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

test("a citation is the code span or the quotation that starts first", () => {
  // Two passes kept the code span, then took `"\`çok"` for a quoted word.
  const stream = envelope('See `a b"`çok" here.');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a quotation never straddles a document parsed out of its string", () => {
  // Split, the second side leaves çok" unquoted. Joined with a space, the
  // first quotation swallows the quote before çok; joined with nothing or a
  // mark, both quotations are dropped as words.
  const stream = envelope('"a{"x":1}b" "çok" end');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("the text before a parsed document carries the voice of the whole string", () => {
  // The cut answer opens after the document in one case and before it in
  // the other; either way the whole string is raw and the quoted word read.
  for (const result of [
    '"Birleştirmeyi" {"a":1} {"position":"cut',
    '["Birleştirmeyi", {"a":1} x',
  ]) {
    const stream = JSON.stringify({ result });
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"], result);
  }
});

test("the text on either side of a document in the stream is two pieces", () => {
  // A line break between pieces is the one thing `.` does not match: joined
  // with nothing, a space or a mark, the sides read as a token never written.
  const token: Canary = { id: "token", pattern: /secret.?marker/u, betrays: "a test layer" };
  // The second stream does not parse whole, so it is read line by line.
  for (const stream of ['secret{"a":1}marker', 'secret{"a":1}marker\n{"b":2} x']) {
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, [token]), [], stream);
    // And the document is taken out, not left standing between the sides.
    const raw = spokenText(stream).filter((piece) => piece.from === "raw");
    assert.ok(raw.some((piece) => piece.text === "secret"), stream);
    assert.ok(raw.some((piece) => piece.text === "marker"), stream);
  }
});
