/**
 * The properties a council depends on: citation ids that mean the same excerpt
 * for every seat, a pack hash that changes when the evidence changes, and a
 * builder that refuses rather than quietly shipping a thinner pack.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { gitText } from "../../src/runtime/git.ts";
import { gitFacts } from "../../src/evidence/git-facts.ts";
import { buildEvidencePack } from "../../src/evidence/pack.ts";

const IDENTITY = ["user.name=MAGI", "user.email=magi@example.invalid"];

/**
 * A sandbox may refuse the system temp directory; the worktree is then the only
 * writable place, so the fallback root is dot-prefixed and removed in `finally`.
 */
function makeRoot(): string {
  try {
    return mkdtempSync(join(tmpdir(), "magi-evidence-"));
  } catch {
    return mkdtempSync(join(process.cwd(), ".magi-evidence-test-"));
  }
}

function write(root: string, relativePath: string, contents: string): void {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

const NUMBERED = "one\ntwo\nthree\nfour\nfive\n";

function withRepo(body: (root: string) => void): void {
  const root = makeRoot();
  try {
    write(root, "CONVENTIONS.md", "# rules\n\n```\nfenced\n```\n");
    write(root, "src/lib.ts", NUMBERED);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function withGitRepo(body: (root: string) => Promise<void>): Promise<void> {
  const root = makeRoot();
  try {
    await gitText(["init", "-b", "main"], { cwd: root });
    write(root, "README.md", "# fixture\n");
    await gitText(["add", "-A"], { cwd: root });
    await gitText(["commit", "--no-gpg-sign", "-m", "initial"], { cwd: root, config: IDENTITY });
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ids run E1..En in declaration order, conventions first", () => {
  withRepo((root) => {
    const pack = buildEvidencePack({
      repoDir: root,
      conventions: ["CONVENTIONS.md"],
      excerpts: [{ path: "src/lib.ts", startLine: 2, endLine: 3 }],
      patch: "diff --git a/x b/x\n",
      testOutput: "ok 1 - fine\n",
    });

    assert.deepEqual(
      pack.index.map((entry) => [entry.id, entry.path]),
      [
        ["E1", "CONVENTIONS.md"],
        ["E2", "src/lib.ts"],
        ["E3", "patch"],
        ["E4", "test-output"],
      ],
    );
    // The markdown must carry the same order, since that is what a seat reads.
    assert.deepEqual(
      [...pack.markdown.matchAll(/^## (E\d+) /gmu)].map((match) => match[1]),
      ["E1", "E2", "E3", "E4"],
    );
  });
});

test("floor sections render after conventions and before excerpts", () => {
  withRepo((root) => {
    const pack = buildEvidencePack({
      repoDir: root,
      conventions: ["CONVENTIONS.md"],
      floor: [{ source: "git-facts", text: "HEAD abc\ndirty: false\n" }],
      excerpts: [{ path: "src/lib.ts" }],
    });
    assert.deepEqual(
      pack.index.map((entry) => entry.path),
      ["CONVENTIONS.md", "git-facts", "src/lib.ts"],
    );
  });
});

test("a whole-file excerpt is the whole file and a window is exactly its lines", () => {
  withRepo((root) => {
    const pack = buildEvidencePack({
      repoDir: root,
      conventions: [],
      excerpts: [{ path: "src/lib.ts" }, { path: "src/lib.ts", startLine: 2, endLine: 4 }],
    });

    assert.deepEqual(pack.index[0], {
      ...pack.index[0],
      startLine: 1,
      endLine: 5,
    });
    assert.ok(pack.markdown.includes("## E1 src/lib.ts:1-5"));
    assert.ok(pack.markdown.includes("## E2 src/lib.ts:2-4"));
    assert.ok(pack.markdown.includes("````\ntwo\nthree\nfour\n````"));
    assert.equal(pack.markdown.includes("````\ntwo\nthree\nfour\nfive\n````"), false);
  });
});

test("a note and the four-backtick fence survive fenced content", () => {
  withRepo((root) => {
    const pack = buildEvidencePack({
      repoDir: root,
      conventions: ["CONVENTIONS.md"],
      excerpts: [],
    });
    // A convention file containing its own ``` fence must not close the block.
    assert.ok(pack.markdown.includes("````\n# rules\n\n```\nfenced\n```\n````"));
  });
});

test("identical inputs hash identically and any change moves the pack hash", () => {
  withRepo((root) => {
    const inputs = {
      repoDir: root,
      conventions: ["CONVENTIONS.md"],
      excerpts: [{ path: "src/lib.ts", startLine: 1, endLine: 5 }],
    };
    const first = buildEvidencePack(inputs);
    const second = buildEvidencePack(inputs);
    assert.equal(first.packSha256, second.packSha256);
    assert.equal(first.markdown, second.markdown);
    assert.match(first.packSha256, /^[0-9a-f]{64}$/u);

    write(root, "src/lib.ts", NUMBERED.replace("three", "THREE"));
    const changed = buildEvidencePack(inputs);
    assert.notEqual(changed.packSha256, first.packSha256);
    assert.notEqual(changed.index[1]?.sha256, first.index[1]?.sha256);
    assert.equal(changed.index[0]?.sha256, first.index[0]?.sha256);
  });
});

test("a missing file throws naming the path", () => {
  withRepo((root) => {
    assert.throws(
      () =>
        buildEvidencePack({
          repoDir: root,
          conventions: [],
          excerpts: [{ path: "src/absent.ts" }],
        }),
      /src\/absent\.ts/u,
    );
  });
});

test("an out-of-range window throws naming the path", () => {
  withRepo((root) => {
    assert.throws(
      () =>
        buildEvidencePack({
          repoDir: root,
          conventions: [],
          excerpts: [{ path: "src/lib.ts", startLine: 4, endLine: 99 }],
        }),
      /src\/lib\.ts/u,
    );
    assert.throws(
      () =>
        buildEvidencePack({
          repoDir: root,
          conventions: [],
          excerpts: [{ path: "src/lib.ts", startLine: 0, endLine: 2 }],
        }),
      /src\/lib\.ts/u,
    );
  });
});

test("patch and test-output sections appear only when given", () => {
  withRepo((root) => {
    const bare = buildEvidencePack({
      repoDir: root,
      conventions: [],
      excerpts: [{ path: "src/lib.ts" }],
    });
    assert.equal(bare.index.length, 1);
    assert.equal(bare.markdown.includes("patch"), false);
    assert.equal(bare.markdown.includes("test-output"), false);

    const withPatch = buildEvidencePack({
      repoDir: root,
      conventions: [],
      excerpts: [{ path: "src/lib.ts" }],
      patch: "diff --git a/x b/x\n",
    });
    assert.deepEqual(
      withPatch.index.map((entry) => entry.path),
      ["src/lib.ts", "patch"],
    );
    assert.ok(withPatch.markdown.includes("diff --git a/x b/x"));
    assert.equal(withPatch.markdown.includes("test-output"), false);
  });
});

test("gitFacts reports HEAD and a clean tree, then the same HEAD when dirty", async () => {
  await withGitRepo(async (root) => {
    const expectedHead = await gitText(["rev-parse", "HEAD"], { cwd: root });
    const clean = await gitFacts(root);
    assert.equal(clean.headSha, expectedHead);
    assert.match(clean.headSha, /^[0-9a-f]{40}$/u);
    assert.equal(clean.dirty, false);

    write(root, "README.md", "# fixture edited\n");
    const dirty = await gitFacts(root);
    assert.equal(dirty.headSha, expectedHead);
    assert.equal(dirty.dirty, true);
  });
});
