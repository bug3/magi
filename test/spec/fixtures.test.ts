import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

// Captured seat output is kept for the failures it proves, not as a record of
// a run. Two rules keep it that way, both asserted over the real directory: a
// capture no test reads has no claim under it, and a capture the README does
// not name has no reason on record. Together they mean the directory can only
// grow by someone stating what a new file is for.

const CAPTURES = join("fixtures", "seat-capture");
const README = "README.md";

function capturedFiles(): string[] {
  return readdirSync(CAPTURES)
    .filter((name) => name !== README)
    .sort();
}

function testSources(): string {
  return readdirSync("test", { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => readFileSync(join("test", name), "utf8"))
    .join("\n");
}

test("every capture is read by a test that makes a claim about it", () => {
  const sources = testSources();
  const unread = capturedFiles().filter((name) => !sources.includes(name));
  assert.deepEqual(unread, [], "a capture no test reads is a record kept for its own sake");
});

test("the README names every capture and no others", () => {
  const documented = [...readFileSync(join(CAPTURES, README), "utf8").matchAll(/^### (.+)$/gmu)]
    .map((match) => match[1] as string)
    .sort();
  assert.deepEqual(documented, capturedFiles());
});
