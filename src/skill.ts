/**
 * Where an orchestrating assistant finds this skill, and whether it is there.
 *
 * All three harnesses discover a skill the same way: a directory named after
 * the skill under their own config root, holding `SKILL.md`. MAGI links the
 * clone rather than copying it, so an installed skill cannot drift from the
 * source. A link is only as stable as the path it points into, so an
 * installation that moves leaves one behind: a link whose target is gone is
 * dangling, one that resolves to another copy of this same skill is stale,
 * and installing replaces either. Anything else at the path was put there by
 * someone else and is reported, never replaced.
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

export type SkillState = "linked" | "absent" | "dangling" | "stale" | "foreign";

/** One label per state; the upper-case ones are what a report fails on. */
export const SKILL_STATE_LABEL: Readonly<Record<SkillState, string>> = {
  linked: "linked",
  absent: "absent",
  dangling: "DANGLING",
  stale: "STALE",
  foreign: "FOREIGN",
};

/** The states installing replaces: this skill's link, just not this copy's. */
const REPAIRABLE: ReadonlySet<SkillState> = new Set<SkillState>(["dangling", "stale"]);

export interface SkillReport {
  readonly harness: Harness;
  /** Where this harness would find the skill. */
  readonly path: string;
  readonly state: SkillState;
  /** What holds the path when this installation's link does not. */
  readonly occupant?: string;
}

/** Whether the path holds something other than this installation's skill. */
export function skillProblem(report: SkillReport): boolean {
  return report.state !== "linked" && report.state !== "absent";
}

/** Whether installing would put this copy's link at the path. */
export function skillRepairable(report: SkillReport): boolean {
  return REPAIRABLE.has(report.state);
}

export function skillStatus(harness: Harness, home: string, source: string): SkillReport {
  const name = skillName(source);
  const path = join(SKILL_ROOTS[harness](home), name);
  let link;
  try {
    link = lstatSync(path);
  } catch {
    return { harness, path, state: "absent" };
  }
  if (!link.isSymbolicLink()) {
    return {
      harness,
      path,
      state: "foreign",
      occupant: link.isDirectory() ? "a directory" : "a file",
    };
  }
  // existsSync follows the link, so a live target is what separates the two.
  if (!existsSync(path)) return { harness, path, state: "dangling" };
  if (realpathSync(path) !== realpathSync(source)) {
    // Another copy of this same skill is a magi that moved, and installing
    // repoints it; a link into anything else is not ours to touch.
    const state: SkillState = holdsSkill(path, name) ? "stale" : "foreign";
    return { harness, path, state, occupant: `a link to ${readlinkSync(path)}` };
  }
  return { harness, path, state: "linked" };
}

/**
 * Links the skill into one harness and reports what stands afterwards.
 * Already linked is success. A dangling link holds nothing and a stale one
 * holds another copy of this same skill, so both are replaced; a real file,
 * directory or foreign link belongs to someone else and is left exactly as
 * it was.
 */
export function installSkill(harness: Harness, home: string, source: string): SkillReport {
  const before = skillStatus(harness, home, source);
  if (before.state === "linked" || before.state === "foreign") return before;
  if (skillRepairable(before)) rmSync(before.path);
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

/**
 * Whether a directory holds this same skill, read through whatever links to
 * it: what separates a magi that moved from a link into something else.
 */
function holdsSkill(dir: string, name: string): boolean {
  try {
    return skillName(dir) === name;
  } catch {
    return false;
  }
}
