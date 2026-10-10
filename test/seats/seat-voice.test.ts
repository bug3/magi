import assert from "node:assert/strict";
import { test } from "node:test";

import { spokenText } from "../../src/seats/seat-voice.ts";

/** The pieces that came out of JSON strings, and those read as they stand. */
function pieces(stream: string): { json: string[]; raw: string[] } {
  const spoken = spokenText(stream);
  return {
    json: spoken.filter((piece) => piece.from === "json").map((piece) => piece.text),
    raw: spoken
      .filter((piece) => piece.from === "raw")
      .map((piece) => piece.text.trim())
      .filter((text) => text !== ""),
  };
}

const ANSWER = JSON.stringify({ position: 'It says "hello".', findings: [] });

test("an answer nested in JSON lines comes out as the seat's own strings", () => {
  const stream = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ANSWER } }),
  ].join("\n");
  const { json, raw } = pieces(stream);
  assert.ok(json.includes('It says "hello".'));
  assert.deepEqual(raw, []);
});

test("a preamble in front of a pretty-printed envelope is kept as it stands", () => {
  const stream = `Hazırlık notu.\n${JSON.stringify({ text: ANSWER }, null, 2)}`;
  const { json, raw } = pieces(stream);
  assert.deepEqual(raw, ["Hazırlık notu."]);
  assert.ok(json.includes('It says "hello".'));
});

test("a fenced answer in its envelope's string is opened like a bare one", () => {
  const stream = JSON.stringify({ result: `\`\`\`json\n${ANSWER}\n\`\`\`` });
  assert.ok(pieces(stream).json.includes('It says "hello".'));
});

test("a document cut short is read as it stands, not dropped", () => {
  const stream = `{"text":"{\\"position\\":\\"Birleştirmeyi engelleyen`;
  assert.deepEqual(pieces(stream), { json: [], raw: [stream] });
});

test("text with no JSON in it is read as it stands", () => {
  assert.deepEqual(pieces("plain words\nand more"), { json: [], raw: ["plain words", "and more"] });
});

test("no depth of nesting in a stream can throw", () => {
  const deep = `${"[".repeat(100_000)}"x"${"]".repeat(100_000)}`;
  assert.doesNotThrow(() => spokenText(deep));
  let nested = JSON.stringify("core");
  // Past the nesting the reader opens; escaping doubles per level, so few are enough.
  for (let level = 0; level < 12; level += 1) nested = JSON.stringify({ text: nested });
  assert.doesNotThrow(() => spokenText(nested));
});

// Raised in a release review: a backtick before a cut answer's opener and one
// inside its prose made a single span of both, and dropping that span as a
// citation took the opener with it.
test("a code span across a string boundary of a cut answer is not a citation", () => {
  for (const cut of [
    '`{"position":"Kesik `x","findings":[',
    'Output (cut at `max_tokens): {"position":"Kesik `x","findings":[',
  ]) {
    assert.deepEqual(pieces(JSON.stringify({ result: cut })), { json: [], raw: [cut] }, cut);
  }
  const cited = 'For `{"position":"x"` the rule holds.';
  assert.deepEqual(pieces(JSON.stringify({ result: cited })), { json: [cited], raw: [] });
});

test("an answer written out escaped opens a document like a plain one", () => {
  for (const answer of ['{\\"position\\":\\"Kesik', '{\\"position\\":\\"Tam\\",\\"findings\\":[]}']) {
    const read = pieces(JSON.stringify({ result: answer }));
    assert.deepEqual(read, { json: [], raw: [answer] }, answer);
  }
});

// Raised in the same review: a bracket in prose read a whole English string
// raw, and a word it quoted then raised a false warning.
test("a bracket or a brace in prose opens nothing", () => {
  for (const prose of [
    'A token like ["word" is discussion.',
    'Reading env["HOME" fails.',
    'Strings open with {" in JSON.',
  ]) {
    assert.deepEqual(pieces(JSON.stringify({ result: prose })), { json: [prose], raw: [] }, prose);
  }
});

test("an array of documents or strings at the start of a line opens a document", () => {
  const openers = ['[{"position":"Kesik', '[["Kesik', '["Kesik', '[\\"Kesik'];
  for (const cut of [...openers, ...openers.map((opener) => `Notes:\n  ${opener}`)]) {
    assert.deepEqual(pieces(JSON.stringify({ result: cut })).json, [], cut);
  }
});

// Accepted, not missed: a cut inside the first key leaves no value to hide.
test("a cut before the first key's colon opens nothing", () => {
  const cut = '{"position';
  assert.deepEqual(pieces(JSON.stringify({ result: cut })), { json: [cut], raw: [] });
});

// Raised by a fresh-context review: the parsed document's place was filled
// with a line break, which put the text after it at the start of a line.
test("what follows a parsed document stays on its line", () => {
  const prose = 'Compare {"a":1} ["x" and "word" quoted.';
  assert.deepEqual(pieces(JSON.stringify({ result: prose })).raw, []);
});
