/**
 * The vocabulary the three seat parsers report in.
 *
 * Three harnesses write three stdout dialects; the validity gate and the ledger
 * read this shape and never a vendor's fields. Two rules hold for every parser
 * and are the reason the failure branch exists at all:
 *
 * - A parser never throws. Whatever a seat left on stdout, the caller gets a
 *   value back, so one broken seat degrades mechanically instead of taking the
 *   consult down with it.
 * - "Garbage" is decided mechanically, never by opinion: a failure carries one
 *   of the reasons below, and no parser digs a payload out of the middle of
 *   text that failed. Failing closed is what stops a seat that broke isolation
 *   from passing for a clean one.
 *
 * Nothing absent is invented: a usage figure the harness did not report stays
 * absent rather than becoming a zero that reads like a measurement.
 */

/** Tokens as the harness reported them, and money only where it reports money. */
export interface SeatUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  /** Recorded only when the harness states a cost itself; never derived here. */
  readonly costUsd?: number;
}

/**
 * Outcome signals, in MAGI's words rather than any vendor's.
 *
 * - `completed`: the seat ran to a conclusion of its own, whatever it was.
 * - `error`: the seat reported its own failure.
 * - `limit-reached`: a turn, token or budget ceiling ended it, which is a model
 *   limit rather than a harness fault.
 * - `provider-trouble`: the only class worth a retry, and only ever read from a
 *   seat that reached no conclusion.
 */
export type SeatSignal = "completed" | "error" | "limit-reached" | "provider-trouble";

/**
 * The failure ladder, in the order every parser walks it. Each rung is a
 * property of the bytes, so two people reading the same stdout assign the same
 * reason.
 */
export type ParseFailureReason =
  /** stdout held no non-whitespace bytes. */
  | "empty-output"
  /** Nothing in stdout parsed as JSON. */
  | "not-json"
  /** JSON parsed, but it is not the shape this harness emits. */
  | "wrong-shape"
  /** The shape is right and the seat still said nothing. */
  | "no-final-message";

/** What a parser observed regardless of which branch it returns. */
interface SeatObservations {
  readonly usage?: SeatUsage;
  readonly signals?: readonly SeatSignal[];
}

export type ParseResult =
  | (SeatObservations & { readonly ok: true; readonly message: string })
  | (SeatObservations & { readonly ok: false; readonly reason: ParseFailureReason });

/** A JSON object; an array, a scalar or null is not one. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** A number that can be recorded: NaN and the infinities are not measurements. */
export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
