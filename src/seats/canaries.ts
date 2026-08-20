/**
 * Isolation canaries as data. See `docs/protocol.md`, "Isolation canaries".
 *
 * A canary is a pattern that can only appear in seat output if an ambient layer
 * reached the seat, because the brief never contains it. `magi doctor` applies
 * the list to seat output; a match is evidence of a leak, not proof of one, so
 * every entry says which layer it betrays.
 *
 * Keep the list small: a pattern that also matches legitimate output is worse
 * than no canary at all. That is why an em/en dash prohibition marker is not
 * here - the marker's absence cannot be observed, and its presence is normal
 * prose.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Canary {
  readonly id: string;
  readonly pattern: RegExp;
  /** Which ambient layer leaking would trip this pattern. */
  readonly betrays: string;
}

/**
 * Personal markers live OUTSIDE the repo, in `<magiDir>/canaries.local.json`
 * (gitignored with the rest of .magi/): sharper canaries drawn from the
 * owner's real config would leak that config the day the repo goes public.
 * Format: an array of { id, pattern, flags?, betrays }, pattern as a RegExp
 * source string. A malformed file throws rather than silently thinning the
 * canary net.
 */
export function loadCanaries(magiDir: string): readonly Canary[] {
  const localPath = join(magiDir, "canaries.local.json");
  if (!existsSync(localPath)) return CANARIES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(localPath, "utf8"));
  } catch {
    throw new Error(`${localPath} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${localPath} must hold an array of { id, pattern, flags?, betrays }`);
  }
  const locals = parsed.map((entry: unknown, at: number): Canary => {
    const record = entry as Record<string, unknown>;
    const { id, pattern, flags, betrays } = record;
    if (typeof id !== "string" || typeof pattern !== "string" || typeof betrays !== "string") {
      throw new Error(`${localPath}[${at}] needs string id, pattern and betrays fields`);
    }
    try {
      return { id, pattern: new RegExp(pattern, typeof flags === "string" ? flags : "u"), betrays };
    } catch {
      throw new Error(`${localPath}[${at}] ("${id}") carries an invalid pattern`);
    }
  });
  return [...CANARIES, ...locals];
}

/** Which canaries match this text. A hit is evidence of a leak, not proof. */
export function canaryHits(text: string, canaries: readonly Canary[]): readonly string[] {
  return canaries.filter((canary) => canary.pattern.test(text)).map((canary) => canary.id);
}

/**
 * The hits that are evidence, given what the seat was handed.
 *
 * A canary the seat could have copied out of its own brief proves nothing:
 * the brief is the one text every seat saw, so a pattern that matches it
 * cannot tell a leak from an echo. The brief already carries this rule for
 * the calibration nonce, which it describes by prefix and never contains,
 * after a seat echoed the token and looked like a leak. The evidence pack is
 * the same channel and needs the same rule: a pack that quotes this catalog
 * would otherwise make every seat discussing it look compromised.
 */
export function canaryEvidence(
  output: string,
  brief: string,
  canaries: readonly Canary[],
): readonly string[] {
  const echoed = new Set(canaryHits(brief, canaries));
  return canaryHits(output, canaries).filter((id) => !echoed.has(id));
}

export const CANARIES: readonly Canary[] = [
  {
    id: "turkish-text-leak",
    pattern: /[çğıİşÇĞŞ]/u,
    betrays:
      "local ambient config reaching a seat, seen as a preamble in the " +
      "machine's own language in front of an English-briefed answer",
  },
];
