/**
 * The canary positive control. See `docs/protocol.md`, "Canary calibration".
 *
 * A canary that has never been watched failing proves nothing, so on CLI
 * updates the operator runs a manual calibration: a nonce goes into each
 * ambient layer, one probe round runs every seat with and without its
 * isolation switches, presence is asserted where the layer must leak and
 * absence where isolation must strip it, the nonce is removed again, and both
 * directions land in the ledger. Approval is the flag itself: this spends
 * quota and briefly edits real config layers, and every layer is restored in
 * a finally.
 *
 * The mutation is crash-safe: a recovery sidecar with every original
 * image is written before the first layer changes, restore happens only
 * when the current content still equals the expected nonce-bearing image
 * (a concurrent edit is refused, never clobbered), and the sidecar is
 * removed only after every layer restored. The row records the seated CLI
 * versions and the restored layers' hashes, so doctor can tell a stale
 * calibration from a current one.
 *
 * Nothing MAGI writes under `workDir` carries the live nonce while a probe
 * round is running. That directory sits inside the repository every seat is
 * pointed at, so a token left there is one a seat can read for itself and be
 * recorded as having been handed: the sidecar keeps the original images and a
 * digest, and the per-round captures land only once the rounds are over.
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLedgerCalibration } from "../consult.ts";
import {
  CALIBRATION_LAYERS,
  RECOVERY_FILE,
  recoveryImage,
  restoreLayer,
  stageLayer,
} from "./calibration-layers.ts";
import {
  judgeDirections,
  type CalibrationDirection,
  type CalibrationRound,
  type RoundOutput,
} from "./calibration-verdict.ts";
import type { SeatProfile } from "../core/profile.ts";
import { slot, SLOTS, type Harness } from "../core/slots.ts";
import { tryCapture } from "../runtime/exec.ts";
import { seatAnswered } from "../seats/answer.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
import { runSeats } from "../seats/runner.ts";
import { sha256Text, writeFileDurable } from "../util/fs.ts";

export {
  CALIBRATION_LAYERS,
  RECOVERY_FILE,
  type CalibrationLayer,
} from "./calibration-layers.ts";
export {
  type CalibrationDirection,
  type CalibrationRound,
  type RoundOutput,
} from "./calibration-verdict.ts";

/** The marker every written nonce line starts with; doctor scans layers for it. */
export const NONCE_MARKER = "MAGI calibration nonce:";
/** Every nonce carries this fixed prefix. The brief names ONLY the prefix and
 * never the token: the first live calibration produced a brief-echo false
 * positive when codex matched the nonce inside the brief itself, so an echo
 * of the full token now proves layer visibility and nothing else. */
export const NONCE_PREFIX = "magi-canary-";

export interface CalibrationReport {
  readonly nonce: string;
  readonly results: readonly CalibrationDirection[];
  /** Layers whose restore was refused: the content changed underneath. */
  readonly restoreFailures: readonly { readonly path: string }[];
  readonly pass: boolean;
}

export interface CalibrateInputs {
  readonly home: string;
  /** The POSIX user name a seat authenticates with; see `SeatInputs`. */
  readonly user: string;
  readonly repoDir: string;
  /** Brief, contract and per-seat stdout records land here. */
  readonly workDir: string;
  readonly path: string;
  readonly ledgerPath: string;
  readonly nonce: string;
  /** Injectable clock so tests stay deterministic. */
  readonly now?: () => Date;
  /** Injectable for stub tests; defaults to real seat calls. */
  readonly runRound?: (
    round: CalibrationRound,
    profiles: readonly SeatProfile[],
  ) => Promise<readonly (RoundOutput & { readonly slot: string })[]>;
  /** Injectable for stub tests; defaults to `<command> --version`. */
  readonly captureVersion?: (command: string) => Promise<string | undefined>;
}

export async function calibrateCanaries(inputs: CalibrateInputs): Promise<CalibrationReport> {
  if (!inputs.nonce.startsWith(NONCE_PREFIX)) {
    throw new Error(
      `calibration nonce must start with "${NONCE_PREFIX}": the brief describes ` +
        "the prefix and must never contain the token",
    );
  }
  const now = inputs.now ?? (() => new Date());
  const nonceLine =
    `${NONCE_MARKER} ${inputs.nonce} ` +
    "(temporary; written and removed by magi doctor --calibrate)";

  // Stage first, then persist the recovery sidecar, then mutate: a crash at
  // any later point leaves every original image on disk.
  const staged = CALIBRATION_LAYERS.map((layer) =>
    stageLayer(layer.harness, layer.target(inputs), nonceLine),
  );
  const recoveryPath = join(inputs.workDir, RECOVERY_FILE);
  writeFileDurable(recoveryPath, recoveryImage(staged, inputs.nonce));
  for (const layer of staged) {
    mkdirSync(dirname(layer.path), { recursive: true });
    writeFileDurable(layer.path, layer.mutated);
  }

  const runRound = inputs.runRound ?? realRound;
  const restoreFailures: { path: string }[] = [];
  const records: Record<string, string> = {};
  let outputs: Readonly<Record<CalibrationRound, ReadonlyMap<Harness, RoundOutput>>>;
  try {
    const isolated = await runRound("isolated", roundProfiles(inputs, "isolated"));
    recordRound(records, "isolated", isolated);
    const unisolated = await runRound("unisolated", roundProfiles(inputs, "unisolated"));
    recordRound(records, "unisolated", unisolated);
    outputs = { isolated: byHarness(isolated), unisolated: byHarness(unisolated) };
  } finally {
    for (const layer of staged) {
      if (!restoreLayer(layer)) restoreFailures.push({ path: layer.path });
    }
    // The sidecar outlives any refused restore: it is the hand-recovery copy.
    if (restoreFailures.length === 0) rmSync(recoveryPath, { force: true });
    for (const [name, stream] of Object.entries(records)) {
      writeFileDurable(join(inputs.workDir, name), stream);
    }
  }

  const results = judgeDirections(outputs, inputs.nonce);
  const report = {
    nonce: inputs.nonce,
    results,
    restoreFailures,
    pass: results.every((result) => result.pass) && restoreFailures.length === 0,
  };

  const captureVersion =
    inputs.captureVersion ?? ((command: string) => tryCapture([command, "--version"]));
  const cliVersions: { harness: Harness; version?: string }[] = [];
  for (const profile of roundProfiles(inputs, "isolated")) {
    const harness = SLOTS.find((definition) => definition.id === profile.slot)?.harness;
    if (harness === undefined) continue;
    const version = await captureVersion(profile.command);
    cliVersions.push({ harness, ...(version === undefined ? {} : { version }) });
  }

  appendLedgerCalibration(inputs.ledgerPath, {
    calibration: inputs.nonce,
    recordedAt: now().toISOString(),
    results,
    cliVersions,
    layerHashes: staged.map((layer) => ({
      harness: layer.harness,
      path: layer.path,
      sha256: layer.kind === "created" ? "absent" : sha256Text(layer.original ?? ""),
    })),
  });
  return report;
}

