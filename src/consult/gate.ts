/**
 * The mechanical validity gate. See `docs/protocol.md`, "The validity gate".
 *
 * A seat's output passes only if it parses as that harness promised, the
 * final message is one JSON document, the document validates against the
 * opinion contract, and every citation resolves inside the evidence pack.
 * Each reason below is mechanical: "garbage" is never a matter of opinion,
 * so a failing seat degrades without anyone arguing about its merit.
 */

import { parseClaudeOutput } from "../adapters/claude.ts";
import { parseCodexOutput } from "../adapters/codex.ts";
import { parseGrokOutput } from "../adapters/grok.ts";
import type { ParseResult } from "../adapters/types.ts";
import { slot, type Harness, type SlotId } from "../core/slots.ts";
import type { CompiledSchema } from "../schema/validator.ts";
import { formatIssues } from "../schema/validator.ts";
import { citedIds, normalizeOpinion, type Opinion } from "./opinion.ts";

const PARSERS: Readonly<Record<Harness, (stdout: string) => ParseResult>> = {
  claude: parseClaudeOutput,
  codex: parseCodexOutput,
  grok: parseGrokOutput,
};

export interface SeatVerdict {
  readonly slot: SlotId;
  /** Kept even when invalid: a degraded seat's usage still goes to the ledger. */
  readonly parse: ParseResult;
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly opinion?: Opinion;
}

export function gateSeatOutput(
  slotId: SlotId,
  stdout: string,
  contract: CompiledSchema,
  packCitations: ReadonlySet<string>,
): SeatVerdict {
  const parse = PARSERS[slot(slotId).harness](stdout);
  if (!parse.ok) {
    return { slot: slotId, parse, valid: false, reasons: [`parse: ${parse.reason}`] };
  }

  let document: unknown;
  try {
    document = JSON.parse(parse.message);
  } catch {
    return {
      slot: slotId,
      parse,
      valid: false,
      reasons: ["opinion: the final message is not one JSON document"],
    };
  }

  const result = contract.validate(document);
  if (!result.ok) {
    return {
      slot: slotId,
      parse,
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
      valid: false,
      reasons: [`citations: ${missing.join(", ")} do not resolve in the evidence pack`],
    };
  }

  return { slot: slotId, parse, valid: true, reasons: [], opinion };
}
