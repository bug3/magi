/**
 * The ambient layers calibration mutates, and the crash-safe way it does so:
 * stage first (read the original, compute the nonce-bearing image), persist
 * the recovery sidecar, then mutate; restore only while the layer still
 * equals the expected image, refusing concurrent edits rather than
 * clobbering them.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Harness } from "../core/slots.ts";
import { DURABLE_TEMP_PREFIX, sha256Text, writeFileDurable } from "../util/fs.ts";

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

/** Whether a layer's content still carries a nonce line MAGI wrote. */
export function carriesNonceMarker(content: string | undefined): boolean {
  return content?.includes(NONCE_MARKER) ?? false;
}

/** The facts a dirty start is judged on, as they stand on disk. */
export interface DirtyStartFacts {
  /** The surviving sidecar's path, or false when none survives. */
  readonly recoveryPending: string | false;
  readonly layers: readonly {
    readonly harness: Harness;
    readonly path: string;
    /** sha256 of the current content, or "absent" when the file is missing. */
    readonly currentSha256: string;
    readonly hasNonceMarker: boolean;
  }[];
  /** Durable-write temp files beside a layer that carry, or may carry, a nonce line. */
  readonly strandedWrites: readonly StrandedWrite[];
}

/** A temp file beside a layer, by what reading it could establish. */
export interface StrandedWrite {
  readonly path: string;
  /** "unchecked": it could not be read, so it is not known to be clean. */
  readonly nonce: "carried" | "unchecked";
}

/**
 * The largest temp file read in full. A calibration write is one layer image
 * plus one line; a larger file is reported unchecked rather than read.
 */
export const STRANDED_WRITE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A kill between a durable write's temp open and its rename leaves the
 * nonce-bearing image beside the layer, under a name no layer read looks at.
 * For codex that is the repository root, readable by the seats; for grok it
 * is the rules directory the harness loads whole.
 *
 * This runs on every doctor, over directories MAGI does not own, so nothing
 * found there may crash it. Only regular files are read: a durable write
 * opens its temp exclusively, so a link or a directory is never one of its
 * leftovers. An entry that vanished is gone; one that cannot be read is
 * reported unchecked, because an unread file is not a clean one.
 */
function strandedWrites(layerPaths: readonly string[]): readonly StrandedWrite[] {
  const found: StrandedWrite[] = [];
  for (const dir of new Set(layerPaths.map((path) => dirname(path)))) {
    const names = attempt(() => readdirSync(dir));
    if (names === "gone") continue;
    if (names === "unreadable") {
      found.push({ path: dir, nonce: "unchecked" });
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(DURABLE_TEMP_PREFIX)) continue;
      const path = join(dir, name);
      const nonce = attempt(() => {
        const entry = lstatSync(path);
        if (!entry.isFile()) return false;
        if (entry.size > STRANDED_WRITE_MAX_BYTES) return "unchecked";
        return carriesNonceMarker(readFileSync(path, "utf8")) && "carried";
      });
      if (nonce === "gone" || nonce === false) continue;
      found.push({ path, nonce: nonce === "unreadable" ? "unchecked" : nonce });
    }
  }
  return found;
}

/** A filesystem read, with a vanished path told apart from any other failure. */
function attempt<T>(read: () => T): T | "gone" | "unreadable" {
  try {
    return read();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unreadable";
  }
}

/**
 * Reads the dirty-start facts for one repository. Doctor's report and
 * calibration's refusal both take them from here, so where the sidecar lives
 * and how a layer is read cannot drift apart between the two. Each layer is
 * read once, so its digest and its marker describe the same bytes.
 */
export function readDirtyStartFacts(paths: {
  readonly home: string;
  readonly repoDir: string;
  readonly workDir: string;
}): DirtyStartFacts {
  const recoveryPath = join(paths.workDir, RECOVERY_FILE);
  const layers = CALIBRATION_LAYERS.map((layer) => {
    const path = layer.target(paths);
    const content = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    return {
      harness: layer.harness,
      path,
      currentSha256: content === undefined ? "absent" : sha256Text(content),
      hasNonceMarker: carriesNonceMarker(content),
    };
  });
  return {
    recoveryPending: existsSync(recoveryPath) && recoveryPath,
    layers,
    strandedWrites: strandedWrites(layers.map((layer) => layer.path)),
  };
}

/**
 * What an interrupted or refused calibration left for a person to finish: a
 * surviving recovery sidecar, a layer still carrying a nonce line, or a
 * nonce-bearing write stranded beside a layer. Doctor fails on each and
 * calibration refuses to start over any of them, both from this one list, so
 * the two cannot disagree about what a dirty start is.
 */
export function dirtyStart(facts: {
  /** The surviving sidecar's path, or false when none survives. */
  readonly recoveryPending: string | false;
  readonly layers: readonly { readonly path: string; readonly hasNonceMarker: boolean }[];
  readonly strandedWrites: readonly StrandedWrite[];
}): readonly string[] {
  const found: string[] = [];
  if (facts.recoveryPending !== false) {
    found.push(
      `an interrupted calibration left its recovery sidecar at ${facts.recoveryPending}; ` +
        "restore the layers from it by hand, then remove it",
    );
  }
  for (const layer of facts.layers) {
    if (layer.hasNonceMarker) {
      found.push(`${layer.path} still carries a calibration nonce; restore it by hand`);
    }
  }
  for (const { path, nonce } of facts.strandedWrites) {
    found.push(
      nonce === "carried"
        ? `${path} is a temp file carrying a calibration nonce line; remove it by hand`
        : `${path} could not be read to rule out a calibration nonce; check it by hand`,
    );
  }
  return found;
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
 * Clears a previous calibration's leavings out of `workDir` after staging
 * has ruled out a dirty start, and reports what it removed.
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
