/**
 * The ambient layers calibration mutates, and the crash-safe way it does so:
 * stage first (read the original, compute the nonce-bearing image), persist
 * the recovery sidecar, then mutate; restore only while the layer still
 * equals the expected image, refusing concurrent edits rather than
 * clobbering them.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Harness } from "../core/slots.ts";
import { writeFileDurable } from "../util/fs.ts";

/** The sidecar under workDir holding original images until restore succeeds. */
export const RECOVERY_FILE = "calibration-recovery.json";

export interface CalibrationLayer {
  readonly harness: Harness;
  readonly target: (paths: { readonly home: string; readonly repoDir: string }) => string;
  /**
   * What the isolated run must show. Grok's rules layer cannot be stripped
   * so its isolated direction is informational: recorded, never failed.
   */
  readonly isolated: "absent" | "informational";
}

export const CALIBRATION_LAYERS: readonly CalibrationLayer[] = [
  {
    harness: "claude",
    target: ({ home }) => join(home, ".claude", "CLAUDE.md"),
    isolated: "absent",
  },
  {
    harness: "codex",
    target: ({ repoDir }) => join(repoDir, "AGENTS.md"),
    isolated: "absent",
  },
  {
    harness: "grok",
    target: ({ home }) => join(home, ".grok", "rules", "99-magi-calibration.md"),
    isolated: "informational",
  },
];

export interface AppliedLayer {
  readonly harness: Harness;
  readonly path: string;
  readonly kind: "appended" | "created";
  readonly original?: string;
  readonly mutated: string;
}

export function stageLayer(harness: Harness, path: string, line: string): AppliedLayer {
  if (existsSync(path)) {
    const original = readFileSync(path, "utf8");
    return { harness, path, kind: "appended", original, mutated: `${original}\n${line}\n` };
  }
  return { harness, path, kind: "created", mutated: `${line}\n` };
}

/** Restores only over the expected nonce-bearing image; anything else is a
 * concurrent edit and is refused, never overwritten. */
export function restoreLayer(layer: AppliedLayer): boolean {
  const current = existsSync(layer.path) ? readFileSync(layer.path, "utf8") : undefined;
  if (current !== layer.mutated) {
    // A created layer already gone is restored by definition.
    return current === undefined && layer.kind === "created";
  }
  if (layer.kind === "created") {
    rmSync(layer.path, { force: true });
    return true;
  }
  writeFileDurable(layer.path, layer.original ?? "");
  return true;
}
