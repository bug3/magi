/**
 * `magi triggers [--base <ref>]`: evaluates the full tracked base-to-worktree
 * delta plus non-ignored untracked files against the thresholds, and prints
 * which deterministic triggers propose a consult. Proposing never convenes: the
 * user approves every convene, and orchestrator judgment can add proposals
 * but not suppress these.
 */

import { evaluateTriggers, triggerChanges } from "../consult.ts";
import {
  close,
  commandUsage,
  detail,
  open,
  problem,
  step,
  warn,
  type CommandNote,
} from "../util/ui.ts";
import { parseArgv, type Grammar } from "./parse.ts";

/** Every flag triggers takes, as the catalogue the usage block is held to. */
export const TRIGGERS_GRAMMAR: Grammar = (command) =>
  command
    .description("say which deterministic triggers propose a consult")
    .option("--base <ref>", "the ref the diff is taken from");

/** Proposing is not convening, and the thresholds are not this command's. */
export const TRIGGERS_NOTE: CommandNote = {
  decides: `The size thresholds and the risk-domain seed are the owner's, set under
.magi/. What this prints is a proposal and never a convene: the user approves
every consult, and orchestrator judgment may add proposals but may not
suppress these.`,
};

export async function triggersCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseArgv<{ readonly base?: string }>("magi triggers", TRIGGERS_GRAMMAR, rest);
  if (parsed.kind === "help") {
    commandUsage(parsed.screen, TRIGGERS_NOTE);
    return 0;
  }
  if (parsed.kind === "refused") {
    problem(parsed.reason);
    return 2;
  }
  const { base } = parsed.opts;

  const repoDir = process.cwd();
  let changed;
  try {
    changed = await triggerChanges(repoDir, base);
  } catch (error) {
    problem(String((error as Error).message));
    return 2;
  }

  const proposals = evaluateTriggers(changed);
  const lines = changed.reduce((sum, file) => sum + file.changedLines, 0);
  const scope = `${base ?? "HEAD"} to worktree, including non-ignored untracked`;
  open("magi triggers");
  step(`${scope}: ${lines} changed lines, ${changed.length} files`);
  for (const proposal of proposals) {
    detail(`TRIGGERED ${proposal.id}: ${proposal.reason}`);
  }
  // A trigger that fired is the whole reason to run this, so it is the one
  // thing here that is not a plain line: the user has a decision to make.
  if (proposals.length > 0) warn("a trigger proposes a consult; the user approves every convene");
  close(
    proposals.length === 0
      ? "no deterministic trigger; judgment may still propose a consult"
      : `${proposals.length} deterministic trigger${proposals.length === 1 ? "" : "s"}`,
  );
  return 0;
}
