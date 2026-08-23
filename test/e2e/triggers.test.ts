/**
 * `magi triggers`, run as a process over a real git repository.
 *
 * The evaluation itself is covered module-side. What only a real repository
 * can show is the half that is not evaluation: that a delta is read from git
 * at all, that an untracked file counts, and that proposing stays proposing.
 * A trigger firing is never a convene, so the exit code is 0 either way and
 * only the report differs.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TRIGGER_THRESHOLDS } from "../../src/consult.ts";
import { git, initRepo, magi, workspace } from "../support/cli.ts";

/** A file long enough that its size alone is over the line, on its own. */
function longFile(repo: string, name: string): void {
  const body = Array.from(
    { length: TRIGGER_THRESHOLDS.diffLines + 20 },
    (_unused, at) => `export const line${at} = ${at};`,
  ).join("\n");
  writeFileSync(join(repo, name), `${body}\n`);
}

test("a clean worktree proposes nothing and still exits 0", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["triggers"], space);

    assert.equal(run.code, 0);
    assert.match(run.out, /no deterministic trigger/u);
    assert.ok(!run.out.includes("TRIGGERED"));
    assert.equal(run.err, "");
  } finally {
    space.remove();
  }
});

test("an untracked file over the size threshold fires the size trigger", async () => {
  // Untracked on purpose: git has never been told about it, so nothing in a
  // committed delta carries it and only the explicit untracked sweep can.
  const space = workspace();
  try {
    await initRepo(space.repo);
    longFile(space.repo, "wide-change.ts");
    const run = await magi(["triggers"], space);

    assert.equal(run.code, 0, "proposing is not convening; a trigger is not a failure");
    assert.match(run.out, /TRIGGERED size/u);
    assert.match(run.out, /the user approves every convene/u);
  } finally {
    space.remove();
  }
});

test("--base reads the delta from the named ref rather than from HEAD", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    longFile(space.repo, "wide-change.ts");
    await git(space.repo, ["add", "."]);
    await git(space.repo, ["commit", "--quiet", "-m", "feat: land a wide change"]);

    // Committed, so HEAD-to-worktree is empty and only the base sees it.
    const fromHead = await magi(["triggers"], space);
    assert.ok(!fromHead.out.includes("TRIGGERED"), "nothing is pending against HEAD");

    const fromBase = await magi(["triggers", "--base", "HEAD~1"], space);
    assert.equal(fromBase.code, 0);
    assert.match(fromBase.out, /TRIGGERED size/u);
  } finally {
    space.remove();
  }
});

test("a ref git cannot resolve is an invocation error on stderr", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["triggers", "--base", "no-such-ref"], space);

    assert.equal(run.code, 2);
    assert.notEqual(run.err, "");
    assert.equal(run.out, "", "nothing is reported about a delta that was never read");
  } finally {
    space.remove();
  }
});
