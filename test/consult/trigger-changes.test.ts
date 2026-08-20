import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { triggerChanges } from "../../src/consult/trigger-changes.ts";
import { gitText } from "../../src/runtime/git.ts";

const IDENTITY = ["user.name=MAGI", "user.email=magi@example.invalid"];

test("trigger input includes staged, unstaged and untracked files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-triggers-"));
  try {
    await gitText(["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "staged.txt"), "old\n");
    writeFileSync(join(repo, "unstaged.txt"), "old\n");
    await gitText(["add", "-A"], { cwd: repo });
    await gitText(["commit", "--no-gpg-sign", "-m", "seed"], { cwd: repo, config: IDENTITY });

    writeFileSync(join(repo, "staged.txt"), "new staged\n");
    await gitText(["add", "staged.txt"], { cwd: repo });
    writeFileSync(join(repo, "unstaged.txt"), "new unstaged\n");
    writeFileSync(join(repo, "untracked.txt"), "one\ntwo\n");
    writeFileSync(join(repo, "binary.dat"), Buffer.from([0, 1, 2]));

    const changed = await triggerChanges(repo);
    assert.deepEqual(
      new Set(changed.map((entry) => entry.path)),
      new Set(["staged.txt", "unstaged.txt", "untracked.txt", "binary.dat"]),
    );
    assert.equal(changed.find((entry) => entry.path === "untracked.txt")?.changedLines, 2);
    assert.equal(changed.find((entry) => entry.path === "binary.dat")?.changedLines, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("trigger input works before the repository has its first commit", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-triggers-"));
  try {
    await gitText(["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "staged.txt"), "staged\n");
    await gitText(["add", "staged.txt"], { cwd: repo });
    writeFileSync(join(repo, "untracked.txt"), "untracked\n");
    const changed = await triggerChanges(repo);
    assert.deepEqual(
      new Set(changed.map((entry) => entry.path)),
      new Set(["staged.txt", "untracked.txt"]),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
