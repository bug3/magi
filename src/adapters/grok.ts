/**
 * Reading what the Casper-3 seat said.
 *
 * Grok runs with `--json-schema <contract>`, which implies
 * `--output-format json`: the whole of stdout is ONE result envelope
 * (verified live): `text` carries the model's constrained
 * JSON as a string, `structuredOutput` the same document parsed, plus
 * usage and cost fields. An error envelope (`{"type":"error",...}`)
 * arrives the same way.
 *
 * Nothing is recovered from the middle of anything. Prose around the
 * envelope is a failure, and deliberately so: this seat has been seen
 * opening an English-briefed answer with a preamble in the language of the
 * machine's own local config. A parser that fished JSON out of such a reply
 * would hide exactly the isolation breach the run needs to see, so a seat
 * that leaks degrades mechanically instead.
 */

import type { ParseResult, SeatSignal, SeatUsage } from "./types.ts";
import { asRecord, finiteNumber } from "./types.ts";

export function parseGrokOutput(stdout: string): ParseResult {
  const text = stdout.trim();
  if (text === "") return { ok: false, reason: "empty-output" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  const document = asRecord(parsed);
  if (document === undefined) return { ok: false, reason: "wrong-shape" };

  // The CLI reports its own failure as an error envelope on stdout.
  if (document["type"] === "error") {
    return { ok: false, reason: "wrong-shape", signals: ["error"] };
  }

  const usage = usageOf(document);
  const observed = {
    ...(usage === undefined ? {} : { usage }),
    signals: signalsOf(document),
  };

  // The seat's exact bytes, as the schema validator downstream will judge
  // them; the parsed structuredOutput is only a fallback serialization.
  const message =
    typeof document["text"] === "string" && document["text"] !== ""
      ? document["text"]
      : serializedStructuredOutput(document);
  if (message === undefined) return { ok: false, reason: "no-final-message", ...observed };
  return { ok: true, message, ...observed };
}

function serializedStructuredOutput(document: Record<string, unknown>): string | undefined {
  const structured = asRecord(document["structuredOutput"]);
  return structured === undefined ? undefined : JSON.stringify(structured);
}

function signalsOf(document: Record<string, unknown>): readonly SeatSignal[] {
  const signals: SeatSignal[] = ["completed"];
  const stop = document["stopReason"];
  if (typeof stop === "string" && stop !== "end_turn") signals.push("error");
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
  const cost = finiteNumber(document["total_cost_usd"]);

  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (cached !== undefined) usage.cachedInputTokens = cached;
  if (cost !== undefined) usage.costUsd = cost;

  return Object.keys(usage).length === 0 ? undefined : usage;
}
