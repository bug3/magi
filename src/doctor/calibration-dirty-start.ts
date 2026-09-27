/**
 * What an interrupted calibration can leave behind, read off disk, and the
 * one list of states that makes a start dirty. Doctor fails on that list and
 * calibration refuses to start over it, so both take it from here.
 */

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { Harness } from "../core/slots.ts";
import { DURABLE_TEMP_PREFIX, sha256Text } from "../util/fs.ts";
import { CALIBRATION_LAYERS, NONCE_MARKER, RECOVERY_FILE } from "./calibration-layers.ts";

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
  /**
   * "unreadable": the file could not be read, or `path` is a layer directory
   * that could not be listed. "oversized": the file is over the limit and was
   * not read. Neither is known to be clean.
   */
  readonly nonce: "carried" | "unreadable" | "oversized";
}

/**
 * The largest temp file read. A calibration write is one layer image plus one
 * line; a larger file is reported oversized rather than read.
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
 * leftovers. An entry that vanished, or became a link, is skipped; one that
 * cannot be read is reported, because an unread file is not a clean one.
 */
function strandedWrites(layerPaths: readonly string[]): readonly StrandedWrite[] {
  const found: StrandedWrite[] = [];
  for (const dir of new Set(layerPaths.map((path) => dirname(path)))) {
    const names = attempt(() => readdirSync(dir));
    if (names === "skip") continue;
    if (names === "unreadable") {
      found.push({ path: dir, nonce: "unreadable" });
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(DURABLE_TEMP_PREFIX)) continue;
      const path = join(dir, name);
      const nonce = attempt(() => lstatSync(path).isFile() && readTemp(path));
      if (nonce === "skip" || nonce === false) continue;
      found.push({ path, nonce });
    }
  }
  return found;
}

/**
 * Reads one temp file the lstat above found regular. The entry can change
 * between that look and this open, so the open refuses a link and never
 * waits on a FIFO, the type and size are checked again on the descriptor,
 * and at most one byte past the limit is read, however much it has grown.
 */
function readTemp(path: string): "carried" | "oversized" | false {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const entry = fstatSync(fd);
    if (!entry.isFile()) return false;
    if (entry.size > STRANDED_WRITE_MAX_BYTES) return "oversized";
    const buffer = Buffer.alloc(entry.size + 1);
    let length = 0;
    for (let read = 1; read > 0 && length < buffer.length; length += read) {
      read = readSync(fd, buffer, length, buffer.length - length, null);
    }
    if (length > STRANDED_WRITE_MAX_BYTES) return "oversized";
    return carriesNonceMarker(buffer.toString("utf8", 0, length)) && "carried";
  } finally {
    closeSync(fd);
  }
}

/**
 * The failures that say there is nothing here to check: the path is gone, a
 * component of it is not a directory, or it became a link after the lstat.
 */
const NOTHING_TO_CHECK = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);

/** A filesystem read, with nothing to check told apart from any other failure. */
function attempt<T>(read: () => T): T | "skip" | "unreadable" {
  try {
    return read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return NOTHING_TO_CHECK.has(code) ? "skip" : "unreadable";
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

/** What a person is told about each kind of temp file, by what was found. */
const STRANDED_MESSAGES: Readonly<Record<StrandedWrite["nonce"], (path: string) => string>> = {
  carried: (path) => `${path} is a temp file carrying a calibration nonce line; remove it by hand`,
  unreadable: (path) =>
    `${path} could not be read to rule out a calibration nonce; check it by hand`,
  oversized: (path) =>
    `${path} is a temp file over ${STRANDED_WRITE_MAX_BYTES / 1024 / 1024} MiB, too large to ` +
    "check for a calibration nonce; check it by hand",
};

/**
 * What an interrupted or refused calibration left for a person to finish: a
 * surviving recovery sidecar, a layer still carrying a nonce line, or a temp
 * file beside one that carries a nonce or could not be checked for one,
 * because it or its directory could not be read or it is over the size
 * limit. Doctor fails on each and calibration refuses to start over any of
 * them, both from this one list, so the two cannot disagree about what a
 * dirty start is.
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
    found.push(STRANDED_MESSAGES[nonce](path));
  }
  return found;
}
