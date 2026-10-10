import assert from "node:assert/strict";
import { test } from "node:test";

import { echoJudge } from "../../src/seats/brief-echo.ts";

test("distinct spans are each looked up at their rarest word, not by a pass over the brief", () => {
  // One search of the brief per span takes seconds here; at the rarest word, milliseconds.
  const spans = Array.from({ length: 40_000 }, (_, index) => `secret phrase${index}`);
  const echoed = echoJudge(spans.map((span) => `${span}.`).join(" "));
  const started = Date.now();
  assert.ok(spans.every(echoed));
  assert.ok(Date.now() - started < 1_000, "a span is not looked up by a pass over the brief");
});

test("a span is an echo only where the brief carries it whole", () => {
  assert.equal(echoJudge("It says secret phrase.")("secret phrase"), true);
  assert.equal(echoJudge("It says xsecret phrase.")("secret phrase"), false);
  assert.equal(echoJudge("It says secret phrasex.")("secret phrase"), false);
  assert.equal(echoJudge("It says phrase secret.")("secret phrase"), false);
  assert.equal(echoJudge("Look in ~/.claude/x for it.")("~/.claude/x"), true);
  assert.equal(echoJudge("Look in a~/.claude/x for it.")("~/.claude/x"), false);
});

test("a span is looked up in both foldings of the brief", () => {
  assert.equal(echoJudge("The brief holds SECRET PHRASE.")("secret phrase"), true);
  assert.equal(echoJudge("Bu İSTANBUL ŞEHRİ.")("istanbul şehri"), true);
});

test("a span with no word in it is found by a search of the whole brief", () => {
  assert.equal(echoJudge("a . b")("."), true);
  assert.equal(echoJudge("a.b")("."), false);
});
