/**
 * What the Melchior-1 seat's one JSON document means in MAGI's vocabulary,
 * including the USD figure no other harness reports.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseClaudeOutput } from "../../src/adapters/claude.ts";

/** A result document shaped like the harness's, with the fields MAGI reads. */
function resultDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "changed the retry policy",
    total_cost_usd: 0.0421,
    usage: { input_tokens: 12_000, output_tokens: 900, cache_read_input_tokens: 4000 },
    ...overrides,
  });
}

test("what the document said becomes what MAGI recorded", () => {
  const parsed = parseClaudeOutput(`\n${resultDocument()}\n`);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.message, "changed the retry policy");
  assert.deepEqual(parsed.usage, {
    inputTokens: 12_000,
    outputTokens: 900,
    cachedInputTokens: 4000,
    // The one harness that states money itself: recorded as reported.
    costUsd: 0.0421,
  });
  assert.deepEqual(parsed.signals, ["completed"]);
});

test("a turn ceiling is a model limit, and the document behind it is still read", () => {
  const parsed = parseClaudeOutput(
    resultDocument({ subtype: "error_max_turns", is_error: true, result: undefined }),
  );

  assert.equal(parsed.ok, false, "a ceiling that ended the turn left no answer");
  assert.equal(!parsed.ok && parsed.reason, "no-final-message");
  assert.deepEqual(parsed.signals, ["completed", "error", "limit-reached"]);
  assert.equal(parsed.usage?.outputTokens, 900, "the ledger still gets what the seat spent");
});

test("a session that reported its own failure is never called an outage", () => {
  const parsed = parseClaudeOutput(
    resultDocument({
      subtype: "error_during_execution",
      is_error: true,
      result: "the model saw a 503 somewhere and said so",
    }),
  );

  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.signals,
    ["completed", "error"],
    "it finished: that is a harness failure, whatever its text looks like",
  );
});

test("usage the document never reported stays absent, and no zero stands in for it", () => {
  const parsed = parseClaudeOutput(resultDocument({ usage: undefined, total_cost_usd: undefined }));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.usage, undefined);
});

test("a figure that is not a finite number is not a measurement", () => {
  const parsed = parseClaudeOutput(
    resultDocument({ usage: { input_tokens: "12000", output_tokens: 900 } }),
  );

  assert.deepEqual(parsed.usage, { outputTokens: 900, costUsd: 0.0421 });
});

test("a document of another type is refused rather than searched for a result", () => {
  const parsed = parseClaudeOutput(
    JSON.stringify({ type: "assistant", message: { content: [{ text: "working" }] } }),
  );

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "wrong-shape");
});

test("a stream of events is not one document, and is refused as bytes", () => {
  // The launch profile pins --output-format json, which writes exactly one
  // document, so more than one line is the seat not writing what it promised.
  const parsed = parseClaudeOutput(
    [JSON.stringify({ type: "system", subtype: "init" }), resultDocument()].join("\n"),
  );

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "not-json");
});

test("a result document with a prose preamble is refused, never recovered", () => {
  const parsed = parseClaudeOutput(`Here is my answer:\n${resultDocument()}`);

  assert.equal(parsed.ok, false);
  assert.equal(!parsed.ok && parsed.reason, "not-json");
});
