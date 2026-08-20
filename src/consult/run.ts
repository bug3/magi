/**
 * One consult, end to end: evidence pack, rendered brief, fan-out, validity
 * gate, synthesis scaffold, manifest and ledger row. See
 * `docs/protocol.md`, "The shape of a consult". The mode picks the template
 * and is recorded everywhere; nothing else differs. Composition only: every rule enforced along the way lives in the
 * module that owns it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConsultMode, ConsultStatus } from "../core/consult.ts";
import type { ConsultId } from "../core/ids.ts";
import type { SeatProfile } from "../core/profile.ts";
import type { SlotId } from "../core/slots.ts";
import { SLOTS } from "../core/slots.ts";
import {
  curateEvidence,
  type CurateInputs,
  type CuratedEvidence,
  type EvidenceReport,
} from "../evidence/curate.ts";
import { gitFacts } from "../evidence/git-facts.ts";
import { buildEvidencePack, type EvidencePack } from "../evidence/pack.ts";
import { exec } from "../runtime/exec.ts";
import { compileSchema } from "../schema/validator.ts";
import { canaryEvidence, loadCanaries } from "../seats/canaries.ts";
import { seatProfile } from "../seats/profiles.ts";
import { runSeats, type SeatRun } from "../seats/runner.ts";
import { ensureDir, sha256Text, writeFileDurable } from "../util/fs.ts";
import { gateBrief } from "./brief-gate.ts";
import { gateSeatOutput, type SeatVerdict } from "./gate.ts";
import { nextConsultId } from "./id.ts";
import { appendLedgerRow, type LedgerRow } from "./ledger.ts";
import { manifestSeat, writeManifest, type ManifestSeat } from "./manifest.ts";
import { consultPaths, consultsDir, ledgerPath, type ConsultPaths } from "./paths.ts";
import { renderTemplate } from "./render.ts";
import { consultStatus } from "./status.ts";
import { renderSynthesisScaffold } from "./synthesis.ts";

export interface ConsultRunInputs {
  readonly mode: ConsultMode;
  /** The repo under review; evidence paths resolve against it. */
  readonly repoDir: string;
  /** Usually `<repoDir>/.magi`; separate so tests can point elsewhere. */
  readonly magiDir: string;
  readonly slug: string;
  /** The orchestrator's brief body: goal, constraints, the concrete question. */
  readonly briefMd: string;
  /** Raw material only; curation is rule-driven (src/evidence/curate.ts). */
  readonly evidence: Omit<CurateInputs, "repoDir" | "mode" | "path">;
  /** A pre-curated result: the CLI curates before preflight so the
   * projection can be size-aware. When present, evidence is not re-derived. */
  readonly curated?: CuratedEvidence;
  readonly templatePath: string;
  readonly schemaPath: string;
  /** Passed through to the seat env; nothing is inherited implicitly. */
  readonly home: string;
  readonly path: string;
  readonly staggerMs?: number;
  /** The preflight headroom snapshot, recorded verbatim in the ledger row. */
  readonly headroom?: LedgerRow["headroom"];
  /** The preflight completeness lag, recorded verbatim in the ledger row. */
  readonly completeness?: LedgerRow["completeness"];
  /** Called after curation and the brief gate, before any seat is spawned:
   * the convene surface where exclusions and fence residue are shown. */
  readonly beforeFanOut?: (evidence: EvidenceReport, briefFences: BriefFenceAccount) => void;
  /** Injectable for stub tests; defaults to the three real launch profiles. */
  readonly profiles?: readonly SeatProfile[];
  /** Injectable clock so tests stay deterministic. */
  readonly now?: () => Date;
}

export interface ConsultRunResult {
  readonly id: ConsultId;
  readonly paths: ConsultPaths;
  readonly status: ConsultStatus;
  readonly pack: EvidencePack;
  readonly runs: readonly SeatRun[];
  readonly verdicts: readonly SeatVerdict[];
  /** Seats whose raw output tripped a canary: warnings, never degrades. */
  readonly canaryWarnings: readonly SeatCanaryWarning[];
}

export interface SeatCanaryWarning {
  readonly slot: SlotId;
  readonly hits: readonly string[];
}

/** What the fence budget admitted into the brief; recorded in the manifest. */
export interface BriefFenceAccount {
  readonly nonPackLines: number;
  readonly sha256?: string;
}

const DEFAULT_STAGGER_MS = 2_000;
const RESIDUE_PROBE_TIMEOUT_MS = 30_000;

