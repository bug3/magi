/**
 * The live smoke's verdict, which turned on a parse alone and therefore read
 * a seat that could not run as a healthy one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSmokeResults } from "../../src/doctor/format.ts";
import { smokeHealthy, type SmokeResult } from "../../src/doctor/live-smoke.ts";

function result(overrides: Partial<SmokeResult> = {}): SmokeResult {
  return {
    slot: "melchior-1",
    outcome: "exit 0",
    answered: true,
    unanswered: undefined,
    parsed: true,
    parseReason: undefined,
    canaryHits: [],
    durationMs: 12,
    stdout: '{"pong":true}',
    ...overrides,
  };
}

test("a seat that answered, parsed and tripped nothing is healthy", () => {
  assert.equal(smokeHealthy([result()]), true);
});

// What a logged-out claude leaves behind: exit 1, a well-formed result
// document, and a failure reported inside it. The parse says yes.
test("a seat that parsed but did not answer is not healthy", () => {
  const smoke = [result({ outcome: "exit 1", answered: false, parsed: true })];
  assert.equal(smokeHealthy(smoke), false);
  assert.match(formatSmokeResults(smoke), /SEAT DID NOT ANSWER/u);
});

// The line the operator reads instead of going to the raw record, where the
// cause sits at the far end of a 1100-character usage blob.
test("the line carries the cause, in the seat's own words", () => {
  const smoke = [
    result({
      outcome: "exit 1",
      answered: false,
      unanswered: 'the seat reported its own failure: Not logged in, please run /login',
    }),
  ];
  assert.match(formatSmokeResults(smoke), /SEAT DID NOT ANSWER: .*Not logged in/u);
});

test("the seat that did answer still reads as it did before", () => {
  assert.doesNotMatch(formatSmokeResults([result()]), /SEAT DID NOT ANSWER/u);
});

test("a canary hit and an unparseable answer each still fail", () => {
  assert.equal(smokeHealthy([result({ canaryHits: ["tr-preamble"] })]), false);
  assert.equal(smokeHealthy([result({ parsed: false, parseReason: "not-json" })]), false);
});
