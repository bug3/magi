/**
 * Reading what the Melchior-1 seat said.
 *
 * `claude -p --output-format json` writes one JSON document to stdout: a
 * `result` frame carrying the final text, the token counts and the USD figure
 * this harness reports itself. The whole of stdout is
 * that document, so it is parsed strictly and as a whole: a prefix or suffix of
 * anything else means the seat did not write what its launch profile promised,
 * and that is a failure, not something to search past.
 *
 * The field and subtype names below must be re-verified against the installed
 * CLI rather than trusted here; `magi doctor` owns that check, because three
 * fast-moving CLIs mean names rot in weeks.
 */

import type { ParseResult, SeatSignal, SeatUsage } from "./types.ts";
import { asRecord, finiteNumber } from "./types.ts";

/** Subtypes that mean a ceiling was hit rather than the work going wrong. */
const LIMIT_SUBTYPES = new Set(["error_max_turns", "error_max_budget", "error_max_tokens"]);

export function parseClaudeOutput(stdout: string): ParseResult {
  const text = stdout.trim();
  if (text === "") return { ok: false, reason: "empty-output" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  const document = asRecord(parsed);
  if (document === undefined || document["type"] !== "result") {
    return { ok: false, reason: "wrong-shape" };
  }

  const usage = usageOf(document);
  const observed = {
    ...(usage === undefined ? {} : { usage }),
    signals: signalsOf(document),
  };

  const message = document["result"];
  if (typeof message !== "string") return { ok: false, reason: "no-final-message", ...observed };
  return { ok: true, message, ...observed };
}

/**
 * A document arrived, so the seat reached a conclusion of its own: whatever
 * else it says, `completed` holds. `provider-trouble` never does, for the same
 * reason - a seat that finished and said what went wrong reported a harness
 * failure, not an infrastructure one.
 */
function signalsOf(document: Record<string, unknown>): readonly SeatSignal[] {
  const subtype = typeof document["subtype"] === "string" ? document["subtype"] : "";
  const signals: SeatSignal[] = ["completed"];
  if (document["is_error"] === true || (subtype !== "" && subtype !== "success")) {
    signals.push("error");
  }
  if (LIMIT_SUBTYPES.has(subtype)) signals.push("limit-reached");
  return signals;
}

function usageOf(document: Record<string, unknown>): SeatUsage | undefined {
  const tokens = asRecord(document["usage"]) ?? {};
  const usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    costUsd?: number;
  } = {};

  const input = finiteNumber(tokens["input_tokens"]);
  const output = finiteNumber(tokens["output_tokens"]);
  const cached = finiteNumber(tokens["cache_read_input_tokens"]);
  // The one harness that states money itself: recorded as reported, never
  // recomputed from a price table.
  const cost = finiteNumber(document["total_cost_usd"]);

  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (cached !== undefined) usage.cachedInputTokens = cached;
  if (cost !== undefined) usage.costUsd = cost;

  return Object.keys(usage).length === 0 ? undefined : usage;
}
