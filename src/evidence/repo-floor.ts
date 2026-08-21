/**
 * The repository evidence floor: what a consult always sees, regardless of
 * what the orchestrator chose to excerpt. Plan packs carried it first; review packs
 * carry it too, so dirtiness and untracked scope stay visible beside the
 * patch. HEAD and dirtiness, the porcelain status, the tracked file
 * list, and the output of the check command the repo declares for itself.
 * That command is named by package.json, not proposed by a seat, so it runs
 * through the check execution profile without passing the seat vocabulary,
 * and its transcript is condensed before it is carried: see check-output.ts.
 * A section that cannot be built becomes a note, never a silent absence.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runHardened } from "../checks.ts";
import { condenseCheckOutput } from "./check-output.ts";
import { gitText } from "../runtime/git.ts";

export interface RepoFloor {
  /** Verbatim pack sections, in fixed order. */
  readonly sections: readonly { readonly source: string; readonly text: string }[];
  /** Why a floor section is absent; recorded in the manifest. */
  readonly notes: readonly string[];
}

export async function repoFloor(repoDir: string, path: string): Promise<RepoFloor> {
  const sections: { source: string; text: string }[] = [];
  const notes: string[] = [];

  try {
    const headSha = await gitText(["rev-parse", "HEAD"], { cwd: repoDir });
    const status = await gitText(["status", "--porcelain"], { cwd: repoDir });
    const files = await gitText(["ls-files"], { cwd: repoDir });
    sections.push({
      source: "git-facts",
      text: `HEAD ${headSha}\ndirty: ${status === "" ? "false" : "true"}\n`,
    });
    sections.push({ source: "git-status", text: status === "" ? "(clean)\n" : `${status}\n` });
    sections.push({ source: "file-list", text: `${files}\n` });
  } catch {
    notes.push("no readable git repo: the floor carries no git sections");
  }

  const command = checkCommand(repoDir);
  if (command === undefined) {
    notes.push("no check or test script in package.json: the floor carries no check output");
  } else {
    const run = await runHardened(command, { repoDir, path });
    const outcome =
      run.outcome.kind === "exit" ? `exit ${run.outcome.code}` : run.outcome.kind;
    // Verbatim would mean every seat pays for hundreds of passing ticks and
    // the pack hash moves between two runs of the same commit.
    const condensed = condenseCheckOutput(`${run.stdout}${run.stderr}`);
    sections.push({
      source: "check-output",
      text: `$ ${command.join(" ")} -> ${outcome}\n${condensed.text}`,
    });
  }

  return { sections, notes };
}

/** The one fixed command, from the repo's own stack: check over test. */
function checkCommand(repoDir: string): readonly string[] | undefined {
  const manifest = join(repoDir, "package.json");
  if (!existsSync(manifest)) return undefined;
  let scripts: Record<string, unknown>;
  try {
    scripts = (JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, unknown> })
      .scripts ?? {};
  } catch {
    return undefined;
  }
  if (typeof scripts["check"] === "string") return ["npm", "run", "check"];
  if (typeof scripts["test"] === "string") return ["npm", "test"];
  return undefined;
}
