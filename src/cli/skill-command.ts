/**
 * `magi skill [--harness <id>]... [--install]`: reports where an orchestrating
 * assistant would find this skill, and links it on the explicit flag. Report
 * is the default because installing is the one thing here that writes outside
 * the target repository.
 */

import { join } from "node:path";

import { SLOTS, type Harness } from "../core/slots.ts";
import { installSkill, skillName, skillStatus, type SkillReport, type SkillState } from "../skill.ts";
import { MAGI_ROOT, ambient } from "./environment.ts";

/** The council's own harnesses, in slot order. */
const HARNESSES: readonly Harness[] = SLOTS.map((definition) => definition.harness);

/** Installing without naming a harness targets the documented orchestrator. */
const DEFAULT_INSTALL: Harness = "claude";

const STATE_LABEL: Readonly<Record<SkillState, string>> = {
  linked: "linked",
  absent: "absent",
  dangling: "DANGLING",
  foreign: "FOREIGN",
};

export function skillCommand(rest: readonly string[]): number {
  let install = false;
  const chosen: Harness[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const arg = rest[at];
    if (arg === "--install") {
      install = true;
      continue;
    }
    if (arg === "--harness") {
      const value = rest[at + 1];
      if (value === undefined || !isHarness(value)) {
        console.error(`--harness needs one of: ${HARNESSES.join(", ")}`);
        return 2;
      }
      chosen.push(value);
      at += 1;
      continue;
    }
    console.error(`unknown skill argument: ${arg}`);
    return 2;
  }

  const { home } = ambient();
  const source = join(MAGI_ROOT, "skills", "magi");
  const targets = chosen.length > 0 ? chosen : install ? [DEFAULT_INSTALL] : HARNESSES;

  const name = skillName(source);
  console.log(`skill ${name} -> ${source}`);
  const reports = targets.map((harness) =>
    install ? installSkill(harness, home, source) : skillStatus(harness, home, source),
  );
  for (const report of reports) console.log(`  ${describe(report)}`);

  if (!install) {
    console.log("  --install links it; --harness picks a harness, repeat it for more");
    return 0;
  }
  const refused = reports.filter((report) => report.state !== "linked");
  if (refused.length === 0) {
    console.log(`  start a new session, then /${name}, or state the decision and let it trigger`);
    return 0;
  }
  for (const report of refused) {
    console.error(`refused ${report.harness}: ${report.path} is not ours to replace`);
  }
  return 1;
}

function describe(report: SkillReport): string {
  const occupant = report.occupant === undefined ? "" : ` (${report.occupant})`;
  return `${report.harness.padEnd(7)} ${STATE_LABEL[report.state].padEnd(8)} ${report.path}${occupant}`;
}

function isHarness(value: string): value is Harness {
  return HARNESSES.includes(value as Harness);
}
