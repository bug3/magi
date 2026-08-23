/**
 * The two streams a command writes to, the one it may read from, and the one
 * question every renderer here asks before it draws: is a human looking?
 *
 * The streams are held rather than reached for, so a test can capture what a
 * command wrote without reassigning anything on `process`. That is also what
 * makes the question answerable in a test: `decorated` asks the held stream
 * whether it is a terminal, not `process.stdout`, so a suite can hand in a
 * sink that claims to be one and exercise the drawn path in-process.
 *
 * The split itself is the point. MAGI is run two ways: by a person at a
 * terminal, and by an orchestrating assistant through a pipe that parses what
 * comes back. The person should get everything the renderer can draw. The
 * pipe must keep receiving the exact bytes it received before any of this was
 * drawn, because `--version` is parsed, the usage block is copied out, and
 * MAGI's own check transcript is carried into evidence packs, where a cursor
 * escape is litter that every seat then reads.
 */

import type { Readable, Writable } from "node:stream";

import { isCI, isTTY } from "@clack/prompts";

export interface Streams {
  readonly out: Writable;
  readonly err: Writable;
  /** Only a prompt reads it; everything else here writes. */
  readonly in?: Readable;
}

let streams: Streams = { out: process.stdout, err: process.stderr, in: process.stdin };

/**
 * Point the writer somewhere else and hand back the undo. A test that forgot
 * to restore would leak its capture into every test after it, so the restore
 * is the return value rather than a second call whose shape has to be
 * remembered.
 */
export function setStreams(replacement: Streams): () => void {
  const previous = streams;
  streams = replacement;
  return () => {
    streams = previous;
  };
}

/** Where a result goes. */
export function outStream(): Writable {
  return streams.out;
}

/** Where a refusal goes, always and only. */
export function errStream(): Writable {
  return streams.err;
}

/** Where a prompt reads its keypresses. */
export function inStream(): Readable {
  return streams.in ?? process.stdin;
}

/**
 * Whether the given stream is a person's terminal. CI counts as a pipe even
 * when it hands out a terminal, because nobody is there to read a redraw and
 * the log it keeps is a file.
 *
 * Asked per stream and not once for the process: a refusal goes to stderr, so
 * a run with stdout piped and stderr on the terminal still draws the refusal.
 */
export function decorated(stream: Writable = streams.out): boolean {
  return !isCI() && isTTY(stream);
}

/**
 * Whether a question may be asked. Stricter than `decorated`, and it has to
 * be: a prompt that draws with nowhere to read from hangs forever, and MAGI's
 * caller is a pipeline. Both ends are checked, and every prompt in this module
 * carries a default it falls through to when this is false.
 */
export function interactive(): boolean {
  const input = inStream() as { isTTY?: boolean };
  return decorated(streams.out) && input.isTTY === true;
}
