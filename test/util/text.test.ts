import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeForDisplay, sanitizeLine } from "../../src/util/text.ts";

const ESC = "\u001b";

test("ordinary text passes through", () => {
  assert.equal(sanitizeForDisplay("git version 2.55.0"), "git version 2.55.0");
  assert.equal(sanitizeForDisplay("line one\nline two"), "line one\nline two");
  assert.equal(sanitizeForDisplay("a\tb"), "a\tb");
});

test("colour and cursor sequences are removed", () => {
  assert.equal(sanitizeForDisplay(`${ESC}[31mred${ESC}[0m`), "red");
  assert.equal(sanitizeForDisplay(`${ESC}[2J${ESC}[Hcleared`), "cleared");
  assert.equal(sanitizeForDisplay(`${ESC}[1;1Hx`), "x");
});

test("a carriage return cannot repaint a line into a lie", () => {
  assert.equal(sanitizeForDisplay("tests: FAIL\rtests: PASS"), "tests: FAILtests: PASS");
});

test("OSC sequences that talk to the terminal are removed", () => {
  // OSC 52 writes the system clipboard; OSC 8 hides a link target.
  assert.equal(sanitizeForDisplay(`${ESC}]52;c;ZXZpbAo=\u0007done`), "done");
  assert.equal(
    sanitizeForDisplay(`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`),
    "click",
  );
  assert.equal(sanitizeForDisplay(`${ESC}]0;window title\u0007ok`), "ok");
});

test("stray control characters are dropped", () => {
  assert.equal(sanitizeForDisplay("a\u0000b\u0007c\u007f"), "abc");
  assert.equal(sanitizeForDisplay(`${ESC}c reset`), " reset", "ESC c resets the whole terminal");
  assert.equal(
    sanitizeForDisplay(`${ESC}(0lqk${ESC}(B`),
    "lqk",
    "charset selection draws fake box characters",
  );
});

test("single-line mode folds newlines and truncates with a marker", () => {
  assert.equal(sanitizeLine("one\n  two\nthree"), "one two three");
  assert.equal(sanitizeLine("abcdefghij", 8), "abcde...");
  assert.equal(sanitizeLine("abcdefghij", 10), "abcdefghij");
});

test("sanitizing is idempotent", () => {
  const nasty = `${ESC}[31m${ESC}]52;c;x\u0007tests\rpassed\u0000`;
  const once = sanitizeForDisplay(nasty);
  assert.equal(sanitizeForDisplay(once), once);
  assert.equal(once.includes(ESC), false);
});
