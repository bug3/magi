/**
 * The command surface, run as a process.
 *
 * `test/cli/args.test.ts` proves the same dispatch by calling `main` in this
 * process. What it cannot prove is anything between `main` and a shell: that
 * the launcher starts, that it picks the sources over a stale `dist/`, that
 * the number `main` returns becomes the process's exit status, and that a
 * refusal goes out on the stream a pipeline reads separately. Those are the
 * claims here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { initRepo, magi, workspace } from "../support/cli.ts";

test("--version prints the shipped manifest and nothing around it", async () => {
  const space = workspace();
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const run = await magi(["--version"], space);

    assert.equal(run.code, 0);
    // Whole, not by substring: the version is parsed by whatever asked for
    // it, so a bar or a colour around it is a break only an exact compare
    // can see.
    assert.equal(run.out, `${manifest.version}\n`);
    assert.equal(run.err, "");
  } finally {
    space.remove();
  }
});

test("both spellings of help and of version reach the same answer", async () => {
  // Two spellings that both work and only one of which was ever printed is
  // the drift this tool holds three harness CLIs to, so it is asserted on
  // itself: each pair is run, not just listed.
  const space = workspace();
  try {
    const [long, short] = [await magi(["help"], space), await magi(["--help"], space)];
    assert.equal(long.code, 0);
    assert.equal(short.code, 0);
    assert.equal(long.out, short.out);
    assert.match(long.out, /magi doctor/u);
    assert.match(long.out, /magi review/u);
    assert.equal(long.err, "");

    const shortVersion = await magi(["-v"], space);
    assert.equal(shortVersion.code, 0);
    assert.equal(shortVersion.out, (await magi(["--version"], space)).out);
  } finally {
    space.remove();
  }
});

test("an unknown command exits 2 with usage on stderr and stdout untouched", async () => {
  // The split matters here and nowhere else can prove it: a caller reading
  // stdout for a result must not receive the usage block as one.
  const space = workspace();
  try {
    const run = await magi(["frobnicate"], space);
    assert.equal(run.code, 2);
    assert.match(run.err, /magi doctor/u);
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("no command at all is an invocation error, not a default", async () => {
  const space = workspace();
  try {
    const run = await magi([], space);
    assert.equal(run.code, 2);
    assert.match(run.err, /usage:/u);
    assert.equal(run.out, "");
  } finally {
    space.remove();
  }
});

test("every subcommand refuses an argument it does not understand, on stderr", async () => {
  const space = workspace();
  try {
    for (const argv of [
      ["doctor", "--bogus"],
      ["triggers", "--bogus"],
      ["skill", "--bogus"],
      ["skill", "--harness", "gemini"],
      ["checks", "0001-review", "extra"],
      ["review", "--bogus"],
      ["plan", "--bogus"],
    ]) {
      const run = await magi(argv, space);
      assert.equal(run.code, 2, `magi ${argv.join(" ")} exits 2`);
      assert.notEqual(run.err, "", `magi ${argv.join(" ")} says why on stderr`);
    }
  } finally {
    space.remove();
  }
});

test("a flag joined to its value with = is the same invocation", async () => {
  // Typed at a real session and refused: `magi skill --harness=codex --install`
  // exited 2 because each command compared whole tokens, so the form every
  // GNU-style CLI takes was an unknown argument in three separate parsers.
  const space = workspace();
  try {
    await initRepo(space.repo);

    const skill = await magi(["skill", "--harness=codex"], space);
    assert.equal(skill.code, 0);
    // Matched as a report row and not as a substring: every row here carries a
    // path under a temporary HOME, and a machine whose temporary directory is
    // named after a harness would otherwise decide this test.
    assert.match(skill.out, /^[^\w\n]*codex\b/mu);
    assert.doesNotMatch(skill.out, /^[^\w\n]*claude\b/mu, "the value bound to the flag");

    const triggers = await magi(["triggers", "--base=HEAD"], space);
    assert.equal(triggers.code, 0);
    assert.match(triggers.out, /HEAD to worktree/u);
  } finally {
    space.remove();
  }
});

test("nothing a command prints carries a cursor escape, having no terminal", async () => {
  // MAGI's output is read by an orchestrating assistant through a pipe, and
  // its own check transcript is carried into evidence packs. A redrawn line
  // is invisible on a terminal and is litter in both.
  //
  // The command is `doctor` and not `help` on purpose: help is one raw write
  // that could not emit an escape under any implementation, so a test using
  // it would pass with the whole renderer deleted. Doctor opens the bar,
  // prints four reports through it, closes it and refuses on stderr.
  const space = workspace();
  try {
    await initRepo(space.repo);
    const run = await magi(["doctor"], space);

    assert.ok(run.out.length > 500, "doctor really printed its reports");
    assert.ok(!run.out.includes("\u001B["), "no escape reaches a piped stdout");
    assert.ok(!run.err.includes("\u001B["), "no escape reaches a piped stderr");
  } finally {
    space.remove();
  }
});
