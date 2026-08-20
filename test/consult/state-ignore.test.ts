import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stateIgnoreStatus } from "../../src/consult/state-ignore.ts";
import { gitText } from "../../src/runtime/git.ts";

test("a git repository must explicitly ignore MAGI runtime state", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-ignore-"));
  try {
    await gitText(["init", "-q"], { cwd: repo });
    assert.equal(await stateIgnoreStatus(repo), "not-ignored");
    writeFileSync(join(repo, ".gitignore"), ".magi/\n");
    assert.equal(await stateIgnoreStatus(repo), "ignored");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a non-git directory needs no ignore rule", async () => {
  const dir = mkdtempSync(join(tmpdir(), "magi-ignore-"));
  try {
    assert.equal(await stateIgnoreStatus(dir), "not-git");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an ignore rule does not make already-tracked runtime state safe", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-ignore-"));
  try {
    await gitText(["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, ".magi"));
    writeFileSync(join(repo, ".magi", "record"), "sensitive\n");
    await gitText(["add", "-f", ".magi/record"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), ".magi/\n");
    assert.equal(await stateIgnoreStatus(repo), "tracked");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
