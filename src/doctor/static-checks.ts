/**
 * The quota-free half of doctor: dry-render every launch profile, probe CLI
 * versions, and compare profile flags against the installed help text.
 * Nothing here spawns a model; the probe commands are --version/--help only.
 */

import { existsSync, readFileSync } from "node:fs";

import { SLOTS, type SlotId } from "../core/slots.ts";
import type { SeatProfile } from "../core/profile.ts";
import { stateIgnoreStatus, type StateIgnoreStatus } from "../consult.ts";
import { tryCapture } from "../runtime/exec.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
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
}

export interface StaticReport {
  readonly seats: readonly SeatStaticReport[];
  readonly ledgerHealth: readonly SeatHealth[];
  readonly stateIgnore: StateIgnoreStatus;
  /** Where each harness would find the skill, and what stands there. */
  readonly skills: readonly SkillReport[];
  readonly healthy: boolean;
}

/** Injectable for tests; the default really runs `--version` and `--help`. */
export interface StaticProbes {
  readonly capture: (argv: readonly string[]) => Promise<string | undefined>;
}

export async function staticChecks(
  inputs: SeatInputs & {
    readonly ledgerPath: string;
    readonly skills: readonly SkillReport[];
  },
  probes: StaticProbes = { capture: (argv) => tryCapture(argv) },
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
    });
  }

  const ledgerHealth = existsSync(inputs.ledgerPath)
    ? healthFromLedger(readFileSync(inputs.ledgerPath, "utf8").split("\n"))
    : [];
  const stateIgnore = await stateIgnoreStatus(inputs.repoDir);

  const healthy =
    seats.every(
      (seat) => seat.cliVersion !== undefined && (seat.undocumented ?? ["missing help"]).length === 0,
    ) &&
    ledgerHealth.every((seat) => !seat.chronic) &&
    stateIgnore !== "not-ignored" &&
    stateIgnore !== "tracked" &&
    !inputs.skills.some(skillProblem);

  return { seats, ledgerHealth, stateIgnore, skills: inputs.skills, healthy };
}
