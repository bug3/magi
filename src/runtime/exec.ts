/**
 * Child-process execution with the guarantees the run semantics depend on:
 * wall-clock timeouts, SIGTERM-then-SIGKILL on the whole process group, bounded
 * output capture, and a typed outcome that never collapses "failed" into
 * "could not run".
 */

import { type ChildProcess, spawn } from "node:child_process";

/**
 * How a command ended. The variants are kept apart on purpose: a nonzero exit
 * is a result the command produced, while a spawn error, a signal, a timeout
 * and a cancellation all mean no result was produced at all. Callers that
 * cannot tell those apart end up reporting "failed" for a command that never
 * ran.
 */
export type CommandOutcome =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "signal"; readonly signal: NodeJS.Signals }
  | { readonly kind: "spawn_error"; readonly message: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" };

export interface ExecOptions {
  readonly argv: readonly string[];
  readonly cwd?: string;
  /** Full environment for the child. Nothing is inherited implicitly. */
  readonly env?: Readonly<Record<string, string>>;
  /** Bytes, not text, because some inputs (a git fast-import stream) are binary. */
  readonly stdin?: string | Uint8Array;
  readonly timeoutMs?: number;
  /** SIGTERM, then SIGKILL after this long. */
  readonly killGraceMs?: number;
  /** Output beyond this many bytes per stream is dropped, and flagged. */
  readonly maxOutputBytes?: number;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly signal?: AbortSignal;
}

export interface ExecResult {
  readonly outcome: CommandOutcome;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 10_000;

export async function exec(options: ExecOptions): Promise<ExecResult> {
  const started = process.hrtime.bigint();
  const [command, ...args] = options.argv;
  if (command === undefined) throw new Error("exec requires a command");

  // A signal that fired before the spawn reaches nobody: the abort listener
  // below never fires for an already-aborted signal, so without this the work
  // queued behind a cancel would all run to completion.
  if (options.signal?.aborted === true) {
    return {
      outcome: { kind: "cancelled" },
      stdout: "",
      stderr: "",
      truncated: false,
      durationMs: 0,
    };
  }

  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  let stdout = "";
  let stderr = "";
  let truncated = false;

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      // Its own process group, so a timeout can reach the whole tree.
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      outcome: { kind: "spawn_error", message: String((error as Error).message ?? error) },
      stdout: "",
      stderr: "",
      truncated: false,
      durationMs: elapsedMs(started),
    };
  }

  const collect = (stream: "out" | "err", chunk: string): void => {
    const current = stream === "out" ? stdout : stderr;
    if (current.length >= maxBytes) {
      truncated = true;
      return;
    }
    const room = maxBytes - current.length;
    const slice = chunk.length > room ? chunk.slice(0, room) : chunk;
    if (slice.length < chunk.length) truncated = true;
    if (stream === "out") stdout += slice;
    else stderr += slice;
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    collect("out", chunk);
    options.onStdout?.(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    collect("err", chunk);
    options.onStderr?.(chunk);
  });

  if (options.stdin !== undefined) {
    // Prompts travel via stdin, never argv: argv is world-readable through
    // /proc/<pid>/cmdline.
    child.stdin?.on("error", () => {
      // The child may exit before reading stdin; that is not our failure.
    });
    child.stdin?.end(options.stdin);
  } else {
    child.stdin?.end();
  }

  const killer = new ProcessKiller(child, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  let timedOut = false;
  let cancelled = false;

  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          killer.terminate();
        }, options.timeoutMs);

  const onAbort = (): void => {
    cancelled = true;
    killer.terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const exit = await new Promise<
      { code: number | null; signal: NodeJS.Signals | null } | { error: Error }
    >((resolvePromise) => {
      child.on("error", (error) => resolvePromise({ error }));
      child.on("close", (code, signal) => resolvePromise({ code, signal }));
    });

    if ("error" in exit) {
      return {
        outcome: { kind: "spawn_error", message: exit.error.message },
        stdout,
        stderr,
        truncated,
        durationMs: elapsedMs(started),
      };
    }

    const outcome = resolveOutcome({ timedOut, cancelled, ...exit });

    return { outcome, stdout, stderr, truncated, durationMs: elapsedMs(started) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    killer.dispose();
  }
}

/**
 * One place decides what a finished child means. Order matters: a run that both
 * timed out and was signalled is a TIMEOUT, because that is the reason it died.
 */
function resolveOutcome(exit: {
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}): CommandOutcome {
  if (exit.timedOut) return { kind: "timeout" };
  if (exit.cancelled) return { kind: "cancelled" };
  if (exit.signal !== null) return { kind: "signal", signal: exit.signal };
  return { kind: "exit", code: exit.code ?? 0 };
}

function elapsedMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

/** SIGTERM to the process group, SIGKILL after the grace period. */
class ProcessKiller {
  readonly #child: ChildProcess;
  readonly #graceMs: number;
  #killTimer: NodeJS.Timeout | undefined;

  constructor(child: ChildProcess, graceMs: number) {
    this.#child = child;
    this.#graceMs = graceMs;
  }

  terminate(): void {
    this.#signal("SIGTERM");
    this.#killTimer ??= setTimeout(() => this.#signal("SIGKILL"), this.#graceMs);
    this.#killTimer.unref?.();
  }

  dispose(): void {
    if (this.#killTimer !== undefined) clearTimeout(this.#killTimer);
    this.#killTimer = undefined;
  }

  #signal(signal: NodeJS.Signals): void {
    const { pid } = this.#child;
    if (pid === undefined) return;
    try {
      // Negative pid: the whole group spawned with detached: true.
      process.kill(-pid, signal);
    } catch {
      try {
        this.#child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  }
}

/** Convenience for probes: run a command and return its trimmed stdout. */
export async function tryCapture(
  argv: readonly string[],
  timeoutMs = 10_000,
): Promise<string | undefined> {
  const result = await exec({
    argv,
    timeoutMs,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
  });
  if (result.outcome.kind !== "exit" || result.outcome.code !== 0) return undefined;
  return result.stdout.trim();
}
