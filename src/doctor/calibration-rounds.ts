/**
 * How one calibration probe round is composed and run: the brief that names
 * only the nonce prefix, the echo contract, the isolated and unisolated seat
 * profiles, and the production round that fans them out.
 *
 * A round reports, it never records. Its output carries whatever token a seat
 * echoed, and `workDir` sits inside the repository every seat is pointed at,
 * so the captures are the caller's to write once both rounds are over.
 */

import { join } from "node:path";

import type { SeatProfile } from "../core/profile.ts";
import { slot, SLOTS, type Harness } from "../core/slots.ts";
import { seatAnswered } from "../seats/answer.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
import { runSeats } from "../seats/runner.ts";
import { writeFileDurable } from "../util/fs.ts";
import { NONCE_PREFIX } from "./calibration-layers.ts";
import type { CalibrationRound, RoundOutput } from "./calibration-verdict.ts";
import type { CalibrateInputs } from "./calibrate.ts";

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

export function roundProfiles(
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

export const realRound: NonNullable<CalibrateInputs["runRound"]> = async (_round, profiles) => {
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
 * layer is restored. These records carry whatever token a seat echoed, so
 * writing one between rounds put MAGI's own copy of it where the next
 * round's seats could read it. Nothing reads them back, so deferring costs
 * only a crashed run's captures, and the sidecar is what a crash must leave.
 *
 * The whole stream is kept, stdout and stderr together, because that is the
 * evidence the row was judged on.
 */
export function recordRound(
  records: Record<string, string>,
  round: CalibrationRound,
  runs: readonly (RoundOutput & { readonly slot: string })[],
): void {
  for (const run of runs) {
    records[`${run.slot}.calibration-${round}.txt`] = run.stream;
  }
}

export function byHarness(
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
