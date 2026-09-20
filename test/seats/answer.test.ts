/**
 * The one bit every reader of a seat's output needs first: did it answer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseClaudeOutput } from "../../src/adapters/claude.ts";
import type { ExecResult } from "../../src/runtime/exec.ts";
import { seatAnswered } from "../../src/seats/answer.ts";

const CAPTURE = join("fixtures", "seat-capture", "melchior-not-logged-in.json");

function ran(stdout: string, code = 0): Pick<ExecResult, "outcome" | "stdout"> {
  return { outcome: { kind: "exit", code }, stdout };
}

const ANSWER = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: '{"echo":"NONE"}',
});

test("a seat that wrote its document and reported no failure answered", () => {
  assert.equal(seatAnswered("claude", ran(ANSWER)), true);
});

// The capture is the whole point: these bytes parse, and a caller reading
// only the text cannot tell them from a seat that had nothing to say.
test("a logged-out seat parses and still has not answered", () => {
  const stdout = readFileSync(CAPTURE, "utf8");
  assert.equal(parseClaudeOutput(stdout).ok, true, "the document is well-formed");
  assert.equal(seatAnswered("claude", ran(stdout, 1)), false);
});

test("a nonzero exit is not on its own a seat that failed to answer", () => {
  assert.equal(seatAnswered("claude", ran(ANSWER, 2)), true);
});

test("a run that produced no result at all answered nothing", () => {
  for (const outcome of [
    { kind: "timeout" },
    { kind: "cancelled" },
    { kind: "signal", signal: "SIGKILL" },
    { kind: "spawn_error", message: "ENOENT" },
  ] as const) {
    assert.equal(seatAnswered("claude", { outcome, stdout: ANSWER }), false, outcome.kind);
  }
});

test("empty and unparseable output are not answers", () => {
  assert.equal(seatAnswered("claude", ran("")), false);
  assert.equal(seatAnswered("claude", ran("Not logged in")), false);
  assert.equal(seatAnswered("codex", ran("thinking about it\n")), false);
  assert.equal(seatAnswered("grok", ran("{}")), false);
});
