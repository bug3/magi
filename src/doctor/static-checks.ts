/**
 * The quota-free half of doctor: dry-render every launch profile, probe CLI
 * versions, compare profile flags against the installed help text, and run
 * each declared residue probe. Nothing here spawns a model; the commands are
 * --version, --help and the probes, which the profile contract keeps local.
 */

import { existsSync, readFileSync } from "node:fs";

import { SLOTS, type SlotId } from "../core/slots.ts";
import type { SeatProfile } from "../core/profile.ts";
import { stateIgnoreStatus, type StateIgnoreStatus } from "../consult.ts";
import { tryCapture } from "../runtime/exec.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
import { probeFailure, probeSucceeded, runResidueProbe } from "../seats/residue.ts";
import { skillProblem, type SkillReport } from "../skill.ts";
import { undocumentedFlags } from "./drift.ts";
import { healthFromLedger, type SeatHealth } from "./health.ts";

/** How each harness prints the help that documents its profile flags. */
const HELP_ARGV: Readonly<Record<SlotId, readonly string[]>> = {
  "melchior-1": ["claude", "--help"],
  "balthasar-2": ["codex", "exec", "--help"],
  "casper-3": ["grok", "--help"],
};

export interface SeatStaticReport {
  readonly slot: SlotId;
  readonly profile: SeatProfile;
  readonly cliVersion: string | undefined;
  /** undefined when help itself could not be captured. */
  readonly undocumented: readonly string[] | undefined;
  /** undefined when the profile declares no residue probe. */
  readonly residueProbe: ResidueCheck | undefined;
}

/** Whether a declared residue probe ran, and why not when it did not. */
export type ResidueCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface StaticReport {
  readonly seats: readonly SeatStaticReport[];
  readonly ledgerHealth: readonly SeatHealth[];
  readonly stateIgnore: StateIgnoreStatus;
  /** Where each harness would find the skill, and what stands there. */
  readonly skills: readonly SkillReport[];
  readonly healthy: boolean;
}

/**
 * Injectable for tests; the default really runs `--version`, `--help` and
 * each declared residue probe, which is quota-free by the profile contract.
 */
export interface StaticProbes {
  readonly capture: (argv: readonly string[]) => Promise<string | undefined>;
  readonly residue: (profile: SeatProfile) => Promise<ResidueCheck | undefined>;
}

export async function staticChecks(
  inputs: SeatInputs & {
    readonly ledgerPath: string;
    readonly skills: readonly SkillReport[];
  },
  probes: StaticProbes = {
    capture: (argv) => tryCapture(argv),
    residue: (profile) => checkResidueProbe(profile, inputs.repoDir),
  },
): Promise<StaticReport> {
  const seats: SeatStaticReport[] = [];
  for (const definition of SLOTS) {
    const profile = seatProfile(definition.id, inputs);
    const cliVersion = await probes.capture([profile.command, "--version"]);
    const helpText = await probes.capture(HELP_ARGV[definition.id]);
    seats.push({
      slot: definition.id,
      profile,
      cliVersion,
      undocumented: helpText === undefined ? undefined : undocumentedFlags(profile.args, helpText),
      residueProbe: await probes.residue(profile),
    });
  }

  const ledgerHealth = existsSync(inputs.ledgerPath)
    ? healthFromLedger(readFileSync(inputs.ledgerPath, "utf8").split("\n"))
    : [];
  const stateIgnore = await stateIgnoreStatus(inputs.repoDir);

  const healthy =
    seats.every(
      (seat) =>
        seat.cliVersion !== undefined &&
        (seat.undocumented ?? ["missing help"]).length === 0 &&
        seat.residueProbe?.ok !== false,
    ) &&
    ledgerHealth.every((seat) => !seat.chronic) &&
    stateIgnore !== "not-ignored" &&
    stateIgnore !== "tracked" &&
    !inputs.skills.some(skillProblem);

  return { seats, ledgerHealth, stateIgnore, skills: inputs.skills, healthy };
}

/**
 * Runs a profile's residue probe the way a consult runs it. A probe that
 * stopped working is otherwise found only as a failure record in a consult's
 * `raw/`, and the snapshot a canary warning is read against is missing.
 */
async function checkResidueProbe(
  profile: SeatProfile,
  repoDir: string,
): Promise<ResidueCheck | undefined> {
  const result = await runResidueProbe(profile, repoDir);
  if (result === undefined) return undefined;
  return probeSucceeded(result) ? { ok: true } : { ok: false, reason: probeFailure(result) };
}
