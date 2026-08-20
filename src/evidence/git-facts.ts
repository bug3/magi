/**
 * The two git facts a consult is anchored to: which commit the seats were
 * shown, and whether the tree had uncommitted changes at that moment.
 *
 * Deliberately thin. What a manifest records, and what a dirty tree should
 * mean for a consult, are the caller's decisions; this file only reports.
 */

import { gitText } from "../runtime/git.ts";

export interface GitFacts {
  readonly headSha: string;
  /** True when `status --porcelain` reports anything at all, staged or not. */
  readonly dirty: boolean;
}

export async function gitFacts(repoDir: string): Promise<GitFacts> {
  const headSha = await gitText(["rev-parse", "HEAD"], { cwd: repoDir });
  const status = await gitText(["status", "--porcelain"], { cwd: repoDir });
  return { headSha, dirty: status !== "" };
}
