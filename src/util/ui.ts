/**
 * Every byte a command writes goes through here.
 *
 * The commands each reached for `console.log` directly, which left the two
 * things a caller depends on decided at every call site: whether a line was a
 * result or a refusal, and which stream it landed on. Both are decided here
 * now, once. `@clack/prompts` draws the terminal; the split is this module's.
 *
 * Three rules the drawing never gets to break:
 *
 * - A result goes to stdout and a refusal to stderr. A caller that pipes
 *   stdout must still see the refusal, and a caller that reads only stdout
 *   must never mistake one for a result.
 * - What a machine reads is written plain. `--version` is parsed and the
 *   usage block is copied out of a terminal, so neither carries a bar, a
 *   symbol or a colour. They still come through here: one writer is the
 *   point, not one decoration.
 * - Nothing animates, and nothing here touches stdin. A long wait announces
 *   itself and then reports what came of it, in two ordinary lines.
 *
 * That third rule cost this module a spinner, and the reason is worth
 * keeping. `@clack/prompts` draws one by seizing the terminal: it puts stdin
 * in raw mode and reads keypresses itself, and on the cancel key it calls
 * `process.exit(0)` before anything else can run. Exit 0 is this tool's word
 * for "the command did its job", so a fan-out interrupted halfway through,
 * with nothing gated and nothing written to the ledger, would have reported
 * success. A progress animation is not worth a false exit code, and none of
 * these commands reads stdin at all. Off a terminal it was wrong for a
 * second reason: the redraw is cursor escapes, which are invisible on a
 * terminal and are litter in a pipe, and MAGI's output is read by an
 * orchestrating assistant through one.
 *
 * The two streams are held rather than reached for, so a test can capture
 * what a command wrote without reassigning anything on `process`.
 */

import type { Writable } from "node:stream";

import { intro, log, outro } from "@clack/prompts";

export interface Streams {
  readonly out: Writable;
  readonly err: Writable;
}

let streams: Streams = { out: process.stdout, err: process.stderr };

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

/** The name of the interaction, opening the bar every later line hangs off. */
export function open(title: string): void {
  intro(title, { output: streams.out });
}

/** The interaction's last line, closing the bar `open` started. */
export function close(message: string): void {
  outro(message, { output: streams.out });
}

/**
 * A named stage of the command: what it is about to do, or what came of it.
 * A wait long enough to read as a hang is two of these, one on each side.
 */
export function step(message: string): void {
  log.step(message, { output: streams.out });
}

/** A step that did what it said. */
export function success(message: string): void {
  log.success(message, { output: streams.out });
}

/** Something the user should read but need not act on. */
export function info(message: string): void {
  log.info(message, { output: streams.out });
}

/** Not yet a refusal, but on the way to one. */
export function warn(message: string): void {
  log.warn(message, { output: streams.out });
}

/**
 * A line under the step above it: a seat's verdict, a harness's skill row, a
 * trigger that fired. Carries the bar and no symbol, because a symbol on each
 * of eight lines reads as eight unrelated events.
 */
export function detail(message: string): void {
  log.message(message, { output: streams.out });
}

/**
 * A block some formatter rendered whole. Its first line is already its title,
 * so that line gets the step symbol and the rest hangs under it; the text
 * itself is passed through untouched, because the report is built and tested
 * where it is formatted, not here.
 *
 * The blank line every formatter puts under its title is dropped rather than
 * carried: the renderer already spaces a body from its title, so passing the
 * blank through printed the gap twice, once per report.
 */
export function report(body: string): void {
  const [title, ...rest] = body.trimEnd().split("\n");
  step(title ?? "");
  const under = rest.join("\n").replace(/^\n+/u, "").trimEnd();
  if (under !== "") detail(under);
}

/**
 * The reason a command is about to return non-zero. Goes to stderr, always:
 * this is the line a script greps for, and a pipeline must not swallow it.
 */
export function problem(message: string): void {
  log.error(message, { output: streams.err });
}

/** Text a machine reads, on stdout, exactly as given. */
export function plain(text: string): void {
  streams.out.write(`${text}\n`);
}

/** Text a machine reads, on stderr: the usage block beside a refusal. */
export function plainError(text: string): void {
  streams.err.write(`${text}\n`);
}
