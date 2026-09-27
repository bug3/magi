/**
 * Running a seat's residue probe: the quota-free local command a profile
 * declares for the ambient layers its harness cannot strip. A consult keeps
 * its output as a snapshot and doctor checks that it runs, so both run it
 * here and judge it here, the same way: the seat's own environment, from the
 * repository root.
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

/**
 * Whether a probe run produced the snapshot it exists for: exit 0, a
 * non-empty output, and nothing cut at the capture ceiling. The ceiling flag
 * covers both streams, so a probe that floods stderr is refused too; an
 * empty or possibly cut snapshot is no reading of the residue.
 */
export function probeSucceeded(result: ExecResult): boolean {
  return (
    result.outcome.kind === "exit" &&
    result.outcome.code === 0 &&
    !result.truncated &&
    result.stdout.trim() !== ""
  );
}

/** Why a probe produced no snapshot, in one line: its outcome and first stderr line. */
export function probeFailure(result: ExecResult): string {
  const { outcome } = result;
  const what =
    outcome.kind === "exit"
      ? outcome.code !== 0
        ? `exit ${outcome.code}`
        : result.truncated
          ? "exit 0, a stream cut at the capture ceiling"
          : "exit 0, no output"
      : outcome.kind === "spawn_error"
        ? `spawn_error: ${outcome.message}`
        : outcome.kind === "signal"
          ? `signal ${outcome.signal}`
          : outcome.kind;
  const said = result.stderr.trim().split("\n")[0] ?? "";
  return said === "" ? what : `${what}: ${said}`;
}
