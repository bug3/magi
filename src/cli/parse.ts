/**
 * The argument grammar every command is parsed against, in one place.
 *
 * Each command used to compare whole tokens, so `--harness=codex` was an
 * unknown argument in three separate loops: the form every GNU-style CLI takes
 * exited 2 in a tool that documents the flag. Joining a value with `=`,
 * repeating a flag, naming a near miss and refusing a stray word are grammar,
 * not policy, and grammar is what `commander` is here for.
 *
 * What it is not here for is speaking or exiting. `src/util/ui.ts` owns every
 * byte a command emits, and a parser writing its own refusal straight to
 * stderr would be a second writer that no facade test could see. Both are
 * turned off here rather than at each call site: a refusal comes back as a
 * value, and the command decides how it is drawn and what the process reports.
 */

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

/**
 * The two pieces of commander a grammar composes with: an error a value parser
 * raises to refuse one flag by name, and the option a flag is declared as when
 * `.option()` cannot say enough. Re-exported rather than imported at each call
 * site, so this module stays the only door commander comes through.
 */
export { InvalidArgumentError, Option };

/** What a command adds to the empty grammar: its flags, and nothing else. */
export type Grammar = (command: Command) => Command;

/** A parse that either produced an invocation or a reason, never both. */
export type Parsed<T> =
  | { readonly ok: true; readonly opts: T; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse `argv` against one command's flags.
 *
 * The command is built per call rather than shared, because commander keeps
 * the values it parsed: a module-level definition would carry one invocation's
 * flags into the next, which is exactly the bug a parser is supposed to end.
 */
export function parseArgv<T>(
  name: string,
  grammar: Grammar,
  argv: readonly string[],
): Parsed<T> {
  const said: string[] = [];
  const command = new Command(name)
    .exitOverride()
    .configureOutput({
      writeOut: (line) => said.push(line),
      writeErr: (line) => said.push(line),
    })
    // A bare word is not an argument any of these commands takes, and one that
    // is silently ignored is how `--brief b.md extra.md` loses a file.
    .allowExcessArguments(false)
    // `magi help` is the help screen. A second spelling that this layer would
    // answer instead, drawn by commander rather than by the renderer, is the
    // drift this tool holds three harness CLIs to.
    .helpOption(false);
  try {
    grammar(command).parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return { ok: false, reason: refusal(said, error) };
    throw error;
  }
  return { ok: true, opts: command.opts() as T, args: command.args };
}

/**
 * Every long flag a grammar declares, without parsing anything.
 *
 * This is what makes the usage block checkable rather than merely proofread:
 * `test/cli/args.test.ts` reads the flags a command accepts from the command
 * itself and holds the printed block to them, in both directions. The rule it
 * enforces is the one MAGI applies to three harness CLIs: a flag that works
 * and is not printed, or is printed and does not work, is the same defect.
 */
export function flagsOf(grammar: Grammar): readonly string[] {
  return grammar(new Command("probe"))
    .options
    // A hidden flag is one taken only so it can be refused by its own name
    // rather than as an unknown token. It does not work, so printing it would
    // be the drift in the other direction.
    .filter((option) => !option.hidden)
    .map((option) => option.long)
    .filter((long): long is string => long !== null && long !== undefined);
}

/**
 * Why the parse failed, in the words commander would have printed.
 *
 * Read from what it tried to write rather than from the error, because the
 * useful half lives only there: `unknown option '--instal'` is the message,
 * and `(Did you mean --install?)` is written beside it and carried nowhere
 * else. The `error: ` prefix comes off because `problem` already marks the
 * line as one.
 */
function refusal(said: readonly string[], error: CommanderError): string {
  const written = said.join("").trim();
  return (written.length > 0 ? written : error.message.trim()).replace(/^error: /u, "");
}
