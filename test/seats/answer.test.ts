/**
 * The one bit every reader of a seat's output needs first: did it answer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseClaudeOutput } from "../../src/adapters/claude.ts";
import { seatAnswered, unansweredReason, type SeatOutput } from "../../src/seats/answer.ts";

const CAPTURE = join("fixtures", "seat-capture", "melchior-not-logged-in.json");

function ran(stdout: string, code = 0, truncated = false): SeatOutput {
  return { outcome: { kind: "exit", code }, stdout, truncated };
}

function claudeSaid(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"echo":"NONE"}',
    ...overrides,
  });
}

test("a seat that wrote its document and reported no failure answered", () => {
  assert.equal(seatAnswered("claude", ran(claudeSaid())), true);
});

// What a logged-out claude leaves behind: exit 1, a well-formed result
// document, and a failure reported inside it. The parse says yes.
test("a logged-out seat parses and still has not answered", () => {
  const stdout = readFileSync(CAPTURE, "utf8");
  assert.equal(parseClaudeOutput(stdout).ok, true, "the document is well-formed");
  assert.equal(seatAnswered("claude", ran(stdout, 1)), false);
});

test("a nonzero exit is not on its own a seat that failed to answer", () => {
  assert.equal(seatAnswered("claude", ran(claudeSaid(), 2)), true);
});

// A ceiling ends a seat that did reach a conclusion and did write it down,
// which is not the same as a seat that never ran. Casper's own profile caps
// its turns, so treating the two alike turns a working run red.
test("a ceiling with a usable document is an answer, not a silence", () => {
  const ceiling = claudeSaid({ subtype: "error_max_turns", is_error: true });
  assert.equal(seatAnswered("claude", ran(ceiling, 1)), true);
});

test("a ceiling that carried no message is still not an answer", () => {
  const empty = claudeSaid({ subtype: "error_max_turns", is_error: true, result: undefined });
  assert.equal(seatAnswered("claude", ran(empty, 1)), false);
});

// Only one of the three parsers refuses an empty final message on its own, so
// the rule refuses it here for all three: an empty answer is not a measurement.
test("an empty final message is not an answer", () => {
  assert.equal(seatAnswered("claude", ran(claudeSaid({ result: "" }))), false);
  assert.equal(seatAnswered("claude", ran(claudeSaid({ result: "   \n" }))), false);
});

// The calibration reads an absence off this capture, so a capture that was cut
// cannot stand in for one that was complete.
test("a capture cut at the output ceiling is not an answer", () => {
  assert.equal(seatAnswered("claude", ran(claudeSaid(), 0, true)), false);
});

test("a run that produced no result at all answered nothing", () => {
  for (const outcome of [
    { kind: "timeout" },
    { kind: "cancelled" },
    { kind: "signal", signal: "SIGKILL" },
    { kind: "spawn_error", message: "ENOENT" },
  ] as const) {
    assert.equal(
      seatAnswered("claude", { outcome, stdout: claudeSaid(), truncated: false }),
      false,
      outcome.kind,
    );
  }
});

test("empty and unparseable output are not answers", () => {
  assert.equal(seatAnswered("claude", ran("")), false);
  assert.equal(seatAnswered("claude", ran("Not logged in")), false);
  assert.equal(seatAnswered("codex", ran("thinking about it\n")), false);
  assert.equal(seatAnswered("grok", ran("{}")), false);
});

// The screen that reports a silent seat has to carry the cause: the raw
// record opens with a usage blob and the sentence that matters is at the end
// of the same line.
test("the reason quotes the seat where the seat said why", () => {
  const stdout = readFileSync(CAPTURE, "utf8");
  assert.match(unansweredReason("claude", ran(stdout, 1)), /Not logged in/u);
});

test("the reason names the mechanism where the seat said nothing", () => {
  assert.match(
    unansweredReason("claude", { outcome: { kind: "timeout" }, stdout: "", truncated: false }),
    /produced no result: timeout/u,
  );
  assert.match(unansweredReason("claude", ran(claudeSaid(), 0, true)), /output ceiling/u);
  assert.match(unansweredReason("codex", ran("prose")), /did not parse: not-json/u);
  assert.match(unansweredReason("claude", ran(claudeSaid({ result: "" }))), /final message was empty/u);
});
