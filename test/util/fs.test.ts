import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ensureDir,
  fileExists,
  safeUnlink,
  sha256File,
  writeFileDurable,
} from "../../src/util/fs.ts";

// Digest of KNOWN_CONTENT, computed independently of the implementation so the
// assertion cannot agree with a broken hash by construction.
const KNOWN_CONTENT = "magi durable write\n";
const KNOWN_SHA256 = "60cb96e0c177fde18c44a8b5b13da4816d5cdd82850a06ed841ff0b3d9eaa27a";

/**
 * A sandbox may refuse the system temp directory; the worktree is then the only
 * writable place, so the fallback root is dot-prefixed and removed by the caller.
 */
function makeSandbox(): string {
  try {
    return mkdtempSync(join(tmpdir(), "magi-fs-"));
  } catch {
    return mkdtempSync(join(process.cwd(), ".magi-fs-test-"));
  }
}

function withSandbox(body: (root: string) => void | Promise<void>): Promise<void> | void {
  const root = makeSandbox();
  let settled = false;
  try {
    const result = body(root);
    if (result instanceof Promise) {
      settled = true;
      return result.finally(() => rmSync(root, { recursive: true, force: true }));
    }
    return undefined;
  } finally {
    if (!settled) rmSync(root, { recursive: true, force: true });
  }
}

function tempLeftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith(".tmp-"));
}

test("writeFileDurable writes exact content and reports its byte count", () =>
  withSandbox((root) => {
    const target = join(root, "manifest.json");
    const contents = '{"seal":"ok","unicode":"ölçüm"}';

    const result = writeFileDurable(target, contents);

    assert.equal(result.path, target);
    assert.equal(result.bytes, Buffer.from(contents, "utf8").length);
    assert.equal(readFileSync(target, "utf8"), contents);
  }));

test("writeFileDurable accepts bytes and leaves no temp file behind", () =>
  withSandbox((root) => {
    const target = join(root, "ledger.jsonl");
    const bytes = Buffer.from("{}\n{}\n", "utf8");

    const result = writeFileDurable(target, bytes);

    assert.equal(result.bytes, bytes.length);
    assert.deepEqual(tempLeftovers(root), []);
  }));

test("writeFileDurable creates the parent directory and asserts private modes", () =>
  withSandbox((root) => {
    const target = join(root, "runs", "r1", "manifest.json");

    writeFileDurable(target, KNOWN_CONTENT);

    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "runs", "r1")).mode & 0o777, 0o700);
  }));

test("writeFileDurable removes the temp file when the rename fails", () =>
  withSandbox((root) => {
    // A non-empty directory at the destination makes renameSync fail after the
    // temp file has already been written and fsynced.
    const target = join(root, "occupied");
    ensureDir(join(target, "child"));
    writeFileSync(join(target, "child", "keep"), "x");

    assert.throws(() => writeFileDurable(target, KNOWN_CONTENT));
    assert.deepEqual(tempLeftovers(root), []);
  }));

test("ensureDir creates nested directories and is repeatable", () =>
  withSandbox((root) => {
    const nested = join(root, "a", "b", "c");

    ensureDir(nested);
    ensureDir(nested);

    assert.ok(statSync(nested).isDirectory());
    assert.equal(statSync(nested).mode & 0o777, 0o700);
  }));

test("sha256File matches the known digest and byte count", () =>
  withSandbox(async (root) => {
    const target = join(root, "known.txt");
    writeFileDurable(target, KNOWN_CONTENT);

    const digest = await sha256File(target);

    assert.equal(digest.sha256, KNOWN_SHA256);
    assert.equal(digest.bytes, Buffer.from(KNOWN_CONTENT, "utf8").length);
  }));

test("fileExists reports presence and absence", () =>
  withSandbox((root) => {
    const target = join(root, "present.txt");
    assert.equal(fileExists(target), false);

    writeFileDurable(target, KNOWN_CONTENT);

    assert.equal(fileExists(target), true);
    assert.equal(fileExists(join(root, "missing", "deep.txt")), false);
  }));

test("safeUnlink removes a file and swallows a missing target", () =>
  withSandbox((root) => {
    const target = join(root, "doomed.txt");
    writeFileDurable(target, KNOWN_CONTENT);

    safeUnlink(target);
    assert.equal(fileExists(target), false);

    safeUnlink(target);
    safeUnlink(join(root, "never-existed.txt"));
    assert.equal(fileExists(target), false);
  }));
