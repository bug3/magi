/**
 * Whether runtime records are protected from accidental publication in the
 * target repository. MAGI never edits the target's ignore rules itself.
 */

import { gitSucceeds, gitText } from "../runtime/git.ts";

export type StateIgnoreStatus = "ignored" | "not-ignored" | "tracked" | "not-git";

export async function stateIgnoreStatus(repoDir: string): Promise<StateIgnoreStatus> {
  const isRepo = await gitSucceeds(["rev-parse", "--is-inside-work-tree"], { cwd: repoDir });
  if (!isRepo) return "not-git";
  const tracked = await gitText(["ls-files", "--", ".magi"], { cwd: repoDir });
  if (tracked !== "") return "tracked";
  const ignored = await gitSucceeds(
    ["check-ignore", "--no-index", "--quiet", ".magi/ledger.jsonl"],
    { cwd: repoDir },
  );
  return ignored ? "ignored" : "not-ignored";
}
