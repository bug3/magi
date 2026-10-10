import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CANARIES,
  canaryEvidence,
  loadCanaries,
  streamEvidence,
  type Canary,
} from "../../src/seats/canaries.ts";

function canary(id: string): Canary {
  const found = CANARIES.find((entry) => entry.id === id);
  assert.ok(found !== undefined, `no canary with id ${id}`);
  return found;
}

const PLAIN_ENGLISH =
  "The spec is right to kill the coded judiciary, and still fails its own two lessons.";

test("every canary has a distinct id and says which layer it betrays", () => {
  assert.equal(new Set(CANARIES.map((entry) => entry.id)).size, CANARIES.length);
  for (const entry of CANARIES) {
    assert.ok(entry.betrays.length > 0);
  }
});

// The real precedent: a grok seat answered an English brief with a Turkish
// preamble, which is how the ambient-config leak was first seen at all. A
// canary asserted only against a synthetic sample would prove it matches its
// own author.
test("the Turkish canary trips on the opening line a seat really wrote", () => {
  const captured = readFileSync("fixtures/seat-capture/casper-leaked-preamble.md", "utf8");
  const firstLine = captured.split("\n")[0] ?? "";
  assert.ok(canary("turkish-text-leak").pattern.test(firstLine));
});

test("the Turkish canary leaves plain English alone", () => {
  assert.equal(canary("turkish-text-leak").pattern.test(PLAIN_ENGLISH), false);
});

test("canary patterns are stateless, so doctor can reuse them across seats", () => {
  for (const entry of CANARIES) {
    assert.equal(entry.pattern.global, false);
    assert.equal(entry.pattern.sticky, false);
  }
});

function withMagiDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "magi-canary-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no local file means exactly the built-in canaries", () => {
  withMagiDir((dir) => {
    assert.deepEqual(loadCanaries(dir), CANARIES);
  });
});

test("a local file adds personal markers on top of the built-ins", () => {
  withMagiDir((dir) => {
    writeFileSync(
      join(dir, "canaries.local.json"),
      JSON.stringify([
        { id: "owner-phrase", pattern: "secret marker", flags: "i", betrays: "owner config" },
      ]),
    );
    const canaries = loadCanaries(dir);
    assert.equal(canaries.length, CANARIES.length + 1);
    const local = canaries[canaries.length - 1] as Canary;
    assert.equal(local.id, "owner-phrase");
    assert.ok(local.pattern.test("A Secret Marker appeared"));
  });
});

test("a malformed local file throws naming the file, never thins the net silently", () => {
  withMagiDir((dir) => {
    writeFileSync(join(dir, "canaries.local.json"), "not json");
    assert.throws(() => loadCanaries(dir), /canaries\.local\.json is not valid JSON/);
    writeFileSync(join(dir, "canaries.local.json"), JSON.stringify([{ id: "x" }]));
    assert.throws(() => loadCanaries(dir), /needs string id, pattern and betrays/);
    writeFileSync(
      join(dir, "canaries.local.json"),
      JSON.stringify([{ id: "bad", pattern: "(", betrays: "b" }]),
    );
    assert.throws(() => loadCanaries(dir), /invalid pattern/);
  });
});

test("a local pattern that matches empty text, or carries y or g, is refused by name", () => {
  withMagiDir((dir) => {
    const refuse = (pattern: string, flags: string, why: RegExp) => {
      writeFileSync(
        join(dir, "canaries.local.json"),
        JSON.stringify([{ id: "loose", pattern, flags, betrays: "b" }]),
      );
      assert.throws(() => loadCanaries(dir), why);
    };
    refuse("(secret)?", "u", /\("loose"\) matches empty text/u);
    refuse("secret", "uy", /\("loose"\) carries the y or g flag/u);
    refuse("secret", "ug", /\("loose"\) carries the y or g flag/u);
  });
});

// A pack that quotes the canary catalog would otherwise make every seat that
// discusses it look compromised, which is how a real consult produced two
// warnings that were nothing but the seat reading its own brief back.
test("a canary the brief itself trips is an echo, not evidence", () => {
  const brief = "The catalog holds a pattern for Turkish text: bir görüş.";
  const output = "Bu bir görüş, not a leak.";

  assert.ok(canary("turkish-text-leak").pattern.test(output));
  assert.deepEqual(canaryEvidence(output, brief, CANARIES), []);
});

test("a canary the brief never carries stays evidence", () => {
  const brief = "Answer in English. Nothing here is in any other script.";
  assert.deepEqual(canaryEvidence("bir görüş önsözü", brief, CANARIES), ["turkish-text-leak"]);
});

