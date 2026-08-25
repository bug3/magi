/**
 * The magi command line: usage and dispatch only. Each subcommand lives in
 * src/cli/ as its own module; bin/magi.js only hands argv over. Exit codes:
 * 0 the command did its job (a degraded consult is a result, not an error),
 * 1 doctor found problems or a preflight refused, 2 the invocation itself
 * is wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { consultGrammar, consultNote } from "./cli/args.ts";
import { CHECKS_GRAMMAR, CHECKS_NOTE, checksCommand } from "./cli/checks-command.ts";
import { consultCommand } from "./cli/consult-command.ts";
import { DOCTOR_GRAMMAR, DOCTOR_NOTE, doctorCommand } from "./cli/doctor-command.ts";
import { MAGI_ROOT } from "./cli/environment.ts";
import { commandScreen, parseArgv, rootScreen, type Grammar } from "./cli/parse.ts";
import { SKILL_GRAMMAR, SKILL_NOTE, skillCommand } from "./cli/skill-command.ts";
import { TRIGGERS_GRAMMAR, TRIGGERS_NOTE, triggersCommand } from "./cli/triggers-command.ts";
import {
  commandUsage,
  problem,
  refuseUsage,
  usage,
  version,
  type CommandNote,
  type UsageScreen,
} from "./util/ui.ts";

/** The two spellings of each of the two commands that are not subcommands. */
const HELP: readonly string[] = ["help", "--help"];
const VERSION: readonly string[] = ["--version", "-v"];

/** What a subcommand does with the argv after its own name. */
type Subcommand = (rest: readonly string[]) => number | Promise<number>;

/** One command: what it does, what it accepts, and what it costs. */
interface CommandEntry {
  readonly run: Subcommand;
  readonly grammar: Grammar;
  readonly note: CommandNote;
}

/**
 * The subcommands, as the table `main` dispatches from. A table rather than a
 * chain of comparisons because the usage text is checked against it: a
 * dispatch chain maintained beside a separate list reproduces the same drift
 * this catalogue exists to catch, one level up.
 *
 * Each entry carries its grammar beside its behaviour, so the flags a command
 * accepts can be read without running it. `test/cli/args.test.ts` holds the
 * printed block to exactly those flags, in both directions, which is a check
 * no reading of the usage text against a regexp could make.
 */
export const SUBCOMMANDS: Readonly<Record<string, CommandEntry>> = {
  doctor: { run: (rest) => doctorCommand(rest), grammar: DOCTOR_GRAMMAR, note: DOCTOR_NOTE },
  skill: { run: (rest) => skillCommand(rest), grammar: SKILL_GRAMMAR, note: SKILL_NOTE },
  plan: {
    run: (rest) => consultCommand("plan", rest),
    grammar: consultGrammar("plan"),
    note: consultNote("plan"),
  },
  review: {
    run: (rest) => consultCommand("review", rest),
    grammar: consultGrammar("review"),
    note: consultNote("review"),
  },
  checks: { run: (rest) => checksCommand(rest), grammar: CHECKS_GRAMMAR, note: CHECKS_NOTE },
  triggers: {
    run: (rest) => triggersCommand(rest),
    grammar: TRIGGERS_GRAMMAR,
    note: TRIGGERS_NOTE,
  },
};

/**
 * The invocation table, generated from the catalogue above rather than typed
 * out beside it.
 *
 * It was a string here for as long as this file existed, and a string is what
 * a person has to remember to edit: `help` and `-v` both worked and neither
 * was printed, with README.md asserted identical to that same incomplete
 * block, so the drift was locked in by a test rather than caught by one. A
 * guard caught the flags after that, and this removes the thing it was
 * guarding: what the screen says is what the commands accept, because it is
 * made of them. `test/cli/args.test.ts` holds README.md to these bytes.
 */
export const COMMAND_USAGE: string = rootScreen(
  "magi",
  Object.fromEntries(Object.entries(SUBCOMMANDS).map(([name, { grammar }]) => [name, grammar])),
);

/**
 * The whole screen: the generated table, and the line that says where the
 * prose about each command went.
 *
 * It used to be five paragraphs of prose run on underneath, kept in this file,
 * beside no flag it was about. Nothing bound a sentence about what `--live`
 * spends to the declaration of `--live`, so renaming a flag left the prose
 * stale and no check noticed. Each command carries its own note now, and this
 * is the line that sends a reader to it: the screen a piped orchestrator reads
 * first must still say that the cost is written down somewhere.
 */
