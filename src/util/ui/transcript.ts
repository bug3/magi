/**
 * What a subprocess printed, for the commands whose whole job is running them.
 *
 * `magi checks` runs every check a seat proposed and reported one line each:
 * `ran [git status --short] -> exit 0`. Whether the check passed was there;
 * what it found never was. For a check that failed, that is the only thing
 * anyone wanted.
 *
 * So on a terminal each run keeps its output under it while the run is
 * happening, and folds to its one line when it goes well. A run that did not
 * go well keeps what it printed, because that is the case somebody is reading.
 *
 * Down a pipe none of this happens. The rows a piped caller has always
 * received are printed by the command in the order it has always printed them,
 * and `drawn` is how the command knows which of the two it is in.
 */

import { note, taskLog } from "@clack/prompts";

import { sanitizeLine } from "../text.ts";
import { decorated, outStream } from "./streams.ts";
import { step, verdict } from "./write.ts";

/** How many lines of one run stay on screen, newest last. */
const TAIL = 12;

/** How wide one of those lines may be before it is cut. */
const WIDEST = 200;

export interface Transcript {
  /**
   * Whether the runs were drawn as they happened. A command prints its own
   * rows when they were not, and prints nothing twice when they were.
   */
  readonly drawn: boolean;
  /** One run: what it was, whether it went well, and what it printed. */
  readonly ran: (summary: string, ok: boolean, output: string) => void;
  /** The last run is in. */
  readonly done: (message: string) => void;
}

export function transcript(title: string): Transcript {
  if (!decorated(outStream())) {
    // The two ordinary lines a piped caller has always been given: what is
    // about to run, and what came of it.
    step(title);
    return { drawn: false, ran: () => undefined, done: (message) => step(message) };
  }

  const log = taskLog({ title, limit: TAIL, output: outStream() });
  const runs: Array<{ readonly summary: string; readonly ok: boolean; readonly kept: string }> = [];
  return {
    drawn: true,
    ran: (summary, ok, output) => {
      const lines = tail(output);
      const group = log.group(summary);
      for (const line of lines) group.message(line);
      // Resolving the group folds what it printed away, which is what should
      // happen to a run nobody needs to read. What the failures printed comes
      // back below, once, under the run it belongs to.
      if (ok) group.success(summary);
      else group.error(summary);
      runs.push({ summary, ok, kept: ok ? "" : lines.join("\n") });
    },
    done: (message) => {
      // The live log ends by erasing itself down to this one line. Everything
      // it was showing is then printed once more, settled: a terminal that saw
      // its own command run should not end up with less on screen than a pipe.
      log.success(message);
      for (const run of runs) {
        // A run that kept its output is titled by the frame around it, so
        // printing the row as well would say the same line twice in a row.
        if (run.kept === "") verdict(run.summary, run.ok);
        else note(run.kept, run.summary, { output: outStream() });
      }
    },
  };
}

/** The end of what a run printed, which is where a failure says why. */
function tail(output: string): readonly string[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-TAIL)
    .map((line) => sanitizeLine(line, WIDEST));
}