// Found live: a pack quoting one Turkish word from a test fixture silenced
// the language canary for a seat that answered its whole position in Turkish.
test("one quoted word in the brief does not silence a seat that answered in that script", () => {
  const brief = `const contents = '{"seal":"ok","unicode":"ölçüm"}';`;
  const output = "Birleştirmeyi engelleyen bir kusur bulmadım.";
  assert.deepEqual(canaryEvidence(output, brief, CANARIES), ["turkish-text-leak"]);
});

test("a seat quoting the brief's own word back is still an echo", () => {
  const brief = `const contents = '{"seal":"ok","unicode":"ölçüm"}';`;
  const output = 'The fixture writes "ölçüm" to prove the write is byte-exact.';
  assert.deepEqual(canaryEvidence(output, brief, CANARIES), []);
});

test("a token canary is an echo only for the token the brief carries", () => {
  const token: Canary = { id: "token", pattern: /marker-[0-9]+/u, betrays: "a test layer" };
  const brief = "The layer under test holds marker-42.";
  assert.deepEqual(canaryEvidence("I see marker-42 in the brief.", brief, [token]), []);
  assert.deepEqual(canaryEvidence("My context holds marker-43.", brief, [token]), ["token"]);
});

test("a dotted or multi-word token the brief carries is an echo", () => {
  for (const [pattern, token] of [
    [/secret phrase/iu, "Secret Phrase"],
    [/~\/\.claude\/x/u, "~/.claude/x"],
    [/owner@host/u, "owner@host"],
  ] as const) {
    const layer: Canary = { id: "token", pattern, betrays: "a test layer" };
    const brief = `The layer under test holds ${token}.`;
    assert.deepEqual(canaryEvidence(`I see ${token} in the brief.`, brief, [layer]), []);
    assert.deepEqual(canaryEvidence(`I see ${token}s here.`, brief, [layer]), ["token"]);
    assert.deepEqual(canaryEvidence(`I see ${token}.`, "The brief is silent.", [layer]), ["token"]);
  }
});

// The empty-text refusal cannot see these: they match nothing in "" and
// beside every word of real text.
test("a zero-width match is no evidence of anything", () => {
  for (const pattern of [/\b/u, /(?=\p{L})/u]) {
    const loose: Canary = { id: "loose", pattern, betrays: "a test layer" };
    assert.deepEqual(canaryEvidence(PLAIN_ENGLISH, "Answer in English.", [loose]), []);
  }
});

/** The opening a seat really wrote when a Turkish layer reached it. */
const TURKISH_ANSWER = "Birleştirmeyi engelleyen bir kusur bulmadım.";

test("an echo is a whole word of the brief, not a piece of one", () => {
  const token: Canary = { id: "token", pattern: /marker-[0-9]+/u, betrays: "a test layer" };
  assert.deepEqual(canaryEvidence("marker-42", "The layer holds marker-420.", [token]), [
    "token",
  ]);
  assert.deepEqual(canaryEvidence("ölçüm", "Benchmarks: ölçümler.", CANARIES), [
    "turkish-text-leak",
  ]);
});

test("case and normalization do not turn a quoted word into a new one", () => {
  const brief = "Fixture words: ölçüm and şimdi.";
  assert.deepEqual(canaryEvidence("Ölçüm is the fixture's word.", brief, CANARIES), []);
  assert.deepEqual(canaryEvidence("ÖLÇÜM, again.", brief, CANARIES), []);
  // Capitals the way toUpperCase writes them: ASCII I, not İ.
  assert.deepEqual(canaryEvidence("ŞIMDI, in capitals.", brief, CANARIES), []);
  const decomposed = brief.normalize("NFD");
  assert.notEqual(decomposed, brief);
  assert.deepEqual(canaryEvidence("ölçüm, composed.", decomposed, CANARIES), []);
});

test("an inflected form of a quoted word is a new word, and stays evidence", () => {
  const brief = `const contents = '{"seal":"ok","unicode":"ölçüm"}';`;
  assert.deepEqual(canaryEvidence("ölçümü", brief, CANARIES), ["turkish-text-leak"]);
});

test("a case-insensitive token canary folds both ways", () => {
  const token: Canary = { id: "sigil", pattern: /sigil-[0-9]+/iu, betrays: "a test layer" };
  assert.deepEqual(canaryEvidence("It says sigil-7.", "The brief holds SIGIL-7.", [token]), []);
});

test("a long run of matches is widened once, not once per match", () => {
  // Quadratic widening takes tens of seconds here; linear takes milliseconds.
  const run = "ş".repeat(20_000);
  const started = Date.now();
  assert.deepEqual(canaryEvidence(run, "Answer in English.", CANARIES), ["turkish-text-leak"]);
  assert.ok(Date.now() - started < 1_000, "widening is linear in the text");
});

