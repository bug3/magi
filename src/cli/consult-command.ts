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
  usage: string,
): Promise<number> {
  let args: ReviewArgs;
  try {
    args = parseReviewArgs(rest, mode);
  } catch (error) {
    console.error(String((error as Error).message));
    console.error(usage);
    return 2;
  }
  const { home, path } = ambient();
  const repoDir = process.cwd();
  const magiDir = join(repoDir, ".magi");

  const checked = await checkInputs(args, repoDir, mode);
  if (!checked.ok) {
    console.error(checked.problem);
    return 2;
  }

  const ignoreStatus = await stateIgnoreStatus(repoDir);
  if (ignoreStatus === "not-ignored" || ignoreStatus === "tracked") {
    console.error(
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
    console.error(empty);
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
  const report = headroomReport(
    consults,
    loadHeadroomConfig(magiDir),
    new Date(),
    estimateBriefTokens(renderedChars),
  );
  console.log(formatHeadroomReport(report));
  if (report.refuse && !args.waiveHeadroom) {
    console.error(
      "postpone the consult, raise the budget in .magi/headroom.local.json, or re-run with --waive-headroom",
    );
    return 1;
  }

  // Preflight completeness: the disposition lag is
  // surfaced in the same preflight report, and an overdue consult refuses by
  // default; the waiver is the user's and lands in the ledger row.
  const completeness = completenessFromLedger(consults, gateExpectedReader(magiDir, consults));
  console.log(formatCompleteness(completeness));
  const overdue = completeness.filter((entry) => entry.overdue);
  if (overdue.length > 0 && !args.waiveBackfill) {
    console.error(
      "disposition the overdue consults above (ledger backfill rows), or re-run with --waive-backfill",
    );
    return 1;
  }

  if (args.dryRun) {
    console.log(
      `dry run: ${mode} would convene ${SLOTS.length} seats on ` +
        `${pack.markdown.length} characters of pack plus a ${briefMd.length}-character brief`,
    );
    console.log("  nothing was spent; drop --dry-run to convene");
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
    headroom: { ...report, ...(args.waiveHeadroom ? { waived: true } : {}) },
    // Exclusions and fence residue surface before any seat is spawned.
    beforeFanOut: (evidence, fences) => {
      for (const exclusion of evidence.exclusions) {
        console.log(`excluded from the pack: ${exclusion.path} (${exclusion.reason})`);
      }
      if (fences.nonPackLines > 0) {
        console.log(
          `brief fences: ${fences.nonPackLines} non-pack lines ` +
            `(budget ${NON_PACK_FENCE_BUDGET_LINES}, hashed in the manifest)`,
        );
      }
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

  console.log(`consult ${result.id}: ${result.status}`);
  for (const verdict of result.verdicts) {
    const label = slot(verdict.slot).label;
    console.log(
      verdict.valid
        ? `  ${label}: valid`
        : `  ${label}: INVALID (${sanitizeLine(verdict.reasons.join("; "), 160)})`,
    );
  }
  for (const warning of result.canaryWarnings) {
    console.log(
      `  ${slot(warning.slot).label}: CANARY WARNING (${warning.hits.join(", ")}): recorded in the ledger, not a degrade`,
    );
  }
  console.log(`  synthesis scaffold: ${result.paths.synthesisPath}`);
  if (result.status === "degraded") {
    console.log("  degraded: proceeding is an explicit user decision");
  }
  return 0;
}
