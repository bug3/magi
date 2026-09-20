/**
 * Whether a seat answered at all, told apart from what it said.
 *
 * Every mechanism that reads a seat's output first needs this one bit, and it
 * is not the same as a zero exit or a parseable document. A harness can exit
 * cleanly, write the document its launch profile promised, and say in it that
 * it never reached the model: claude reports a login failure exactly that way,
 * as a well-formed result frame carrying `is_error`. A caller that reads only
 * the text then treats a seat that could not run as a seat that had nothing to
 * say, which is how a dead seat calibrated clean.
 *
 * So the rule lives here once: the process finished on its own, the parser
 * recognised what it wrote, and the seat did not report its own failure.
 */

import { SEAT_PARSERS } from "../adapters/parsers.ts";
import type { Harness } from "../core/slots.ts";
import type { ExecResult } from "../runtime/exec.ts";

/**
 * A timeout, a signal, a spawn error and a cancellation all mean the seat
 * produced no result to read, whatever landed on its streams. A nonzero exit
 * is not in that list on purpose: a harness that finished and wrote its
 * document answered, whatever code it chose to leave with.
 */
export function seatAnswered(
  harness: Harness,
  result: Pick<ExecResult, "outcome" | "stdout">,
): boolean {
  if (result.outcome.kind !== "exit") return false;
  const parse = SEAT_PARSERS[harness](result.stdout);
  return parse.ok && !(parse.signals ?? []).includes("error");
}
