/**
 * The questions, and the answer each one takes when there is nobody to ask.
 *
 * MAGI is driven by an orchestrating assistant through a pipe at least as
 * often as by a person, so the fall-through is the part that matters: a
 * question that waits down a pipe hangs the caller the tool was built for.
 * Both directions are asserted, because they are deliberately not the same.
 * Spending quota falls through to yes, since invoking the command is the
 * approval. Replacing a file this installation did not put there falls
 * through to no, and no flag unlocks it.
 *
 * The prompts are driven in-process rather than through a pty. The writer
 * asks the streams it holds, so a sink that says it is a terminal and a
 * stream that answers with keypresses are all a prompt needs, and the four
 * cases stay deterministic on any machine.
 */

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { approve, choose } from "../../src/util/ui.ts";
import { capture } from "../support/capture.ts";

/** Submit whatever the prompt is showing. */
const ENTER = "\r";

/** What the cancel key sends. */
const CANCEL = "\u0003";

/**
 * A terminal somebody is typing at. The keys are written before the prompt
 * starts and wait in the stream until it reads them, which keeps the test off
 * a timer: a race here would fail on a loaded machine and pass everywhere
 * else.
 */
function typing(...keys: readonly string[]): PassThrough {
  const input = new PassThrough();
  for (const key of keys) input.write(key);
  return Object.assign(input, { setRawMode: () => undefined });
}

test("a question nobody can be asked takes the answer it states", async () => {
  const spend = await capture(() => approve("convene 3 seats?", { otherwise: true }));
  const replace = await capture(() => approve("replace it?", { otherwise: false }));

  assert.deepEqual(spend.result, { cancelled: false, value: true });
  assert.deepEqual(replace.result, { cancelled: false, value: false });
  // And says nothing at all: a prompt half-drawn into a pipe is litter in the
  // transcript an orchestrating assistant reads.
  assert.equal(spend.out, "");
  assert.equal(replace.out, "");
});

test("a terminal with nothing to type at is not a terminal for this", async () => {
  // stdout being a terminal is not enough. A prompt drawn with nowhere to read
  // from waits until the pipeline gives up.
  const answer = await capture(() => approve("convene 3 seats?", { otherwise: true }), {
    tty: true,
    inputTty: false,
  });

  assert.deepEqual(answer.result, { cancelled: false, value: true });
  assert.equal(answer.out, "");
});

test("the flag that says not to ask means that, and never means yes", async () => {
  // It skips the question and takes the answer the question already falls
  // through to. Spending falls through to yes, so `--yes` is yes; the replace
  // question falls through to no, so a skip there would still be no. Returning
  // true outright would have made a single `skip: true` at that call site
  // unlock a replacement no flag can reach, which is the lock this keeps
  // structural rather than a rule about who remembers not to pass it.
  const spend = await capture(
    () => approve("convene 3 seats?", { otherwise: true, skip: true }),
    { tty: true, input: typing(ENTER), inputTty: true },
  );
  const replace = await capture(
    () => approve("replace it?", { otherwise: false, skip: true }),
    { tty: true, input: typing(ENTER), inputTty: true },
  );

  assert.deepEqual(spend.result, { cancelled: false, value: true });
  assert.deepEqual(replace.result, { cancelled: false, value: false });
  assert.equal(spend.out, "", "nothing was asked, so nothing was drawn");
  assert.equal(replace.out, "");
});

test("a person at a terminal is asked, and answering takes what they answered", async () => {
  const spend = await capture(() => approve("convene 3 seats?", { otherwise: true }), {
    tty: true,
    input: typing(ENTER),
    inputTty: true,
  });
  const replace = await capture(() => approve("replace it?", { otherwise: false }), {
    tty: true,
    input: typing(ENTER),
    inputTty: true,
  });

  // Enter takes what the prompt is already showing, and what it shows is the
  // answer the question falls through to. So the two directions differ here
  // exactly as they differ down a pipe.
  assert.deepEqual(spend.result, { cancelled: false, value: true });
  assert.deepEqual(replace.result, { cancelled: false, value: false });
  assert.ok(spend.out.includes("convene 3 seats?"), "the question was drawn");
  assert.ok(replace.out.includes("replace it?"), "the question was drawn");
});

test("cancelling is not a no: it is its own answer", async () => {
  // A no is a decision the command reports and exits 1 for. A cancel ends the
  // command at 130, the way an interrupted wait does, and the two must not
  // reach a command as the same value.
  const answer = await capture(() => approve("convene 3 seats?", { otherwise: true }), {
    tty: true,
    input: typing(CANCEL),
    inputTty: true,
  });

  assert.deepEqual(answer.result, { cancelled: true });
  assert.ok(answer.out.includes("cancelled"), "and the screen says so");
});

test("which harness falls through to the documented one", async () => {
  const answer = await capture(() =>
    choose(
      "which harness gets the skill?",
      [{ value: "claude" as const }, { value: "codex" as const }, { value: "grok" as const }],
      "claude",
    ),
  );

  assert.deepEqual(answer.result, { cancelled: false, value: "claude" });
  assert.equal(answer.out, "");
});

test("a person picks the harness, starting from the documented one", async () => {
  const answer = await capture(
    () =>
      choose(
        "which harness gets the skill?",
        [{ value: "claude" as const }, { value: "codex" as const }, { value: "grok" as const }],
        "codex",
      ),
    { tty: true, input: typing(ENTER), inputTty: true },
  );

  assert.deepEqual(answer.result, { cancelled: false, value: "codex" });
  assert.ok(answer.out.includes("which harness gets the skill?"));
});

test("a question whose input ends is over, and the command is not left hanging", async () => {
  // The renderer waits for a keypress that cannot arrive when the stream it
  // reads has ended, and a promise nobody will settle is not an error: the
  // process exits on an unsettled await, having drawn a question and then
  // gone quiet, with no exit code anyone can act on. So an ended input is a
  // cancel, which is what it is.
  const input = typing();
  input.end();

  const answer = await capture(() => approve("convene 3 seats?", { otherwise: true }), {
    tty: true,
    input,
    inputTty: true,
  });

  assert.deepEqual(answer.result, { cancelled: true });
});
