/**
 * `magi triggers [--base <ref>]`: evaluates the full tracked base-to-worktree
 * delta plus non-ignored untracked files against the thresholds, and prints
 * which deterministic triggers propose a consult. Proposing never convenes: the
 * user approves every convene, and orchestrator judgment can add proposals
 * but not suppress these.
 */

import { evaluateTriggers, triggerChanges } from "../consult.ts";
import { close, detail, open, problem, step, warn } from "../util/ui.ts";

export async function triggersCommand(rest: readonly string[]): Promise<number> {
  // The whole argument grammar, in one condition: nothing, or --base and a ref.
  if (rest.length !== 0 && (rest.length !== 2 || rest[0] !== "--base")) {
    problem(`usage: magi triggers [--base <ref>]; got: ${rest.join(" ")}`);
    return 2;
  }
  const base = rest[1];

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
