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

test("a word in curly quotes is a citation, as in straight ones", () => {
  const stream = envelope("A word like “ölçümü” is new.");
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), []);
});

test("a dropped citation leaves a line break, as between pieces", () => {
  assert.deepEqual(canaryEvidence(envelope('secret"x"marker'), ENGLISH_BRIEF, [TOKEN]), []);
});

test("a quotation never straddles a document parsed out of its string", () => {
  // Split, the second side `b" "çok" end` matches `" "` as a quotation, a
  // phrase kept whole, which takes the quote before çok and leaves it bare.
  // Joined with a space, `"a b"` and `"çok"` are two quotations and the word
  // is dropped; joined with nothing or a mark, both are quoted words.
  const stream = envelope('"a{"x":1}b" "çok" end');
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("each side of a parsed document carries the voice of the whole string", () => {
  // The whole string is raw, so the quoted word is read on whichever side it
  // sits: before an opener after the document, before the document with the
  // opener beside it, and after the document with the opener before it.
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

test("a document's own first character stays in the voice decision", () => {
  // Without it, `[` and the mark open nothing, and the cut array goes unseen.
  const stream = JSON.stringify({ result: '[{}, "Birleştirmeyi",' });
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a cut answer opens with whitespace around its key or after its bracket", () => {
  for (const result of [
    '{\n  "position": "Birleştirmeyi",\n  "findings": [',
    '{ "position" : "Birleştirmeyi", ',
    '[\n  "Birleştirmeyi",',
  ]) {
    const stream = JSON.stringify({ result });
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"], result);
  }
});

test("a key, a quotation and a code span each end at the end of a line", () => {
  for (const position of [
    'A brace {" opens\nnothing": x" "ölçümü" here',
    'x "a\n"ölçüm" y',
    '`a\n"ölçüm"` b',
  ]) {
    assert.deepEqual(canaryEvidence(envelope(position), ENGLISH_BRIEF, CANARIES), [], position);
  }
});

test("any whitespace makes a quotation a phrase", () => {
  const stream = envelope("A “ölçüm\u00A0x” here.");
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

/** `inner` as the string of a document, `times` over. */
function nested(inner: string, times: number): string {
  let text = inner;
  for (let level = 0; level < times; level += 1) text = JSON.stringify({ text });
  return text;
}

test("a document in strings is opened eight deep and no deeper", () => {
  // Opened, the quoted word is a citation; past the limit, the unopened
  // answer is read raw and the word with it.
  const answer = JSON.stringify({ position: 'A word like "ölçümü" here.' });
  assert.deepEqual(canaryEvidence(nested(answer, 8), ENGLISH_BRIEF, CANARIES), []);
  assert.deepEqual(canaryEvidence(nested(answer, 9), ENGLISH_BRIEF, CANARIES), [
    "turkish-text-leak",
  ]);
  // Plain objects around a string are not nesting in strings, and do not count.
  let objects: unknown = { text: answer };
  for (let level = 0; level < 12; level += 1) objects = { a: objects };
  assert.deepEqual(canaryEvidence(JSON.stringify(objects), ENGLISH_BRIEF, CANARIES), []);
});
