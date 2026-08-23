/**
 * `magi review` and `magi plan`: the consult pipeline behind an explicit CLI
 * invocation. Preflights run before any quota is spent, headroom and telemetry
 * completeness, each refusing by default with a recorded user waiver as the
 * only way past.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NON_PACK_FENCE_BUDGET_LINES,
  estimateBriefTokens,
  foldLedger,
  formatHeadroomReport,
  headroomReport,
  loadHeadroomConfig,
  runConsult,
  stateIgnoreStatus,
} from "../consult.ts";
import type { ConsultMode } from "../core/consult.ts";
import { SLOTS, slot } from "../core/slots.ts";
import { completenessFromLedger, formatCompleteness, gateExpectedReader } from "../doctor.ts";
import { curateEvidence } from "../evidence/curate.ts";
import { buildEvidencePack } from "../evidence/pack.ts";
import { gitText } from "../runtime/git.ts";
import { sanitizeLine } from "../util/text.ts";
import {
  close,
  detail,
  info,
  open,
  problem,
  refuseUsage,
  report,
  step,
  verdict,
  warn,
  type UsageScreen,
} from "../util/ui.ts";
import { parseReviewArgs, type ReviewArgs } from "./args.ts";
import { checkInputs, emptyReviewTarget } from "./consult-inputs.ts";
import { MAGI_ROOT, ambient } from "./environment.ts";

/** What git has never been told about, so no delta can carry it. */
async function untrackedPaths(repoDir: string): Promise<readonly string[]> {
  try {
    const listed = await gitText(["ls-files", "--others", "--exclude-standard"], { cwd: repoDir });
    return listed.split("\n").filter((line) => line.trim() !== "");
  } catch {
    return [];
  }
}

