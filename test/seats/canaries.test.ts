import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CANARIES,
  canaryEvidence,
  canaryHits,
  loadCanaries,
  type Canary,
} from "../../src/seats/canaries.ts";

test("canaryHits names every matching canary and nothing else", () => {
  assert.deepEqual(canaryHits("bir görüş önsözü", CANARIES), ["turkish-text-leak"]);
  assert.deepEqual(canaryHits("plain ascii prose", CANARIES), []);
});

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

// A pack that quotes the canary catalog would otherwise make every seat that
// discusses it look compromised, which is how a real consult produced two
// warnings that were nothing but the seat reading its own brief back.
test("a canary the brief itself trips is an echo, not evidence", () => {
  const brief = "The catalog holds a pattern for Turkish text: bir görüş.";
  const output = "Bu bir görüş, not a leak.";

  assert.deepEqual(canaryHits(output, CANARIES), ["turkish-text-leak"]);
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
