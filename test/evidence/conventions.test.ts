import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONVENTION_FILENAMES, collectConventions } from "../../src/evidence/conventions.ts";

function world(files: readonly string[]): string {
  const repo = mkdtempSync(join(tmpdir(), "magi-conv-"));
  for (const file of files) {
    mkdirSync(join(repo, file, ".."), { recursive: true });
    writeFileSync(join(repo, file), `# ${file}\n`);
  }
  return repo;
}

test("the filename catalog is CLAUDE.md then AGENTS.md", () => {
  assert.deepEqual(CONVENTION_FILENAMES, ["CLAUDE.md", "AGENTS.md"]);
});

test("collects every catalog file on the walk from root to each cited file", () => {
  const repo = world(["CLAUDE.md", "AGENTS.md", "src/CLAUDE.md"]);
  const scan = collectConventions(repo, ["src/deep/file.ts"]);
  assert.deepEqual(scan.paths, ["CLAUDE.md", "AGENTS.md", "src/CLAUDE.md"]);
});

test("the same filename at two depths is reported as a conflict, closer wins", () => {
  const repo = world(["CLAUDE.md", "src/CLAUDE.md"]);
  const scan = collectConventions(repo, ["src/file.ts"]);
  assert.equal(scan.conflicts.length, 1);
  assert.match(scan.conflicts[0] as string, /CLAUDE\.md/);
  assert.match(scan.conflicts[0] as string, /closer/);
});

test("root conventions apply even when nothing is cited", () => {
  const repo = world(["AGENTS.md"]);
  const scan = collectConventions(repo, []);
  assert.deepEqual(scan.paths, ["AGENTS.md"]);
  assert.deepEqual(scan.conflicts, []);
});

test("cited paths sharing ancestors do not duplicate entries", () => {
  const repo = world(["CLAUDE.md", "src/CLAUDE.md"]);
  const scan = collectConventions(repo, ["src/a.ts", "src/b/c.ts"]);
  assert.deepEqual(scan.paths, ["CLAUDE.md", "src/CLAUDE.md"]);
});
