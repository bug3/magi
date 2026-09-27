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
 * removed only after every layer restored. A sidecar or a nonce marker left by
 * an earlier run refuses the start. The row records the seated CLI
 * versions and the restored layers' hashes, so doctor can tell a stale
 * calibration from a current one.
 *
 * Nothing MAGI writes under `workDir` carries a calibration token while a
 * probe round is running, this run's or an earlier one's. That directory sits
 * inside the repository every seat is pointed at, and the brief asks a seat
 * for any token carrying the prefix rather than for this run's, so the
 * sidecar keeps original images and digests, the captures land only once the
 * rounds are over, and a previous calibration's leavings are cleared only
 * after the start has been confirmed clean.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLedgerCalibration } from "../consult.ts";
import {
  CALIBRATION_LAYERS,
  NONCE_MARKER,
  NONCE_PREFIX,
  RECOVERY_FILE,
  carriesNonceMarker,
  clearScratch,
  dirtyStart,
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
import { byHarness, realRound, recordRound, roundProfiles } from "./calibration-rounds.ts";
import type { SeatProfile } from "../core/profile.ts";
import { SLOTS, type Harness } from "../core/slots.ts";
import { tryCapture } from "../runtime/exec.ts";
import { sha256Text, writeFileDurable } from "../util/fs.ts";

export {
  CALIBRATION_LAYERS,
  CALIBRATION_TOKEN,
  NONCE_MARKER,
  NONCE_PREFIX,
  RECOVERY_FILE,
  carriesNonceMarker,
  type CalibrationLayer,
} from "./calibration-layers.ts";
export {
  type CalibrationDirection,
  type CalibrationRound,
  type RoundOutput,
} from "./calibration-verdict.ts";
export { unisolatedProfile } from "./calibration-rounds.ts";

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
  // Staging only read. A dirty start is refused here, before cleanup can
  // erase an earlier run's hand-recovery evidence: a surviving sidecar would
  // be replaced with the current layers and then deleted by a clean run.
  const recoveryPath = join(inputs.workDir, RECOVERY_FILE);
  const dirty = dirtyStart({
    recoveryPending: existsSync(recoveryPath) && recoveryPath,
    layers: staged.map((layer) => ({
      path: layer.path,
      hasNonceMarker: carriesNonceMarker(layer.original),
    })),
  });
  if (dirty.length > 0) throw new Error(`calibration refused: ${dirty.join("; ")}`);
  clearScratch(inputs.workDir);
  writeFileDurable(recoveryPath, recoveryImage(staged, inputs.nonce));
  for (const layer of staged) {
    mkdirSync(dirname(layer.path), { recursive: true });
    writeFileDurable(layer.path, layer.mutated);
  }

  const runRound = inputs.runRound ?? realRound;
  const restoreFailures: { path: string }[] = [];
  const records: Record<string, string> = {};
  let roundFailed = false;
  let outputs: Readonly<Record<CalibrationRound, ReadonlyMap<Harness, RoundOutput>>>;
  try {
    const isolated = await runRound("isolated", roundProfiles(inputs, "isolated"));
    recordRound(records, "isolated", isolated);
    const unisolated = await runRound("unisolated", roundProfiles(inputs, "unisolated"));
    recordRound(records, "unisolated", unisolated);
    outputs = { isolated: byHarness(isolated), unisolated: byHarness(unisolated) };
  } catch (error) {
    roundFailed = true;
    throw error;
  } finally {
    for (const layer of staged) {
      if (!restoreLayer(layer)) restoreFailures.push({ path: layer.path });
    }
    // The sidecar outlives any refused restore: it is the hand-recovery copy.
    if (restoreFailures.length === 0) rmSync(recoveryPath, { force: true });
    for (const [name, stream] of Object.entries(records)) {
      try {
        writeFileDurable(join(inputs.workDir, name), stream);
      } catch (error) {
        // A capture is evidence, never the measurement: it may not replace a
        // round failure already on its way out. Nothing pending, it travels.
        if (!roundFailed) throw error;
      }
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
    // The digest, not the token: the ledger lives at `<repoDir>/.magi` and a
    // row naming its nonce in the clear is residue a later calibration's
    // seats can read. It is the same identifier the sidecar carries, so the
    // two still match; rows written before this keep their raw nonce.
    calibration: sha256Text(inputs.nonce),
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