export async function consultCommand(
  mode: ConsultMode,
  rest: readonly string[],
  screen: UsageScreen,
): Promise<number> {
  let args: ReviewArgs;
  try {
    args = parseReviewArgs(rest, mode);
  } catch (error) {
    problem(String((error as Error).message));
    refuseUsage(screen);
    return 2;
  }
  const { home, path } = ambient();
  const repoDir = process.cwd();
  const magiDir = join(repoDir, ".magi");

  const checked = await checkInputs(args, repoDir, mode);
  if (!checked.ok) {
    problem(checked.problem);
    return 2;
  }

  const ignoreStatus = await stateIgnoreStatus(repoDir);
  if (ignoreStatus === "not-ignored" || ignoreStatus === "tracked") {
    problem(
      ignoreStatus === "tracked"
        ? ".magi/ contains tracked files; remove them from version control before convening"
        : ".magi/ is not ignored by this repository; add `.magi/` to .gitignore before convening",
    );
    return 1;
  }

  // Curation runs before preflight so the headroom projection can see
  // this consult's rendered size, not just the historical mean.
  const briefMd = checked.briefMd;
  const templatePath = join(MAGI_ROOT, "prompts", `${mode}.md`);
  const schemaPath = join(MAGI_ROOT, "schemas", "opinion.v1.schema.json");
  const curated = await curateEvidence({
    repoDir,
    mode,
    path,
    excerpts: args.excerpts,
    ...(checked.patch === undefined ? {} : { patch: checked.patch }),
    ...(args.base === undefined ? {} : { base: args.base }),
    ...(checked.testOutput === undefined ? {} : { testOutput: checked.testOutput }),
  });
  const empty = emptyReviewTarget(mode, curated.pack.patch, await untrackedPaths(repoDir));
  if (empty !== undefined) {
    problem(empty);
    return 2;
  }
  const pack = buildEvidencePack(curated.pack);
  const renderedChars =
    readFileSync(templatePath, "utf8").length +
    briefMd.length +
    pack.markdown.length +
    readFileSync(schemaPath, "utf8").length;

  // Preflight headroom: the report before any seat spends quota.
  const ledgerFile = join(magiDir, "ledger.jsonl");
  const consults = existsSync(ledgerFile)
    ? foldLedger(readFileSync(ledgerFile, "utf8").split("\n"))
    : [];
  const headroom = headroomReport(
    consults,
    loadHeadroomConfig(magiDir),
    new Date(),
    estimateBriefTokens(renderedChars),
  );
  // Opened here rather than at the top: everything above refuses before a
  // single line reaches stdout, and a block opened for a command that then
  // printed nothing into it is a block left hanging.
  open(`magi ${mode}`);
  report(formatHeadroomReport(headroom));
  if (headroom.refuse && !args.waiveHeadroom) {
    close("refused: nothing was convened and nothing was spent");
    problem(
      "postpone the consult, raise the budget in .magi/headroom.local.json, or re-run with --waive-headroom",
    );
    return 1;
  }

  // Preflight completeness: the disposition lag is
  // surfaced in the same preflight report, and an overdue consult refuses by
  // default; the waiver is the user's and lands in the ledger row.
  const completeness = completenessFromLedger(consults, gateExpectedReader(magiDir, consults));
  report(formatCompleteness(completeness));
  const overdue = completeness.filter((entry) => entry.overdue);
  if (overdue.length > 0 && !args.waiveBackfill) {
    close("refused: nothing was convened and nothing was spent");
    problem(
      "disposition the overdue consults above (ledger backfill rows), or re-run with --waive-backfill",
    );
    return 1;
  }

  if (args.dryRun) {
    info(
      `dry run: ${mode} would convene ${SLOTS.length} seats on ` +
        `${pack.markdown.length} characters of pack plus a ${briefMd.length}-character brief`,
    );
    close("nothing was spent; drop --dry-run to convene");
    return 0;
  }

  const result = await runConsult({
    mode,
    repoDir,
    magiDir,
    slug: args.slug,
    briefMd,
    evidence: { excerpts: args.excerpts },
    curated,
    templatePath,
    schemaPath,
    home,
    path,
    headroom: { ...headroom, ...(args.waiveHeadroom ? { waived: true } : {}) },
    // Exclusions and fence residue surface before any seat is spawned, and
    // the announcement comes last so what the fan-out is about is the line
    // still on screen while it runs.
    beforeFanOut: (evidence, fences) => {
      for (const exclusion of evidence.exclusions) {
        detail(`excluded from the pack: ${exclusion.path} (${exclusion.reason})`);
      }
      if (fences.nonPackLines > 0) {
        detail(
          `brief fences: ${fences.nonPackLines} non-pack lines ` +
            `(budget ${NON_PACK_FENCE_BUDGET_LINES}, hashed in the manifest)`,
        );
      }
      step(`convening ${SLOTS.length} seats, blind and in parallel`);
    },
    ...(overdue.length === 0
      ? {}
      : {
          completeness: {
            overdue: overdue.map((entry) => ({
              consult: entry.consult,
              undispositioned: entry.missing.length,
              expected: entry.expected,
            })),
            ...(args.waiveBackfill ? { waived: true } : {}),
          },
        }),
  });

  // The run's own identity, printed unconditionally: everything downstream,
  // `magi checks` included, is addressed by this id.
  step(`consult ${result.id}: ${result.status}`);

  for (const seat of result.verdicts) {
    const label = slot(seat.slot).label;
    if (seat.valid) verdict(`${label}: valid`, true);
    else verdict(`${label}: INVALID (${sanitizeLine(seat.reasons.join("; "), 160)})`, false);
  }
  for (const warning of result.canaryWarnings) {
    warn(
      `${slot(warning.slot).label}: CANARY WARNING (${warning.hits.join(", ")}): recorded in the ledger, not a degrade`,
    );
  }
  // A degraded consult is a result and exits 0, so the one thing that makes it
  // visible is this line. It is a warning rather than a plain one for that.
  if (result.status === "degraded") warn("degraded: proceeding is an explicit user decision");
  close(`synthesis scaffold: ${result.paths.synthesisPath}`);
  return 0;
}
