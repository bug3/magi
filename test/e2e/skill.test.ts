/**
 * `magi skill`, run as a process against a HOME of its own.
 *
 * Installing is the one thing this tool does outside the target repository,
 * so it is also the one thing no in-process test should be trusted on alone:
 * what is asserted here is the link on disk, not a report about it. Every run
 * gets a fresh temporary HOME, so nothing can reach the real one.
 */

import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { magi, workspace } from "../support/cli.ts";

/** Where each harness discovers a skill, as `src/skill.ts` states it. */
function skillPath(home: string, harness: string): string {
  return join(home, `.${harness}`, "skills", "magi");
}

test("reporting is the default, and it names all three harnesses", async () => {
  const space = workspace();
  try {
    const run = await magi(["skill"], space);
    assert.equal(run.code, 0);
    for (const harness of ["claude", "codex", "grok"]) {
      assert.ok(run.out.includes(harness), `${harness} is reported`);
    }
    assert.ok(run.out.includes("absent"), "a fresh HOME holds no link yet");
    // Reporting writes nothing: the paths it named must still be empty.
    for (const harness of ["claude", "codex", "grok"]) {
      assert.throws(() => lstatSync(skillPath(space.home, harness)), /ENOENT/u);
    }
  } finally {
    space.remove();
  }
});

test("--install links this clone, and a later report sees the link", async () => {
  const space = workspace();
  try {
    const installed = await magi(["skill", "--harness", "claude", "--install"], space);
    assert.equal(installed.code, 0);

    const path = skillPath(space.home, "claude");
    assert.ok(lstatSync(path).isSymbolicLink(), "the skill is linked, never copied");
    assert.equal(readlinkSync(path), resolve("skills", "magi"));

    const reported = await magi(["skill", "--harness", "claude"], space);
    assert.equal(reported.code, 0);
    assert.ok(reported.out.includes("linked"));
  } finally {
    space.remove();
  }
});

test("installing twice is the same install, not a second one", async () => {
  const space = workspace();
  try {
    assert.equal((await magi(["skill", "--harness", "grok", "--install"], space)).code, 0);
    const again = await magi(["skill", "--harness", "grok", "--install"], space);
    assert.equal(again.code, 0);
    assert.equal(readlinkSync(skillPath(space.home, "grok")), resolve("skills", "magi"));
  } finally {
    space.remove();
  }
});

test("something the tool did not put there is reported and left alone", async () => {
  const space = workspace();
  try {
    const path = skillPath(space.home, "codex");
    mkdirSync(join(space.home, ".codex", "skills"), { recursive: true });
    writeFileSync(path, "someone else's skill\n");

    const run = await magi(["skill", "--harness", "codex", "--install"], space);
    assert.equal(run.code, 1, "a refused install is a failure, not a silent skip");
    assert.match(run.err, /not ours to replace/u);
    assert.equal(lstatSync(path).isFile(), true, "the file that was there is still there");
  } finally {
    space.remove();
  }
});

test("a harness that is not one of the three is an invocation error", async () => {
  const space = workspace();
  try {
    const run = await magi(["skill", "--harness", "gemini", "--install"], space);
    assert.equal(run.code, 2);
    assert.match(run.err, /claude, codex, grok/u);
    assert.equal(run.out, "", "nothing was reported, because nothing was done");
  } finally {
    space.remove();
  }
});

test("installing without naming a harness targets the documented orchestrator", async () => {
  // Reporting covers all three; installing picks one, because linking is the
  // one thing here that writes outside the target repository.
  const space = workspace();
  try {
    const run = await magi(["skill", "--install"], space);
    assert.equal(run.code, 0);

    assert.ok(lstatSync(skillPath(space.home, "claude")).isSymbolicLink());
    for (const harness of ["codex", "grok"]) {
      assert.throws(
        () => lstatSync(skillPath(space.home, harness)),
        /ENOENT/u,
        `${harness} was not installed into without being asked for`,
      );
    }
  } finally {
    space.remove();
  }
});
