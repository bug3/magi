/**
 * Everything a consult invocation names, checked before anything is read for
 * real and before either preflight runs.
 *
 * Argument parsing refuses a bad invocation by name; a file it cannot read, a
 * window past the end of that file, a slug no consult id could carry, a base
 * that is not a commit and a review with nothing to review are the same kind
 * of fact and belong beside it.
 * Existence is the wrong question to ask of any of them: a directory and a
 * file with no read permission both answer it yes and then throw out of the
 * first reader, which is what put a `node:fs` stack trace in front of users.
 *
 * Every file read here is handed back rather than read again later, so the
 * bytes that were checked are the bytes that are consulted. Reading twice is
 * not only wasteful: between the two reads a file can change or vanish, and
 * the second read is past the seam that turns that into a named refusal.
 *
 * One check cannot live here. Whether a `--base` derives an empty patch is
 * known only once git has been asked, which curation does; `emptyReviewTarget`
 * is that check, called from the command with the derived patch in hand.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ConsultMode } from "../core/consult.ts";
import type { ExcerptRequest } from "../evidence/pack.ts";
import { gitSucceeds } from "../runtime/git.ts";
import type { ReviewArgs } from "./args.ts";

/** The slug half of a consult id, which is minted as `NNNN-<slug>`. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

export type InputCheck =
  | { readonly ok: false; readonly problem: string }
  | {
      readonly ok: true;
      readonly briefMd: string;
      /** Read here when named, so curation consults the bytes that passed. */
      readonly patch?: string;
      readonly testOutput?: string;
    };

export async function checkInputs(
  args: ReviewArgs,
  repoDir: string,
  mode: ConsultMode = "review",
): Promise<InputCheck> {
  if (!SLUG.test(args.slug)) {
    return refuse(`--slug: not a kebab slug: "${args.slug}" (a consult id is NNNN-slug)`);
  }

  const brief = readNamed("--brief", args.briefFile);
  if ("problem" in brief) return refuse(brief.problem);
  if (brief.text.trim() === "") {
    return refuse(`--brief: ${args.briefFile} is empty; a consult needs a question to answer`);
  }

  let patch: string | undefined;
  if (args.patchFile !== undefined) {
    const read = readNamed("--patch", args.patchFile);
    if ("problem" in read) return refuse(read.problem);
    // Known here, so refused here, before curation runs the repository's own
    // check command to build a floor around a patch that carries nothing.
    if (read.text.trim() === "") {
      return refuse(`--patch: ${args.patchFile} is empty; there is nothing in it to review`);
    }
    patch = read.text;
  }
  let testOutput: string | undefined;
  if (args.testOutputFile !== undefined) {
    const read = readNamed("--test-output", args.testOutputFile);
    if ("problem" in read) return refuse(read.problem);
    testOutput = read.text;
  }

  for (const excerpt of args.excerpts) {
    const problem = excerptProblem(excerpt, repoDir);
    if (problem !== undefined) return refuse(problem);
  }

  if (args.base !== undefined) {
    const problem = await baseProblem(args.base, repoDir);
    if (problem !== undefined) return refuse(problem);
  }

  // Last, so a path that cannot be read is named before this is: a review with
  // no target ships the repository floor and nothing else, and three seats
  // answer that they cannot review anything. That is a correct answer to a
  // question the invocation already knew not to ask, at the cost of a fan-out.
  if (mode === "review" && args.base === undefined && args.patchFile === undefined) {
    return refuse(
      "review needs something to review: pass --base <ref> to derive the patch from git, " +
        "or --patch <file> to supply one",
    );
  }

  return {
    ok: true,
    briefMd: brief.text,
    ...(patch === undefined ? {} : { patch }),
    ...(testOutput === undefined ? {} : { testOutput }),
  };
}

function refuse(problem: string): InputCheck {
  return { ok: false, problem };
}

/**
 * Why the review has nothing to review, once curation has derived the patch,
 * or nothing. Requiring a base or a patch is not the same as having a change:
 * `--base HEAD` against a clean tree names a target and derives an empty
 * patch, and three seats still convened on nothing. The flag check refuses
 * sooner and more clearly; this one refuses the case it cannot see.
 */
export function emptyReviewTarget(
  mode: ConsultMode,
  patch: string | undefined,
  untracked: readonly string[] = [],
): string | undefined {
  if (mode !== "review" || (patch ?? "").trim() !== "") return undefined;
  if (untracked.length > 0) {
    // A patch derives from git's tracked delta, which cannot see a file git
    // has never been told about. Refusing without saying so sends the reader
    // looking for a change they can see in their own working tree.
    return (
      `review has nothing to review: the patch is empty because all ${untracked.length} ` +
      `changed paths are untracked (${untracked.slice(0, 3).join(", ")}` +
      `${untracked.length > 3 ? ", ..." : ""}). Run \`git add -N\` on them so the ` +
      "delta can see them, or supply a --patch"
    );
  }
  return (
    "review has nothing to review: the patch is empty. Name a base the working " +
    "tree differs from, or supply a --patch that is not empty"
  );
}

/** A named path read the way the consult will read it, or why it cannot be. */
function readNamed(flag: string, path: string): { text: string } | { problem: string } {
  try {
    return { text: readFileSync(path, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      problem:
        code === "ENOENT"
          ? `${flag}: no such file: ${path}`
          : `${flag}: cannot read ${path} (${code ?? "unknown"})`,
    };
  }
}

/**
 * An excerpt names a file and, optionally, a window inside it. A window that
 * runs past the end resolves to nothing at pack time, after curation has run
 * the repository's own check command, so it is answered here instead.
 */
function excerptProblem(excerpt: ExcerptRequest, repoDir: string): string | undefined {
  const read = readNamed("--excerpt", resolve(repoDir, excerpt.path));
  if ("problem" in read) return read.problem;
  const { startLine, endLine } = excerpt;
  if (startLine === undefined || endLine === undefined) return undefined;
  if (startLine < 1 || endLine < startLine) {
    return `--excerpt: not a line window: ${excerpt.path}:${startLine}-${endLine}`;
  }
  const lines = countLines(read.text);
  if (endLine > lines) {
    return (
      `--excerpt: ${excerpt.path} has ${lines} lines, ` +
      `so ${startLine}-${endLine} runs past its end`
    );
  }
  return undefined;
}

/**
 * Lines the way a reader counts them, which is one fewer than `split` gives
 * for the newline-terminated file almost every file is. The pack renders a
 * whole file as `path:1-<count>`, and the two counts must agree or a window
 * the pack would accept is refused here.
 */
function countLines(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/u, "").split("\n").length;
}

/**
 * Git is reached through the wrapper that owns its hardening rather than a
 * bare capture, and the two ways a base can fail are told apart: MAGI runs in
 * working directories that are not repositories at all, where "no such
 * commit" would be a misleading thing to say.
 */
async function baseProblem(base: string, repoDir: string): Promise<string | undefined> {
  if (!(await gitSucceeds(["rev-parse", "--git-dir"], { cwd: repoDir }))) {
    return `--base: ${repoDir} is not a git repository, so a base cannot be pinned`;
  }
  if (!(await gitSucceeds(["rev-parse", "--verify", `${base}^{commit}`], { cwd: repoDir }))) {
    return `--base: not a commit in this repository: ${base}`;
  }
  return undefined;
}
