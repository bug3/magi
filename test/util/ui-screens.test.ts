/**
 * The screens a user sees before any work happens, asserted rather than
 * described: what the tool can do, what one command costs, what version it is,
 * and why an invocation was refused.
 *
 * Split out of `ui.test.ts` when that file hit its ceiling, along the line the
 * source is split on: these are the rules `src/util/ui/usage.ts` states, and
 * they are the ones with a byte contract on the other side of them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commandUsage,
  noteText,
  refuseUsage,
  usage,
  usageText,
  version,
  type CommandNote,
  type UsageScreen,
} from "../../src/util/ui.ts";
import { capture } from "../support/capture.ts";

/** A usage screen the shape of the real one, small enough to assert on. */
const SCREEN: UsageScreen = {
  commands: "usage:\n  magi doctor [--live]\n  magi triggers [--base <ref>]",
  pointer: "magi <command> --help adds what that command spends.",
};

/** One command's note, the shape the real ones have. */
const NOTE: CommandNote = {
  spends: "doctor --live spends quota: one minimal call per harness.",
  decides: "proposing never convenes; the user approves every consult.",
};

test("the usage block a pipe receives is the block and nothing else", async () => {
  // It is copied out of a terminal and pasted into a shell, and MAGI's own
  // check transcript carries it into evidence packs. A bar down the side
  // survives neither.
  const { out, err } = await capture(() => {
    usage(SCREEN);
  });

  assert.equal(out, `${usageText(SCREEN)}\n`);
  assert.equal(err, "");
});

test("the same block is drawn on a terminal, with every command still in it", async () => {
  const { out } = await capture(() => {
    usage(SCREEN);
  }, { tty: true });

  // Not asserted symbol by symbol: which characters clack draws depends on the
  // terminal's unicode support and on clack's version, and pinning them fails
  // on a machine where nothing is wrong. What is pinned is that the screen was
  // drawn rather than written flat, and that nothing was lost in the drawing.
  assert.notEqual(out, `${usageText(SCREEN)}\n`, "a terminal gets more than the flat block");
  for (const line of ["magi doctor [--live]", "magi triggers [--base <ref>]"]) {
    assert.ok(out.includes(line), `${line} survived the drawing`);
  }
  assert.ok(out.includes(SCREEN.pointer.split(" ")[0] as string), "the pointer survived too");
});

test("a command's screen carries what that command costs", async () => {
  // The prose used to run on under the tool-wide block, beside no flag it was
  // about. It is drawn here, on the screen for the command it is about, and a
  // pipe gets it labelled category by category rather than as a wall.
  const screen = "Usage: magi doctor [options]";

  const piped = await capture(() => {
    commandUsage(screen, NOTE);
  });
  assert.equal(piped.out, `${screen}\n\n${noteText(NOTE)}\n`);
  assert.match(piped.out, /^spends: /mu, "each category is labelled where a pipe reads it");
  assert.equal(piped.err, "", "a screen is a result, not a refusal");

  const drawn = await capture(() => {
    commandUsage(screen, NOTE);
  }, { tty: true });
  for (const label of ["spends", "decides"]) {
    assert.ok(drawn.out.includes(label), `${label} titles its own note on a terminal`);
  }
  assert.ok(drawn.out.includes("approves every consult"), "and the prose came with it");
});

test("a terminal too narrow to frame a block gets the flat one", async () => {
  // Measured, not assumed: at zero columns the renderer's box divides by what
  // it was told and throws, which is what `magi help` did in a pty nobody had
  // sized. Every fallback here is to the piped rendering, which fits anything.
  const narrow = await capture(() => {
    usage(SCREEN);
  }, { tty: true, columns: 0 });

  assert.equal(narrow.out, `${usageText(SCREEN)}\n`);
});

test("the version is exactly the number when something is parsing it", async () => {
  const piped = await capture(() => {
    version("0.6.0");
  });
  assert.equal(piped.out, "0.6.0\n");

  const terminal = await capture(() => {
    version("0.6.0");
  }, { tty: true });
  assert.ok(terminal.out.includes("0.6.0"));
  assert.notEqual(terminal.out, "0.6.0\n");
});

test("a refused invocation puts the whole screen on stderr, drawn or not", async () => {
  const piped = await capture(() => {
    refuseUsage(SCREEN, "unknown command: frobnicate");
  });
  // The reason is drawn on a terminal only: what a pipe receives on this path
  // is the block alone, which is a contract older than this renderer.
  assert.equal(piped.err, `${usageText(SCREEN)}\n`);
  assert.equal(piped.out, "");

  const terminal = await capture(() => {
    refuseUsage(SCREEN, "unknown command: frobnicate");
  }, { tty: true });
  assert.ok(terminal.err.includes("unknown command: frobnicate"), "a person is told what broke");
  assert.ok(terminal.err.includes("magi doctor [--live]"), "and still gets the block");
  assert.equal(terminal.out, "", "a caller reading stdout for a result gets nothing");
});
