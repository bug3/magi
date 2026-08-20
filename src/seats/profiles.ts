/**
 * The three launch profiles as data: symmetric starting conditions,
 * recorded trajectories. See `docs/protocol.md`, "Fan-out and isolation".
 *
 * Each slot is a pure function of its inputs, so the same inputs always render
 * the same argv and the run manifest can record the launch verbatim. Nothing is
 * read from the ambient process here: the child environment is built from
 * scratch, and HOME is passed in explicitly because each CLI reads its
 * subscription auth from it.
 */

import type { ProfileSelection, SeatProfile } from "../core/profile.ts";
import type { SlotId } from "../core/slots.ts";
import { modelSelection, reasoningEffortSelection } from "./pins.ts";

export interface SeatInputs {
  /** The brief + evidence pack; the only instruction context a seat gets. */
  readonly briefPath: string;
  /** The opinion contract the harness is constrained to, as a file path. */
  readonly schemaPath: string;
  /**
   * The same contract as inline JSON text: grok's --json-schema takes the
   * schema itself, not a path (verified live, the path string fails its JSON
   * parse), while codex --output-schema wants the file.
   */
  readonly schemaJson: string;
  /** Working root handed to the harness. */
  readonly repoDir: string;
  /** Subscription auth lives under HOME; no API keys, no fake HOME. */
  readonly home: string;
  /** PATH used to resolve the harness binary. */
  readonly path: string;
}

/**
 * Wall-clock cap for one seat call. `claude -p` has no native turn cap in this
 * CLI's help, so the wrapper timeout is the only bound it gets; the other two
 * carry it for symmetry.
 */
export const SEAT_TIMEOUT_MS = 600_000;

/** Grok's own turn cap, kept as data because the argv is asserted verbatim. */
const CASPER_MAX_TURNS = "8";

type SeatProfileBuilder = (inputs: SeatInputs) => SeatProfile;

export const SEAT_PROFILES: Readonly<Record<SlotId, SeatProfileBuilder>> = {
  "melchior-1": melchiorProfile,
  "balthasar-2": balthasarProfile,
  "casper-3": casperProfile,
};

export function seatProfile(id: SlotId, inputs: SeatInputs): SeatProfile {
  return SEAT_PROFILES[id](inputs);
}

/**
 * claude 2.1.227. `--safe-mode` disables CLAUDE.md, skills, plugins, hooks and
 * MCP while subscription OAuth keeps working; `--bare` would be stronger but
 * never reads OAuth. `--tools ""` is the CLI's documented way to disable the
 * whole built-in set, and the deny list restates the three that must never come
 * back: Bash, WebFetch, WebSearch.
 */
function melchiorProfile(inputs: SeatInputs): SeatProfile {
  return {
    slot: "melchior-1",
    command: "claude",
    args: [
      "--safe-mode",
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--disallowed-tools",
      "Bash,WebFetch,WebSearch",
      ...modelArgs("melchior-1", "--model"),
    ],
    env: baseEnv(inputs),
    promptVia: "stdin",
    model: modelSelection("melchior-1"),
    reasoningEffort: reasoningEffortSelection("melchior-1"),
    timeoutMs: SEAT_TIMEOUT_MS,
  };
}

/**
 * codex 0.148.0. `--ignore-user-config` drops `~/.codex/config.toml`,
 * `--ignore-rules` the execpolicy rules, `project_doc_max_bytes=0` the repo
 * AGENTS.md. No `--model`: this seat keeps the CLI default, so the flag is
 * omitted rather than pinned to a guess.
 */
function balthasarProfile(inputs: SeatInputs): SeatProfile {
  return {
    slot: "balthasar-2",
    command: "codex",
    args: [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--strict-config",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "--output-schema",
      inputs.schemaPath,
      "-C",
      inputs.repoDir,
      "-c",
      "project_doc_max_bytes=0",
      // Web search off via config: codex exposes no dedicated flag for it.
      "-c",
      "tools.web_search=false",
      ...modelArgs("balthasar-2", "--model"),
    ],
    env: baseEnv(inputs),
    promptVia: "stdin",
    model: modelSelection("balthasar-2"),
    reasoningEffort: reasoningEffortSelection("balthasar-2"),
    timeoutMs: SEAT_TIMEOUT_MS,
  };
}

/**
 * grok 1.0.5. Takes its prompt from a file rather than stdin. Memory is off
 * through the environment, this CLI having removed its flag; residual layers
 * (rules, skills, MCP, hooks) cannot be fully stripped, so every fan-out snapshots them through
 * the residue probe instead of claiming they are off.
 */
function casperProfile(inputs: SeatInputs): SeatProfile {
  return {
    slot: "casper-3",
    command: "grok",
    args: [
      "--prompt-file",
      inputs.briefPath,
      // Without this, briefs past the CLI's large-prompt offload threshold
      // reach the model as a bounded preview plus a file reference its
      // disabled tools cannot read; the seat then answers hollow
      // (verified live).
      "--verbatim",
      "--json-schema",
      inputs.schemaJson,
      "--sandbox",
      "read-only",
      "--permission-mode",
      "plan",
      "--disable-web-search",
      "--no-subagents",
      "--max-turns",
      CASPER_MAX_TURNS,
      ...modelArgs("casper-3", "--model"),
      ...effortArgs("casper-3", "--reasoning-effort"),
    ],
    env: { ...baseEnv(inputs), GROK_MEMORY: "0" },
    promptVia: "prompt-file",
    model: modelSelection("casper-3"),
    reasoningEffort: reasoningEffortSelection("casper-3"),
    timeoutMs: SEAT_TIMEOUT_MS,
    residueProbe: ["grok", "inspect", "--json"],
  };
}

/**
 * Exactly HOME and PATH. HOME because each CLI reads its already-logged-in
 * subscription from it; PATH because the command name is resolved through it.
 * Anything else a seat needs is an explicit, per-profile addition.
 */
function baseEnv(inputs: SeatInputs): Record<string, string> {
  return { HOME: inputs.home, PATH: inputs.path };
}

/** A cli-default selection renders no flag at all, so the CLI default stands. */
function pinArgs(flag: string, selection: ProfileSelection): readonly string[] {
  return selection.kind === "pinned" ? [flag, selection.value] : [];
}

function modelArgs(id: SlotId, flag: string): readonly string[] {
  return pinArgs(flag, modelSelection(id));
}

function effortArgs(id: SlotId, flag: string): readonly string[] {
  return pinArgs(flag, reasoningEffortSelection(id));
}
