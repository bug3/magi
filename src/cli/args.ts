/**
 * Argument parsing for `magi review` and `magi plan`: typed, tested, and
 * separate from command execution. A bad invocation is refused by name
 * before anything touches the repo or spends quota.
 *
 * The grammar comes from `./parse.ts`; what is decided here is what the flags
 * mean together, which is the half no parser can know: which of them belong
 * to review alone, and that a consult without a brief is not a consult.
 */

import type { ExcerptRequest } from "../evidence/pack.ts";
import type { ConsultMode } from "../core/consult.ts";
import type { CommandNote } from "../util/ui.ts";
import { InvalidArgumentError, Option, parseArgv, type Grammar } from "./parse.ts";

/**
 * `--help` on a consult: not a bad invocation, and not one either. Thrown so
 * the one caller that turns a parse into an exit code can tell the two apart,
 * because everything between here and it is typed to a `ReviewArgs`.
 */
export class HelpAsked extends Error {
  readonly screen: string;

  constructor(screen: string) {
    super("help asked");
    this.screen = screen;
  }
}

export interface ReviewArgs {
  readonly slug: string;
  readonly briefFile: string;
  readonly excerpts: readonly ExcerptRequest[];
  readonly patchFile?: string;
  /** Pin the review patch against this git ref. */
  readonly base?: string;
  readonly testOutputFile?: string;
  /** The user's explicit decision to convene past a refusing headroom check. */
  readonly waiveHeadroom: boolean;
  /** The user's explicit decision to convene over overdue dispositions. */
  readonly waiveBackfill: boolean;
  /**
   * Do everything a consult does except spend it: curate, gate, run both
   * preflights, report what would be sent, and stop before the fan-out.
   */
  readonly dryRun: boolean;
  /**
   * Do not ask before spending. Only ever skips a question, never answers one
   * that falls through to no: nothing here can be unlocked by a flag.
   */
  readonly yes: boolean;
}

/** "path" or "path:12-40"; a trailing colon segment that is not N-N is path. */
export function parseExcerpt(spec: string): ExcerptRequest {
  const at = spec.lastIndexOf(":");
  const window = at === -1 ? undefined : /^(\d+)-(\d+)$/.exec(spec.slice(at + 1));
  if (at === -1 || window === null || window === undefined) return { path: spec };
  return {
    path: spec.slice(0, at),
    startLine: Number(window[1]),
    endLine: Number(window[2]),
  };
}

/** One flag's value, appended to the ones already given for it. */
function collect(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

/** The flags as commander hands them back, before they mean anything. */
interface ConsultOptions {
  readonly brief: string;
  readonly slug: string;
  readonly excerpt: readonly string[];
  readonly patch?: string;
  readonly base?: string;
  readonly testOutput?: string;
  readonly waiveHeadroom: boolean;
  readonly waiveBackfill: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
}

/**
 * A flag the other mode takes, on the mode that does not.
 *
 * Declared rather than left out, so `magi plan --base main` is refused by the
 * flag's own name and not as an unknown token, and hidden, so the usage block
 * is never asked to print a flag that cannot work here.
 */
function reviewOnly(flags: string): Option {
  return new Option(flags).hideHelp().argParser(() => {
    throw new InvalidArgumentError("valid only for review");
  });
}

/** What plan and review accept, which differs only in the patch pins. */
export function consultGrammar(mode: ConsultMode): Grammar {
  return (command) => {
    const shared = command
      .description(
        mode === "review"
          ? "convene the council on a plan or a diff"
          : "convene the council for approaches before a plan exists",
      )
      .requiredOption("--brief <file>", "the brief the council answers")
      .option("--slug <slug>", "what the consult is filed under", mode)
      .option("--excerpt <path[:start-end]>", "a passage to comment on", collect, [])
      .option("--test-output <file>", "the test run the council is shown")
      .option("--waive-headroom", "convene past a refusing headroom check", false)
      .option("--waive-backfill", "convene over overdue dispositions", false)
      .option("--dry-run", "curate and gate both ways, convene nothing", false)
      .option("--yes", "do not ask first", false);
    return mode === "review"
      ? shared
          .option("--base <ref>", "derive the review patch from git")
          .option("--patch <file>", "the diff under review")
      : shared.addOption(reviewOnly("--base <ref>")).addOption(reviewOnly("--patch <file>"));
  };
}

/**
 * What convening costs, what the preflights refuse, and what is written down,
 * for whichever of the two modes is being asked about. The patch pins are
 * review's alone, so plan is not told about them.
 */
export function consultNote(mode: ConsultMode): CommandNote {
  const pins = `With --base the patch derives from git and the base and head SHAs are pinned
in the manifest; a --patch beside a --base is checked against the full delta
and every scoped-out file is recorded as an exclusion; a --patch alone is
recorded caller-supplied-unpinned. `;
  return {
    spends: `Convening spends quota: three seats, once each, on the repository at the
current working directory. A terminal is asked once before the fan-out spends
anything; --yes skips the question, --dry-run is never asked, and down a pipe
the invocation is the approval.`,
    refuses: `A headroom preflight refuses when a configured budget cannot fit the projected
burn. A completeness preflight refuses when a consult's findings are overdue a
disposition. --waive-headroom and --waive-backfill are the user's explicit
overrides, one for each.`,
    records: `${mode === "review" ? pins : ""}Both waivers are recorded in the ledger, beside
the consult they were given for.`,
    decides: `Curation is rule-driven: conventions are collected from the tree and both
modes carry the same repository floor, so --excerpt only adds commentary and
cannot narrow what was derived. --dry-run does everything a consult does
except spend it: curation, both gates and both preflights run, what would be
sent is reported, and nothing is convened.`,
  };
}

export function parseReviewArgs(
  argv: readonly string[],
  mode: ConsultMode = "review",
): ReviewArgs {
  const parsed = parseArgv<ConsultOptions>(`magi ${mode}`, consultGrammar(mode), argv);
  if (parsed.kind === "help") throw new HelpAsked(parsed.screen);
  if (parsed.kind === "refused") throw new Error(parsed.reason);

  const {
    brief: briefFile,
    slug,
    excerpt,
    patch: patchFile,
    base,
    testOutput: testOutputFile,
    waiveHeadroom,
    waiveBackfill,
    dryRun,
    yes,
  } = parsed.opts;
  const excerpts = excerpt.map(parseExcerpt);

  return {
    slug,
    briefFile,
    excerpts,
    waiveHeadroom,
    waiveBackfill,
    dryRun,
    yes,
    ...(patchFile === undefined ? {} : { patchFile }),
    ...(base === undefined ? {} : { base }),
    ...(testOutputFile === undefined ? {} : { testOutputFile }),
  };
}
