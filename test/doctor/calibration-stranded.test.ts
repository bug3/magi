import assert from "node:assert/strict";
import fs, {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { mock, test } from "node:test";

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
function modeBites(read: () => unknown): boolean {
  try {
    read();
    return false;
  } catch {
    return true;
  }
}

function told(facts: ReturnType<typeof scan>): string {
  return dirtyStart({ recoveryPending: false, layers: [], strandedWrites: facts }).join("\n");
}

test("a temp file that cannot be read is reported as unreadable, not as clean", (t) => {
  const space = workspace();
  const locked = join(space.repo, ".tmp-locked");
  writeFileSync(locked, "unknown\n");
  chmodSync(locked, 0o000);
  try {
    if (!modeBites(() => readFileSync(locked))) return t.skip("the mode does not stop this user");
    const facts = scan(space);
    assert.deepEqual(facts, [{ path: locked, nonce: "unreadable" }]);
    assert.match(told(facts), /could not be read .* by hand/u);
  } finally {
    chmodSync(locked, 0o600);
    space.remove();
  }
});

test("a layer directory that cannot be listed is reported as unreadable, not as clean", (t) => {
  const space = workspace();
  const rules = join(space.home, ".grok", "rules");
  mkdirSync(rules, { recursive: true });
  chmodSync(rules, 0o000);
  try {
    if (!modeBites(() => readdirSync(rules))) return t.skip("the mode does not stop this user");
    assert.deepEqual(scan(space), [{ path: rules, nonce: "unreadable" }]);
  } finally {
    chmodSync(rules, 0o700);
    space.remove();
  }
});

test("a layer directory that is a file holds no temp file and is not reported", () => {
  const space = workspace();
  try {
    writeFileSync(join(space.home, ".grok"), "not a directory\n");
    assert.deepEqual(scan(space), []);
  } finally {
    space.remove();
  }
});

test("a readable temp file over the limit is reported as oversized, not as unreadable", () => {
  const space = workspace();
  try {
    const large = join(space.repo, ".tmp-large");
    writeFileSync(large, Buffer.alloc(STRANDED_WRITE_MAX_BYTES + 1, 0x61));
    const facts = scan(space);
    assert.deepEqual(facts, [{ path: large, nonce: "oversized" }]);
    assert.match(told(facts), /is a temp file over 4 MiB, too large to check .* by hand/u);
    assert.doesNotMatch(told(facts), /could not be read/u);
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

// A linked layer is written at its target, so its temp file lands beside the
// target, which may be nowhere near the layer: a dotfiles checkout, say.
test("a temp file stranded beside a linked layer's target is found", () => {
  const space = workspace();
  try {
    const dotfiles = join(space.home, "dotfiles");
    mkdirSync(dotfiles);
    mkdirSync(join(space.home, ".claude"));
    writeFileSync(join(dotfiles, "CLAUDE.md"), "# owner rules\n");
    symlinkSync(join(dotfiles, "CLAUDE.md"), join(space.home, ".claude", "CLAUDE.md"));
    const residue = `# owner rules\n${NONCE_MARKER} magi-canary-residue\n`;
    writeFileSync(join(dotfiles, ".tmp-1-a-b"), residue);
    // Found where the write lands: the target's real directory.
    const stranded = join(realpathSync(dotfiles), ".tmp-1-a-b");
    assert.deepEqual(scan(space), [{ path: stranded, nonce: "carried" }]);
  } finally {
    space.remove();
  }
});

/**
 * Runs `read` with every link resolution failing as `code`, the way it fails
 * when a target goes between the look and the resolve.
 */
function withResolveFailing<T>(code: string, read: () => T): T {
  const failing = mock.method(fs, "realpathSync", () => {
    throw Object.assign(new Error(`${code}: mocked`), { code });
  });
  syncBuiltinESMExports();
  try {
    return read();
  } finally {
    failing.mock.restore();
    syncBuiltinESMExports();
  }
}

// A layer is looked at before its link is resolved, and its target can go in
// between. That may cost the scan the target's directory, never the doctor.
test("a layer whose target went before it was resolved is still scanned beside itself", () => {
  const space = workspace();
  try {
    mkdirSync(join(space.home, ".claude"));
    writeFileSync(join(space.home, ".claude", "CLAUDE.md"), "# owner rules\n");
    const stranded = join(space.home, ".claude", ".tmp-1-a-b");
    writeFileSync(stranded, `${NONCE_MARKER} magi-canary-residue\n`);
    assert.deepEqual(withResolveFailing("ENOENT", () => scan(space)), [
      { path: stranded, nonce: "carried" },
    ]);
  } finally {
    space.remove();
  }
});

test("a layer whose target cannot be resolved is reported as unreadable, not as clean", () => {
  const space = workspace();
  try {
    const layer = join(space.home, ".claude", "CLAUDE.md");
    mkdirSync(join(space.home, ".claude"));
    writeFileSync(layer, "# owner rules\n");
    assert.deepEqual(withResolveFailing("EACCES", () => scan(space)), [
      { path: layer, nonce: "unreadable" },
    ]);
  } finally {
    space.remove();
  }
});

// The layer's own directory and the directory its write lands in can be one
// directory under two names, through a linked parent or a linked temp root.
test("a temp file in one directory reached under two names is reported once", () => {
  const space = workspace();
  try {
    const real = join(space.home, "claude-config");
    mkdirSync(real);
    symlinkSync(real, join(space.home, ".claude"));
    writeFileSync(join(real, "CLAUDE.md"), "# owner rules\n");
    writeFileSync(join(real, ".tmp-1-a-b"), `${NONCE_MARKER} magi-canary-residue\n`);
    const stranded = join(space.home, ".claude", ".tmp-1-a-b");
    assert.deepEqual(scan(space), [{ path: stranded, nonce: "carried" }]);
  } finally {
    space.remove();
  }
});
