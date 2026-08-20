/**
 * The value checkpoint. See `docs/protocol.md`, "The value checkpoint".
 *
 * Every tenth consult reports two numbers, adopted unique findings per
 * consult and cost per adopted finding, beside the pooled adoption rate that
 * could inflate them. The threshold band is pre-registered as data, so the
 * bar cannot be set after seeing the score. Comparing is mechanical;
 * deciding is never code's job, and every checkpoint ends in an explicit
 * continue, adjust or stop.
 */

import type { FoldedConsult } from "../consult/ledger.ts";

/** Report cadence, in consults. */
export const VALUE_CHECKPOINT_CONSULTS = 10;

export interface ValueBand {
  /** Continue while adopted-unique per consult is at least this. */
  readonly continueAdoptedPerConsult: number;
  /** Stop-consider when it falls below this... */
  readonly stopConsiderAdoptedPerConsult: number;
  /** ...at this many consecutive checkpoints. */
  readonly stopConsiderConsecutiveCheckpoints: number;
  /** A cost above either ceiling per adopted finding triggers adjust. */
  readonly adjustTokensPerAdopted: number;
  readonly adjustCostUsdPerAdopted: number;
  /** Stop thresholds stay provisional until this many non-self consults ran
   * (consults about repos other than MAGI itself, tracked by hand since
   * each repo's ledger only sees its own consults). */
  readonly stopLockNonSelfConsults: number;
}

/** Pre-registered before the first checkpoint; revisions carry a written
 * reason as a ledger override and apply only to future windows. */
export const VALUE_BAND: ValueBand = {
  continueAdoptedPerConsult: 1,
  stopConsiderAdoptedPerConsult: 0.3,
  stopConsiderConsecutiveCheckpoints: 2,
  adjustTokensPerAdopted: 50_000,
  adjustCostUsdPerAdopted: 2,
  stopLockNonSelfConsults: 3,
};

export interface ValueReport {
  readonly consults: number;
  /** Adopted dispositions, minus duplicate re-records of a counted finding. */
  readonly adoptedUnique: number;
  /** Every folded disposition, duplicates included. */
  readonly dispositioned: number;
  /** Adopted share of every disposition: generosity inflation stays visible. */
  readonly adoptionRate?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Summed only where the CLI reported a figure itself. */
  readonly costUsd: number;
  /** True once the report cadence is reached; the derived metrics appear. */
  readonly checkpoint: boolean;
  readonly consultsUntilCheckpoint: number;
  readonly adoptedPerConsult?: number;
  readonly costPerAdoptedUsd?: number;
}

export function valueFromLedger(consults: readonly FoldedConsult[]): ValueReport {
  let adoptedUnique = 0;
  let adopted = 0;
  let dispositioned = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for (const consult of consults) {
    for (const disposition of consult.dispositions) {
      dispositioned += 1;
      if (disposition.disposition === "adopted") adopted += 1;
      if (disposition.disposition === "adopted" && disposition.duplicateOf === undefined) {
        adoptedUnique += 1;
      }
    }
    for (const seat of consult.seats) {
      inputTokens += seat.usage?.inputTokens ?? 0;
      outputTokens += seat.usage?.outputTokens ?? 0;
      costUsd += seat.usage?.costUsd ?? 0;
    }
  }

  const count = consults.length;
  const checkpoint = count >= VALUE_CHECKPOINT_CONSULTS;
  const base = {
    consults: count,
    adoptedUnique,
    dispositioned,
    ...(dispositioned === 0 ? {} : { adoptionRate: adopted / dispositioned }),
    inputTokens,
    outputTokens,
    costUsd,
    checkpoint,
    consultsUntilCheckpoint: VALUE_CHECKPOINT_CONSULTS - (count % VALUE_CHECKPOINT_CONSULTS),
  };
  if (!checkpoint) return base;
  return {
    ...base,
    adoptedPerConsult: adoptedUnique / count,
    ...(adoptedUnique === 0 ? {} : { costPerAdoptedUsd: costUsd / adoptedUnique }),
  };
}
