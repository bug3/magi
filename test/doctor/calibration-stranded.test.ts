import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  STRANDED_WRITE_MAX_BYTES,
  dirtyStart,
  readDirtyStartFacts,
} from "../../src/doctor/calibration-dirty-start.ts";
import { NONCE_MARKER } from "../../src/doctor/calibration-layers.ts";
import { workspace } from "../support/cli.ts";

// The scan runs on every `magi doctor`, over the repository root, ~/.claude
// and ~/.grok/rules. Whatever else lives there must neither crash it nor be
// read as clean when it could not be read at all.

function scan(space: ReturnType<typeof workspace>) {
  return readDirtyStartFacts({
    home: space.home,
    repoDir: space.repo,
    workDir: join(space.repo, ".magi", "doctor"),
  }).strandedWrites;
}

test("links and directories named like a temp file are neither followed nor read", () => {
  const space = workspace();
  try {
    const target = join(space.home, "elsewhere.md");
    writeFileSync(target, `${NONCE_MARKER} magi-canary-residue\n`);
    symlinkSync(join(space.home, "missing"), join(space.repo, ".tmp-dangling"));
    symlinkSync(target, join(space.repo, ".tmp-link"));
    mkdirSync(join(space.repo, ".tmp-dir"));
    assert.deepEqual(scan(space), []);
  } finally {
    space.remove();
  }
});

/** Whether the mode actually stops this process, which it does not for root. */
function modeBites(path: string): boolean {
  try {
    readdirOrRead(path);
    return false;
  } catch {
    return true;
  }
}

function readdirOrRead(path: string): void {
  if (statSync(path).isDirectory()) readdirSync(path);
  else readFileSync(path);
}

test("a temp file that cannot be read is reported as unchecked, not as clean", (t) => {
  const space = workspace();
  const locked = join(space.repo, ".tmp-locked");
  writeFileSync(locked, "unknown\n");
  chmodSync(locked, 0o000);
  try {
    if (!modeBites(locked)) return t.skip("the mode does not stop this user");
    const facts = scan(space);
    assert.deepEqual(facts, [{ path: locked, nonce: "unchecked" }]);
    assert.match(
      dirtyStart({ recoveryPending: false, layers: [], strandedWrites: facts })[0] ?? "",
      /could not be read .* by hand/u,
    );
  } finally {
    chmodSync(locked, 0o600);
    space.remove();
  }
});

test("a layer directory that cannot be listed is reported as unchecked, not as clean", (t) => {
  const space = workspace();
  const rules = join(space.home, ".grok", "rules");
  mkdirSync(rules, { recursive: true });
  chmodSync(rules, 0o000);
  try {
    if (!modeBites(rules)) return t.skip("the mode does not stop this user");
    assert.deepEqual(scan(space), [{ path: rules, nonce: "unchecked" }]);
  } finally {
    chmodSync(rules, 0o700);
    space.remove();
  }
});

test("a temp file too large to be a calibration write is reported as unchecked", () => {
  const space = workspace();
  try {
    const large = join(space.repo, ".tmp-large");
    writeFileSync(large, Buffer.alloc(STRANDED_WRITE_MAX_BYTES + 1, 0x61));
    assert.deepEqual(scan(space), [{ path: large, nonce: "unchecked" }]);
  } finally {
    space.remove();
  }
});

test("a nonce-bearing temp file is reported by what it holds, not by where it came from", () => {
  const space = workspace();
  try {
    const stranded = join(space.repo, ".tmp-1-a-b");
    writeFileSync(stranded, `# rules\n${NONCE_MARKER} magi-canary-residue\n`);
    const facts = scan(space);
    assert.deepEqual(facts, [{ path: stranded, nonce: "carried" }]);
    assert.deepEqual(dirtyStart({ recoveryPending: false, layers: [], strandedWrites: facts }), [
      `${stranded} is a temp file carrying a calibration nonce line; remove it by hand`,
    ]);
  } finally {
    space.remove();
  }
});
