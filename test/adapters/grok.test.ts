/**
 * The Casper-3 seat writes one result envelope and nothing else (verified
 * live): `text` carries the constrained JSON as a string,
 * `structuredOutput` the same document parsed, plus usage and cost. What is
 * under test is mostly the refusals: this is the seat that has leaked local
 * config into an English-briefed answer, and the parser must let that show.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseGrokOutput } from "../../src/adapters/grok.ts";

const OPINION = JSON.stringify({
  position: "the coded judiciary should go",
  findings: [{ id: "F1", claim: "economics are unmeasured" }],
});

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    text: OPINION,
    structuredOutput: JSON.parse(OPINION),
    stopReason: "end_turn",
    sessionId: "s-1",
    num_turns: 1,
    usage: { input_tokens: 19221, output_tokens: 6845, cache_read_input_tokens: 1408 },
    total_cost_usd: 0.0136,
    ...overrides,
  });
}

test("the envelope's text is returned verbatim, as the validator will read it", () => {
  const parsed = parseGrokOutput(`\n  ${envelope()}\n`);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.message, OPINION, "the seat's own bytes for the contract");
  assert.deepEqual(parsed.signals, ["completed"]);
  assert.equal(parsed.usage?.inputTokens, 19221);
  assert.equal(parsed.usage?.outputTokens, 6845);
  assert.equal(parsed.usage?.cachedInputTokens, 1408);
  assert.equal(parsed.usage?.costUsd, 0.0136);
});

test("an empty text falls back to the parsed structuredOutput", () => {
  const parsed = parseGrokOutput(envelope({ text: "" }));

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && JSON.parse(parsed.message), JSON.parse(OPINION));
});

test("an envelope with neither text nor structured output said nothing", () => {
  const parsed = parseGrokOutput(envelope({ text: "", structuredOutput: undefined }));

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "no-final-message");
  assert.equal(parsed.usage?.outputTokens, 6845, "usage still reaches the ledger");
});

test("the CLI's own error envelope is a typed failure carrying the error signal", () => {
  const parsed = parseGrokOutput('{"type":"error","message":"API error (status 400)"}');

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "wrong-shape");
  assert.deepEqual(parsed.signals, ["error"]);
});

test("a stop reason other than end_turn is flagged alongside completion", () => {
  const parsed = parseGrokOutput(envelope({ stopReason: "max_turns" }));

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.signals, ["completed", "error"]);
});

test("the seat's real leaked answer is a typed failure, never a rescued payload", () => {
  // A preamble in the language of the machine's own config, in front of the
  // answer. Recovering JSON from the middle would hide the breach.
  const leaked = readFileSync(
    join("fixtures", "seat-capture", "casper-leaked-preamble.md"),
    "utf8",
  );
  const parsed = parseGrokOutput(leaked);

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "not-json");
});

test("a preamble in front of a valid envelope is refused rather than searched past", () => {
  const parsed = parseGrokOutput(`Brief'i yalnizca baglam olarak aliyorum.\n${envelope()}`);

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "not-json");
});

test("a JSON array is not a result envelope", () => {
  const parsed = parseGrokOutput('[{"id":"F1"}]');

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "wrong-shape");
});
