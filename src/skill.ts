/**
 * Where an orchestrating assistant finds this skill, and whether it is there.
 *
 * All three harnesses discover a skill the same way: a directory named after
 * the skill under their own config root, holding `SKILL.md`. MAGI links the
 * clone rather than copying it, so an installed skill cannot drift from the
 * source, and it refuses to replace anything it did not create.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { Harness } from "./core/slots.ts";

/** Per harness, the directory it discovers skills in. */
export const SKILL_ROOTS: Readonly<Record<Harness, (home: string) => string>> = {
  claude: (home) => join(home, ".claude", "skills"),
  codex: (home) => join(home, ".codex", "skills"),
  grok: (home) => join(home, ".grok", "skills"),
};

export type SkillState = "linked" | "absent" | "dangling" | "foreign";

export interface SkillReport {
  readonly harness: Harness;
  /** Where this harness would find the skill. */
  readonly path: string;
  readonly state: SkillState;
  /** What holds the path when nothing of ours does. */
  readonly occupant?: string;
}

export function skillStatus(harness: Harness, home: string, source: string): SkillReport {
  const path = join(SKILL_ROOTS[harness](home), skillName(source));
  let link;
  try {
    link = lstatSync(path);
  } catch {
    return { harness, path, state: "absent" };
  }
  if (!link.isSymbolicLink()) {
    return { harness, path, state: "foreign", occupant: link.isDirectory() ? "a directory" : "a file" };
  }
  // existsSync follows the link, so a live target is what separates the two.
  if (!existsSync(path)) return { harness, path, state: "dangling" };
  if (realpathSync(path) !== realpathSync(source)) {
    return { harness, path, state: "foreign", occupant: `a link to ${readlinkSync(path)}` };
  }
  return { harness, path, state: "linked" };
}

/**
 * Links the skill into one harness and reports what stands afterwards.
 * Already linked is success. A dangling link holds nothing and is replaced; a
 * real file, directory or foreign link belongs to someone else and is left
 * exactly as it was.
 */
export function installSkill(harness: Harness, home: string, source: string): SkillReport {
  const before = skillStatus(harness, home, source);
  if (before.state === "linked" || before.state === "foreign") return before;
  if (before.state === "dangling") rmSync(before.path);
  mkdirSync(dirname(before.path), { recursive: true });
  symlinkSync(source, before.path);
  return skillStatus(harness, home, source);
}

/**
 * The skill's own name, read from its frontmatter: the directory name every
 * harness discovers it by. One source of truth, so a rename cannot half-land.
 */
export function skillName(source: string): string {
  const file = join(source, "SKILL.md");
  const name = /^name:[ \t]*(\S+)[ \t]*$/mu.exec(readFileSync(file, "utf8"))?.[1];
  if (name === undefined) throw new Error(`no name in the frontmatter of ${file}`);
  return name;
}
