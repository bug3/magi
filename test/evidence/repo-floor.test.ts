import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { planCheck } from "../../src/checks.ts";
import { repoFloor } from "../../src/evidence/repo-floor.ts";

function git(cwd: string, ...args: readonly string[]): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    env: { PATH: process.env["PATH"] as string, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  });
}

test("without a git repo or package.json the floor records notes, not sections", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-floor-"));
  const floor = await repoFloor(repo, process.env["PATH"] as string);
  assert.deepEqual(floor.sections, []);
  assert.equal(floor.notes.length, 2);
  assert.match(floor.notes.join(" "), /git/);
  assert.match(floor.notes.join(" "), /package\.json/);
});

test("the check command comes from package.json scripts, check before test", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-floor-"));
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { test: "node -e x", check: "node -e y" } }),
  );
  const floor = await repoFloor(repo, process.env["PATH"] as string);
  const check = floor.sections.find((section) => section.source === "check-output");
  assert.ok(check, "a check-output section exists");
  assert.match(check.text, /npm run check/);
});

test("a git repo's floor carries git facts, status, the file list and check output", async () => {
  const repo = mkdtempSync(join(tmpdir(), "magi-floor-"));
  writeFileSync(join(repo, "a.txt"), "tracked\n");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { check: "node -e 'console.log(1)'" } }),
  );
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "seed");
  writeFileSync(join(repo, "b.txt"), "untracked, the tree is dirty\n");

  const floor = await repoFloor(repo, process.env["PATH"] as string);
  assert.deepEqual(
    floor.sections.map((section) => section.source),
    ["git-facts", "git-status", "file-list", "check-output"],
  );
  assert.match(floor.sections[0]?.text ?? "", /HEAD [0-9a-f]{40}\ndirty: true/);
  assert.ok((floor.sections[2]?.text ?? "").includes("a.txt"), "ls-files lists the tracked file");
  assert.match(floor.sections[3]?.text ?? "", /\$ npm run check -> exit 0/);
  assert.ok((floor.sections[3]?.text ?? "").includes("\n1\n"), "the output rides along");
});

// The floor's command is named by package.json, so it never passes the seat
// vocabulary. Both shapes it can emit are exactly what a seat may not propose.
test("a seat could not propose the command the floor runs for itself", () => {
  assert.equal(planCheck("npm run check").kind, "refuse");
  assert.equal(planCheck("npm test").kind, "refuse");
});
