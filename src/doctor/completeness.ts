/**
 * Telemetry completeness. See `docs/protocol.md`, "Telemetry completeness".
 *
 * The skew tripwire and the value checkpoint read folded dispositions, and
 * the party they measure is the party that writes the backfill rows, so the
 * lag itself is measured: a consult is telemetry-complete when every
 * expected finding carries exactly one folded disposition, and an incomplete
 * consult becomes overdue once enough newer consults have run.
 *
 * Expected finding ids enumerate mechanically from the persisted gate
 * record (gate.json), restricted to seats the consult-time ledger row
 * marked valid: a later re-gate of old raw output must not manufacture
 * retroactive debt: re-validating an old seat's output has produced exactly
 * that.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FoldedConsult } from "../consult.ts";

export interface CompletenessParams {
  /** A consult still incomplete after this many newer consults is overdue. */
  readonly overdueAfterConsults: number;
}

/** A setting: revisable, and printed with every report. */
export const COMPLETENESS_PARAMS: CompletenessParams = { overdueAfterConsults: 2 };

export interface ExpectedFinding {
  readonly slot: string;
  readonly finding: string;
}

/** Expected findings per consult; undefined when no gate record exists. */
export type ExpectedReader = (consult: string) => readonly ExpectedFinding[] | undefined;

export interface ConsultCompleteness {
  readonly consult: string;
  /** False when the consult predates the persisted gate: unknowable, not complete. */
  readonly tracked: boolean;
  readonly expected: number;
  readonly dispositioned: number;
  /** "slot/finding" ids with no folded disposition. */
  readonly missing: readonly string[];
  /** "slot/finding" ids with more than one folded disposition. */
  readonly conflicting: readonly string[];
  readonly complete: boolean;
  /** How many consults have run since this one. */
  readonly ageConsults: number;
  readonly overdue: boolean;
}

export function completenessFromLedger(
  consults: readonly FoldedConsult[],
  readExpected: ExpectedReader,
  params: CompletenessParams = COMPLETENESS_PARAMS,
): readonly ConsultCompleteness[] {
  return consults.map((consult, at) => {
    const ageConsults = consults.length - 1 - at;
    const base = {
      consult: consult.consult,
      dispositioned: consult.dispositions.length,
      ageConsults,
    };
    const expected = readExpected(consult.consult);
    if (expected === undefined) {
      return {
        ...base,
        tracked: false,
        expected: 0,
        missing: [],
        conflicting: [],
        complete: false,
        overdue: false,
      };
    }
    const counts = new Map<string, number>();
    for (const disposition of consult.dispositions) {
      const key = `${disposition.slot}/${disposition.finding}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const missing: string[] = [];
    const conflicting: string[] = [];
    for (const finding of expected) {
      const key = `${finding.slot}/${finding.finding}`;
      const seen = counts.get(key) ?? 0;
      if (seen === 0) missing.push(key);
      else if (seen > 1) conflicting.push(key);
    }
    const complete = missing.length === 0 && conflicting.length === 0;
    return {
      ...base,
      tracked: true,
      expected: expected.length,
      missing,
      conflicting,
      complete,
      overdue: !complete && ageConsults >= params.overdueAfterConsults,
    };
  });
}

/** The real reader: gate.json opinions, intersected with consult-time validity. */
export function gateExpectedReader(
  magiDir: string,
  consults: readonly FoldedConsult[],
): ExpectedReader {
  const validSlots = new Map(
    consults.map((consult) => [
      consult.consult,
      new Set(consult.seats.filter((seat) => seat.valid).map((seat) => seat.slot)),
    ]),
  );
  return (consult) => {
    const gatePath = join(magiDir, "consults", consult, "gate.json");
    if (!existsSync(gatePath)) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(gatePath, "utf8"));
    } catch {
      return undefined;
    }
    const verdicts = (parsed as { readonly verdicts?: unknown }).verdicts;
    if (!Array.isArray(verdicts)) return undefined;
    const valid = validSlots.get(consult);
    const expected: ExpectedFinding[] = [];
    for (const verdict of verdicts as readonly {
      readonly slot?: unknown;
      readonly valid?: unknown;
      readonly opinion?: { readonly findings?: unknown };
    }[]) {
      if (typeof verdict.slot !== "string" || verdict.valid !== true) continue;
      if (valid !== undefined && !valid.has(verdict.slot)) continue;
      const findings = verdict.opinion?.findings;
      if (!Array.isArray(findings)) continue;
      for (const finding of findings as readonly { readonly id?: unknown }[]) {
        if (typeof finding.id === "string") {
          expected.push({ slot: verdict.slot, finding: finding.id });
        }
      }
    }
    return expected;
  };
}