test("a line of opening curly quotes with no closing one is skipped in one pass", () => {
  // Backtracking over every opening quote takes seconds here; one pass, milliseconds.
  const stream = JSON.stringify({ result: "“".repeat(60_000) });
  const started = Date.now();
  assert.deepEqual(canaryEvidence(stream, "Answer in English.", CANARIES), []);
  assert.ok(Date.now() - started < 1_000, "the quotation pattern is linear in the text");
});

test("an echo repeated in the text is looked up in the brief once", () => {
  // Both words are everywhere in the brief and the span stands alone only at
  // its end, so a lookup walks every place either word starts: per repeat,
  // seconds; once, milliseconds.
  const phrase: Canary = { id: "phrase", pattern: /secret phrase/u, betrays: "a test layer" };
  const brief = `${"secret, phrase, ".repeat(20_000)}secret phrase.`;
  const started = Date.now();
  assert.deepEqual(canaryEvidence("secret phrase. ".repeat(20_000), brief, [phrase]), []);
  assert.ok(Date.now() - started < 1_000, "an echo is judged once per word");
});

test("a letter outside the BMP is a word character on either side of a match", () => {
  // U+10400 is one letter in two UTF-16 units; read unit by unit, it was a boundary.
  const phrase: Canary = { id: "phrase", pattern: /secret phrase/u, betrays: "a test layer" };
  assert.deepEqual(canaryEvidence("It says secret phrase.", "\u{10400}secret phrase", [phrase]), [
    "phrase",
  ]);
  const token: Canary = { id: "token", pattern: /marker-[0-9]+/u, betrays: "a test layer" };
  assert.deepEqual(canaryEvidence("It says \u{10400}marker-1.", "It holds marker-1.", [token]), [
    "token",
  ]);
});

/** A seat's answer the way codex prints it: JSON lines, the answer a nested document. */
function codexStream(position: string): string {
  return [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify({ position, findings: [] }) },
    }),
  ].join("\n");
}

const ENGLISH_BRIEF = "Answer in English. Nothing here is in any other script.";

// Found live: two seats discussing this very rule in English tripped it by
// quoting example words, putting them in code spans, and naming letters.
test("quotations, code spans and single letters in a seat's text are discussion", () => {
  const discussion =
    'A seat might write "ölçümü", `preölçüm` or `foo-ç-bar`; the class covers İ, ı, ş, ç and ğ.';
  assert.deepEqual(canaryEvidence(codexStream(discussion), ENGLISH_BRIEF, CANARIES), []);
  assert.deepEqual(canaryEvidence(codexStream(TURKISH_ANSWER), ENGLISH_BRIEF, CANARIES), [
    "turkish-text-leak",
  ]);
});

