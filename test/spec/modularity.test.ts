import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

// AGENTS.md "File size": a file that hits its ceiling holds more than one
// idea. src/ gets 300 lines; test/ follows its case count, so it gets 400.
const CEILINGS: ReadonlyArray<{ root: string; maxLines: number }> = [
  { root: "src", maxLines: 300 },
  { root: "test", maxLines: 400 },
];

function tsFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => join(root, name));
}

test("every source file stays under its line ceiling", () => {
  for (const { root, maxLines } of CEILINGS) {
    for (const file of tsFilesUnder(root)) {
      const lines = readFileSync(file, "utf8").split("\n").length;
      assert.ok(
        lines <= maxLines,
        `${file} has ${lines} lines; the ceiling under ${root}/ is ${maxLines}`,
      );
    }
  }
});
