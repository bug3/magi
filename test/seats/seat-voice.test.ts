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
