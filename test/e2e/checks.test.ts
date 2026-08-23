/**
 * `magi checks`, run as a process over a run that really happened.
 *
 * The vocabulary and the planner have unit tests over strings. What only a
 * real run can show is the part that is not a string: that the gate record a
 * fan-out wrote is the record this command reads back, that an admitted
 * proposal reaches a real subprocess without a shell, that a refused one is
 * recorded and never run, and that both land in the records directory.
 *
 * The stub seats each propose a different check on purpose: two shapes the
 * catalog admits and one it refuses, so a single run exercises both halves.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  convenedId,
  git,
  initRepo,
  installStubHarnesses,
  magi,
  workspace,
  writeBrief,
  type Workspace,
} from "../support/cli.ts";

/** A run to have checks about, convened the same way a user would convene it. */
async function convene(space: Workspace): Promise<string> {
  await initRepo(space.repo);
  writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hi';\n");
  await git(space.repo, ["add", "greet.ts"]);
  await git(space.repo, ["commit", "--quiet", "-m", "feat: add a greeting"]);
  writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hello there';\n");
  writeBrief(space.repo, "# Brief\n\nIs the greeting worth its own module?\n");
  installStubHarnesses(space.bin);

  const run = await magi(["review", "--brief", "brief.md", "--base", "HEAD"], space);
  assert.equal(run.code, 0, run.err);
  return convenedId(run.out);
}

test("an admitted proposal runs for real and a refused one is recorded, not run", async () => {
  const space = workspace();
  try {
    const id = await convene(space);
    const run = await magi(["checks", id], space);

    assert.equal(run.code, 0, run.err);
    // Admitted: a read-only git shape, run as a real subprocess with no shell.
    assert.match(run.out, /ran \[git status --short\] -> exit 0/u);
    assert.match(run.out, /ran \[git log --oneline -1\] -> exit 0/u);
    // Refused: a project-code entry point, which can write, reach the network
    // or run repository code. It is reported and it never ran.
    assert.match(run.out, /REFUSED/u);
    assert.ok(!run.out.includes("ran [npm"), "a refused proposal is never spawned");

    const records = join(space.repo, ".magi", "consults", id, "checks");
    assert.ok(existsSync(records), "the records directory is where the command said it was");
    assert.equal(readdirSync(records).length, 3, "every proposal is recorded, admitted or not");
  } finally {
    space.remove();
  }
});

test("a run with no gate record is refused rather than reported as empty", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["checks", "0001-review"], space);

    assert.equal(run.code, 2);
    assert.match(run.err, /no gate record/u);
    assert.match(run.err, /run the consult first/u);
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("an id that is not an id is an invocation error", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["checks", "not-an-id"], space);

    assert.equal(run.code, 2);
    assert.notEqual(run.err, "");
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("no id at all prints why, and the usage block, on stderr", async () => {
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["checks"], space);

    assert.equal(run.code, 2);
    assert.match(run.err, /checks needs a consult id/u);
    assert.match(run.err, /usage:/u);
    assert.equal(run.out, "", "the usage block is not a result");
  } finally {
    space.remove();
  }
});
