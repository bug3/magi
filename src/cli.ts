/**
 * The magi command line: usage and dispatch only. Each subcommand lives in
 * src/cli/ as its own module; bin/magi.js only hands argv over. Exit codes:
 * 0 the command did its job (a degraded consult is a result, not an error),
 * 1 doctor found problems or a preflight refused, 2 the invocation itself
 * is wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { consultGrammar } from "./cli/args.ts";
import { CHECKS_GRAMMAR, checksCommand } from "./cli/checks-command.ts";
import { consultCommand } from "./cli/consult-command.ts";
import { DOCTOR_GRAMMAR, doctorCommand } from "./cli/doctor-command.ts";
import { MAGI_ROOT } from "./cli/environment.ts";
import { parseArgv, rootScreen, type Grammar } from "./cli/parse.ts";
import { SKILL_GRAMMAR, skillCommand } from "./cli/skill-command.ts";
import { TRIGGERS_GRAMMAR, triggersCommand } from "./cli/triggers-command.ts";
import {
  refuseUsage,
  usage,
  version,
  type CommandGuide,
  type UsageScreen,
} from "./util/ui.ts";

/** The two spellings of each of the two commands that are not subcommands. */
const HELP: readonly string[] = ["help", "--help"];
const VERSION: readonly string[] = ["--version", "-v"];

/**
 * What each command does, and what its flags cost, one entry per command.
 *
 * Kept apart rather than as one block of prose because it is drawn two ways: a
 * terminal gets a note per command, and a pipe gets them run together into the
 * block that has always been copied out of one. `usageText` assembles the
 * second from the first, so the two cannot drift.
 */
const GUIDE: readonly CommandGuide[] = [
  {
    title: "doctor",
    body: `doctor --live spends quota: one minimal call per harness.
doctor --calibrate is the owner-approved canary calibration for CLI
updates: it spends quota (two rounds, six seat calls), briefly writes a
nonce into each ambient config layer and restores every layer after,
asserts the nonce surfaces without isolation and stays out with it, and
records both directions in the ledger.
Both spending flags ask once before they spend, on a terminal; --yes skips
that question and a pipe is never asked.`,
  },
  {
    title: "skill",
    body: `skill reports where each harness would find the orchestrator skill and, on
--install, links it there: a symlink to this clone so the installed skill
cannot drift. Installing leaves a marker beside the link naming the source it
claims, and only a link that marker still claims is repointed later; a link
nobody here made, a real file or a directory is reported and left exactly as
it was, and at a terminal the run asks once before replacing it: no flag
answers that question, because overwriting somebody else's file needs a
person. Without --harness it asks which harness at a terminal and installs
for claude anywhere else.`,
  },
  {
    title: "plan and review",
    body: `review and plan convene the council on the repo at the current working
directory; review critiques a plan or diff, plan asks for independent
approaches before one exists. Curation is rule-driven: conventions are
collected from the tree, review packs derive from the patch and carry
the same repository floor as plan packs; excerpts only add commentary.
With --base the review patch derives from git (base/head SHAs pinned in
the manifest); a --patch beside a --base is checked against the full
delta and every scoped-out file is recorded as an exclusion; a --patch
alone is recorded caller-supplied-unpinned. A preflight headroom
check precedes the fan-out and refuses when a configured budget cannot
fit the projected burn; --waive-headroom is the user's explicit
override, and the waiver is recorded in the ledger. A completeness
preflight lists consults whose findings still lack ledger dispositions
and refuses when one is overdue; --waive-backfill is the matching
override, also recorded. --dry-run does everything a consult does except
spend it: curation, both gates and both preflights run, what would be sent
is reported, and nothing is convened. A terminal is asked once before the
fan-out spends anything; --yes skips the question, --dry-run is never asked,
and down a pipe the invocation is the approval.`,
  },
  {
    title: "checks",
    body: `checks plans every seat-proposed check against a built-in read-only
vocabulary, runs only what matches without a shell, and records every
proposal. Project-code commands such as npm and node tests are refused.`,
  },
  {
    title: "triggers",
    body: `triggers evaluates the tracked base-to-worktree diff plus non-ignored
untracked files against the owner-set size thresholds and risk-domain
seed and prints which deterministic triggers propose a consult;
proposing never convenes, and judgment may add proposals but not
suppress these.`,
  },
];

/** What a subcommand does with the argv after its own name. */
type Subcommand = (rest: readonly string[]) => number | Promise<number>;

/** One command: what it does, and what it accepts. */
interface CommandEntry {
  readonly run: Subcommand;
  readonly grammar: Grammar;
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
  doctor: { run: (rest) => doctorCommand(rest), grammar: DOCTOR_GRAMMAR },
  skill: { run: (rest) => skillCommand(rest), grammar: SKILL_GRAMMAR },
  plan: {
    run: (rest) => consultCommand("plan", rest, SCREEN),
    grammar: consultGrammar("plan"),
  },
  review: {
    run: (rest) => consultCommand("review", rest, SCREEN),
    grammar: consultGrammar("review"),
  },
  checks: { run: (rest) => checksCommand(rest, SCREEN), grammar: CHECKS_GRAMMAR },
  triggers: { run: (rest) => triggersCommand(rest), grammar: TRIGGERS_GRAMMAR },
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

/** The whole screen: the generated table, and the prose under it. */
const SCREEN: UsageScreen = { commands: COMMAND_USAGE, guide: GUIDE };

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

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== undefined && HELP.includes(command)) {
    usage(SCREEN);
    return 0;
  }
  if (command !== undefined && VERSION.includes(command)) {
    version(declaredVersion());
    return 0;
  }
  const subcommand = command === undefined ? undefined : SUBCOMMANDS[command];
  if (subcommand !== undefined) return subcommand.run(rest);
  // The reason is drawn on a terminal only: what a pipe receives here is the
  // block alone, and that is a contract the end-to-end suite pins.
  refuseUsage(SCREEN, command === undefined ? "magi needs a command" : notACommand(command));
  return 2;
}

export { parseExcerpt, parseReviewArgs, type ReviewArgs } from "./cli/args.ts";
