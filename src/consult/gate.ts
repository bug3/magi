/**
 * The mechanical validity gate. See `docs/protocol.md`, "The validity gate".
 *
 * A seat's output passes only if it parses as that harness promised, the
 * final message is one JSON document, the document validates against the
 * opinion contract, and every citation resolves inside the evidence pack.
 * Each reason below is mechanical: "garbage" is never a matter of opinion,
 * so a failing seat degrades without anyone arguing about its merit.
 */

import { SEAT_PARSERS } from "../adapters/parsers.ts";
import type { ParseResult } from "../adapters/types.ts";
import { slot, type SlotId } from "../core/slots.ts";
import { seatAnswered, unansweredReason, type SeatOutput } from "../seats/answer.ts";
import type { CompiledSchema } from "../schema/validator.ts";
import { formatIssues } from "../schema/validator.ts";
import { citedIds, normalizeOpinion, type Opinion } from "./opinion.ts";

export interface SeatVerdict {
  readonly slot: SlotId;
  /** Kept even when invalid: a degraded seat's usage still goes to the ledger. */
  readonly parse: ParseResult;
  /**
   * The seat produced an answer of its own. An opinion from a seat that did
   * not is never valid, so it never counts toward the consult's family total:
   * a well-formed document a harness wrote while telling you it never ran is
   * not a second opinion, and counting it is how one becomes a quorum.
   */
  readonly answered: boolean;
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly opinion?: Opinion;
}

/**
 * The whole run, not just its bytes: a seat's validity rests on the process
 * that produced them as much as on what they say.
 */
export function gateSeatOutput(
  slotId: SlotId,
  output: SeatOutput,
  contract: CompiledSchema,
  packCitations: ReadonlySet<string>,
): SeatVerdict {
  const harness = slot(slotId).harness;
  const parse = SEAT_PARSERS[harness](output.stdout);
  const answered = seatAnswered(harness, output);
  if (!parse.ok) {
    return { slot: slotId, parse, answered, valid: false, reasons: [`parse: ${parse.reason}`] };
  }
  if (!answered) {
    return {
      slot: slotId,
      parse,
      answered,
      valid: false,
      reasons: [`the seat did not answer: ${unansweredReason(harness, output)}`],
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(parse.message);
  } catch {
    return {
      slot: slotId,
      parse,
      answered,
      valid: false,
      reasons: ["opinion: the final message is not one JSON document"],
    };
  }

  const result = contract.validate(document);
  if (!result.ok) {
    return {
      slot: slotId,
      parse,
      answered,
      valid: false,
      reasons: [`schema: ${formatIssues(result.issues)}`],
    };
  }

  const opinion = normalizeOpinion(document);
  const missing = citedIds(opinion).filter((citation) => !packCitations.has(citation));
  if (missing.length > 0) {
    return {
      slot: slotId,
      parse,
      answered,
      valid: false,
      reasons: [`citations: ${missing.join(", ")} do not resolve in the evidence pack`],
    };
  }

  return { slot: slotId, parse, answered, valid: true, reasons: [], opinion };
}
