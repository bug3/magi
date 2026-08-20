/**
 * The preflight headroom check. See `docs/protocol.md`, "Headroom".
 *
 * No installed CLI reports remaining subscription quota headlessly (verified
 * 2026-08-20: `claude auth status --json` is auth-only; codex and grok expose
 * no quota surface; no seat envelope carries a remaining field). Headroom is
 * therefore a budget model, not a measurement: the owner allots MAGI a
 * per-harness token budget per rolling window, and everything outside the
 * allotment stays reserved for the orchestrator session. The result estimates
 * token burn; it is not remaining-quota telemetry or a price quote. No config
 * file means report-only: the numbers print, nothing refuses.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SLOTS, type Harness } from "../core/slots.ts";
import type { FoldedConsult, LedgerSeat } from "./ledger.ts";

export interface HeadroomConfig {
  readonly windowHours: number;
  /** Tokens (input + output) MAGI may spend per window, per harness. */
  readonly budgets: Readonly<Partial<Record<Harness, number>>>;
}

export const DEFAULT_WINDOW_HOURS = 5;
/** How many recent appearances of a harness feed its burn projection. */
const PROJECTION_SAMPLE = 5;

/** Owner budgets are personal numbers: gitignored, absent means report-only. */
export function loadHeadroomConfig(magiDir: string): HeadroomConfig | undefined {
  const path = join(magiDir, "headroom.local.json");
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  const record = parsed as { readonly windowHours?: unknown; readonly budgets?: unknown };
  const windowHours = record.windowHours ?? DEFAULT_WINDOW_HOURS;
  if (typeof windowHours !== "number" || windowHours <= 0) {
    throw new Error(`${path}: windowHours must be a positive number`);
  }
  const budgets = record.budgets;
  if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) {
    throw new Error(`${path}: budgets must be an object of { harness: tokens }`);
  }
  const known = new Set<string>(SLOTS.map((definition) => definition.harness));
  for (const [harness, tokens] of Object.entries(budgets)) {
    if (!known.has(harness)) throw new Error(`${path}: unknown harness "${harness}"`);
    if (typeof tokens !== "number" || tokens < 0) {
      throw new Error(`${path}: budget for ${harness} must be a non-negative token count`);
    }
  }
  return { windowHours, budgets: budgets as HeadroomConfig["budgets"] };
}

export interface HarnessHeadroom {
  readonly harness: Harness;
  readonly spentInWindow: number;
  /** Mean tokens of this harness's recent appearances; absent without history. */
  readonly projectedBurn?: number;
  /** What preflight compares against the budget: the larger of the historical
   * mean and this consult's rendered-size estimate. */
  readonly projection?: number;
  readonly budget?: number;
  readonly remaining?: number;
}

export interface HeadroomReport {
  readonly configured: boolean;
  readonly windowHours: number;
  /** Estimated tokens of this consult's rendered brief plus pack (chars/4). */
  readonly estimatedBriefTokens?: number;
  readonly harnesses: readonly HarnessHeadroom[];
  /** True when a budgeted harness is spent or cannot fit the projection. */
  readonly refuse: boolean;
}

/** The size heuristic: about four characters per token, rounded up. */
export function estimateBriefTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** What the ledger row records: the report, plus whether the user overrode it. */
export interface HeadroomSnapshot {
  readonly configured: boolean;
  readonly waived?: boolean;
  readonly windowHours?: number;
  readonly harnesses?: readonly HarnessHeadroom[];
  readonly refuse?: boolean;
}

export function headroomReport(
  consults: readonly FoldedConsult[],
  config: HeadroomConfig | undefined,
  now: Date,
  estimatedBriefTokens?: number,
): HeadroomReport {
  const windowHours = config?.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStart = now.getTime() - windowHours * 3_600_000;

  const harnesses = SLOTS.map((definition): HarnessHeadroom => {
    const appearances = consults.flatMap((consult) =>
      consult.seats
        .filter((seat) => seat.slot === definition.id && seat.usage !== undefined)
        .map((seat) => ({ tokens: seatTokens(seat), startedAt: consult.startedAt })),
    );
    const spentInWindow = appearances
      .filter((a) => a.startedAt !== undefined && Date.parse(a.startedAt) >= windowStart)
      .reduce((sum, a) => sum + a.tokens, 0);
    const recent = appearances.slice(-PROJECTION_SAMPLE);
    const budget = config?.budgets[definition.harness];
    const projectedBurn =
      recent.length === 0
        ? undefined
        : Math.round(recent.reduce((sum, a) => sum + a.tokens, 0) / recent.length);
    const projection =
      projectedBurn === undefined && estimatedBriefTokens === undefined
        ? undefined
        : Math.max(projectedBurn ?? 0, estimatedBriefTokens ?? 0);
    return {
      harness: definition.harness,
      spentInWindow,
      ...(projectedBurn === undefined ? {} : { projectedBurn }),
      ...(projection === undefined ? {} : { projection }),
      ...(budget === undefined ? {} : { budget, remaining: budget - spentInWindow }),
    };
  });

  return {
    configured: config !== undefined,
    windowHours,
    ...(estimatedBriefTokens === undefined ? {} : { estimatedBriefTokens }),
    harnesses,
    refuse: harnesses.some(
      (h) =>
        h.remaining !== undefined &&
        (h.remaining <= 0 || (h.projection !== undefined && h.projection > h.remaining)),
    ),
  };
}

export function formatHeadroomReport(report: HeadroomReport): string {
  const source = report.configured
    ? "budgets from .magi/headroom.local.json"
    : "no budgets configured: report-only";
  const lines = [`headroom (window ${report.windowHours}h; ${source})`];
  if (report.estimatedBriefTokens !== undefined) {
    lines.push(`  this brief+pack: ~${report.estimatedBriefTokens} tokens rendered (chars/4)`);
  }
  for (const h of report.harnesses) {
    const projected =
      h.projectedBurn === undefined ? "no history to project" : `mean ${h.projectedBurn}`;
    const projection = h.projection === undefined ? "" : `, projection ${h.projection}`;
    const budget =
      h.budget === undefined ? "no budget" : `budget ${h.budget}, remaining ${h.remaining}`;
    lines.push(
      `  ${h.harness}: spent ${h.spentInWindow} in window, ${projected}${projection}, ${budget}`,
    );
  }
  lines.push(
    report.refuse
      ? "  preflight: REFUSED, the projection does not fit the remaining allotment"
      : "  preflight: ok",
  );
  return lines.join("\n");
}

function seatTokens(seat: LedgerSeat): number {
  return (seat.usage?.inputTokens ?? 0) + (seat.usage?.outputTokens ?? 0);
}
