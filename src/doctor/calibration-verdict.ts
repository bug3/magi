/**
 * What one probe round proves, per harness and direction.
 *
 * A row rests on two questions and the order between them is the whole point:
 * did the seat answer, and only then did the nonce reach it on its own. What
 * the canary asserts is mostly an absence, and a seat that could not answer
 * produces no nonce either, so its isolated row scored `ok` for exactly the
 * same reason a properly isolated seat's did. That is not a pass. It is a
 * measurement that did not happen, and it is recorded as one.
 *
 * Found live: a seat launched without `USER` answered nothing for six calls
 * while the calibration reported its isolated direction clean and failed the
 * unisolated one, which pointed at isolation when the fault was
 * authentication. The two-round protocol is what caught it at all, and it
 * stays exactly as it is; with only the isolated round a dead seat would have
 * calibrated clean forever. The narrow defect was the per-row verdict, here.
 */

import type { Harness } from "../core/slots.ts";
import { UNPROVEN_BY_CONSTRUCTION, nonceWasFetched } from "./calibration-evidence.ts";
import { CALIBRATION_LAYERS } from "./calibration-layers.ts";

export type CalibrationRound = "isolated" | "unisolated";

/** One seat's whole output for one round. */
export interface RoundOutput {
  /**
   * Both streams together: a harness that prints the nonce on stderr leaks
   * exactly as much as one that prints it on stdout.
   */
  readonly stream: string;
  /** `seatAnswered`: the run finished, parsed, and reported no failure of its own. */
  readonly answered: boolean;
}

export interface CalibrationDirection {
  readonly harness: Harness;
  readonly direction: CalibrationRound;
  readonly expectation: "absent" | "present" | "informational";
  /**
   * The seat produced an answer of its own. False makes the row
   * inconclusive: nothing about isolation was measured, in either direction.
   */
  readonly answered: boolean;
  /** The layer reached the seat on its own: the only thing that counts. */
  readonly nonceSeen: boolean;
  /**
   * The token is in the stream, but only after the seat fetched it. Recorded
   * because it says the seat can read the layer, and judged as nothing else.
   */
  readonly nonceFetched: boolean;
  /**
   * This harness's evidence cannot separate a token it was handed from one it
   * fetched, so the direction is recorded and not read as proof of either.
   */
  readonly unproven: boolean;
  /** The ledger's older, coarser word: true only for a row that proved its
   * expectation. An inconclusive row is never true and never claims to be. */
  readonly pass: boolean;
}

export function judgeDirections(
  outputs: Readonly<Record<CalibrationRound, ReadonlyMap<Harness, RoundOutput>>>,
  nonce: string,
): readonly CalibrationDirection[] {
  const results: CalibrationDirection[] = [];
  for (const direction of ["isolated", "unisolated"] as const) {
    for (const layer of CALIBRATION_LAYERS) {
      const output = outputs[direction].get(layer.harness);
      const stream = output?.stream ?? "";
      const answered = output?.answered ?? false;
      const nonceFetched = nonceWasFetched(layer.harness, stream, nonce);
      const nonceSeen = !nonceFetched && stream.includes(nonce);
      const expectation = direction === "unisolated" ? "present" : layer.isolated;
      results.push({
        harness: layer.harness,
        direction,
        expectation,
        answered,
        nonceSeen,
        nonceFetched,
        unproven: UNPROVEN_BY_CONSTRUCTION.has(layer.harness),
        pass: measured({ answered, nonceSeen }) && proves(expectation, nonceSeen),
      });
    }
  }
  return results;
}

/**
 * Whether the row measured anything at all, which is what separates a failure
 * from a row with no evidence under it. A seat that answered measured its
 * direction. So did a stream carrying the token, whatever the seat then did
 * with its turn: a leak that turned up beside a harness error is still a leak,
 * and that is the one direction a false negative must not be possible in.
 * Only an absence needs an answer behind it to mean anything.
 */
export function measured(result: Pick<CalibrationDirection, "answered" | "nonceSeen">): boolean {
  return result.answered || result.nonceSeen;
}

/** Only ever asked of a row that measured something; the rest proved nothing. */
function proves(expectation: CalibrationDirection["expectation"], nonceSeen: boolean): boolean {
  if (expectation === "present") return nonceSeen;
  if (expectation === "absent") return !nonceSeen;
  return true;
}