test("a single letter with a hyphen or underscore beside it is still a single letter", () => {
  const discussion = "Prefixes such as ç- or -ş and names like ğ_ are what the class covers.";
  assert.deepEqual(canaryEvidence(codexStream(discussion), ENGLISH_BRIEF, CANARIES), []);
  assert.deepEqual(canaryEvidence("ça", ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a preamble in front of the envelope is read as it stands", () => {
  const stream = `Merhaba, işte cevabım:\n${codexStream("An answer in English.")}`;
  assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

test("a fenced answer and an answer cut short are both still read", () => {
  const answer = JSON.stringify({ position: TURKISH_ANSWER, findings: [] });
  const fenced = JSON.stringify({ result: `\`\`\`json\n${answer}\n\`\`\`` });
  assert.deepEqual(canaryEvidence(fenced, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
  const cut = codexStream(TURKISH_ANSWER).slice(0, -20);
  assert.deepEqual(canaryEvidence(cut, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
});

// The harness closes its envelope even when the model hits its output limit,
// so only the nested answer is broken, and its quotation marks are structure.
test("a whole envelope around an answer cut short or slightly invalid is still read", () => {
  const answer = JSON.stringify({ position: TURKISH_ANSWER, findings: [{ title: "Eksik" }] });
  const cut = JSON.stringify({ type: "result", result: answer.slice(0, -10) });
  assert.deepEqual(canaryEvidence(cut, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
  const fenced = JSON.stringify({ result: `Here it is:\n\`\`\`json\n${answer.slice(0, -10)}` });
  assert.deepEqual(canaryEvidence(fenced, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
  const invalid = JSON.stringify({ result: `${answer.slice(0, -1)},}` });
  assert.deepEqual(canaryEvidence(invalid, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
  const tagged = JSON.stringify({ result: '[High] A word like "ölçümü" is new.' });
  assert.deepEqual(canaryEvidence(tagged, ENGLISH_BRIEF, CANARIES), []);
});

// Raised by all three seats of one release review: an array inside the cut
// answer parsed on its own, and what was left of the answer read as quoted.
test("an answer cut short is read as it stands wherever its document opens", () => {
  const answer = JSON.stringify({ position: TURKISH_ANSWER, findings: [] });
  const cases = [
    JSON.stringify({ result: answer.slice(0, -1) }),
    JSON.stringify({ result: `${answer.slice(0, -1)},"answers":[{"question":"q",` }),
    JSON.stringify({ result: `Here it is: ${answer.slice(0, -2)} [}` }),
    // Shapes a later review built to slip past the voice decision.
    JSON.stringify({ result: 'Output: ["Birleştirmeyi engelleyen",' }),
    JSON.stringify({ result: '`{"position":"a \\" `x","claim":"Birleştirmeyi engelleyen","f":[' }),
    JSON.stringify({ result: `\`{"position":"It says "${TURKISH_ANSWER}\`x` }),
  ];
  for (const stream of cases) {
    assert.deepEqual(canaryEvidence(stream, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"], stream);
  }
});

test("a document a seat cites in a code span is an example, not its answer", () => {
  // The example is the pack's own, as a seat reviewing this code would cite it.
  const claim = `For \`{"position":"${TURKISH_ANSWER}"\` the rule returns "ölçümü".`;
  const brief = `${ENGLISH_BRIEF} ${TURKISH_ANSWER}`;
  assert.deepEqual(canaryEvidence(codexStream(claim), brief, CANARIES), []);
});

// Issue #25: an answer written inside quotation marks was dropped with them.
test("a quoted phrase is the seat's own voice; only a quoted word is a citation", () => {
  for (const position of [`“${TURKISH_ANSWER}”`, `"${TURKISH_ANSWER}"`, `\`${TURKISH_ANSWER}\``]) {
    const hits = canaryEvidence(codexStream(position), ENGLISH_BRIEF, CANARIES);
    assert.deepEqual(hits, ["turkish-text-leak"], position);
  }
  // The accepted cost, recorded: a phrase the seat composed is read too.
  const composed = codexStream('Use the "façade pattern" here.');
  assert.deepEqual(canaryEvidence(composed, ENGLISH_BRIEF, CANARIES), ["turkish-text-leak"]);
  // A code span dropped inside a quoted word leaves the word one word.
  assert.deepEqual(canaryEvidence(codexStream('A word like "ölçüm`x`" here.'), ENGLISH_BRIEF, CANARIES), []);
  const copied = codexStream(`The brief says "${TURKISH_ANSWER}" here.`);
  assert.deepEqual(canaryEvidence(copied, `${ENGLISH_BRIEF} ${TURKISH_ANSWER}`, CANARIES), []);
});

test("an escaped line break does not glue itself to the next word", () => {
  const brief = `const contents = '{"seal":"ok","unicode":"ölçüm"}';`;
  const stream = JSON.stringify({ position: "First line.\nölçüm is the fixture's word." });
  assert.deepEqual(canaryEvidence(stream, brief, CANARIES), []);
});

test("each stream is read on its own, so stderr cannot break stdout's document", () => {
  const stdout = JSON.stringify({ result: 'A word like "ölçümü" is new.' }, null, 2);
  const stderr = 'log {"level":"info"}';
  assert.deepEqual(canaryEvidence(`${stdout}\n${stderr}`, ENGLISH_BRIEF, CANARIES), [
    "turkish-text-leak",
  ]);
  assert.deepEqual(streamEvidence([stdout, stderr], ENGLISH_BRIEF, CANARIES), []);
  assert.deepEqual(streamEvidence([stdout, "Uyarı: bağlam yüklendi"], ENGLISH_BRIEF, CANARIES), [
    "turkish-text-leak",
  ]);
});

// Where text was taken out of a seat's string, the scan sees a line break:
// it keeps the words on either side apart and matches no pattern a line break
// between pieces would not.
test("taken-out text separates words and matches nothing a line break would not", () => {
  const glued = codexStream("A word`x`çok here.");
  assert.deepEqual(canaryEvidence(glued, `${ENGLISH_BRIEF} çok`, CANARIES), []);
  const nonAscii: Canary = { id: "non-ascii", pattern: /[^\x00-\x7F]/u, betrays: "a test layer" };
  const flag = codexStream("the `x`-flag is set");
  assert.deepEqual(canaryEvidence(flag, ENGLISH_BRIEF, [nonAscii]), []);
  // Left behind a parsed document in a string that is read raw, too.
  const cut = JSON.stringify({ result: 'x{"a":1}-flag and {"position":"cut' });
  assert.deepEqual(canaryEvidence(cut, ENGLISH_BRIEF, [nonAscii]), []);
});
