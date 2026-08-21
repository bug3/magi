/**
 * Where an orchestrating assistant finds this skill, and whether it is there.
 *
 * All three harnesses discover a skill the same way: a directory named after
 * the skill under their own config root, holding `SKILL.md`. MAGI links the
 * clone rather than copying it, so an installed skill cannot drift from the
 * source. A link is only as stable as the path it points into, so an
 * installation that moves leaves one behind. A link whose target is gone is
 * dangling and holds nothing, so installing replaces it. A live link is a
 * different matter: replacing one destroys a working pointer, so only a link
 * this tool can prove it made is repointed, and the proof is a marker written
 * beside the link at install time naming the source it claims. Everything
 * else at the path belongs to someone else and is reported, never replaced.
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
import { writeFileDurable } from "./util/fs.ts";

/**
 * What this tool leaves beside a link it created, naming the source that link
 * points at. Identity cannot rest on the skill's own name: a second clone, a
 * fork, or anyone else's skill called `magi` wears the same one, and a link a
 * user placed deliberately is not this tool's to move.
 */
export const LINK_MARKER = ".magi-link.json";

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
  const root = SKILL_ROOTS[harness](home);
  const path = join(root, name);
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
  const target = readlinkSync(path);
  if (realpathSync(path) !== realpathSync(source)) {
    // A link this tool made and can still prove it made is a magi that moved,
    // and installing repoints it. Anything else is not ours to touch, however
    // much it looks like ours.
    const claimed = readMarker(root);
    const ours = claimed?.skill === name && claimed.source === target;
    return {
      harness,
      path,
      state: ours ? "stale" : "foreign",
      occupant: `a link to ${target}`,
    };
  }
  return { harness, path, state: "linked" };
}

/**
 * Links the skill into one harness and reports what stands afterwards.
 * A dangling link holds nothing and a stale one is this tool's own, so both
 * are replaced; a real file, directory or foreign link belongs to someone
 * else and is left exactly as it was.
 *
 * The marker is written on every run that leaves our link standing, already
 * linked included, so a link an older version left unclaimed is adopted here
 * rather than reading as a stranger's the next time this installation moves.
 */
export function installSkill(harness: Harness, home: string, source: string): SkillReport {
  const before = skillStatus(harness, home, source);
  if (before.state === "foreign") return before;
  if (before.state !== "linked") {
    if (skillRepairable(before)) rmSync(before.path);
    mkdirSync(dirname(before.path), { recursive: true });
    symlinkSync(source, before.path);
  }
  writeMarker(dirname(before.path), skillName(source), source);
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

interface LinkClaim {
  readonly skill: string;
  readonly source: string;
}

/** The claim standing in a skills directory, or nothing legible. */
function readMarker(root: string): LinkClaim | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, LINK_MARKER), "utf8"));
  } catch {
    return undefined;
  }
  const { skill, source } = parsed as { skill?: unknown; source?: unknown };
  if (typeof skill !== "string" || typeof source !== "string") return undefined;
  return { skill, source };
}

function writeMarker(root: string, skill: string, source: string): void {
  writeFileDurable(join(root, LINK_MARKER), `${JSON.stringify({ skill, source }, null, 2)}\n`);
}
