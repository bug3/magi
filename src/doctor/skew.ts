/**
 * The family-skew tripwire. See `docs/protocol.md`, "Family skew".
 *
 * Anonymization was dropped: with three known candidates, stylometry defeats
 * label shuffling. Measurement is the bias mitigation that replaced it, read
 * off the combined recommend-and-decide stream, and a tripwire without numbers
 * can never fire, so the rule is mechanical and its numbers are settings.
 * Recomputed from the folded ledger on every doctor run: there is no stored
 * trip state, and hysteresis is derived by replaying the ledger in consult
 * order.
 */

import type { FoldedConsult } from "../consult.ts";
import { SLOTS, type Harness } from "../core/slots.ts";

export interface SkewParams {
  /** Rolling window: only the last this-many consults count. */
  readonly windowConsults: number;
  /** Arming floor: EACH side needs this many dispositioned findings in the window. */
  readonly minPerSide: number;
  /** Trip when the melchior rate exceeds the pooled foreign rate by MORE than this. */
  readonly tripPoints: number;
  /** Hysteresis: an armed trip clears when the gap falls strictly below this... */
  readonly clearPoints: number;
  /** ...or after this many consecutive armed evaluations at or under the trip line. */
  readonly clearDwellConsults: number;
}

/** Settings: revisable, and printed with every report. */
export const SKEW_PARAMS: SkewParams = {
  windowConsults: 10,
  minPerSide: 6,
  tripPoints: 33,
  clearPoints: 25,
  clearDwellConsults: 3,
};

export type SkewState = "unarmed" | "clear" | "tripped";

export interface RateSample {
  readonly adopted: number;
  readonly total: number;
}

/** One foreign family's window sample: printed beside the pooled gap. */
export interface FamilyGap {
  readonly harness: Harness;
  readonly adopted: number;
  readonly total: number;
  /** Melchior minus this family, percentage points; absent when a side is empty. */
  readonly gapPoints?: number;
}

export interface SkewReport {
  readonly state: SkewState;
  /** Whether the current window meets the per-side floor. A trip is latched:
   * it can hold while unarmed, until an adequate recovery sample clears it. */
  readonly armed: boolean;
  readonly consultsInWindow: number;
  readonly findingsInWindow: number;
  readonly melchior: RateSample;
  readonly foreign: RateSample;
  /** Per foreign family, informational: the trip reads only the pooled gap. */
  readonly families: readonly FamilyGap[];
  /** Percentage points, melchior minus pooled foreign; absent when a side is empty. */
  readonly gapPoints?: number;
  readonly params: SkewParams;
}

export function skewFromLedger(
  consults: readonly FoldedConsult[],
  params: SkewParams = SKEW_PARAMS,
): SkewReport {
  // Replay the latch across history: every consult boundary is evaluated on
  // its own window, so activation, hysteresis and deactivation are all
  // reproducible from the folded ledger alone.
  let tripped = false;
  let dwell = 0;
  for (let at = 0; at < consults.length; at += 1) {
    const rates = windowRates(consults, at, params);
    const armed =
      rates.melchior.total >= params.minPerSide && rates.foreign.total >= params.minPerSide;
    if (!armed) {
      // A latched trip survives an under-floor window (no adequate sample to
      // clear on); the dwell counter only advances while armed.
      dwell = 0;
      continue;
    }
    const gap = gapPoints(rates.melchior, rates.foreign);
    if (!tripped) {
      if (gap > params.tripPoints) tripped = true;
      dwell = 0;
    } else if (gap < params.clearPoints) {
      tripped = false;
      dwell = 0;
    } else if (gap <= params.tripPoints) {
      dwell += 1;
      if (dwell >= params.clearDwellConsults) {
        tripped = false;
        dwell = 0;
      }
    } else {
      dwell = 0;
    }
  }

  const rates = windowRates(consults, consults.length - 1, params);
  const armed =
    rates.melchior.total >= params.minPerSide && rates.foreign.total >= params.minPerSide;
  const families = SLOTS.filter((definition) => definition.harness !== "claude").map(
    (definition): FamilyGap => {
      const sample = rates.byHarness.get(definition.harness) ?? { adopted: 0, total: 0 };
      return {
        harness: definition.harness,
        ...sample,
        ...(rates.melchior.total > 0 && sample.total > 0
          ? { gapPoints: gapPoints(rates.melchior, sample) }
          : {}),
      };
    },
  );
  return {
    state: tripped ? "tripped" : armed ? "clear" : "unarmed",
    armed,
    consultsInWindow: rates.consults,
    findingsInWindow: rates.melchior.total + rates.foreign.total,
    melchior: rates.melchior,
    foreign: rates.foreign,
    families,
    ...(rates.melchior.total > 0 && rates.foreign.total > 0
      ? { gapPoints: gapPoints(rates.melchior, rates.foreign) }
      : {}),
    params,
  };
}

interface WindowRates {
  readonly consults: number;
  readonly melchior: RateSample;
  readonly foreign: RateSample;
  readonly byHarness: ReadonlyMap<Harness, RateSample>;
}

/**
 * Family credit is mechanical: every disposition counts for the family
 * that raised it, including duplicate-marked re-records; `duplicateOf`
 * deduplicates only the value metric's unique count (src/doctor/value.ts).
 */
function windowRates(
  consults: readonly FoldedConsult[],
  endAt: number,
  params: SkewParams,
): WindowRates {
  const window =
    endAt < 0 ? [] : consults.slice(Math.max(0, endAt + 1 - params.windowConsults), endAt + 1);
  const byHarness = new Map<Harness, { adopted: number; total: number }>();
  for (const consult of window) {
    for (const disposition of consult.dispositions) {
      const harness = SLOTS.find((slot) => slot.id === disposition.slot)?.harness;
      if (harness === undefined) continue;
      const sample = byHarness.get(harness) ?? { adopted: 0, total: 0 };
      sample.total += 1;
      if (disposition.disposition === "adopted") sample.adopted += 1;
      byHarness.set(harness, sample);
    }
  }
  const melchior = byHarness.get("claude") ?? { adopted: 0, total: 0 };
  const foreign = { adopted: 0, total: 0 };
  for (const [harness, sample] of byHarness) {
    if (harness === "claude") continue;
    foreign.adopted += sample.adopted;
    foreign.total += sample.total;
  }
  return { consults: window.length, melchior, foreign, byHarness };
}

/** Integer numerator over integer denominator: a gap landing exactly on a
 * threshold must compare exactly, not through float rate subtraction. */
function gapPoints(melchior: RateSample, other: RateSample): number {
  return (
    ((melchior.adopted * other.total - other.adopted * melchior.total) * 100) /
    (melchior.total * other.total)
  );
}
