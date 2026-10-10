import assert from "node:assert/strict";
import { test } from "node:test";

import { CANARIES, canaryEvidence, type Canary } from "../../src/seats/canaries.ts";

// How a seat's text is cut into the pieces the canary scans: the sides of a
// parsed document, and citations found in one pass. Raised by fresh-context
// reviews of the release branch, each case watched failing without its rule.

const ENGLISH_BRIEF = "Answer in English. Nothing here is in any other script.";

/** A seat's answer the way codex prints it: the answer a document in a JSON line. */
function codexStream(position: string): string {
  return JSON.stringify({ item: { text: JSON.stringify({ position, findings: [] }) } });
}

test("a citation is the code span or the quotation that starts first", () => {
  // Two passes kept the code span, then took `"\`çok"` for a quoted word.
  const stream = codexStream('See `a b"`çok" here.');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a quotation never straddles a document parsed out of its string", () => {
  const stream = codexStream('He said "çok{"a":1}daha" there.');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("the text before a parsed document carries the voice of the whole string", () => {
  // The cut answer after the document makes the whole string raw, so the
  // quoted word before it is read too.
  const stream = JSON.stringify({ result: '"Birleştirmeyi" {"a":1} {"position":"cut' });
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("the text on either side of a document in the stream is two pieces", () => {
  // Joined with a space, the two sides read as a phrase the seat never wrote.
  const phrase: Canary = { id: "phrase", pattern: /secret marker/u, betrays: "a test layer" };
  // The second stream does not parse whole, so it is read line by line.
  for (const stream of ['secret{"a":1}marker', 'secret{"a":1}marker\n{"b":2} x']) {
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, [phrase]), [], stream);
  }
});
