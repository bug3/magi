import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

// AGENTS.md "Where things live": a fact has one home. Two of them held by
// habit until each cost something, so both are scanned over the real tree.
//
// The harness-to-parser table was copied into three readers, and a fix that
// moved two of them left the third behind: a copy is not a second opinion,
// it is a second place to forget.
//
// A seat's environment is built from its inputs alone, which is the promise
// that nothing ambient crosses into a seat. An `??` onto `process.env` inside
// `src/seats/` would keep every existing assertion green while breaking it.

const SRC = "src";

function sourceFiles(): readonly string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((name) => extname(name) === ".ts")
    .map((name) => name.replaceAll("\\", "/"));
}

function read(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

const PARSER_NAMES = ["parseClaudeOutput", "parseCodexOutput", "parseGrokOutput"];

test("the harness parser table has one home", () => {
  const tables = sourceFiles().filter((file) => {
    // The adapters themselves define and export the parsers; the table that
    // maps a harness to one of them is what may not be rebuilt.
    if (file.startsWith("adapters/")) return false;
    const source = read(file);
    return PARSER_NAMES.filter((name) => source.includes(name)).length > 1;
  });
  assert.deepEqual(
    tables,
    [],
    "a second harness-to-parser table: import SEAT_PARSERS from src/adapters/parsers.ts",
  );
});

test("a seat's environment comes from its inputs: src/seats/ reads no process.env", () => {
  const ambient = sourceFiles().filter(
    (file) => file.startsWith("seats/") && /process\s*\.\s*env/u.test(read(file)),
  );
  assert.deepEqual(
    ambient,
    [],
    "a seat profile that reads the ambient process is no longer a pure function of its inputs",
  );
});
