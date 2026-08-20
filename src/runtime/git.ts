/**
 * Running git with an environment git cannot be steered through.
 *
 * MAGI reads a repository it does not own, and later walks trees an untrusted
 * session wrote. So no invocation inherits the ambient environment: user and
 * system config, hooks, attribute files, credential prompts and locale are all
 * pinned here, because anything the machine's own gitconfig, hooks or templates
 * could change is something an evidence pack would then record wrongly. A
 * caller that needs more (an author identity for a snapshot commit) passes
 * `config` entries rather than reaching for the user's own.
 *
 * The second thing this file owns is what a git failure means: `gitText` throws
 * a {@link GitError} carrying stderr, because "git said no" is information the
 * user has to see, not a boolean.
 */

import { type ExecResult, exec } from "./exec.ts";

/**
 * Config every invocation carries. `-c` beats the config files git would read,
 * and the environment below removes those files anyway: both, because either
 * one alone is a single point of failure for a security property.
 */
const FIXED_CONFIG: readonly string[] = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "core.symlinks=true",
  "protocol.ext.allow=never",
  "protocol.file.allow=always",
];

/** No user config, no prompts, no locale-dependent output to parse. */
function gitEnvironment(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    // A home that cannot exist: nothing under it can supply config or hooks.
    HOME: "/nonexistent",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    TZ: "UTC",
    ...extra,
  };
}

export interface GitOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  /** Extra `-c key=value` entries, for the few places that need identity. */
  readonly config?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string | Uint8Array;
}

export class GitError extends Error {
  readonly argv: readonly string[];
  readonly stderr: string;

  constructor(argv: readonly string[], result: ExecResult) {
    const reason =
      result.outcome.kind === "exit" ? `exit ${result.outcome.code}` : result.outcome.kind;
    super(`git ${argv.join(" ")} failed (${reason}): ${result.stderr.trim() || "no output"}`);
    this.name = "GitError";
    this.argv = argv;
    this.stderr = result.stderr;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Runs git and hands back the raw outcome; failure is the caller's to read. */
export async function git(argv: readonly string[], options: GitOptions): Promise<ExecResult> {
  const config = [...FIXED_CONFIG, ...(options.config ?? [])].flatMap((entry) => ["-c", entry]);
  return await exec({
    argv: ["git", ...config, ...argv],
    cwd: options.cwd,
    env: gitEnvironment(options.env),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  });
}

/** Runs git and returns trimmed stdout, throwing {@link GitError} on failure. */
export async function gitText(argv: readonly string[], options: GitOptions): Promise<string> {
  const result = await git(argv, options);
  if (result.outcome.kind !== "exit" || result.outcome.code !== 0) {
    throw new GitError(argv, result);
  }
  return result.stdout.trim();
}

/** True when git exits 0. Used for questions whose answer is the exit code. */
export async function gitSucceeds(argv: readonly string[], options: GitOptions): Promise<boolean> {
  const result = await git(argv, options);
  return result.outcome.kind === "exit" && result.outcome.code === 0;
}

/** The git build MAGI is running against, recorded in every run manifest. */
export async function gitVersion(cwd: string): Promise<string | undefined> {
  const result = await git(["--version"], { cwd, timeoutMs: 10_000 });
  if (result.outcome.kind !== "exit" || result.outcome.code !== 0) return undefined;
  return result.stdout.trim().replace(/^git version /u, "");
}
