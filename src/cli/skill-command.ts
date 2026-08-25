/**
 * `magi skill [--harness <id>]... [--install]`: reports where an orchestrating
 * assistant would find this skill, and links it on the explicit flag. Report
 * is the default because installing is the one thing here that writes outside
 * the target repository.
 */

import { SLOTS, type Harness } from "../core/slots.ts";
import {
  SKILL_STATE_LABEL,
  installSkill,
  skillName,
  skillStatus,
  type SkillReport,
} from "../skill.ts";
import {
  approve,
  choose,
  close,
  commandUsage,
  detail,
  info,
  open,
  problem,
  step,
  type CommandNote,
} from "../util/ui.ts";
import { SKILL_SOURCE, ambient } from "./environment.ts";
import { InvalidArgumentError, parseArgv, type Grammar } from "./parse.ts";

/** The council's own harnesses, in slot order. */
const HARNESSES: readonly Harness[] = SLOTS.map((definition) => definition.harness);

/** Installing without naming a harness targets the documented orchestrator. */
const DEFAULT_INSTALL: Harness = "claude";

/** What the shell reports for a command a person stopped rather than answered. */
const CANCELLED = 130;

/** One `--harness` value, checked by name and kept in the order it was given. */
function collectHarness(value: string, previous: readonly Harness[]): readonly Harness[] {
  if (!isHarness(value)) throw new InvalidArgumentError(`needs one of: ${HARNESSES.join(", ")}`);
  return [...previous, value];
}

/** Every flag skill takes, as the catalogue the usage block is held to. */
export const SKILL_GRAMMAR: Grammar = (command) =>
  command
    .description("report where each harness finds the orchestrator skill, or link it")
    .option(
      "--harness <id>",
      `which harness, repeat for more (${HARNESSES.join(", ")})`,
      collectHarness,
      [],
    )
    .option("--install", "link the skill where the harness finds it", false);

/** What installing writes, what it will not touch, and what it asks. */
export const SKILL_NOTE: CommandNote = {
  records: `--install links the skill where the harness looks for it: a symlink to this
clone, so the installed skill cannot drift, with a marker beside it naming the
source it claims.`,
  refuses: `Only a link that marker still claims is repointed later. A link nobody here
made, a real file and a directory are each reported and left exactly as they
were.`,
  decides: `At a terminal the run asks once before replacing somebody else's file, and no
flag answers that question, because overwriting it needs a person. Without
--harness it asks which harness at a terminal, and installs for claude
anywhere else.`,
};

export async function skillCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseArgv<{ readonly harness: readonly Harness[]; readonly install: boolean }>(
    "magi skill",
    SKILL_GRAMMAR,
    rest,
  );
  if (parsed.kind === "help") {
    commandUsage(parsed.screen, SKILL_NOTE);
    return 0;
  }
  if (parsed.kind === "refused") {
    problem(parsed.reason);
    return 2;
  }
  const { harness: chosen, install } = parsed.opts;

  const { home } = ambient();
  const source = SKILL_SOURCE;
  const name = skillName(source);
  open(`magi skill ${name}`);
  step(`skill ${name} -> ${source}`);

  // Installing without naming a harness has always gone to the documented
  // orchestrator. On a terminal the same run asks first, because there are
  // three and picking one is the user's call; everywhere else the answer is
  // the one it has always been.
  let targets = chosen.length > 0 ? chosen : install ? [DEFAULT_INSTALL] : HARNESSES;
  if (install && chosen.length === 0) {
    const picked = await choose(
      "which harness gets the skill?",
      HARNESSES.map((harness) => ({ value: harness, label: harness })),
      DEFAULT_INSTALL,
    );
    if (picked.cancelled) return CANCELLED;
    targets = [picked.value];
  }

  const reports: SkillReport[] = [];
  for (const harness of targets) {
    if (!install) {
      reports.push(skillStatus(harness, home, source));
      continue;
    }
    const settled = await installOne(harness, home, source);
    if (settled === undefined) return CANCELLED;
    reports.push(settled);
  }
  for (const report of reports) detail(describe(report));

  if (!install) {
    close("--install links it; --harness picks a harness, repeat it for more");
    return 0;
  }
  const refused = reports.filter((report) => report.state !== "linked");
  if (refused.length === 0) {
    close(`start a new session, then /${name}, or state the decision and let it trigger`);
    return 0;
  }
  // Every refusal is named before the exit code says there was one: a run that
  // linked two harnesses and refused the third has to show which was which.
  info(`${reports.length - refused.length} of ${reports.length} linked`);
  for (const report of refused) {
    problem(`refused ${report.harness}: ${report.path} is not ours to replace`);
  }
  return 1;
}

/**
 * One harness, installed. A path this installation did not fill belongs to
 * somebody else, and the only thing that may replace it is a person at a
 * terminal saying so: off one, and on `--yes` just the same, it is reported
 * and left exactly as it was. Returns nothing where the question was
 * cancelled rather than answered.
 */
async function installOne(
  harness: Harness,
  home: string,
  source: string,
): Promise<SkillReport | undefined> {
  const before = skillStatus(harness, home, source);
  if (before.state !== "foreign") return installSkill(harness, home, source);

  const occupant = before.occupant === undefined ? "something else" : before.occupant;
  const replace = await approve(`${before.path} holds ${occupant}; replace it?`, {
    otherwise: false,
  });
  if (replace.cancelled) return undefined;
  if (!replace.value) return before;
  return installSkill(harness, home, source, { replaceForeign: true });
}

function describe(report: SkillReport): string {
  const occupant = report.occupant === undefined ? "" : ` (${report.occupant})`;
  const label = SKILL_STATE_LABEL[report.state].padEnd(8);
  return `${report.harness.padEnd(7)} ${label} ${report.path}${occupant}`;
}

function isHarness(value: string): value is Harness {
  return HARNESSES.includes(value as Harness);
}
