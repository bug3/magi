/**
 * The argument grammar every command is parsed against, and the screens that
 * grammar prints, in one place.
 *
 * Each command used to compare whole tokens, so `--harness=codex` was an
 * unknown argument in three separate loops: the form every GNU-style CLI takes
 * exited 2 in a tool that documents the flag. Joining a value with `=`,
 * repeating a flag, naming a near miss and refusing a stray word are grammar,
 * not policy, and grammar is what `commander` is here for. So is telling a
 * person what a command takes: the flags are declared once, and the screen is
 * generated from the declaration rather than typed out beside it, where the
 * two drifted for as long as both existed.
 *
 * What commander is not here for is speaking or exiting. `src/util/ui.ts` owns
 * every byte a command emits, and a parser writing its own refusal or its own
 * help straight to a stream would be a second writer that no facade test could
 * see. Both are turned off here rather than at each call site: a refusal and a
 * help screen come back as values, and the command decides how each is drawn
 * and what the process reports.
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

/** What an invocation turned out to be: a call, a question, or a mistake. */
export type Parsed<T> =
  | { readonly kind: "invocation"; readonly opts: T; readonly args: readonly string[] }
  | { readonly kind: "help"; readonly screen: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The width every generated screen is laid out to.
 *
 * Pinned rather than taken from the terminal, because this text is compared
 * byte for byte: the block in README.md is the one the CLI prints, and a
 * screen that reflowed with the window would make that assertion depend on
 * whose terminal ran the suite.
 */
const HELP_WIDTH = 80;

/**
 * A command that cannot speak and cannot exit: what it would have written is
 * captured, and what it would have exited with is thrown back as a value.
 *
 * Colour is pinned off for the same reason the width is. Commander asks the
 * output stream whether it paints, and the streams here are arrays, so the
 * answer would come from the process's own stream and put escapes into a
 * string that is asserted against a file.
 */
function contained(name: string, said: string[]): Command {
  return new Command(name)
    .exitOverride()
    .configureOutput({
      writeOut: (line) => said.push(line),
      writeErr: (line) => said.push(line),
      getOutHasColors: () => false,
      getErrHasColors: () => false,
    })
    .configureHelp({ helpWidth: HELP_WIDTH })
    // A bare word is not an argument any of these commands takes, and one that
    // is silently ignored is how `--brief b.md extra.md` loses a file.
    .allowExcessArguments(false)
    // Only the spelling the usage block offers. `-h` is not a MAGI flag, and a
    // second spelling that works and is not printed is the drift this tool
    // holds three harness CLIs to.
    .helpOption("--help", "print what this command takes");
}

/**
 * Parse `argv` against one command's flags.
 *
 * The command is built per call rather than shared, because commander keeps
 * the values it parsed: a module-level definition would carry one invocation's
 * flags into the next, which is exactly the bug a parser is supposed to end.
 */
export function parseArgv<T>(name: string, grammar: Grammar, argv: readonly string[]): Parsed<T> {
  const said: string[] = [];
  const command = contained(name, said);
  try {
    grammar(command).parse([...argv], { from: "user" });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    // Asking what a command takes is not a mistake, and the screen commander
    // wrote for it is the answer rather than a reason for exit 2.
    if (error.code === "commander.helpDisplayed") {
      return { kind: "help", screen: said.join("").trimEnd() };
    }
    return { kind: "refused", reason: refusal(said, error) };
  }
  return { kind: "invocation", opts: command.opts() as T, args: command.args };
}

/**
 * The screen `magi help` prints: every command, and what each one is for.
 *
 * Generated from the same grammars the commands are parsed with, so a flag
 * cannot be accepted without being printable and cannot be printed without
 * being accepted. What each command's own screen adds is its flags in full;
 * this one names the commands and sends the reader to those.
 */
export function rootScreen(name: string, commands: Readonly<Record<string, Grammar>>): string {
  const said: string[] = [];
  const program = contained(name, said)
    .helpCommand("help", "print this screen")
    .option("-v, --version", "print the version and nothing around it");
  for (const [command, grammar] of Object.entries(commands)) grammar(program.command(command));
  return program.helpInformation().trimEnd();
}

/**
 * Every long flag a grammar declares, without parsing anything.
 *
 * What the screens print is generated from these, so the drift that needed
 * watching is gone; what a guard can still ask is the other half, that the
 * flags a command declares are the flags its own screen shows.
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
