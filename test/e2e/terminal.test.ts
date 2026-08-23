/**
 * The drawn half of the contract, through a real terminal.
 *
 * `test/e2e/surface.test.ts` runs every command down a pipe, which is what an
 * orchestrating assistant reads and what the evidence pack carries. This suite
 * runs the same launcher through a pseudo-terminal, because the two paths
 * cannot fail the same way. A pipe receives text that was assembled; a
 * terminal receives a frame that was measured, and the measuring is what
 * broke: the renderer frames a block by dividing by the width the terminal
 * reports, and `magi help` threw a RangeError in a pty nobody had sized.
 *
 * `test/util/ui.test.ts` proves the same split in-process, against a sink that
 * claims to be a terminal. What it cannot prove is that a real one agrees, and
 * that a whole command runs through the drawn path without throwing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  git,
  initRepo,
  installStubHarnesses,
  magi,
  onTerminal,
  workspace,
  writeBrief,
} from "../support/cli.ts";

/** How every cursor move and every colour begins. */
const ESCAPE = "\u001B[";

const NO_TERMINAL = "no script(1) on this machine to open a pseudo-terminal with";

test("a terminal is drawn to, and the same command down a pipe is not", async (t) => {
  const space = workspace();
  try {
    const drawn = await onTerminal(["help"], space);
    if (drawn === undefined) {
      t.skip(NO_TERMINAL);
      return;
    }
    const piped = await magi(["help"], space);

    assert.equal(drawn.code, 0, "the drawn screen still exits 0");
    assert.ok(drawn.screen.includes("magi doctor"), "and still says what the commands are");
    // The claim is the split itself: one command, one machine, a rendering
    // each. Which symbols were drawn is not asserted, because those follow the
    // terminal's unicode support and the renderer's version.
    assert.ok(drawn.screen.includes(ESCAPE), "a terminal gets colour and a frame");
    assert.ok(!piped.out.includes(ESCAPE), "and the pipe gets none of it");
  } finally {
    space.remove();
  }
});

test("a refused invocation is drawn too, and still exits 2", async (t) => {
  const space = workspace();
  try {
    const drawn = await onTerminal(["frobnicate"], space);
    if (drawn === undefined) {
      t.skip(NO_TERMINAL);
      return;
    }

    assert.equal(drawn.code, 2);
    // Named on a terminal, where a person is reading it. Down a pipe this path
    // is the block alone, which `test/e2e/surface.test.ts` pins.
    assert.ok(drawn.screen.includes("frobnicate"), "a person is told what broke");
    assert.ok(drawn.screen.includes("magi doctor"), "and gets the block with it");
  } finally {
    space.remove();
  }
});

test("a terminal that reports no width is written to as if it were a pipe", async (t) => {
  // Measured rather than reasoned about, and this is the case that found it: a
  // pty inherits its parent's size, so one opened by a process that has no
  // terminal of its own starts at zero columns, and the renderer's box divides
  // by that and throws.
  const space = workspace();
  try {
    const drawn = await onTerminal(["help"], space, { columns: 0, rows: 0 });
    if (drawn === undefined) {
      t.skip(NO_TERMINAL);
      return;
    }

    assert.equal(drawn.code, 0, "an unsized terminal does not crash the help screen");
    assert.ok(drawn.screen.includes("magi doctor"), "it gets the block instead");
    assert.ok(!drawn.screen.includes(ESCAPE), "flat, exactly as a pipe would get it");
  } finally {
    space.remove();
  }
});

test("a whole consult runs on a terminal, question and progress and all", async (t) => {
  // The one flow that is nothing but composition: the question releases stdin,
  // the spinner seizes it back for the length of the fan-out, and the verdicts
  // print after. Every piece has a test. Only this has the three in one
  // process, on a terminal, which is the only place any of them draw.
  //
  // `--yes` is what a run in a pipeline would pass, and it is what keeps this
  // test off a timer: the question is skipped, and everything after it is not.
  const space = workspace();
  try {
    await initRepo(space.repo);
    writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hi';\n");
    await git(space.repo, ["add", "greet.ts"]);
    await git(space.repo, ["commit", "--quiet", "-m", "feat: add a greeting"]);
    writeFileSync(join(space.repo, "greet.ts"), "export const greet = () => 'hello there';\n");
    writeBrief(space.repo, "# Brief\n\nShould the greeting move into its own module?\n");
    installStubHarnesses(space.bin);

    const drawn = await onTerminal(
      ["review", "--brief", "brief.md", "--base", "HEAD", "--yes"],
      space,
    );
    if (drawn === undefined) {
      t.skip(NO_TERMINAL);
      return;
    }

    assert.equal(drawn.code, 0, drawn.screen);
    assert.match(drawn.screen, /convening 3 seats/u, "the fan-out announced itself");
    assert.match(drawn.screen, /Melchior-1: valid/u, "and the seats answered into the screen");
    assert.match(drawn.screen, /convening 3 seats, blind and in parallel \[\ds\]/u, "timed");
    assert.match(drawn.screen, /synthesis scaffold/u, "and the command finished its own block");
  } finally {
    space.remove();
  }
});
