/**
 * What it takes to launch one seat headless: symmetric starting conditions,
 * recorded trajectories.
 *
 * A profile is plain data so the run manifest can record the exact launch
 * verbatim and `magi doctor` can dry-render it without spawning anything.
 */

import type { SlotId } from "./slots.ts";

export type ProfileSelection =
  | { readonly kind: "pinned"; readonly value: string }
  | { readonly kind: "cli-default" };

export interface SeatProfile {
  readonly slot: SlotId;
  /** Executable name, resolved via PATH at spawn time. */
  readonly command: string;
  /** Arguments after the command, fully resolved; no placeholders remain. */
  readonly args: readonly string[];
  /** Full child environment. Nothing is inherited implicitly. */
  readonly env: Readonly<Record<string, string>>;
  /** claude and codex read the brief from stdin; grok takes a file path. */
  readonly promptVia: "stdin" | "prompt-file";
  /** The launch policy, recorded even when the CLI chooses its own default. */
  readonly model: ProfileSelection;
  /** The same explicit policy for reasoning effort. */
  readonly reasoningEffort: ProfileSelection;
  readonly timeoutMs: number;
  /**
   * A quota-free local command (full argv) that snapshots the ambient layers
   * this harness cannot strip: recorded, not denied.
   * Every consult writes its output to raw/<slot>.inspect.json.
   */
  readonly residueProbe?: readonly string[];
}
