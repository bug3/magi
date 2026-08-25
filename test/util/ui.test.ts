/**
 * The rules `src/util/ui.ts` states, asserted rather than described.
 *
 * Which symbols the renderer draws is not asserted anywhere here. They depend
 * on the terminal's unicode support and on the renderer's version, so a test
 * that pinned one would fail on a machine where nothing was wrong. What is
 * pinned is what a caller depends on: which stream a line lands on, that a
 * machine-read line carries nothing around it, that a pipe is written to as it
 * always was, and that a terminal gets more than a pipe does.
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
  problem,
  report,
  step,
  transcript,
  verdict,
  warn,
} from "../../src/util/ui.ts";
// Reached around the facade on purpose: these two are what the pipe's plain
// bytes are written with, and the facade stops offering them so that no
// command can choose not to be drawn. This suite is the rule's own test.
import { plain, plainError } from "../../src/util/ui/write.ts";
import { capture } from "../support/capture.ts";

/**
 * An escape sequence, which is how every cursor move begins. Matched on the
 * control character and not on the bracket alone: a bare bracket is ordinary
 * text, and a message carrying one ("ran [git status]") would otherwise fail
 * this suite on a machine where nothing was wrong.
 */
const ESCAPE = /\u001B\[/u;

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

test("nothing reaches a pipe that moves a cursor, on either stream", async () => {
  // A redraw is invisible on a terminal and is litter in a pipe, and MAGI's
  // output is read by an orchestrating assistant through one and carried into
  // evidence packs. The terminal is where the drawing goes; this is the rule
  // for everything else, asserted over every writer at once.
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

test("a report is framed under its own title on a terminal", async () => {
  // `magi doctor` prints five of these. One bar down the left of all of them
  // is a wall of text with five headings somewhere inside it.
  const body = "static checks\n\nMelchior-1 (claude)\n  version: 0.0.0\n";
  const piped = await capture(() => {
    report(body);
  });
  const terminal = await capture(() => {
    report(body);
  }, { tty: true });

  assert.notEqual(terminal.out, piped.out, "a terminal gets the frame, a pipe does not");
  for (const line of ["static checks", "Melchior-1 (claude)", "version: 0.0.0"]) {
    assert.ok(terminal.out.includes(line), `${line} survived the framing`);
    assert.ok(piped.out.includes(line), `${line} survived the pipe`);
  }
});

test("a verdict is its own symbol on a terminal and stays on the bar in a pipe", async () => {
  const piped = await capture(() => {
    verdict("MELCHIOR-1: valid", true);
  });
  const terminal = await capture(() => {
    verdict("MELCHIOR-1: valid", true);
  }, { tty: true });

  assert.ok(piped.out.includes("MELCHIOR-1: valid"));
  assert.ok(terminal.out.includes("MELCHIOR-1: valid"));
  // Three seats are three verdicts and the eye should find the one that went
  // wrong; eight harness rows are one list, and a symbol on each of them reads
  // as eight unrelated events. The pipe keeps the bar for the second reason
  // and because those bytes are read by something that was reading them
  // before any of this was drawn.
  assert.notEqual(terminal.out, piped.out);
});

test("a verdict that went wrong is a warning wherever it lands", async () => {
  // Never a stderr refusal: one seat answering badly is a result the command
  // still returns 0 for, and a caller reading stderr for refusals must not
  // find it there.
  for (const tty of [false, true]) {
    const { out, err } = await capture(() => {
      verdict("Casper-3: INVALID (schema)", false);
    }, { tty });
    assert.ok(out.includes("Casper-3: INVALID (schema)"), `on stdout with tty ${String(tty)}`);
    assert.equal(err, "", `never on stderr, with tty ${String(tty)}`);
  }
});

test("a pipe is told what is running and what came of it, in two lines", async () => {
  // Exactly the two lines `magi checks` has always printed around its run.
  const { out } = await capture(() => {
    const runs = transcript("planning the checks proposed by 3 valid seats");
    runs.ran("Melchior-1 f1: ran [git status] -> exit 0", true, "M src/cli.ts");
    runs.done("1 proposed check");
  });

  assert.ok(out.includes("planning the checks proposed by 3 valid seats"));
  assert.ok(out.includes("1 proposed check"));
  // The rows are the command's to print down a pipe, in the order it has
  // always printed them, which is what `drawn` tells it.
  assert.ok(!out.includes("Melchior-1"), "the rows are not the transcript's on this path");
});

test("a terminal is shown what a check printed when the check did not pass", async () => {
  // The whole point of the command: `ran [git status --short] -> exit 0` said
  // whether a check passed and never once said what it found.
  const { out, result } = await capture(() => {
    const runs = transcript("planning the checks proposed by 3 valid seats");
    runs.ran("Melchior-1 f1: ran [git status] -> exit 0", true, "M src/cli.ts");
    runs.ran("Balthasar-2 f2: ran [git log] -> exit 1", false, "fatal: not a git repository");
    runs.done("2 proposed checks");
    return runs.drawn;
  }, { tty: true });

  assert.equal(result, true, "the runs were drawn, so the command prints no rows of its own");
  // What a terminal is left looking at, which is everything from the closing
  // summary on. A capture holds what the live log wrote and then erased with
  // cursor escapes, because erasing moves a real terminal's cursor and appends
  // to a buffer; the settled screen is the part after the last erase.
  const settled = out.slice(out.lastIndexOf("2 proposed checks"));
  assert.ok(settled.includes("fatal: not a git repository"), "the failing run kept its output");
  assert.ok(!settled.includes("M src/cli.ts"), "and the passing one folded its away");
  for (const row of ["Melchior-1 f1", "Balthasar-2 f2"]) {
    assert.ok(settled.includes(row), `${row} is still on screen when the log has settled`);
  }
});

test("a terminal that will not say how wide it is is not drawn to", async () => {
  // Absent is not eighty. Taking a missing width as the renderer's own default
  // framed a block at a width the terminal had never claimed, while this
  // module's own documentation said such a terminal gets the flat rendering.
  const unsaid = await capture(() => decorated(), { tty: true, columns: "unsaid" });
  const zero = await capture(() => decorated(), { tty: true, columns: 0 });
  const said = await capture(() => decorated(), { tty: true, columns: 80 });

  assert.equal(unsaid.result, false, "a width nobody claimed is not a width");
  assert.equal(zero.result, false);
  assert.equal(said.result, true);
});

test("a terminal too narrow to frame a block still has a person on it", async () => {
  // Asking is not drawing. The width floor is about frames, and reusing it as
  // the ask predicate meant a person in an ordinary narrow split was never
  // asked: a run that spends quota fell through to yes with somebody sitting
  // right there. Measured: the renderer's prompts draw and answer correctly at
  // every width, including a terminal reporting none, which is exactly where
  // its framed blocks throw.
  const narrow = await capture(
    () => ({ drawn: decorated(), asked: interactive() }),
    { tty: true, columns: 40, inputTty: true },
  );

  assert.equal(narrow.result.drawn, false, "no frame fits");
  assert.equal(narrow.result.asked, true, "the question still does");
});
