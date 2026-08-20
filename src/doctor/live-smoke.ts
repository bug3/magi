/**
 * The quota-spending half of doctor: one minimal call per harness, behind an
 * explicit flag and never by default. Each seat gets a trivial brief and a
 * one-field contract; what comes back is judged mechanically: did it parse
 * as the launch profile promised, and did any isolation canary trip.
 */

import { join } from "node:path";

import { parseClaudeOutput } from "../adapters/claude.ts";
import { parseCodexOutput } from "../adapters/codex.ts";
import { parseGrokOutput } from "../adapters/grok.ts";
import type { ParseResult } from "../adapters/types.ts";
import { slot, SLOTS, type Harness, type SlotId } from "../core/slots.ts";
import { canaryEvidence, loadCanaries } from "../seats/canaries.ts";
import { seatProfile, type SeatInputs } from "../seats/profiles.ts";
import { runSeats } from "../seats/runner.ts";
import { writeFileDurable } from "../util/fs.ts";

const PARSERS: Readonly<Record<Harness, (stdout: string) => ParseResult>> = {
  claude: parseClaudeOutput,
  codex: parseCodexOutput,
  grok: parseGrokOutput,
};

const SMOKE_BRIEF =
  'This is a mechanical health check of the launch profile, not a task. Reply with exactly one JSON object {"pong": true} and nothing else: no prose, no fences.';

// Single-value enum rather than const: the same shape our opinion contract
// uses, chosen for the narrowest common subset across the three enforcement
// engines.
const PONG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pong"],
  properties: { pong: { enum: [true] } },
};

const SMOKE_TIMEOUT_MS = 180_000;

export interface SmokeResult {
  readonly slot: SlotId;
  readonly outcome: string;
  readonly parsed: boolean;
  readonly parseReason: string | undefined;
  readonly canaryHits: readonly string[];
  readonly durationMs: number;
  readonly stdout: string;
}

/** workDir must exist; the brief and contract land there for the record. */
export async function liveSmoke(
  inputs: Omit<SeatInputs, "briefPath" | "schemaPath" | "schemaJson"> & {
    readonly workDir: string;
  },
): Promise<readonly SmokeResult[]> {
  const briefPath = join(inputs.workDir, "smoke-brief.md");
  const schemaPath = join(inputs.workDir, "smoke-contract.json");
  writeFileDurable(briefPath, `${SMOKE_BRIEF}\n`);
  writeFileDurable(schemaPath, `${JSON.stringify(PONG_SCHEMA, null, 2)}\n`);

  const seatInputs: SeatInputs = {
    ...inputs,
    briefPath,
    schemaPath,
    schemaJson: JSON.stringify(PONG_SCHEMA),
  };
  const runs = await runSeats({
    seats: SLOTS.map((definition) => ({
      profile: { ...seatProfile(definition.id, seatInputs), timeoutMs: SMOKE_TIMEOUT_MS },
      brief: SMOKE_BRIEF,
    })),
    staggerMs: 1_000,
  });

  const canaries = loadCanaries(join(inputs.repoDir, ".magi"));
  return runs.map((run) => {
    // The raw record survives the run: a failed smoke must be diagnosable
    // without spending another call.
    writeFileDurable(join(inputs.workDir, `${run.slot}.stdout.txt`), run.result.stdout);
    writeFileDurable(join(inputs.workDir, `${run.slot}.stderr.txt`), run.result.stderr);
    const parse = PARSERS[slot(run.slot).harness](run.result.stdout);
    const text = `${run.result.stdout}\n${run.result.stderr}`;
    return {
      slot: run.slot,
      outcome:
        run.result.outcome.kind === "exit"
          ? `exit ${run.result.outcome.code}`
          : run.result.outcome.kind,
      parsed: parse.ok,
      parseReason: parse.ok ? undefined : parse.reason,
      canaryHits: canaryEvidence(text, SMOKE_BRIEF, canaries),
      durationMs: run.durationMs,
      stdout: run.result.stdout,
    };
  });
}
