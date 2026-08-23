/**
 * Running `magi` the way a user runs it: a real process, over a real
 * repository, with real subprocesses underneath.
 *
 * Every other suite here reaches into the modules and asserts on what they
 * return. That proves the pieces and never the wiring: an exit code, a stream
 * split, a launcher that picks the wrong entry, a template resolved from the
 * wrong root and a seat spawned through PATH are all invisible from inside.
 * So these tests spawn `bin/magi.js` and read what came out of it.
 *
 * Nothing here reaches a live harness. `fixtures/seats/stub-harness.mjs` is
 * installed on a temporary PATH under the three names the launch profiles
 * resolve, so the fan-out really spawns, really parses three different
 * envelope shapes, and really gates the answers, while no subscription is
 * spent and no model is asked anything.
 *
 * Nothing here writes outside its own temporary directory either: HOME, the
 * working repository and the PATH the seats resolve through are all built per
 * test and removed after.
 *
 * The PATH is sealed rather than prefixed, and that is the load-bearing part.
 * A workspace directory in front of the machine's own PATH looks like
 * isolation and is not: with no stub installed, `claude` resolves to the real
 * one behind it, and a test asserting that a missing harness is reported
 * instead spends a live subscription to prove the opposite. So the PATH a
 * command runs with holds nothing but this workspace, and the two binaries
 * the tool genuinely shells out to are linked into it by name.
 */

import { spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { SLOTS } from "../../src/core/slots.ts";
import { profileFlagsOf } from "../../src/doctor/drift.ts";
import { seatProfile } from "../../src/seats/profiles.ts";

const LAUNCHER = resolve("bin", "magi.js");
const STUB_HARNESS = resolve("fixtures", "seats", "stub-harness.mjs");

/** Long enough for three stub seats and a git call; short enough to fail. */
const RUN_TIMEOUT_MS = 60_000;

export interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface Workspace {
  /** The repository the command runs against, as its working directory. */
  readonly repo: string;
  /** A HOME of its own, so an install cannot touch the real one. */
  readonly home: string;
  /** The whole PATH: node, git, and whatever stubs were installed. */
  readonly bin: string;
  readonly remove: () => void;
}

/**
 * What the tool itself spawns, and all it may find. `node` because the stubs
 * are node scripts reached through their shebang, `git` because the state,
 * trigger and evidence paths all read the repository through it. A harness
 * binary is deliberately not here: it arrives only when a test installs one.
 */
const REACHABLE: readonly string[] = ["node", "git"];

/** The first executable of that name on the machine's own PATH. */
function locate(command: string): string {
  if (command === "node") return process.execPath;
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`${command} is not on PATH; the end-to-end suite needs it`);
}

/**
 * Run the launcher itself rather than importing `main`, because the launcher
 * choosing between the sources and a stale `dist/` is part of what can break.
 */
export async function magi(
  argv: readonly string[],
  workspace: Pick<Workspace, "repo" | "home" | "bin">,
): Promise<Run> {
  const child = spawn(process.execPath, [LAUNCHER, ...argv], {
    cwd: workspace.repo,
    // Exactly what the tool asks the process for, plus the colour opt-out.
    // A wider environment would let a variable on the machine running the
    // suite change what the assertions see.
    env: { HOME: workspace.home, PATH: workspace.bin, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: RUN_TIMEOUT_MS,
  });

  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
  });

  const code = await new Promise<number>((settle, fail) => {
    child.on("error", fail);
    child.on("close", (status, signal) => {
      if (status === null) fail(new Error(`magi ${argv.join(" ")} died on ${signal}`));
      else settle(status);
    });
  });
  return { code, out, err };
}

export function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "magi-e2e-"));
  const paths = { repo: join(root, "repo"), home: join(root, "home"), bin: join(root, "bin") };
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
  for (const command of REACHABLE) symlinkSync(locate(command), join(paths.bin, command));
  return { ...paths, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** A repository with one commit, ignoring the state directory as MAGI asks. */
export async function initRepo(repo: string): Promise<void> {
  await git(repo, ["init", "--quiet", "--initial-branch", "main"]);
  // Identity in the repository, never in the temporary HOME: a commit must
  // not depend on whether the machine running this has a global git config.
  await git(repo, ["config", "user.email", "e2e@magi.invalid"]);
  await git(repo, ["config", "user.name", "magi end-to-end"]);
  writeFileSync(join(repo, ".gitignore"), ".magi/\n");
  writeFileSync(join(repo, "README.md"), "# subject repository\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "chore: seed the subject repository"]);
}

/**
 * Git, with the machine's own configuration out of the way. A global
 * `commit.gpgsign`, `core.hooksPath` or `init.templateDir` would otherwise
 * reach into every temporary repository built here, so the suite would pass
 * or fail on whose laptop it ran. Pointing both config scopes at nothing is
 * the documented way to say "this repository and nothing else".
 */
export function git(repo: string, argv: readonly string[]): Promise<void> {
  return new Promise((settle, fail) => {
    const child = spawn("git", [...argv], {
      cwd: repo,
      stdio: "ignore",
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    child.on("error", fail);
    child.on("close", (status) =>
      status === 0 ? settle() : fail(new Error(`git ${argv.join(" ")} exited ${String(status)}`)),
    );
  });
}

/**
 * The three harness stubs, on the workspace's own PATH under the names the
 * launch profiles resolve.
 *
 * The help text each stub prints is generated from the real profiles rather
 * than written out here. Restating today's flags would pass today and report
 * drift the moment a profile gained one, which is the opposite of what the
 * drift check is for: what is being proved is that doctor reads the installed
 * help, not that anybody remembered to update a fixture.
 */
export function installStubHarnesses(bin: string): void {
  for (const definition of SLOTS) {
    const profile = seatProfile(definition.id, {
      briefPath: "brief.md",
      schemaPath: "opinion.schema.json",
      schemaJson: "{}",
      repoDir: ".",
      home: "/nonexistent",
      path: bin,
    });
    const target = join(bin, profile.command);
    copyFileSync(STUB_HARNESS, target);
    chmodSync(target, 0o755);
    writeFileSync(
      `${target}.help.txt`,
      `${profile.command} stub help\n${profileFlagsOf(profile.args).join("\n")}\n`,
    );
  }
}

/**
 * The id of the run a convene just recorded, read out of what it printed.
 * Taken from the output rather than from the state directory, because a run
 * that minted an id and reported a different one is exactly the kind of break
 * an end-to-end test is here for.
 */
export function convenedId(out: string): string {
  const found = /\b(\d{4}-[a-z][a-z0-9-]*):/u.exec(out)?.[1];
  if (found === undefined) throw new Error(`no run id was reported:\n${out}`);
  return found;
}

/** A brief file, the one input every consult requires. */
export function writeBrief(repo: string, body: string): string {
  const path = join(repo, "brief.md");
  writeFileSync(path, body);
  return path;
}
