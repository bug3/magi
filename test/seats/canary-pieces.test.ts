import assert from "node:assert/strict";
import { test } from "node:test";

import { CANARIES, canaryEvidence, type Canary } from "../../src/seats/canaries.ts";
import { spokenText } from "../../src/seats/seat-voice.ts";

// How a seat's text is cut into the pieces the canary scans: the sides of a
// parsed document, and citations found in one pass. Raised by fresh-context
// reviews of the release branch, each case watched failing without its rule.

const ENGLISH_BRIEF = "Answer in English. Nothing here is in any other script.";

/** One JSON document whose string holds the seat's answer document. */
function envelope(position: string): string {
  return JSON.stringify({ item: { text: JSON.stringify({ position, findings: [] }) } });
}

/** Matches `secret` and `marker` with at most one character between, never a line break. */
const TOKEN: Canary = { id: "token", pattern: /secret.?marker/u, betrays: "a test layer" };

test("a citation is the code span or the quotation that starts first", () => {
  // Two passes kept the code span, then took `"\`çok"` for a quoted word.
  const stream = envelope('See `a b"`çok" here.');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a dropped citation leaves a line break, as between pieces", () => {
  assert.deepEqual(canaryEvidence(envelope('secret"x"marker'), ENGLISH_BRIEF, [TOKEN]), []);
});

test("a quotation never straddles a document parsed out of its string", () => {
  // Split, the second side `b" "çok" end` cites `" "` and leaves çok" bare.
  // Joined with a space, `"a b"` and `"çok"` are two quotations and the word
  // is dropped; joined with nothing or a mark, both are quoted words.
  const stream = envelope('"a{"x":1}b" "çok" end');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("each side of a parsed document carries the voice of the whole string", () => {
  // The cut answer opens on one side, the quoted word sits on the other;
  // the whole string is raw, so the word is read wherever it is.
  for (const result of [
    '"Birleştirmeyi" {"a":1} {"position":"cut',
    '["Birleştirmeyi", {"a":1} x',
    '["x", {"a":1} "Birleştirmeyi"',
  ]) {
    const stream = JSON.stringify({ result });
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"], result);
  }
});

test("a parsed document's place in the voice decision is held, not closed up", () => {
  // Closed up, `{` and `"note":` read as a key, and the string as a cut answer.
  const stream = JSON.stringify({ result: '{"a":1}"note": "Birleştirmeyi"' });
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), []);
});

test("the text on either side of a document in the stream is two pieces", () => {
  // Joined with nothing, a space or a mark, the sides read as a token never
  // written. The second stream does not parse whole, so it is read by line.
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['secret{"a":1}marker', ["secret", "marker"]],
    ['secret{"a":1}marker\n{"b":2} x', ["secret", "marker", "", " x"]],
  ];
  for (const [stream, sides] of cases) {
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, [TOKEN]), [], stream);
    // And the document is taken out, not left standing anywhere in the text.
    const raw = spokenText(stream).filter((piece) => piece.from === "raw");
    assert.deepEqual(raw.map((piece) => piece.text), sides, stream);
  }
});
