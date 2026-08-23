/**
 * Running a command with both its streams held in memory.
 *
 * A suite that lets CLI output through puts the whole usage block in the
 * repository check transcript, which the evidence floor then carries into
 * every pack, for every seat. So nothing here prints: the command writes into
 * a buffer and the test asserts on the buffer.
 *
 * Held streams are also the only way to tell the two halves of the contract
 * apart. `console.log` and `console.error` used to be swapped for one shared
 * array, which could prove a line was printed and never that it landed on the
 * stream a piped caller reads.
 */

import { Readable, Writable } from "node:stream";

import { setStreams } from "../../src/util/ui.ts";

export interface Captured {
  readonly out: string;
  readonly err: string;
}

export interface CaptureOptions {
  /**
   * Whether the sinks claim to be a person's terminal. The writer asks the
   * stream it holds and not `process.stdout`, so this is what exercises the
   * drawn path in-process: without it every test here would only ever see the
   * piped rendering, and the terminal one would be provable only by spawning
   * a pty.
   */
  readonly tty?: boolean;
  /** What a prompt reads its keypresses from. */
  readonly input?: Readable;
  /**
   * How wide the terminal says it is. Zero is a pty nobody sized, which is
   * where the renderer's framed blocks throw rather than wrap.
   */
  readonly columns?: number;
  /** Whether the input claims to be a terminal, which is what lets a prompt run. */
  readonly inputTty?: boolean;
  /**
   * Whether the run believes it is in CI. A terminal owned by a build agent is
   * a log file with nobody reading it, so the writer treats it as a pipe; this
   * is how a test says so, because the default is to clear the variable.
   */
  readonly ci?: boolean;
}

/** A sink that records, and answers the one question the writer asks it. */
function sink(into: string[], tty: boolean, columns: number): Writable {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      into.push(String(chunk));
      done();
    },
  });
  return Object.assign(stream, { isTTY: tty, columns, rows: 24 });
}

export async function capture<T>(
  run: () => T | Promise<T>,
  options: CaptureOptions = {},
): Promise<Captured & { readonly result: T }> {
  const out: string[] = [];
  const err: string[] = [];
  const tty = options.tty === true;
  const input = options.input ?? Readable.from([]);
  const columns = options.columns ?? 80;
  const restore = setStreams({
    out: sink(out, tty, columns),
    err: sink(err, tty, columns),
    in: Object.assign(input, { isTTY: options.inputTty ?? tty }),
  });
  // The renderer treats CI as a pipe however good the terminal is, and this
  // suite runs in one. Without this, every assertion about the drawn path
  // would pass on a laptop and fail on the machine that gates the release.
  const ci = process.env["CI"];
  if (options.ci === true) process.env["CI"] = "true";
  else if (tty) delete process.env["CI"];
  try {
    return { result: await run(), out: out.join(""), err: err.join("") };
  } finally {
    restore();
    if (ci === undefined) delete process.env["CI"];
    else process.env["CI"] = ci;
  }
}
