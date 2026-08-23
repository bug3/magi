/**
 * The rules `src/util/ui.ts` states, asserted rather than described.
 *
 * The decoration itself is not asserted anywhere here. Which symbol clack
 * draws depends on the terminal's unicode support and on clack's own version,
 * so a test that pinned one would fail on a machine where nothing was wrong.
 * What is pinned is the part a caller depends on: which stream a line lands
 * on, that a machine-read line carries nothing around it, and that nothing
 * this module writes moves a cursor.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  close,
  decorated,
  detail,
  info,
  interactive,
  open,
  plain,
  plainError,
  problem,
  refuseUsage,
  report,
  step,
  usage,
  usageText,
  version,
  warn,
  type UsageScreen,
} from "../../src/util/ui.ts";
import { capture } from "../support/capture.ts";

/**
 * An escape sequence, which is how every cursor move begins. Matched on the
 * control character and not on the bracket alone: a bare bracket is ordinary
 * text, and a message carrying one ("ran [git status]") would otherwise fail
 * this suite on a machine where nothing was wrong.
 */
const ESCAPE = /\u001B\[/u;

/** A usage screen the shape of the real one, small enough to assert on. */
const SCREEN: UsageScreen = {
  commands: "usage:\n  magi doctor [--live]\n  magi triggers [--base <ref>]",
  guide: [
    { title: "doctor", body: "doctor --live spends quota: one minimal call per harness." },
    { title: "triggers", body: "triggers evaluates the tracked base-to-worktree diff." },
  ],
};

test("a result goes to stdout and never to stderr", async () => {
  const { out, err } = await capture(() => {
    open("magi doctor");
    step("live smoke: one minimal call per harness");
    info("nothing to do");
    warn("one seat did not answer");
    detail("MELCHIOR-1: valid");
    close("healthy");
  });

  for (const message of ["magi doctor", "nothing to do", "MELCHIOR-1: valid", "healthy"]) {
    assert.ok(out.includes(message), `${message} belongs on stdout`);
  }
  assert.equal(err, "");
});

test("a refusal goes to stderr and never to stdout", async () => {
  // The line a script greps for. A pipeline reading stdout must not swallow
  // it, and a caller reading stdout must not mistake it for a result.
  const { out, err } = await capture(() => {
    problem("no gate record; run the consult first");
  });

  assert.ok(err.includes("no gate record; run the consult first"));
  assert.equal(out, "");
});

test("what a machine reads carries no bar, no symbol and no colour", async () => {
  const { out, err } = await capture(() => {
    plain("0.5.0");
    plainError("usage:\n  magi doctor");
  });

  assert.equal(out, "0.5.0\n");
  assert.equal(err, "usage:\n  magi doctor\n");
});

test("nothing this module writes moves a cursor, on either stream", async () => {
  // A redraw is invisible on a terminal and is litter in a pipe, and MAGI's
  // output is read by an orchestrating assistant through one. It is also how
  // a spinner would come back: clack draws one by seizing stdin and calling
  // process.exit(0) on the cancel key, which turns an interrupted fan-out
  // into a reported success. So the rule is asserted over every writer here.
  const { out, err } = await capture(() => {
    open("magi review");
    step("convening 3 seats, blind and in parallel");
    detail("excluded from the pack: vendor.ts (generated)");
    report("headroom (window 24h)\n\n  preflight: ok\n");
    warn("Casper-3: INVALID (schema)");
    close("synthesis scaffold: .magi/synthesis.md");
    problem("doctor found problems");
  });

  assert.ok(!ESCAPE.test(out), "stdout carries no escape");
  assert.ok(!ESCAPE.test(err), "stderr carries no escape");
});

test("a report titles on its first line and hangs the rest under it", async () => {
  const { out } = await capture(() => {
    report("headroom (window 24h)\n\n  claude: no budget\n  preflight: ok\n\n");
  });

  for (const line of ["headroom (window 24h)", "claude: no budget", "preflight: ok"]) {
    assert.ok(out.includes(line), `${line} survived the rendering`);
  }
  // Every formatter ends its block with a blank line. Carried through, that
  // becomes a decorated line with nothing on it, so the last thing written is
  // the last thing said.
  assert.match(out.trimEnd().split("\n").at(-1) ?? "", /preflight: ok$/u);
});

test("the blank a formatter puts under its title is not printed twice", async () => {
  // The renderer already spaces a body from its title. Passing the
  // formatter's own blank through as well gave every report a decorated line
  // with nothing on it, once per report, on every command that prints one.
  const { out } = await capture(() => {
    report("static checks\n\nMelchior-1 (claude)\n  version: 0.0.0\n");
  });

  const lines = out.split("\n");
  const between = lines.slice(
    lines.findIndex((line) => line.includes("static checks")) + 1,
    lines.findIndex((line) => line.includes("Melchior-1")),
  );
  assert.equal(between.length, 1, `one separator between title and body, not ${between.length}`);
});

test("a one-line report needs no body under its title", async () => {
  const { out } = await capture(() => {
    report("ledger: no consult history");
  });
  assert.ok(out.includes("ledger: no consult history"));
  assert.equal(out.trimEnd().split("\n").filter((line) => line.includes("ledger")).length, 1);
});

test("the streams are restored after a capture, so no test leaks into the next", async () => {
  const first = await capture(() => {
    plain("inside");
  });
  const second = await capture(() => {
    plain("after");
  });
  assert.equal(first.out, "inside\n");
  assert.equal(second.out, "after\n");
});

test("the terminal question is asked of the stream held, not of the process", async () => {
  // The writer holds its streams so a test can capture them, and the same hold
  // is what makes the split provable in-process: asking `process.stdout` would
  // have made every assertion about the drawn path depend on how the suite was
  // launched, and left the drawn path unreachable under `node --test`.
  const piped = await capture(() => decorated());
  const terminal = await capture(() => decorated(), { tty: true });

  assert.equal(piped.result, false, "a sink is not a terminal");
  assert.equal(terminal.result, true, "a stream that says it is a terminal is one");
});

test("a build agent's terminal is a pipe: nobody is reading the redraw", async () => {
  const built = await capture(() => decorated(), { tty: true, ci: true });
  assert.equal(built.result, false);
});

test("a question is asked only when both ends are a terminal", async () => {
  // A prompt drawn with nowhere to read from hangs until the pipeline times
  // out, and MAGI's caller is a pipeline.
  const halfway = await capture(() => interactive(), { tty: true, inputTty: false });
  const both = await capture(() => interactive(), { tty: true, inputTty: true });

  assert.equal(halfway.result, false, "stdout alone is not enough to ask");
  assert.equal(both.result, true);
});

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
  for (const entry of SCREEN.guide) {
    assert.ok(out.includes(entry.title), `${entry.title} titles its own note`);
    assert.ok(out.includes(entry.body.split(":")[0] as string), `${entry.title} kept its prose`);
  }
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
