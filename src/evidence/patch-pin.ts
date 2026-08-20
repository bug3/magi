/**
 * Patch provenance. "The patch" is only a scope when something pins what
 * it is: with a base ref
 * the patch derives from git and carries base/head SHAs plus dirtiness; a
 * caller-supplied patch beside a base is checked against the full delta,
 * and every scoped-out file becomes a first-class exclusion instead of a
 * silent narrowing.
 */

import { gitText } from "../runtime/git.ts";
import { patchTouchedPaths } from "./derive.ts";

export interface PinnedPatch {
  /** The full worktree-vs-base diff of tracked files. */
  readonly patch: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly dirty: boolean;
  /** Every tracked path in the base..worktree delta. */
  readonly deltaPaths: readonly string[];
}

export async function pinPatch(repoDir: string, base: string): Promise<PinnedPatch> {
  const baseSha = await gitText(["rev-parse", "--verify", `${base}^{commit}`], { cwd: repoDir });
  const headSha = await gitText(["rev-parse", "HEAD"], { cwd: repoDir });
  const status = await gitText(["status", "--porcelain"], { cwd: repoDir });
  const patch = await gitText(["diff", baseSha], { cwd: repoDir });
  const names = await gitText(["diff", "--name-only", baseSha], { cwd: repoDir });
  return {
    patch: patch === "" ? "" : `${patch}\n`,
    baseSha,
    headSha,
    dirty: status !== "",
    deltaPaths: names === "" ? [] : names.split("\n"),
  };
}

/** Delta files a supplied patch never touches: recorded, never silent. */
export function patchShortfall(
  deltaPaths: readonly string[],
  patchText: string,
): readonly { readonly path: string; readonly reason: string }[] {
  const touched = new Set(patchTouchedPaths(patchText).map((entry) => entry.path));
  return deltaPaths
    .filter((path) => !touched.has(path))
    .map((path) => ({
      path,
      reason: "in the base..worktree delta but not in the supplied patch",
    }));
}
