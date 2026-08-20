/**
 * The on-disk consult layout under the target repo's .magi/ directory.
 * Paths are decided here and nowhere else, so a reader and a writer can
 * never disagree about where a consult lives.
 */

import { join } from "node:path";

import type { ConsultId } from "../core/ids.ts";

export interface ConsultPaths {
  readonly root: string;
  /** The fully rendered seat brief, identical for every seat. */
  readonly briefPath: string;
  readonly manifestPath: string;
  /** Per-seat raw stdout/stderr and launch records. */
  readonly rawDir: string;
  /** The gate's verdicts with normalized opinions, persisted for tooling. */
  readonly gatePath: string;
  /** Seat-proposed check commands and their results. */
  readonly checksDir: string;
  readonly synthesisPath: string;
}

export function consultPaths(magiDir: string, id: ConsultId): ConsultPaths {
  const root = join(magiDir, "consults", id);
  return {
    root,
    briefPath: join(root, "brief.md"),
    manifestPath: join(root, "manifest.json"),
    rawDir: join(root, "raw"),
    gatePath: join(root, "gate.json"),
    checksDir: join(root, "checks"),
    synthesisPath: join(root, "synthesis.md"),
  };
}

export function consultsDir(magiDir: string): string {
  return join(magiDir, "consults");
}

export function ledgerPath(magiDir: string): string {
  return join(magiDir, "ledger.jsonl");
}
