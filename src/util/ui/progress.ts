/**
 * The long waits, and the exit code an interrupted one has to report.
 *
 * A council fan-out is three harness processes answering at once, and
 * `doctor --live` and `doctor --calibrate` are more of the same. They take
 * minutes with nothing on screen, which reads as a hang. So on a terminal the
 * wait is drawn, and the drawing is a spinner with a timer on it.
 *
 * That spinner was removed from 0.6.0, and the reason it was removed is real:
 * `@clack/prompts` draws one by seizing the terminal. It puts stdin in raw
 * mode, reads keypresses itself, and on the cancel key calls `process.exit(0)`
 * before anything else runs. Exit 0 is this tool's word for "the command did
 * its job", so a fan-out interrupted halfway through, with nothing gated and
 * nothing written to the ledger, reported success.
 *
 * What was never measured is that the exit code is correctable. A handler on
 * `process.on("exit")` runs after `process.exit(0)` has set the code and can
 * still overwrite it, so an interrupt during a live wait leaves 130 behind.
 * Three lines, and the probe that proves them is a test in this repository.
 *
 * The guard is not optional and not best-effort. It is installed with the
 * spinner and removed with it, and while it is installed a zero exit is a lie:
 * nobody reaches an exit of zero through here except by finishing.
 *
 * Off a terminal none of this runs. The wait is announced in one ordinary line
 * and accounted for in the next, because MAGI's stdout is read by an
 * orchestrating assistant through a pipe and carried into evidence packs,
 * where a redraw is litter and a timer is noise.
 */

import { spinner } from "@clack/prompts";

import { decorated, outStream } from "./streams.ts";
import { step } from "./write.ts";

/** What the shell reports for a command a person interrupted. */
const INTERRUPTED = 130;

/** The two ways an interrupt arrives when nothing is reading raw keypresses. */
const SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface Wait {
  /** What is happening now, without ending the wait. Drawn only. */
  readonly say: (message: string) => void;
  /** The wait ended, and this is what came of it. */
  readonly done: (message?: string) => void;
  /** The wait ended badly. */
  readonly failed: (message: string) => void;
}

/**
 * Open a wait. The caller must close it on every path, which is why almost
 * every call site should use `waiting` instead: it closes in a `finally`.
 * Reach for this one only where the work that ends the wait is not the work
 * that started it, as in the fan-out, where the announcement comes from a
 * callback the runner fires.
 */
export function announce(message: string): Wait {
  if (!decorated(outStream())) {
    step(message);
    return {
      say: () => undefined,
      done: (finished) => {
        if (finished !== undefined) step(finished);
      },
      failed: (finished) => step(finished),
    };
  }

  let live = true;
  // While the wait is live, a zero exit did not come from finishing.
  const interrupted = (): void => {
    if (live && (process.exitCode ?? 0) === 0) process.exitCode = INTERRUPTED;
  };
  process.on("exit", interrupted);
  const spin = spinner({ indicator: "timer", output: outStream() });
  spin.start(message);
  // Registered after the spinner's own handlers, so its cleanup runs first and
  // the terminal is out of raw mode with the cursor back before this exits.
  //
  // Not the renderer's `onCancel` hook, which was tried and is wrong: the
  // renderer calls it for any exit with code 1 as well as for a signal,
  // because it reads 1 as "cancelled". Code 1 is this tool's word for doctor
  // finding problems and for a preflight refusing, and a test here watched
  // that become a 130.
  //
  // A handler is needed at all because attaching one is what stops SIGINT from
  // killing the process by default, and the renderer attaches its own. Without
  // this, Ctrl-C off a raw-mode terminal stopped the progress line and left
  // the fan-out running behind it.
  const signalled = (): void => {
    process.exit(INTERRUPTED);
  };
  for (const signal of SIGNALS) process.on(signal, signalled);

  const end = (finish: (finished: string) => void, finished: string): void => {
    if (!live) return;
    live = false;
    finish(finished);
    process.off("exit", interrupted);
    for (const signal of SIGNALS) process.off(signal, signalled);
  };
  return {
    say: (said) => {
      spin.message(said);
    },
    done: (finished) => end(spin.stop, finished ?? message),
    failed: (finished) => end(spin.error, finished),
  };
}

/**
 * Announce a wait, do the work, and close the wait however the work ends. The
 * `finally` is the point: a wait left open holds the exit guard, and a guard
 * held past the end of the work turns an ordinary success into a 130.
 */
export async function waiting<T>(
  message: string,
  work: (say: (said: string) => void) => Promise<T>,
): Promise<T> {
  const wait = announce(message);
  try {
    const result = await work(wait.say);
    wait.done();
    return result;
  } catch (error) {
    wait.failed(`${message}: failed`);
    throw error;
  }
}
