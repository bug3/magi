/**
 * Reading what the Balthasar-2 seat said.
 *
 * `codex exec --json` writes NDJSON: one event per line, from the family
 * `thread.started` / `turn.started` / `item.completed` / `turn.completed`, with
 * `error` and `turn.failed` for the unhappy paths. Each line stands alone, so a
 * frame cut in half by a truncated capture is dropped rather than stitched back
 * together: rejoining halves would report an item the seat never finished
 * writing.
 *
 * These event names must be re-verified against the installed CLI rather than
 * trusted here; `magi doctor` owns that check, because three fast-moving CLIs
 * mean names rot in weeks.
 *
 * Two absences are deliberate. Codex reports tokens and no money, so `costUsd`
 * is never set. And it has no native turn or budget ceiling, so `limit-reached`
 * is never reported: reading one out of message text would be a guess, and the
 * signal has consequences for the ledger.
 */

import type { ParseResult, SeatSignal, SeatUsage } from "./types.ts";
import { asRecord, finiteNumber } from "./types.ts";

/**
 * What provider trouble looks like from outside a process. Only a seat that
 * reached no conclusion of its own is read this way: one that completed a turn
 * and said what went wrong reported a harness failure, not an outage, and only
 * an outage is worth a retry.
 */
const PROVIDER_TROUBLE = /overloaded|rate.?limit|too many requests|5\d\d|econnreset|etimedout/iu;

export function parseCodexOutput(stdout: string): ParseResult {
  if (stdout.trim() === "") return { ok: false, reason: "empty-output" };

  let sawJson = false;
  const events: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    sawJson = true;
    const event = asRecord(parsed);
    if (event !== undefined && typeof event["type"] === "string") events.push(event);
  }

  if (!sawJson) return { ok: false, reason: "not-json" };
  if (events.length === 0) return { ok: false, reason: "wrong-shape" };
  return readEvents(events);
}

function readEvents(events: readonly Record<string, unknown>[]): ParseResult {
  const errorMessages: string[] = [];
  let message: string | undefined;
  let usage: SeatUsage | undefined;
  let completed = false;
  let isError = false;

  for (const event of events) {
    switch (event["type"]) {
      case "item.completed": {
        // Last agent message wins. `codex exec` is single-turn, so there is one
        // in practice; the rule is written down so two would not be ambiguous.
        const text = agentMessageOf(event);
        if (text !== undefined) message = text;
        break;
      }
      case "turn.completed": {
        completed = true;
        // Last wins here too, including a last turn that reported no usage at
        // all: that is not the same as an earlier turn's numbers still holding.
        usage = usageOf(event);
        break;
      }
      case "error": {
        isError = true;
        const text = messageOf(event);
        if (text !== undefined) errorMessages.push(text);
        break;
      }
      case "turn.failed": {
        isError = true;
        // The failure text nests inside the turn frame, and is collected for
        // the one caller that has to tell an outage from a seat that failed on
        // its own terms.
        const text = messageOf(asRecord(event["error"]) ?? {});
        if (text !== undefined) errorMessages.push(text);
        break;
      }
      default:
        break;
    }
  }

  const observed = {
    ...(usage === undefined ? {} : { usage }),
    signals: signalsOf({ completed, isError, errorMessages }),
  };
  if (message === undefined) return { ok: false, reason: "no-final-message", ...observed };
  return { ok: true, message, ...observed };
}

function signalsOf(read: {
  completed: boolean;
  isError: boolean;
  errorMessages: readonly string[];
}): readonly SeatSignal[] {
  const signals: SeatSignal[] = [];
  if (read.completed) signals.push("completed");
  if (read.isError) signals.push("error");
  if (!read.completed && PROVIDER_TROUBLE.test(read.errorMessages.join(" "))) {
    signals.push("provider-trouble");
  }
  return signals;
}

/** The final message is the text of an `agent_message` item, and nothing else. */
function agentMessageOf(event: Record<string, unknown>): string | undefined {
  const item = asRecord(event["item"]) ?? {};
  if (item["type"] !== "agent_message") return undefined;
  return typeof item["text"] === "string" ? item["text"] : undefined;
}

function messageOf(event: Record<string, unknown>): string | undefined {
  return typeof event["message"] === "string" ? event["message"] : undefined;
}

function usageOf(event: Record<string, unknown>): SeatUsage | undefined {
  const tokens = asRecord(event["usage"]) ?? {};
  const usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } = {};

  const input = finiteNumber(tokens["input_tokens"]);
  const output = finiteNumber(tokens["output_tokens"]);
  const cached = finiteNumber(tokens["cached_input_tokens"]);
  if (input !== undefined) usage.inputTokens = input;
  if (output !== undefined) usage.outputTokens = output;
  if (cached !== undefined) usage.cachedInputTokens = cached;

  return Object.keys(usage).length === 0 ? undefined : usage;
}
