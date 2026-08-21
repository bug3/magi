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
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLedgerCalibration } from "../consult/ledger.ts";
import { tokenWasFetched } from "./calibration-evidence.ts";
import {
  CALIBRATION_LAYERS,
  RECOVERY_FILE,
  restoreLayer,
  stageLayer,
} from "./calibration-layers.ts";
import type { SeatProfile } from "../core/profile.ts";
import { SLOTS, type Harness } from "../core/slots.ts";
import { tryCapture } from "../runtime/exec.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
import { runSeats } from "../seats/runner.ts";
import { sha256Text, writeFileDurable } from "../util/fs.ts";

export {
  CALIBRATION_LAYERS,
  RECOVERY_FILE,
  type CalibrationLayer,
} from "./calibration-layers.ts";

/** The marker every written nonce line starts with; doctor scans layers for it. */
export const NONCE_MARKER = "MAGI calibration nonce:";
/** Every nonce carries this fixed prefix. The brief names ONLY the prefix and
 * never the token: the first live calibration produced a brief-echo false
 * positive when codex matched the nonce inside the brief itself, so an echo
 * of the full token now proves layer visibility and nothing else. */
export const NONCE_PREFIX = "magi-canary-";

export type CalibrationRound = "isolated" | "unisolated";

export interface CalibrationDirection {
  readonly harness: Harness;
  readonly direction: CalibrationRound;
  readonly expectation: "absent" | "present" | "informational";
  /** The layer reached the seat on its own: the only thing that counts. */
  readonly nonceSeen: boolean;
  /**
   * The token is in the stream, but only after the seat fetched it. Recorded
   * because it says the seat can read the layer, and judged as nothing else.
   */
  readonly nonceFetched: boolean;
  readonly pass: boolean;
}

export interface CalibrationReport {
  readonly nonce: string;
  readonly results: readonly CalibrationDirection[];
  /** Layers whose restore was refused: the content changed underneath. */
  readonly restoreFailures: readonly { readonly path: string }[];
  readonly pass: boolean;
}

export interface CalibrateInputs {
  readonly home: string;
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
  ) => Promise<readonly { readonly slot: string; readonly stdout: string }[]>;
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
  writeFileDurable(
    recoveryPath,
    `${JSON.stringify({ nonce: inputs.nonce, layers: staged }, null, 2)}\n`,
  );
  for (const layer of staged) {
    mkdirSync(dirname(layer.path), { recursive: true });
    writeFileDurable(layer.path, layer.mutated);
  }

  const runRound = inputs.runRound ?? realRound(inputs);
  const restoreFailures: { path: string }[] = [];
  let outputs: Readonly<Record<CalibrationRound, ReadonlyMap<Harness, string>>>;
  try {
    outputs = {
      isolated: byHarness(await runRound("isolated", roundProfiles(inputs, "isolated"))),
      unisolated: byHarness(await runRound("unisolated", roundProfiles(inputs, "unisolated"))),
    };
  } finally {
    for (const layer of staged) {
      if (!restoreLayer(layer)) restoreFailures.push({ path: layer.path });
    }
    // The sidecar outlives any refused restore: it is the hand-recovery copy.
    if (restoreFailures.length === 0) rmSync(recoveryPath, { force: true });
  }

  const results: CalibrationDirection[] = [];
  for (const direction of ["isolated", "unisolated"] as const) {
    for (const layer of CALIBRATION_LAYERS) {
      const stdout = outputs[direction].get(layer.harness) ?? "";
      const nonceFetched = tokenWasFetched(layer.harness, stdout, inputs.nonce);
      const nonceSeen = !nonceFetched && stdout.includes(inputs.nonce);
      const expectation = direction === "unisolated" ? "present" : layer.isolated;
      const pass =
        expectation === "present" ? nonceSeen : expectation === "absent" ? !nonceSeen : true;
      results.push({
        harness: layer.harness,
        direction,
        expectation,
        nonceSeen,
        nonceFetched,
        pass,
      });
    }
  }
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
  };
  const profiles = SLOTS.map((definition) => seatProfile(definition.id, seatInputs));
  return round === "isolated" ? profiles : profiles.map(unisolatedProfile);
}

function realRound(inputs: CalibrateInputs): NonNullable<CalibrateInputs["runRound"]> {
  return async (round, profiles) => {
    const runs = await runSeats({
      seats: profiles.map((profile) => ({ profile, brief: briefText() })),
      staggerMs: 1_000,
    });
    for (const run of runs) {
      writeFileDurable(
        join(inputs.workDir, `${run.slot}.calibration-${round}.stdout.txt`),
        run.result.stdout,
      );
    }
    return runs.map((run) => ({ slot: run.slot, stdout: run.result.stdout }));
  };
}

function byHarness(
  outputs: readonly { readonly slot: string; readonly stdout: string }[],
): ReadonlyMap<Harness, string> {
  const map = new Map<Harness, string>();
  for (const output of outputs) {
    const harness = SLOTS.find((definition) => definition.id === output.slot)?.harness;
    if (harness !== undefined) map.set(harness, output.stdout);
  }
  return map;
}
