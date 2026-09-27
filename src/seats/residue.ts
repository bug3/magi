/**
 * Running a seat's residue probe: the quota-free local command a profile
 * declares for the ambient layers its harness cannot strip. A consult keeps
 * its output as a snapshot and doctor checks that it runs, so both run it
 * here and the same way: the seat's own environment, from the repository root.
 */

import type { SeatProfile } from "../core/profile.ts";
import { exec, type ExecResult } from "../runtime/exec.ts";

const RESIDUE_PROBE_TIMEOUT_MS = 30_000;

/** Runs the profile's probe; undefined when it declares none. */
export async function runResidueProbe(
  profile: SeatProfile,
  repoDir: string,
): Promise<ExecResult | undefined> {
  if (profile.residueProbe === undefined) return undefined;
  return exec({
    argv: profile.residueProbe,
    cwd: repoDir,
    env: profile.env,
    timeoutMs: RESIDUE_PROBE_TIMEOUT_MS,
  });
}

/** Whether a probe run produced the snapshot it exists for. */
export function probeSucceeded(result: ExecResult): boolean {
  return result.outcome.kind === "exit" && result.outcome.code === 0;
}
