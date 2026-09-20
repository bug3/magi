/**
 * Whether a seat answered at all, told apart from what it said.
 *
 * Every mechanism that reads a seat's output first needs this one bit, and it
 * is not the same as a zero exit or a parseable document. A harness can exit
 * cleanly, write the document its launch profile promised, and say in it that
 * it never reached the model: claude reports a login failure exactly that way,
 * as a well-formed result frame carrying `is_error`. A caller that reads only
 * the text then treats a seat that could not run as a seat that had nothing to
 * say, which is how a dead seat calibrated clean, smoked healthy and gated
 * valid: three modules, the same mistake three times.
 *
 * So the rule lives here once, and so does its explanation, because a caller
 * left to restate why a seat is silent will restate it differently.
 */

import { SEAT_PARSERS } from "../adapters/parsers.ts";
import type { Harness } from "../core/slots.ts";
import type { ExecResult } from "../runtime/exec.ts";
import { sanitizeLine } from "../util/text.ts";

/** What a seat left behind: everything this rule is allowed to look at. */
export type SeatOutput = Pick<ExecResult, "outcome" | "stdout" | "truncated">;

/** Bound for the harness's own words on a one-line report. */
const REASON_WIDTH = 160;

/**
 * Four ways to have said nothing, and two that are not on the list.
 *
 * - A timeout, a signal, a spawn error and a cancellation produced no result
 *   to read, whatever landed on the streams.
 * - A capture cut at the output ceiling cannot be evidence of what is not in
 *   it, and an absence is exactly what the canary reads off one.
 * - Output the harness's own parser rejects, or a final message with nothing
 *   in it: an empty answer is not a measurement, and only one of the three
 *   parsers refuses it on its own.
 * - A failure the seat reported about itself.
 *
 * Not on the list: a nonzero exit, which a harness that finished and wrote its
 * document is free to leave with, and a ceiling. A turn or token limit ends a
 * seat that did reach a conclusion and did write it down, which is what
 * `limit-reached` says and why the vocabulary keeps it apart from `error`.
 *
 * Grok is the gap. Its parser maps every stop reason other than `end_turn` to
 * `error`, ceilings included, so a grok seat cut off by the `--max-turns` its
 * own profile sets reads here as one that did not answer. That errs in the
 * safe direction, a row going inconclusive rather than quietly ok, and it is
 * left standing rather than papered over: naming that CLI's stop reasons means
 * verifying them against the installed one, not writing down what they are
 * probably called.
 */
export function seatAnswered(harness: Harness, result: SeatOutput): boolean {
  if (result.outcome.kind !== "exit") return false;
  if (result.truncated) return false;
  const parse = SEAT_PARSERS[harness](result.stdout);
  if (!parse.ok || parse.message.trim() === "") return false;
  const signals = parse.signals ?? [];
  return !signals.includes("error") || signals.includes("limit-reached");
}

/**
 * Why it did not answer, in the seat's own words wherever it said so. A screen
 * that reports a silent seat has to carry the cause or the operator goes
 * looking for it: the raw record opens with a usage blob, and the sentence
 * that matters sits at the far end of the same line.
 */
export function unansweredReason(harness: Harness, result: SeatOutput): string {
  if (result.outcome.kind !== "exit") return `the run produced no result: ${result.outcome.kind}`;
  if (result.truncated) {
    return "the capture hit the output ceiling, so what is missing from it proves nothing";
  }
  const parse = SEAT_PARSERS[harness](result.stdout);
  if (!parse.ok) return `the output did not parse: ${parse.reason}`;
  if (parse.message.trim() === "") return "the seat's final message was empty";
  return `the seat reported its own failure: ${sanitizeLine(parse.message, REASON_WIDTH)}`;
}
