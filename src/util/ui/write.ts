/**
 * The lines a command says, and which stream each one lands on.
 *
 * The commands each reached for `console.log` directly, which left the two
 * things a caller depends on decided at every call site: whether a line was a
 * result or a refusal, and which stream it landed on. Both are decided here
 * now, once.
 *
 * Two rules the drawing never gets to break:
 *
 * - A result goes to stdout and a refusal to stderr. A caller that pipes
 *   stdout must still see the refusal, and a caller that reads only stdout
 *   must never mistake one for a result.
 * - What a machine reads is written exactly as given. `--version` is parsed
 *   and the usage block is copied out of a terminal, so neither carries a bar,
 *   a symbol or a colour when it goes down a pipe. It still comes through
 *   here: one writer is the point, not one decoration.
 */

import { intro, log, outro } from "@clack/prompts";

import { errStream, outStream } from "./streams.ts";

/** The name of the interaction, opening the bar every later line hangs off. */
export function open(title: string): void {
  intro(title, { output: outStream() });
}

/** The interaction's last line, closing the bar `open` started. */
export function close(message: string): void {
  outro(message, { output: outStream() });
}

/**
 * A named stage of the command: what it is about to do, or what came of it.
 * A wait long enough to read as a hang is two of these, one on each side.
 */
export function step(message: string): void {
  log.step(message, { output: outStream() });
}

/** Something the user should read but need not act on. */
export function info(message: string): void {
  log.info(message, { output: outStream() });
}

/** A stage that ended well, where saying so is the point of the line. */
export function success(message: string): void {
  log.success(message, { output: outStream() });
}

/** Not yet a refusal, but on the way to one. */
export function warn(message: string): void {
  log.warn(message, { output: outStream() });
}

/**
 * A line under the step above it: a seat's verdict, a harness's skill row, a
 * trigger that fired. Carries the bar and no symbol, because a symbol on each
 * of eight lines reads as eight unrelated events.
 */
export function detail(message: string): void {
  log.message(message, { output: outStream() });
}

/**
 * The reason a command is about to return non-zero. Goes to stderr, always:
 * this is the line a script greps for, and a pipeline must not swallow it.
 */
export function problem(message: string): void {
  log.error(message, { output: errStream() });
}

/** Text a machine reads, on stdout, exactly as given. */
export function plain(text: string): void {
  outStream().write(`${text}\n`);
}

/** Text a machine reads, on stderr: the usage block beside a refusal. */
export function plainError(text: string): void {
  errStream().write(`${text}\n`);
}
