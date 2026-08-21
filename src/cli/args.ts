/**
 * Argument parsing for `magi review` and `magi plan`: typed, tested, and
 * separate from command execution. A bad invocation is refused by name
 * before anything touches the repo or spends quota.
 */

import type { ExcerptRequest } from "../evidence/pack.ts";
import type { ConsultMode } from "../core/consult.ts";

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

export function parseReviewArgs(
  argv: readonly string[],
  mode: ConsultMode = "review",
): ReviewArgs {
  let slug: string = mode;
  let briefFile: string | undefined;
  let patchFile: string | undefined;
  let base: string | undefined;
  let testOutputFile: string | undefined;
  let waiveHeadroom = false;
  let waiveBackfill = false;
  let dryRun = false;
  const excerpts: ExcerptRequest[] = [];

  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at] as string;
    const value = (): string => {
      const next = argv[at + 1];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      at += 1;
      return next;
    };
    switch (flag) {
      case "--slug":
        slug = value();
        break;
      case "--brief":
        briefFile = value();
        break;
      case "--excerpt":
        excerpts.push(parseExcerpt(value()));
        break;
      case "--patch":
        patchFile = value();
        break;
      case "--base":
        base = value();
        break;
      case "--test-output":
        testOutputFile = value();
        break;
      case "--waive-headroom":
        waiveHeadroom = true;
        break;
      case "--waive-backfill":
        waiveBackfill = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (briefFile === undefined) throw new Error("--brief is required");
  if (mode === "plan" && base !== undefined) throw new Error("--base is valid only for review");
  if (mode === "plan" && patchFile !== undefined) {
    throw new Error("--patch is valid only for review");
  }
  return {
    slug,
    briefFile,
    excerpts,
    waiveHeadroom,
    waiveBackfill,
    dryRun,
    ...(patchFile === undefined ? {} : { patchFile }),
    ...(base === undefined ? {} : { base }),
    ...(testOutputFile === undefined ? {} : { testOutputFile }),
  };
}
