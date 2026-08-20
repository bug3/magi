/**
 * The deterministic convention collector. Which project instructions enter
 * the evidence pack is not
 * an orchestrator choice: the filenames are a catalog, the walk goes from the
 * repo root to each cited file, and a filename that applies at more than one
 * depth is reported as a conflict rather than silently resolved. Precedence,
 * documented: files appear root-first, and where texts disagree the file
 * closer to the cited path wins.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The convention carriers the seat harnesses read in-repo, in pack order. */
export const CONVENTION_FILENAMES: readonly string[] = ["CLAUDE.md", "AGENTS.md"];

export interface ConventionScan {
  /** Repo-relative paths, walk order: root first, then deeper directories. */
  readonly paths: readonly string[];
  /** One line per filename that applies at more than one depth. */
  readonly conflicts: readonly string[];
}

export function collectConventions(
  repoDir: string,
  citedPaths: readonly string[],
): ConventionScan {
  const dirs = new Set<string>(["."]);
  for (const cited of citedPaths) {
    let dir = dirname(cited);
    while (dir !== "." && dir !== "/" && dir !== "") {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  const ordered = [...dirs].sort(byDepthThenName);

  const paths: string[] = [];
  const hits = new Map<string, string[]>();
  for (const dir of ordered) {
    for (const name of CONVENTION_FILENAMES) {
      const rel = dir === "." ? name : `${dir}/${name}`;
      if (!existsSync(join(repoDir, rel))) continue;
      paths.push(rel);
      hits.set(name, [...(hits.get(name) ?? []), dir]);
    }
  }

  const conflicts = [...hits.entries()]
    .filter(([, at]) => at.length > 1)
    .map(
      ([name, at]) =>
        `${name}: applies at ${at.join(", ")}; the file closer to the cited path wins where they disagree`,
    );
  return { paths, conflicts };
}

function byDepthThenName(a: string, b: string): number {
  const depth = (dir: string): number => (dir === "." ? 0 : dir.split("/").length);
  return depth(a) - depth(b) || a.localeCompare(b);
}
