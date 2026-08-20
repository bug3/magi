/**
 * The magi command line: usage and dispatch only. Each subcommand lives in
 * src/cli/ as its own module; bin/magi.js only hands argv over. Exit codes:
 * 0 the command did its job (a degraded consult is a result, not an error),
 * 1 doctor found problems or a preflight refused, 2 the invocation itself
 * is wrong.
 */

import { checksCommand } from "./cli/checks-command.ts";
import { consultCommand } from "./cli/consult-command.ts";
import { doctorCommand } from "./cli/doctor-command.ts";
import { skillCommand } from "./cli/skill-command.ts";
import { triggersCommand } from "./cli/triggers-command.ts";

export const COMMAND_USAGE = `usage:
  magi doctor [--live] [--calibrate]
  magi skill  [--harness <claude|codex|grok>]... [--install]
  magi plan   --brief <file> [--slug <slug>] [--excerpt <path[:start-end]>]...
              [--test-output <file>] [--waive-headroom] [--waive-backfill]
  magi review --brief <file> [--slug <slug>] [--base <ref>] [--patch <file>]
              [--excerpt <path[:start-end]>]... [--test-output <file>]
              [--waive-headroom] [--waive-backfill]
  magi checks <consult-id>
  magi triggers [--base <ref>]`;

const USAGE = `${COMMAND_USAGE}

doctor --live spends quota: one minimal call per harness.
doctor --calibrate is the owner-approved canary calibration for CLI
updates: it spends quota (two rounds, six seat calls), briefly writes a
nonce into each ambient config layer and restores every layer after,
asserts the nonce surfaces without isolation and stays out with it, and
records both directions in the ledger.
skill reports where each harness would find the orchestrator skill and, on
--install, links it there: a symlink to this clone so the installed skill
cannot drift, never over anything this command did not create. Without
--harness it reports all three and installs for claude.
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
override, also recorded.
checks plans every seat-proposed check against a built-in read-only
vocabulary, runs only what matches without a shell, and records every
proposal. Project-code commands such as npm and node tests are refused.
triggers evaluates the tracked base-to-worktree diff plus non-ignored
untracked files against the owner-set size thresholds and risk-domain
seed and prints which deterministic triggers propose a consult;
proposing never convenes, and judgment may add proposals but not
suppress these.`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "doctor") return doctorCommand(rest);
  if (command === "skill") return skillCommand(rest);
  if (command === "review") return consultCommand("review", rest, USAGE);
  if (command === "plan") return consultCommand("plan", rest, USAGE);
  if (command === "checks") return checksCommand(rest, USAGE);
  if (command === "triggers") return triggersCommand(rest);
  console.error(USAGE);
  return 2;
}

export { parseExcerpt, parseReviewArgs, type ReviewArgs } from "./cli/args.ts";