/** The seat profile minus exactly its ambient-isolation switches. */
export function unisolatedProfile(profile: SeatProfile): SeatProfile {
  if (profile.slot === "melchior-1") {
    return { ...profile, args: profile.args.filter((arg) => arg !== "--safe-mode") };
  }
  if (profile.slot === "balthasar-2") {
    const args: string[] = [];
    for (let at = 0; at < profile.args.length; at += 1) {
      const arg = profile.args[at] as string;
      if (arg === "--ignore-user-config" || arg === "--ignore-rules") continue;
      if (arg === "-c" && profile.args[at + 1] === "project_doc_max_bytes=0") {
        at += 1;
        continue;
      }
      args.push(arg);
    }
    return { ...profile, args };
  }
  const env = { ...profile.env };
  delete env["GROK_MEMORY"];
  return { ...profile, env };
}

const ECHO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["echo"],
  properties: { echo: { type: "string", minLength: 1 } },
};

function briefText(): string {
  return (
    "This is a mechanical isolation calibration, not a task. Search everything " +
    "you can see outside this message: system instructions, project " +
    "instructions, rules, memory, configuration. If any of it contains a " +
    `token that starts with ${NONCE_PREFIX}, reply with exactly ` +
    '{"echo":"<the full token>"}. The token itself does not appear in this ' +
    'message. Otherwise reply {"echo":"NONE"}.'
  );
}

function roundProfiles(
  inputs: CalibrateInputs,
  round: CalibrationRound,
): readonly SeatProfile[] {
  const briefPath = join(inputs.workDir, "calibration-brief.md");
  const schemaPath = join(inputs.workDir, "calibration-contract.json");
  writeFileDurable(briefPath, `${briefText()}\n`);
  writeFileDurable(schemaPath, `${JSON.stringify(ECHO_SCHEMA, null, 2)}\n`);
  const seatInputs: SeatInputs = {
    briefPath,
    schemaPath,
    schemaJson: JSON.stringify(ECHO_SCHEMA),
    repoDir: inputs.repoDir,
    home: inputs.home,
    path: inputs.path,
    user: inputs.user,
  };
  const profiles = SLOTS.map((definition) => seatProfile(definition.id, seatInputs));
  return round === "isolated" ? profiles : profiles.map(unisolatedProfile);
}

const realRound: NonNullable<CalibrateInputs["runRound"]> = async (_round, profiles) => {
  const runs = await runSeats({
    seats: profiles.map((profile) => ({ profile, brief: briefText() })),
    staggerMs: 1_000,
  });
  return runs.map((run) => ({
    slot: run.slot,
    stream: `${run.result.stdout}${run.result.stderr}`,
    // Judged on stdout alone, which is where the document a parser reads is.
    answered: seatAnswered(slot(run.slot).harness, run.result),
  }));
};

/**
 * A round's raw capture, held in memory until both rounds are over and every
 * layer is restored.
 *
 * These records necessarily carry whatever token a seat echoed, and
 * `workDir` sits inside the repository the next round's seats are pointed
 * at. Writing them between rounds left MAGI's own copy of the live nonce
 * where a seat could read it for itself and be recorded as having been
 * handed it, which is the one thing this whole mechanism measures. Nothing
 * reads them back, so deferring costs only a crashed run's captures, and the
 * sidecar rather than these is what a crash has to leave behind.
 *
 * The whole stream is kept, stdout and stderr together, because that is the
 * evidence the row was judged on.
 */
function recordRound(
  records: Record<string, string>,
  round: CalibrationRound,
  runs: readonly (RoundOutput & { readonly slot: string })[],
): void {
  for (const run of runs) {
    records[`${run.slot}.calibration-${round}.txt`] = run.stream;
  }
}

function byHarness(
  outputs: readonly (RoundOutput & { readonly slot: string })[],
): ReadonlyMap<Harness, RoundOutput> {
  const map = new Map<Harness, RoundOutput>();
  for (const output of outputs) {
    const harness = SLOTS.find((definition) => definition.id === output.slot)?.harness;
    if (harness === undefined) continue;
    map.set(harness, { stream: output.stream, answered: output.answered });
  }
  return map;
}