export async function runConsult(inputs: ConsultRunInputs): Promise<ConsultRunResult> {
  const now = inputs.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const id = nextConsultId(consultsDir(inputs.magiDir), inputs.slug);
  const paths = consultPaths(inputs.magiDir, id);
  ensureDir(paths.rawDir);
  ensureDir(paths.checksDir);

  const curated =
    inputs.curated ??
    (await curateEvidence({
      repoDir: inputs.repoDir,
      mode: inputs.mode,
      path: inputs.path,
      ...inputs.evidence,
    }));
  const pack = buildEvidencePack(curated.pack);
  const template = readFileSync(inputs.templatePath, "utf8");
  const schemaJson = readFileSync(inputs.schemaPath, "utf8");
  const brief = renderTemplate(template, {
    consult_id: id,
    brief_md: inputs.briefMd,
    evidence_pack_md: pack.markdown,
    opinion_schema_json: schemaJson,
  });
  writeFileDurable(paths.briefPath, brief);

  // Prebuild gate: a brief that inlines artifacts or disagrees with its
  // manifest fails here, before any quota is spent.
  const briefGate = gateBrief({
    brief,
    consult: id,
    mode: inputs.mode,
    packMarkdown: pack.markdown,
  });
  if (briefGate.failures.length > 0) {
    throw new Error(`brief gate:\n  ${briefGate.failures.join("\n  ")}`);
  }
  const briefFences: BriefFenceAccount = {
    nonPackLines: briefGate.nonPackFencedLines,
    ...(briefGate.nonPackFencedSha256 === undefined
      ? {}
      : { sha256: briefGate.nonPackFencedSha256 }),
  };
  inputs.beforeFanOut?.(curated.report, briefFences);

  const profiles =
    inputs.profiles ??
    SLOTS.map((definition) =>
      seatProfile(definition.id, {
        briefPath: paths.briefPath,
        schemaPath: inputs.schemaPath,
        // Compact form: the schema travels inline in grok's argv.
        schemaJson: JSON.stringify(JSON.parse(schemaJson)),
        repoDir: inputs.repoDir,
        home: inputs.home,
        path: inputs.path,
      }),
    );

  for (const profile of profiles) {
    await snapshotResidue(paths, profile, inputs.repoDir);
  }

  const runs = await runSeats({
    seats: profiles.map((profile) => ({ profile, brief })),
    staggerMs: inputs.staggerMs ?? DEFAULT_STAGGER_MS,
  });
  for (const run of runs) {
    writeSeatRecord(paths, run);
  }

  const canaries = loadCanaries(inputs.magiDir);
  const canaryWarnings = runs
    .map((run) => ({ slot: run.slot, hits: canaryEvidence(run.result.stdout, brief, canaries) }))
    .filter((warning) => warning.hits.length > 0);

  const contract = compileSchema(JSON.parse(schemaJson));
  const packCitations = new Set<string>(pack.index.map((entry) => entry.id));
  const verdicts = runs.map((run) =>
    gateSeatOutput(run.slot, run.result.stdout, contract, packCitations),
  );
  const status = consultStatus(verdicts.filter((v) => v.valid).map((v) => v.slot));
  // Persisted so later steps (seat-proposed checks, synthesis tooling) read
  // the gate's outcome from disk instead of re-deriving it.
  writeFileDurable(paths.gatePath, `${JSON.stringify({ verdicts }, null, 2)}\n`);

  writeFileDurable(
    paths.synthesisPath,
    renderSynthesisScaffold({ consult: id, status, verdicts }),
  );

  const seats: ManifestSeat[] = [];
  for (const profile of profiles) {
    seats.push(await manifestSeat(profile));
  }
  writeManifest(paths.manifestPath, {
    consult: id,
    mode: inputs.mode,
    createdAt: startedAt,
    templateSha256: sha256Text(template),
    packSha256: pack.packSha256,
    briefFences,
    evidence: curated.report,
    repo: await repoFacts(inputs.repoDir),
    seats,
  });

  appendLedgerRow(ledgerPath(inputs.magiDir), {
    consult: id,
    mode: inputs.mode,
    startedAt,
    finishedAt: now().toISOString(),
    status,
    ...(inputs.headroom === undefined ? {} : { headroom: inputs.headroom }),
    ...(inputs.completeness === undefined ? {} : { completeness: inputs.completeness }),
    seats: runs.map((run, at) => {
      const verdict = verdicts[at] as SeatVerdict;
      const hits = canaryWarnings.find((warning) => warning.slot === run.slot)?.hits;
      return {
        slot: run.slot,
        valid: verdict.valid,
        reasons: verdict.reasons,
        durationMs: run.durationMs,
        retried: run.retried,
        ...(verdict.parse.usage === undefined ? {} : { usage: verdict.parse.usage }),
        ...(hits === undefined ? {} : { canaryWarnings: hits }),
      };
    }),
  });

  return { id, paths, status, pack, runs, verdicts, canaryWarnings };
}

/** Ambient layers a profile cannot strip are recorded, never denied. */
async function snapshotResidue(
  paths: ConsultPaths,
  profile: SeatProfile,
  repoDir: string,
): Promise<void> {
  if (profile.residueProbe === undefined) return;
  const probe = await exec({
    argv: profile.residueProbe,
    cwd: repoDir,
    env: profile.env,
    timeoutMs: RESIDUE_PROBE_TIMEOUT_MS,
  });
  const ok = probe.outcome.kind === "exit" && probe.outcome.code === 0;
  writeFileDurable(
    join(paths.rawDir, `${profile.slot}.inspect.json`),
    ok
      ? probe.stdout
      : `${JSON.stringify({ residueProbeFailed: probe.outcome, stderr: probe.stderr })}\n`,
  );
}

/** Raw trajectories: exactly what the seat wrote, plus how it was launched. */
function writeSeatRecord(paths: ConsultPaths, run: SeatRun): void {
  writeFileDurable(join(paths.rawDir, `${run.slot}.stdout.txt`), run.result.stdout);
  writeFileDurable(join(paths.rawDir, `${run.slot}.stderr.txt`), run.result.stderr);
  writeFileDurable(
    join(paths.rawDir, `${run.slot}.launch.json`),
    `${JSON.stringify(
      {
        argv: run.argv,
        startedAtMs: run.startedAtMs,
        durationMs: run.durationMs,
        retried: run.retried,
        outcome: run.result.outcome,
        truncated: run.result.truncated,
      },
      null,
      2,
    )}\n`,
  );
}

async function repoFacts(repoDir: string): Promise<{ headSha: string; dirty: boolean } | undefined> {
  try {
    return await gitFacts(repoDir);
  } catch {
    // A consult can run before the target repo has any commit; the manifest
    // records the absence rather than inventing a base.
    return undefined;
  }
}
