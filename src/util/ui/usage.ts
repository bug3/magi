/**
 * The screens a user sees before any work happens: what the tool can do, what
 * version it is, and why an invocation was refused.
 *
 * These are the most-read surfaces MAGI has, and they were the last ones the
 * renderer touched. `magi` with no arguments, `magi help` and `--version` were
 * raw writes, so the first thing anyone saw was the one thing that had not
 * changed. That is not a decoration decision a command layer gets to make, so
 * it is made here, once, by the same terminal question everything else asks.
 *
 * The pipe is what keeps the plain path: `--version` is parsed by whatever
 * asked for it, and the usage block is copied out of a terminal and pasted
 * into a shell. Both must arrive whole, without a bar down the side. So the
 * bytes a pipe receives are assembled here too, from the same parts the drawn
 * screen is built from, rather than kept as a second string beside them where
 * the two would drift.
 */

import { box, cancel, intro, note } from "@clack/prompts";

import { decorated, errStream, outStream } from "./streams.ts";
import { close, detail, open, plain, plainError, problem } from "./write.ts";

/** One command's prose: what it does, and what its flags cost. */
export interface CommandGuide {
  readonly title: string;
  readonly body: string;
}

export interface UsageScreen {
  /** The invocation table, copy-pasteable exactly as it appears. */
  readonly commands: string;
  /** The prose under it, one entry per command. */
  readonly guide: readonly CommandGuide[];
}

/**
 * The whole screen as one block, which is what a pipe receives. The guide's
 * entries run together without blank lines between them, because that is the
 * shape the block has always had and it is pinned by the end-to-end suite.
 */
export function usageText(screen: UsageScreen): string {
  return `${screen.commands}\n\n${screen.guide.map((entry) => entry.body).join("\n")}`;
}

/** What the tool can do: `magi help`, `magi --help`, and `magi` with nothing. */
export function usage(screen: UsageScreen): void {
  if (!decorated(outStream())) {
    plain(usageText(screen));
    return;
  }
  open("magi");
  // Sized to the table rather than to the terminal: the default stretches a
  // box to the full width, which puts the flags at one edge and the frame at
  // the other with a hand's width of nothing between them.
  box(screen.commands, "usage", { output: outStream(), width: "auto" });
  // One note per command rather than one wall of prose: the paragraphs are
  // about six different things, and run together nobody reads past the first.
  for (const entry of screen.guide) note(entry.body, entry.title, { output: outStream() });
  close("the council thinks; the orchestrator works");
}

/**
 * The version, and nothing around it where it is being parsed.
 *
 * The exact-compare in the end-to-end suite is the contract: a bar or a colour
 * around this number is a break that only a whole-string assertion can see.
 */
export function version(value: string): void {
  if (!decorated(outStream())) {
    plain(value);
    return;
  }
  open("magi");
  detail(value);
  close("magi help lists what it can do");
}

/**
 * The invocation itself was wrong, so the block goes to stderr and the caller
 * gets exit 2. A pipeline reading stdout for a result must not receive this as
 * one.
 *
 * A reason given here is drawn on a terminal only. What a pipe receives on
 * this path is a byte contract older than this renderer: the block alone, with
 * nothing before it. A command that wants its reason on both paths says so
 * with `problem` before calling this, which is what the subcommands do.
 */
export function refuseUsage(screen: UsageScreen, reason?: string): void {
  if (!decorated(errStream())) {
    plainError(usageText(screen));
    return;
  }
  // Opened on stderr rather than through `open`, because every line of this
  // screen belongs on the stream a pipeline reads separately, and a bar that
  // `cancel` closes without anything having opened it hangs off nothing.
  intro("magi", { output: errStream() });
  if (reason !== undefined) problem(reason);
  box(screen.commands, "usage", { output: errStream(), width: "auto" });
  cancel("magi help explains each command", { output: errStream() });
}
