/** Build trigger input from the full tracked delta plus non-ignored untracked files. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { gitSucceeds, gitText } from "../runtime/git.ts";
import { parseNumstat, type ChangedFile } from "./triggers.ts";

export async function triggerChanges(
  repoDir: string,
  base?: string,
): Promise<readonly ChangedFile[]> {
  const tracked = await trackedChanges(repoDir, base);
  const untrackedText = await gitText(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: repoDir },
  );
  const untracked = untrackedText
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => ({ path, changedLines: untrackedLines(repoDir, path) }));
  return [...tracked, ...untracked];
}

async function trackedChanges(repoDir: string, base?: string): Promise<readonly ChangedFile[]> {
  if (base !== undefined || (await hasHead(repoDir))) {
    return parseNumstat(
      await gitText(["diff", "--numstat", base ?? "HEAD"], { cwd: repoDir }),
    );
  }
  // An unborn repository has no tree to diff against. Combine its staged
  // empty-tree delta with any later unstaged edits, conservatively by path.
  const staged = parseNumstat(await gitText(["diff", "--cached", "--numstat"], { cwd: repoDir }));
  const unstaged = parseNumstat(await gitText(["diff", "--numstat"], { cwd: repoDir }));
  const merged = new Map<string, number>();
  for (const entry of [...staged, ...unstaged]) {
    merged.set(entry.path, (merged.get(entry.path) ?? 0) + entry.changedLines);
  }
  return [...merged].map(([path, changedLines]) => ({ path, changedLines }));
}

function hasHead(repoDir: string): Promise<boolean> {
  return gitSucceeds(["rev-parse", "--verify", "HEAD"], { cwd: repoDir });
}

function untrackedLines(repoDir: string, path: string): number {
  try {
    const bytes = readFileSync(join(repoDir, path));
    if (bytes.length === 0 || bytes.includes(0)) return 0;
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines += 1;
    return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
  } catch {
    return 0;
  }
}
