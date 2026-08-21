/**
 * Running planned checks and recording every proposal, run or refused.
 *
 * The execution profile is fail closed: explicit cwd, only PATH inherited,
 * fixed hardening variables, a wall-clock timeout and bounded output. Two
 * entry points share it. A seat proposal is planned against the read-only
 * vocabulary first, so project-code entry points are refused before they run;
 * the repository floor passes the argv package.json declares, which is the
 * repo's own command and never a seat's.
 */

import { join } from "node:path";

import type { Opinion } from "../consult.ts";
import type { SlotId } from "../core/slots.ts";
import { exec, type CommandOutcome } from "../runtime/exec.ts";
import { writeFileDurable } from "../util/fs.ts";
import { planCheck } from "./plan.ts";

const CHECK_TIMEOUT_MS = 120_000;
const CHECK_MAX_OUTPUT_BYTES = 1024 * 1024;

/** One command that reached the execution profile. */
export interface HardenedRunRecord {
  readonly argv: readonly string[];
  readonly outcome: CommandOutcome;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

/** A seat proposal: planned first, so a refusal carries its reason instead. */
export interface CheckRecord extends Partial<HardenedRunRecord> {
  readonly decision: "ran" | "refused";
  readonly reason?: string;
  readonly slot: SlotId;
  readonly finding: string;
  readonly proposal: string;
}

export interface CheckRunInputs {
  readonly opinions: ReadonlyArray<{ readonly slot: SlotId; readonly opinion: Opinion }>;
  readonly repoDir: string;
  readonly path: string;
  readonly checksDir: string;
}

/** Only PATH is inherited. HOME and every other entry are fixed here. */
function checkEnvironment(path: string): Record<string, string> {
  return {
    PATH: path,
    HOME: "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

export async function runProposedChecks(inputs: CheckRunInputs): Promise<readonly CheckRecord[]> {
  const records: CheckRecord[] = [];
  for (const { slot, opinion } of inputs.opinions) {
    for (const finding of opinion.findings) {
      if (finding.check === undefined) continue;
      const record = await runOneCheck(slot, finding.id, finding.check, inputs);
      records.push(record);
      writeFileDurable(
        join(inputs.checksDir, `${String(records.length).padStart(2, "0")}-${slot}-${finding.id}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    }
  }
  return records;
}

async function runOneCheck(
  slot: SlotId,
  finding: string,
  proposal: string,
  inputs: CheckRunInputs,
): Promise<CheckRecord> {
  const plan = planCheck(proposal);
  if (plan.kind === "refuse") {
    return { slot, finding, proposal, decision: "refused", reason: plan.reason };
  }
  const run = await runHardened(plan.argv, inputs);
  return { slot, finding, proposal, decision: "ran", ...run };
}

/** The one execution profile. What reaches it has already earned the run. */
export async function runHardened(
  argv: readonly string[],
  inputs: { readonly repoDir: string; readonly path: string },
): Promise<HardenedRunRecord> {
  const result = await exec({
    argv,
    cwd: inputs.repoDir,
    env: checkEnvironment(inputs.path),
    timeoutMs: CHECK_TIMEOUT_MS,
    maxOutputBytes: CHECK_MAX_OUTPUT_BYTES,
  });
  return {
    argv,
    outcome: result.outcome,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    durationMs: result.durationMs,
  };
}
