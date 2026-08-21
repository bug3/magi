/**
 * The magi command line: usage and dispatch only. Each subcommand lives in
 * src/cli/ as its own module; bin/magi.js only hands argv over. Exit codes:
 * 0 the command did its job (a degraded consult is a result, not an error),
 * 1 doctor found problems or a preflight refused, 2 the invocation itself
 * is wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checksCommand } from "./cli/checks-command.ts";
import { consultCommand } from "./cli/consult-command.ts";
import { doctorCommand } from "./cli/doctor-command.ts";
import { MAGI_ROOT } from "./cli/environment.ts";
import { skillCommand } from "./cli/skill-command.ts";
import { triggersCommand } from "./cli/triggers-command.ts";

/** The two spellings of each of the two commands that are not subcommands. */
const HELP: readonly string[] = ["help", "--help"];
const VERSION: readonly string[] = ["--version", "-v"];

export const COMMAND_USAGE = `usage:
  magi doctor [--live] [--calibrate]
  magi skill  [--harness <claude|codex|grok>]... [--install]
  magi plan   --brief <file> [--slug <slug>] [--excerpt <path[:start-end]>]...
              [--test-output <file>] [--waive-headroom] [--waive-backfill]
              [--dry-run]
  magi review --brief <file> [--slug <slug>] [--base <ref>] [--patch <file>]
              [--excerpt <path[:start-end]>]... [--test-output <file>]
              [--waive-headroom] [--waive-backfill] [--dry-run]
  magi checks <consult-id>
  magi triggers [--base <ref>]
  magi help | --help
  magi --version | -v`;

const USAGE = `${COMMAND_USAGE}

doctor --live spends quota: one minimal call per harness.
doctor --calibrate is the owner-approved canary calibration for CLI
updates: it spends quota (two rounds, six seat calls), briefly writes a
nonce into each ambient config layer and restores every layer after,
asserts the nonce surfaces without isolation and stays out with it, and
records both directions in the ledger.
skill reports where each harness would find the orchestrator skill and, on
--install, links it there: a symlink to this clone so the installed skill
cannot drift. Installing leaves a marker beside the link naming the source it
claims, and only a link that marker still claims is repointed later; a link
nobody here made, a real file or a directory is reported and left exactly as
it was. Without --harness it reports all three and installs for claude.
review and plan convene the council on the repo at the current working
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
is reported, and nothing is convened.
checks plans every seat-proposed check against a built-in read-only
vocabulary, runs only what matches without a shell, and records every
proposal. Project-code commands such as npm and node tests are refused.
triggers evaluates the tracked base-to-worktree diff plus non-ignored
untracked files against the owner-set size thresholds and risk-domain
seed and prints which deterministic triggers propose a consult;
proposing never convenes, and judgment may add proposals but not
suppress these.`;

/** What a subcommand does with the argv after its own name. */
type Subcommand = (rest: readonly string[]) => number | Promise<number>;

/**
 * The subcommands, as the table `main` dispatches from. A table rather than a
 * chain of comparisons because the usage text is checked against it: a
 * dispatch chain maintained beside a separate list reproduces the same drift
 * this catalogue exists to catch, one level up.
 */
const SUBCOMMANDS: Readonly<Record<string, Subcommand>> = {
  doctor: (rest) => doctorCommand(rest),
  skill: (rest) => skillCommand(rest),
  plan: (rest) => consultCommand("plan", rest, USAGE),
  review: (rest) => consultCommand("review", rest, USAGE),
  checks: (rest) => checksCommand(rest, USAGE),
  triggers: (rest) => triggersCommand(rest),
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
function version(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(MAGI_ROOT, "package.json"), "utf8"));
  const declared = (manifest as { version?: unknown }).version;
  return typeof declared === "string" ? declared : "unknown";
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== undefined && HELP.includes(command)) {
    console.log(USAGE);
    return 0;
  }
  if (command !== undefined && VERSION.includes(command)) {
    console.log(version());
    return 0;
  }
  const subcommand = command === undefined ? undefined : SUBCOMMANDS[command];
  if (subcommand !== undefined) return subcommand(rest);
  console.error(USAGE);
  return 2;
}

export { parseExcerpt, parseReviewArgs, type ReviewArgs } from "./cli/args.ts";
