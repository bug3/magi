/**
 * The council fan-out: up to three seats launched
 * headless in parallel, staggered, each under its own wall-clock cap.
 *
 * Two rules live here and nowhere else. The stagger delays the SPAWN only, so a
 * later seat is not punished for waiting: `profile.timeoutMs` is counted from
 * its own spawn. And a seat is retried exactly once, only when it never
 * started: a seat that ran and then failed produced a result, and rerunning it
 * would double-charge the subscription for the same answer.
 */

import type { SeatProfile } from "../core/profile.ts";
import type { SlotId } from "../core/slots.ts";
import { type ExecResult, exec } from "../runtime/exec.ts";
import { mapWithLimit } from "../util/concurrency.ts";

export interface SeatCall {
  readonly profile: SeatProfile;
  /** The brief + evidence pack, identical for every seat. */
  readonly brief: string;
}

export interface SeatRunRequest {
  readonly seats: readonly SeatCall[];
  /** Seat i spawns i * staggerMs after seat 0. */
  readonly staggerMs: number;
  /** Cancels the whole fan-out, including seats still waiting on the stagger. */
  readonly signal?: AbortSignal;
}

export interface SeatRun {
  readonly slot: SlotId;
  /** Command plus args verbatim, so the manifest records the exact launch. */
  readonly argv: readonly string[];
  /** Spawn offset from the start of the fan-out, in ms: a wall clock would make
   * the stagger untestable, and only the relative order and spacing matter. */
  readonly startedAtMs: number;
  /** From this seat's first spawn to its final result, retry included. */
  readonly durationMs: number;
  readonly retried: boolean;
  readonly result: ExecResult;
}

export async function runSeats(request: SeatRunRequest): Promise<SeatRun[]> {
  const fanOutStarted = process.hrtime.bigint();

  // Limit = seat count: the whole council is meant to be in flight together.
  return mapWithLimit(request.seats, request.seats.length, async (seat, index) => {
    await delay(index * request.staggerMs, request.signal);

    const startedAtMs = elapsedMs(fanOutStarted);
    const first = await runOnce(seat, request.signal);
    const retried = first.outcome.kind === "spawn_error";
    const result = retried ? await runOnce(seat, request.signal) : first;

    return {
      slot: seat.profile.slot,
      argv: argvOf(seat.profile),
      startedAtMs,
      durationMs: elapsedMs(fanOutStarted) - startedAtMs,
      retried,
      result,
    };
  });
}

function argvOf(profile: SeatProfile): readonly string[] {
  return [profile.command, ...profile.args];
}

/**
 * `promptVia` decides where the brief goes, in one place. "stdin" keeps the
 * prompt out of argv; "prompt-file" gets NO stdin at all, because the path is
 * already in `profile.args` and the caller wrote that file.
 */
function runOnce(call: SeatCall, signal: AbortSignal | undefined): Promise<ExecResult> {
  const { profile } = call;
  return exec({
    argv: argvOf(profile),
    env: profile.env,
    timeoutMs: profile.timeoutMs,
    ...(profile.promptVia === "stdin" ? { stdin: call.brief } : {}),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** Abort-aware: a cancelled fan-out must not sit out the remaining stagger. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) return Promise.resolve();
  return new Promise<void>((resolvePromise) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function elapsedMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}
