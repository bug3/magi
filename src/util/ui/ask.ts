/**
 * The questions, and the answer each one falls through to when there is
 * nobody to ask.
 *
 * MAGI is driven by an orchestrating assistant through a pipe as often as by a
 * person, so a question that waits is a question that hangs a pipeline. Every
 * one here therefore carries the answer it takes when stdin is not a terminal,
 * when CI is set, or when the user passed the flag that says not to ask, and
 * the fall-through is stated at the call site rather than defaulted here.
 *
 * The two directions are not the same, and the difference is the whole design:
 *
 * - A run that spends quota falls through to yes. Invoking the command is the
 *   approval; `skills/magi/SKILL.md` has said so since before there was a
 *   prompt, and a consult that refused to run down a pipe would break every
 *   caller MAGI was built for. The terminal question is a second chance, not
 *   the first permission.
 * - Replacing something this installation did not put there falls through to
 *   no, and stays no. There is no flag that unlocks it: overwriting somebody
 *   else's file needs a person at a terminal saying so, and a pipe has none.
 *
 * Cancelling is its own answer and never a no. A no is a decision the command
 * reports; a cancel ends the command at 130, the way an interrupted wait does.
 */

import type { Readable } from "node:stream";

import { cancel, confirm, isCancel, select, type Option } from "@clack/prompts";

import { inStream, interactive, outStream } from "./streams.ts";

/** One thing a question offers, named here so a caller never learns whose it is. */
export type Choice<Value> = Option<Value>;

/** What came back, with cancelling kept apart from any answer. */
export type Answer<T> =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly value: T };

export interface Fallthrough {
  /** The answer where nobody can be asked. Stated, never assumed. */
  readonly otherwise: boolean;
  /**
   * The user answered on the command line already. Only a question that falls
   * through to yes may be skipped this way: a flag on a pipe is not a person.
   */
  readonly skip?: boolean;
}

/** Ask to go ahead. */
export async function approve(question: string, fall: Fallthrough): Promise<Answer<boolean>> {
  if (fall.skip === true) return { cancelled: false, value: true };
  if (!interactive()) return { cancelled: false, value: fall.otherwise };

  const input = inStream();
  const ended = untilItEnds(input);
  try {
    return settle(
      await confirm({
        message: question,
        initialValue: fall.otherwise,
        output: outStream(),
        input,
        signal: ended.signal,
      }),
    );
  } finally {
    ended.release();
  }
}

/** Ask which one. */
export async function choose<Value extends string>(
  question: string,
  options: ReadonlyArray<Choice<Value>>,
  otherwise: Value,
): Promise<Answer<Value>> {
  if (!interactive()) return { cancelled: false, value: otherwise };

  const input = inStream();
  const ended = untilItEnds(input);
  try {
    return settle(
      await select<Value>({
        message: question,
        options: [...options],
        initialValue: otherwise,
        output: outStream(),
        input,
        signal: ended.signal,
      }),
    );
  } finally {
    ended.release();
  }
}

/**
 * A question is over when there is nobody left to answer it.
 *
 * A terminal whose input ends is a person pressing Ctrl-D, and the renderer
 * has no answer for that: it goes on waiting for a keypress that cannot
 * arrive. What that looked like was the command exiting on an unsettled
 * promise, having drawn a question and then gone quiet. The renderer does
 * understand an abort, and treats it exactly as a cancel, which is what this
 * is: the question ended without being answered.
 */
function untilItEnds(input: Readable): { readonly signal: AbortSignal; readonly release: () => void } {
  const controller = new AbortController();
  const over = (): void => controller.abort();
  input.once("end", over);
  input.once("close", over);
  return {
    signal: controller.signal,
    release: () => {
      input.off("end", over);
      input.off("close", over);
    },
  };
}

/**
 * The renderer answers a cancelled prompt with a symbol rather than a value,
 * and that symbol must not reach a command: a command asks what the user
 * decided, and cancelling is not a decision.
 */
function settle<Value>(answer: Value | symbol): Answer<Value> {
  if (isCancel(answer)) {
    cancel("cancelled; nothing was done", { output: outStream() });
    return { cancelled: true };
  }
  return { cancelled: false, value: answer };
}
