import assert from "node:assert/strict";
import { test } from "node:test";

import { condenseCheckOutput } from "../../src/evidence/check-output.ts";

const RUN = [
  "> @bug3/magi@0.3.0 check",
  "> npm run typecheck && npm run test",
  "✔ a case that passed (0.291396ms)",
  "✔ another that passed (1.02ms)",
  "✖ the one that did not (3.4ms)",
  "  AssertionError: expected 1 to equal 2",
  "ℹ tests 3",
  "ℹ pass 2",
  "ℹ fail 1",
  "ℹ duration_ms 6673.704765",
].join("\n");

test("passing cases collapse to a count and failures survive", () => {
  const { text, collapsed } = condenseCheckOutput(RUN);
  assert.equal(collapsed, 2);
  assert.ok(!text.includes("a case that passed"), "a tick nobody reads is not carried");
  assert.ok(text.includes("✖ the one that did not"), "the failure is still there");
  assert.ok(
    text.includes("  AssertionError: expected 1 to equal 2"),
    "and so is the line under it, byte for byte",
  );
  assert.match(text, /2 passing cases collapsed/u);
});

test("a passing run condenses to the same bytes twice", () => {
  const green = ["✔ one (0.29ms)", "✔ two (1.02ms)", "ℹ pass 2", "ℹ duration_ms 6673.7"].join("\n");
  const later = green.replace("0.29ms", "0.48ms").replace("1.02ms", "0.91ms").replace("6673.7", "7104.2");
  assert.equal(condenseCheckOutput(green).text, condenseCheckOutput(later).text);
});

test("a failure keeps its own bytes, timing included", () => {
  // An earlier version stripped trailing timings from every kept line, which
  // edited failure text while promising it verbatim.
  const { text } = condenseCheckOutput(RUN);
  assert.ok(text.includes("✖ the one that did not (3.4ms)"), "the line is carried as written");
});

test("package manager notices are dropped wherever they appear", () => {
  const noisy = ["npm notice New major version available", "✔ a case (1ms)", "ℹ pass 1"].join("\n");
  const { text } = condenseCheckOutput(noisy);
  assert.ok(!text.includes("npm notice"));
  assert.ok(text.includes("ℹ pass 1"));
});

test("a line this does not recognise is kept", () => {
  const odd = ["RSPEC 4 examples, 0 failures", "cargo test: ok", "PASS src/thing.test.js"].join("\n");
  assert.equal(condenseCheckOutput(odd).collapsed, 0);
  for (const line of odd.split("\n")) assert.ok(condenseCheckOutput(odd).text.includes(line));
});

test("output with nothing left in it condenses to nothing", () => {
  assert.equal(condenseCheckOutput("").text, "");
  assert.equal(condenseCheckOutput("\n\n").text, "");
});
