/**
 * The consult ledger: append-only JSONL, two kinds of line.
 *
 * A consult row is written at consult time. Dispositions arrive later, at
 * synthesis, and the file is never rewritten, so they land as backfill rows
 * that name their consult; readers fold backfills onto the base row.
 * Measuring cost while ignoring value is how a tool like this flatters
 * itself, so the folded view carries both sides: what each seat spent and
 * how its findings fared.
 */

import { appendFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SeatUsage } from "../adapters/types.ts";
import type { ConsultMode, ConsultStatus } from "../core/consult.ts";
import { ensureDir, fsyncPath } from "../util/fs.ts";
import type { HeadroomSnapshot } from "./headroom.ts";

export interface LedgerSeat {
  readonly slot: string;
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly durationMs: number;
  readonly retried: boolean;
  readonly usage?: SeatUsage;
  /**
   * Canary ids that matched this seat's raw output: evidence of an ambient
   * leak, recorded as a warning. Never an automatic degrade: a canary match
   * has false positives, and degradation stays mechanical (the validity gate).
   */
  readonly canaryWarnings?: readonly string[];
}

export interface LedgerRow {
  readonly consult: string;
  readonly mode: ConsultMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: ConsultStatus;
  readonly seats: readonly LedgerSeat[];
  /** The preflight headroom snapshot; the earliest rows carry free prose. */
  readonly headroom?: HeadroomSnapshot | string;
  /** The preflight completeness lag: present when a consult convened
   * over overdue dispositions, with the user's waiver when one was given. */
  readonly completeness?: CompletenessSnapshot;
}

export interface CompletenessSnapshot {
  readonly waived?: boolean;
  readonly overdue: readonly {
    readonly consult: string;
    readonly undispositioned: number;
    readonly expected: number;
  }[];
}

export interface LedgerDisposition {
  readonly slot: string;
  readonly finding: string;
  readonly disposition: "adopted" | "rejected";
  readonly reason: string;
  /** "<consult>/<slot>/<finding>" when this adoption re-records one already
   * counted (early rows omit the slot). Dedupes only the value metric's
   * unique count; family credit never moves. */
  readonly duplicateOf?: string;
}

export interface LedgerBackfill {
  /** The consult id this backfill belongs to. */
  readonly backfill: string;
  readonly recordedAt: string;
  readonly dispositions: readonly LedgerDisposition[];
  /** "Finding later proved right/wrong" and user-override notes. */
  readonly overrides: readonly string[];
}

/** A canary-calibration record: both directions, per harness. */
export interface LedgerCalibration {
  /** The nonce; doubles as the row-kind marker, like `consult` and `backfill`. */
  readonly calibration: string;
  readonly recordedAt: string;
  readonly results: readonly {
    readonly harness: string;
    readonly direction: string;
    readonly expectation: string;
    readonly nonceSeen: boolean;
    /**
     * The token was in the stream, but only because the seat fetched it.
     * Rows written before the canary told the two apart omit it.
     */
    readonly nonceFetched?: boolean;
    /**
     * This harness's evidence cannot separate the two, so neither is proved.
     * Rows written before that was recorded omit it.
     */
    readonly unproven?: boolean;
    readonly pass: boolean;
  }[];
  /** What was seated when the canaries were proved; the earliest rows omit it. */
  readonly cliVersions?: readonly { readonly harness: string; readonly version?: string }[];
  /** The ambient layers' restored images ("absent" for a created-then-deleted
   * layer), so later drift is detectable. */
  readonly layerHashes?: readonly {
    readonly harness: string;
    readonly path: string;
    readonly sha256: string;
  }[];
}

/** A consult with every backfill row folded in: the ledger's read view. */
export interface FoldedConsult {
  readonly consult: string;
  /** ISO timestamp of the consult row; feeds headroom window arithmetic. */
  readonly startedAt?: string;
  readonly seats: readonly LedgerSeat[];
  readonly dispositions: readonly LedgerDisposition[];
  readonly overrides: readonly string[];
}

export function appendLedgerRow(path: string, row: LedgerRow): void {
  appendLine(path, row);
}

export function appendLedgerBackfill(path: string, row: LedgerBackfill): void {
  appendLine(path, row);
}

export function appendLedgerCalibration(path: string, row: LedgerCalibration): void {
  appendLine(path, row);
}

/** Garbage lines and backfills naming unknown consults are skipped, not fatal. */
export function foldLedger(lines: readonly string[]): readonly FoldedConsult[] {
  const byId = new Map<string, Fold>();
  for (const line of lines) {
    const text = line.trim();
    if (text === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const record = parsed as {
      readonly consult?: unknown;
      readonly backfill?: unknown;
      readonly startedAt?: unknown;
    };
    if (typeof record.consult === "string") {
      byId.set(record.consult, {
        consult: record.consult,
        ...(typeof record.startedAt === "string" ? { startedAt: record.startedAt } : {}),
        seats: asArray<LedgerSeat>(parsed, "seats"),
        dispositions: asArray<LedgerDisposition>(parsed, "dispositions"),
        overrides: asArray<string>(parsed, "overrides"),
      });
    } else if (typeof record.backfill === "string") {
      const target = byId.get(record.backfill);
      if (target === undefined) continue;
      target.dispositions.push(...asArray<LedgerDisposition>(parsed, "dispositions"));
      target.overrides.push(...asArray<string>(parsed, "overrides"));
    }
  }
  return [...byId.values()];
}

interface Fold {
  readonly consult: string;
  readonly startedAt?: string;
  readonly seats: readonly LedgerSeat[];
  readonly dispositions: LedgerDisposition[];
  readonly overrides: string[];
}

/** A field that is not the expected array (legacy row shapes) reads as empty. */
function asArray<T>(record: unknown, field: string): T[] {
  const value = (record as Record<string, unknown>)[field];
  return Array.isArray(value) ? [...(value as T[])] : [];
}

function appendLine(path: string, row: LedgerRow | LedgerBackfill | LedgerCalibration): void {
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  fsyncPath(path);
}
