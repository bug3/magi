/**
 * Filesystem primitives with the durability guarantees the persistence model
 * depends on. `manifest.json` and `ledger.jsonl` are read back as statements of
 * fact, so a half-written file must never be mistaken for a complete one.
 *
 * Every write that must survive a crash goes through {@link writeFileDurable}:
 * temp file on the destination filesystem, fsync the file, atomic rename, fsync
 * the parent directory. A reader then sees either the previous bytes or the
 * whole new ones, never a prefix.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function ensureDir(path: string, mode = 0o700): void {
  mkdirSync(path, { recursive: true, mode });
  // mkdir honours the umask, so the mode is asserted explicitly: transcripts
  // and mappings must never be group- or world-readable.
  chmodSync(path, mode);
}

/**
 * fsync a path by descriptor. Used both on a directory, to seal a rename, and
 * on a file another process wrote, before its bytes are treated as final.
 */
export function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface DurableWriteResult {
  readonly path: string;
  readonly bytes: number;
}

/**
 * What every temp file {@link writeFileDurable} creates is named with. A kill
 * between its open and its rename leaves one behind, beside the destination.
 */
export const DURABLE_TEMP_PREFIX = ".tmp-";

/**
 * Where a `"keep"` write of `path` lands, and so where its temp file is made:
 * through an existing link to its target, otherwise the path itself.
 */
export function foreignDestination(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

/**
 * Writes `contents` to `path` durably and atomically. The temp file is created
 * in the destination directory so the rename never crosses a filesystem.
 *
 * A numeric `mode` is for MAGI's own state: the directory is asserted private
 * and the file gets exactly that mode. `"keep"` is for a file MAGI does not
 * own, such as a harness's config layer. The write goes through an existing
 * link to its target, so the owner's link survives; an existing directory is
 * left at its mode and a missing one is made under the umask; the file keeps
 * the mode it had, or is made under the umask like any new file.
 */
export function writeFileDurable(
  path: string,
  contents: string | Uint8Array,
  mode: number | "keep" = 0o600,
): DurableWriteResult {
  const destination = mode === "keep" ? foreignDestination(path) : path;
  const dir = dirname(destination);
  if (mode === "keep") mkdirSync(dir, { recursive: true });
  else ensureDir(dir, 0o700);
  // Undefined for a new file MAGI does not own: the umask decides, as it would
  // for any tool, and nothing re-modes the result.
  const fileMode = mode === "keep" ? existingMode(destination) : mode;
  const data = typeof contents === "string" ? Buffer.from(contents, "utf8") : Buffer.from(contents);
  const temp = join(
    dir,
    `${DURABLE_TEMP_PREFIX}${process.pid}-${Date.now().toString(36)}-` +
      Math.random().toString(36).slice(2, 8),
  );

  const fd = openSync(temp, "wx", fileMode ?? 0o666);
  try {
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    safeUnlink(temp);
    throw error;
  }
  closeSync(fd);

  try {
    if (fileMode !== undefined) chmodSync(temp, fileMode);
    renameSync(temp, destination);
  } catch (error) {
    safeUnlink(temp);
    throw error;
  }
  fsyncPath(dir);
  return { path, bytes: data.length };
}

/** The permission bits of an existing file, or undefined when there is none. */
function existingMode(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o7777;
  } catch {
    return undefined;
  }
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return { sha256: hash.digest("hex"), bytes };
}

export function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best effort: the caller is already handling a failure.
  }
}
