/**
 * The ambient layers calibration mutates, and the crash-safe way it does so:
 * stage first (read the original, compute the nonce-bearing image), persist
 * the recovery sidecar, then mutate; restore only while the layer still
 * equals the expected image, refusing concurrent edits rather than
 * clobbering them.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Harness } from "../core/slots.ts";
import { sha256Text, writeFileDurable } from "../util/fs.ts";

/** The sidecar under workDir holding original images until restore succeeds. */
export const RECOVERY_FILE = "calibration-recovery.json";

/** The marker every written nonce line starts with; doctor scans layers for it. */
export const NONCE_MARKER = "MAGI calibration nonce:";
/** Every nonce carries this fixed prefix. The brief names ONLY the prefix and
 * never the token: the first live calibration produced a brief-echo false
 * positive when codex matched the nonce inside the brief itself, so an echo
 * of the full token now proves layer visibility and nothing else. */
export const NONCE_PREFIX = "magi-canary-";

/**
 * Any calibration token, this run's or an older one's.
 *
 * The brief asks a seat to echo a token carrying the prefix, not the token
 * this run is measuring, so residue from an earlier calibration is as
 * readable to a seat as the live one. A suffix character is required, which
 * is what keeps the brief's own bare prefix from matching.
 */
export const CALIBRATION_TOKEN = new RegExp(`${NONCE_PREFIX}[A-Za-z0-9][A-Za-z0-9-]*`);

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

/**
 * What the sidecar puts on disk. It has one reader, a person restoring a
 * layer by hand after a refused restore, and that reader needs the original
 * image and nothing else.
 *
 * The mutated image is deliberately left out, and with it the nonce: the
 * sidecar lives under `workDir`, which sits inside the repository every seat
 * is pointed at, so a token written here is a token a seat can read for
 * itself and be recorded as having been handed. The run is named by the
 * nonce's digest instead, which identifies it against the ledger row without
 * putting the token anywhere a seat can reach.
 */
export function recoveryImage(layers: readonly AppliedLayer[], nonce: string): string {
  const image = {
    nonceSha256: sha256Text(nonce),
    layers: layers.map(({ harness, path, kind, original, mutated }) => ({
      harness,
      path,
      kind,
      // The digest of the image restore expects to find. A surviving sidecar
      // means the layer no longer equals it, and without this a person is
      // handed `original` with no way to tell MAGI's nonce line from the
      // owner edit the refusal existed to protect, so the obvious action
      // clobbers it. The digest says which it is without carrying the token.
      mutatedSha256: sha256Text(mutated),
      ...(original === undefined ? {} : { original }),
    })),
  };
  return `${JSON.stringify(image, null, 2)}\n`;
}

/**
 * Clears a previous calibration's leavings out of `workDir` before this one
 * stages anything, and reports what it removed.
 *
 * `workDir` sits inside the repository every seat is pointed at, and a
 * capture from an earlier run carries that run's token. The brief asks a
 * seat to echo any token with the calibration prefix, so a seat that finds a
 * stale one answers with it, the round records this run's nonce as not seen,
 * and the calibration fails naming isolation when the fault is residue MAGI
 * left behind. Only files carrying a token go; everything else in the
 * directory, the live smoke's records among them, is left alone.
 */
export function clearScratch(workDir: string): readonly string[] {
  if (!existsSync(workDir)) return [];
  const cleared: string[] = [];
  for (const name of readdirSync(workDir)) {
    const path = join(workDir, name);
    if (!statSync(path).isFile()) continue;
    if (!CALIBRATION_TOKEN.test(readFileSync(path, "utf8"))) continue;
    rmSync(path, { force: true });
    cleared.push(path);
  }
  return cleared;
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
