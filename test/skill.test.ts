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
import { formatSkillLinks } from "../src/doctor.ts";
import {
  SKILL_ROOTS,
  SKILL_STATE_LABEL,
  installSkill,
  skillName,
  skillProblem,
  skillStatus,
  type SkillReport,
  type SkillState,
} from "../src/skill.ts";

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

/** A second installation of the same skill: what a magi that moved leaves. */
function otherCopy(prefix: string, name = "magi"): string {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n\nbody\n`);
  return dir;
}

test("an installation that moved is stale to the copy that replaces it", () => {
  const { home } = world();
  const previous = otherCopy("magi-moved-");
  // The link is made the only way that earns the claim: by installing it.
  assert.equal(installSkill("claude", home, previous).state, "linked");

  const { source } = world();
  const before = skillStatus("claude", home, source);
  assert.equal(before.state, "stale");
  assert.match(before.occupant ?? "", /magi-moved-/u);

  const report = installSkill("claude", home, source);
  assert.equal(report.state, "linked");
  assert.equal(readlinkSync(report.path), source);
  assert.ok(existsSync(join(previous, "SKILL.md")), "the copy it pointed at is left alone");
});

test("a link nobody here made is foreign, however much it looks like ours", () => {
  const { home, source } = world();
  // Same skill, same frontmatter name, placed by hand: a second clone, a fork,
  // or someone else's skill called magi. No claim stands beside it.
  const theirs = otherCopy("magi-theirs-clone-");
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  symlinkSync(theirs, join(home, ".claude", "skills", "magi"));

  const report = installSkill("claude", home, source);
  assert.equal(report.state, "foreign");
  assert.equal(readlinkSync(join(home, ".claude", "skills", "magi")), theirs);
});

test("a link an older version left unclaimed is adopted, not stranded", () => {
  const { home, source } = world();
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  symlinkSync(source, join(home, ".claude", "skills", "magi"));
  assert.equal(skillStatus("claude", home, source).state, "linked");

  // Installing over an already-linked path writes the claim it was missing.
  assert.equal(installSkill("claude", home, source).state, "linked");
  const moved = world();
  assert.equal(skillStatus("claude", moved.home, source).state, "absent");
  assert.equal(skillStatus("claude", home, moved.source).state, "stale");
});

test("a link to a skill of another name is foreign, not ours to repoint", () => {
  const { home, source } = world();
  const theirs = otherCopy("magi-theirs-", "council");
  mkdirSync(join(home, ".grok", "skills"), { recursive: true });
  symlinkSync(theirs, join(home, ".grok", "skills", "magi"));

  const report = installSkill("grok", home, source);
  assert.equal(report.state, "foreign");
  assert.equal(readlinkSync(join(home, ".grok", "skills", "magi")), theirs);
});

test("every state a report can hold has a label", () => {
  const states: readonly SkillState[] = ["linked", "absent", "dangling", "stale", "foreign"];
  for (const state of states) assert.equal(typeof SKILL_STATE_LABEL[state], "string");
});

test("only a link the tool can repair is a problem doctor offers to fix", () => {
  const broken: readonly SkillReport[] = [
    { harness: "claude", path: "/h/.claude/skills/magi", state: "stale", occupant: "a link to /old" },
    { harness: "codex", path: "/h/.codex/skills/magi", state: "absent" },
  ];
  const text = formatSkillLinks(broken);
  assert.match(text, /STALE/u);
  assert.match(text, /magi skill --install/u);
  assert.ok(broken.some(skillProblem));
});

test("a skill that is linked or simply absent reports no repair", () => {
  const fine: readonly SkillReport[] = [
    { harness: "claude", path: "/h/.claude/skills/magi", state: "linked" },
    { harness: "codex", path: "/h/.codex/skills/magi", state: "absent" },
  ];
  assert.doesNotMatch(formatSkillLinks(fine), /magi skill --install/u);
  assert.ok(!fine.some(skillProblem));
});