const SCREEN: UsageScreen = {
  commands: COMMAND_USAGE,
  pointer:
    "magi <command> --help adds what that command spends, refuses, records, and leaves to you.",
};

/**
 * Every token `main` accepts as its first argument, derived from what it
 * dispatches rather than restated beside it. MAGI holds three harness CLIs to
 * a help-text drift rule and held itself to none: `help` and `-v` both worked
 * and neither was printed, with the README asserted identical to that same
 * incomplete block, so the drift was locked in by a test rather than caught
 * by one. `test/cli/args.test.ts` checks this against the usage text.
 */
export const COMMANDS: readonly string[] = [...Object.keys(SUBCOMMANDS), ...HELP, ...VERSION];

/**
 * The version this build reports, read from the manifest beside it instead of
 * duplicated in source. Both the clone and the published tarball carry
 * package.json at MAGI_ROOT, so the number a user sees cannot drift from the
 * one that was published.
 */
function declaredVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(MAGI_ROOT, "package.json"), "utf8"));
  const declared = (manifest as { version?: unknown }).version;
  return typeof declared === "string" ? declared : "unknown";
}

/**
 * Why a token is not a command, in the words a parser would use.
 *
 * The catalogue above is handed to the same grammar every command is parsed
 * with, for the one token, so a near miss is named rather than merely
 * rejected: `magi revieww` says which command it was probably meant to be, and
 * `magi --live` is told it typed a flag where a command goes. Nothing is
 * dispatched from it, because the table already answered that question.
 */
function notACommand(token: string): string {
  const parsed = parseArgv(
    "magi",
    (root) => {
      for (const name of Object.keys(SUBCOMMANDS)) root.command(name);
      return root;
    },
    [token],
  );
  return parsed.kind === "refused" ? parsed.reason : `unknown command: ${token}`;
}

/**
 * The tool-wide refusal, said on both streams a caller might be reading.
 *
 * `refuseUsage` draws the reason on a terminal only, because the block down a
 * pipe is a byte contract older than any of this. The line that says which
 * token was wrong is not part of that block, so it goes out first, the way
 * every named command says it.
 */
function refuseRoot(reason: string): void {
  problem(reason);
  refuseUsage(SCREEN, reason);
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== undefined && HELP.includes(command)) {
    // `magi help review` is `magi review --help` asked the other way round.
    // Parsed rather than indexed, so a second word is refused here for the
    // same reason it is refused anywhere else: `magi help review extra`
    // answered as though the extra word were not there.
    const asked = parseArgv<never>(
      "magi help",
      (root) => root.helpOption(false).argument("[command]", "the command to print the screen of"),
      rest,
    );
    if (asked.kind !== "invocation") {
      refuseRoot(asked.kind === "refused" ? asked.reason : "magi help takes one command");
      return 2;
    }
    const named = asked.args[0];
    if (named === undefined) {
      usage(SCREEN);
      return 0;
    }
    const wanted = SUBCOMMANDS[named];
    if (wanted === undefined) {
      refuseRoot(notACommand(named));
      return 2;
    }
    commandUsage(commandScreen(`magi ${named}`, wanted.grammar), wanted.note);
    return 0;
  }
  if (command !== undefined && VERSION.includes(command)) {
    // The number is parsed by whatever asked for it, so a word this command
    // cannot use is refused rather than printed past.
    const asked = parseArgv<never>("magi --version", (root) => root.helpOption(false), rest);
    if (asked.kind !== "invocation") {
      refuseRoot(asked.kind === "refused" ? asked.reason : "magi --version takes nothing");
      return 2;
    }
    version(declaredVersion());
    return 0;
  }
  const subcommand = command === undefined ? undefined : SUBCOMMANDS[command];
  if (subcommand !== undefined) return subcommand.run(rest);
  // The reason is drawn on a terminal only: what a pipe receives here is the
  // block alone, and that is a contract the end-to-end suite pins.
  refuseRoot(command === undefined ? "magi needs a command" : notACommand(command));
  return 2;
}

export { parseExcerpt, parseReviewArgs, type ReviewArgs } from "./cli/args.ts";
