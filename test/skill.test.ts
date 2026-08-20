import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SLOTS } from "../src/core/slots.ts";
import { SKILL_ROOTS, installSkill, skillName, skillStatus } from "../src/skill.ts";

/** A clone-shaped source: the directory a harness would link to. */
function world(): { home: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "magi-skill-"));
  const source = join(root, "skills", "magi");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: magi\ndescription: x\n---\n\nbody\n");
  const home = join(root, "home");
  mkdirSync(home);
  return { home, source };
}

test("every council harness has a place the skill can be installed", () => {
  for (const { harness } of SLOTS) {
    assert.equal(typeof SKILL_ROOTS[harness]("/h"), "string");
  }
});

test("the install directory is named by the skill's own frontmatter", () => {
  const { source } = world();
  assert.equal(skillName(source), "magi");
  writeFileSync(join(source, "SKILL.md"), "---\nname: council\n---\n");
  assert.equal(skillName(source), "council");
});

test("installing links the clone into the harness, and doing it twice is the same", () => {
  const { home, source } = world();
  assert.equal(skillStatus("claude", home, source).state, "absent");

  const first = installSkill("claude", home, source);
  assert.equal(first.state, "linked");
  assert.equal(first.path, join(home, ".claude", "skills", "magi"));
  assert.equal(readlinkSync(first.path), source);
  assert.equal(installSkill("claude", home, source).state, "linked");
});

test("each harness gets its own path and neither install touches the others", () => {
  const { home, source } = world();
  installSkill("codex", home, source);
  assert.equal(skillStatus("codex", home, source).state, "linked");
  assert.equal(skillStatus("claude", home, source).state, "absent");
  assert.equal(skillStatus("grok", home, source).state, "absent");
});

test("a directory this command did not create is reported, never replaced", () => {
  const { home, source } = world();
  const occupied = join(home, ".grok", "skills", "magi");
  mkdirSync(occupied, { recursive: true });
  writeFileSync(join(occupied, "SKILL.md"), "someone else's skill\n");

  const report = installSkill("grok", home, source);
  assert.equal(report.state, "foreign");
  assert.equal(report.occupant, "a directory");
  assert.equal(readFileSync(join(occupied, "SKILL.md"), "utf8"), "someone else's skill\n");
});

test("a link pointing somewhere else is foreign, and its target is named", () => {
  const { home, source } = world();
  const elsewhere = mkdtempSync(join(tmpdir(), "magi-other-"));
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  symlinkSync(elsewhere, join(home, ".claude", "skills", "magi"));

  const report = installSkill("claude", home, source);
  assert.equal(report.state, "foreign");
  assert.match(report.occupant ?? "", /magi-other-/u);
  assert.equal(readlinkSync(join(home, ".claude", "skills", "magi")), elsewhere);
});

test("a link whose target is gone holds nothing, so installing repairs it", () => {
  const { home, source } = world();
  const moved = mkdtempSync(join(tmpdir(), "magi-moved-"));
  mkdirSync(join(home, ".codex", "skills"), { recursive: true });
  symlinkSync(moved, join(home, ".codex", "skills", "magi"));
  rmSync(moved, { recursive: true, force: true });

  assert.equal(skillStatus("codex", home, source).state, "dangling");
  const report = installSkill("codex", home, source);
  assert.equal(report.state, "linked");
  assert.ok(existsSync(join(report.path, "SKILL.md")), "the link resolves to the clone's skill");
});
