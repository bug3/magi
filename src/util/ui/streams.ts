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
 * The narrowest terminal still worth drawing a frame in.
 *
 * Below it the framed blocks come apart: the usage table stops being
 * copy-pasteable once it wraps, and prose wrapped into a box two characters
 * wide is one letter per line. A terminal that reports no width at all is
 * worse than narrow: `box` divides by what it was told and throws outright,
 * which is what `magi help` did in a pty nobody had sized. Falling back to the
 * piped rendering is the safe direction every time, because that rendering is
 * plain text and fits any width.
 */
const NARROWEST = 60;

/**
 * How wide the stream says it is, or nothing where it will not say.
 *
 * Absent is not eighty. Taking a missing width as the renderer's own default
 * drew a framed block at an assumed width on a terminal that had never
 * claimed one, which is the opposite of what this module documents: a
 * terminal that will not say how wide it is gets the rendering that fits any
 * width. Zero, negative and non-finite are the same case by another spelling.
 */
export function columns(stream: Writable = streams.out): number | undefined {
  const declared = (stream as { columns?: number }).columns;
  if (typeof declared !== "number" || !Number.isFinite(declared) || declared <= 0) return undefined;
  return declared;
}

/**
 * Whether the given stream is a person's terminal, wide enough to draw in. CI
 * counts as a pipe even when it hands out a terminal, because nobody is there
 * to read a redraw and the log it keeps is a file.
 *
 * Asked per stream and not once for the process: a refusal goes to stderr, so
 * a run with stdout piped and stderr on the terminal still draws the refusal.
 */
export function decorated(stream: Writable = streams.out): boolean {
  const wide = columns(stream);
  return !isCI() && isTTY(stream) && wide !== undefined && wide >= NARROWEST;
}

/**
 * Whether a question may be asked. Both ends are checked, because a prompt
 * drawn with nowhere to read from hangs until the pipeline gives up, and
 * MAGI's caller is a pipeline. Every prompt in this module carries the answer
 * it falls through to when this is false.
 *
 * Deliberately not `decorated`. Asking is not drawing, and the width floor
 * above is about frames: reusing it here meant a person in an ordinary narrow
 * split was never asked, and a run that spends quota fell through to yes on a
 * terminal with somebody sitting at it. Measured rather than assumed: the
 * renderer's `confirm` and `select` draw and answer correctly at every width
 * down to a terminal reporting none at all, which is exactly where `box`
 * throws.
 */
export function interactive(): boolean {
  const input = inStream() as { isTTY?: boolean };
  return !isCI() && isTTY(streams.out) && input.isTTY === true;
}
