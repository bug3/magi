/**
 * The properties MAGI's git invocations must have, asserted against a real
 * repository: no user config, no hooks, and failures that carry their reason.
 *
 * These are security properties, not conveniences. The evidence-pack builder
 * runs git over a tree an untrusted session wrote, where a hook or a filter
 * driver is simply code that tree got MAGI to execute.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { GitError, git, gitSucceeds, gitText, gitVersion } from "../../src/runtime/git.ts";

const IDENTITY = ["user.name=MAGI", "user.email=magi@example.invalid"];

/**
 * A sandbox may refuse the system temp directory; the worktree is then the only
 * writable place, so the fallback root is dot-prefixed and removed in `finally`.
 */
function makeRoot(): string {
  try {
    return mkdtempSync(join(tmpdir(), "magi-repo-"));
  } catch {
    return mkdtempSync(join(process.cwd(), ".magi-git-test-"));
  }
}

interface TempRepo {
  readonly root: string;
  write(relativePath: string, contents: string): void;
  cleanup(): void;
}

/**
 * A throwaway repository, built through the wrapper under test so the fixture
 * carries no ambient identity either: every commit names itself explicitly.
 */
async function tempRepo(files: Readonly<Record<string, string>> = {}): Promise<TempRepo> {
  const root = makeRoot();
  const repo: TempRepo = {
    root,
    write(relativePath, contents) {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  await gitText(["init", "-b", "main"], { cwd: root });
  const entries = Object.entries(files);
  for (const [path, contents] of entries) repo.write(path, contents);
  if (entries.length > 0) {
    await gitText(["add", "-A"], { cwd: root });
    await gitText(["commit", "--no-gpg-sign", "-m", "initial"], { cwd: root, config: IDENTITY });
  }
  return repo;
}

/** The smallest repository MAGI accepts: one commit, one file. */
async function tempRepoWithCommit(): Promise<TempRepo> {
  return await tempRepo({ "README.md": "# fixture\n" });
}

test("no ambient identity: git never signs MAGI's work as the user", async () => {
  const repo = await tempRepoWithCommit();
  try {
    assert.equal(
      await gitSucceeds(["var", "GIT_AUTHOR_IDENT"], { cwd: repo.root }),
      false,
      "the user's global config must not reach a MAGI invocation",
    );
    assert.equal(
      await gitSucceeds(["var", "GIT_AUTHOR_IDENT"], { cwd: repo.root, config: IDENTITY }),
      true,
      "an identity is passed explicitly, per call",
    );
  } finally {
    repo.cleanup();
  }
});

test("a hook the repository configures does not run", async () => {
  const repo = await tempRepo({ "README.md": "# fixture\n" });
  try {
    // The shape that matters: config inside the repository pointing at code
    // whoever wrote the tree controls.
    repo.write("hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    chmodSync(join(repo.root, "hooks", "pre-commit"), 0o755);
    await gitText(["config", "core.hooksPath", "hooks"], { cwd: repo.root });
    repo.write("file.txt", "content\n");

    const staged = await git(["add", "-A"], { cwd: repo.root });
    assert.equal(staged.outcome.kind === "exit" && staged.outcome.code, 0);

    const committed = await git(["commit", "--no-gpg-sign", "-m", "collected"], {
      cwd: repo.root,
      config: IDENTITY,
    });
    assert.equal(
      committed.outcome.kind === "exit" && committed.outcome.code,
      0,
      "the rejecting hook was never executed",
    );
  } finally {
    repo.cleanup();
  }
});

test("a failure carries git's own words, not a boolean", async () => {
  const repo = await tempRepoWithCommit();
  try {
    await assert.rejects(
      () => gitText(["rev-parse", "--verify", "no-such-ref"], { cwd: repo.root }),
      (error: unknown) =>
        error instanceof GitError &&
        error.argv.includes("no-such-ref") &&
        error.message.includes("exit"),
    );
  } finally {
    repo.cleanup();
  }
});

test("the git version is reported for the run manifest", async () => {
  const repo = await tempRepoWithCommit();
  try {
    assert.match((await gitVersion(repo.root)) ?? "", /^\d+\.\d+/u, "recorded with every run");
    assert.equal(await gitText(["rev-parse", "--is-inside-work-tree"], { cwd: repo.root }), "true");
  } finally {
    repo.cleanup();
  }
});
