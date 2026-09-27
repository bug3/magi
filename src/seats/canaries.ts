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

import { spokenText } from "./seat-voice.ts";

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
    const flagText = typeof flags === "string" ? flags : "u";
    // Scanning is stateless and unanchored: a sticky or global pattern would
    // carry lastIndex from one text into the next.
    if (/[gy]/u.test(flagText)) {
      throw new Error(`${localPath}[${at}] ("${id}") carries the y or g flag`);
    }
    let compiled: RegExp;
    try {
      compiled = new RegExp(pattern, flagText);
    } catch {
      throw new Error(`${localPath}[${at}] ("${id}") carries an invalid pattern`);
    }
    // A pattern that matches empty text matches at every word, so every seat
    // would trip it once its matches are judged one by one.
    if (compiled.test("")) {
      throw new Error(`${localPath}[${at}] ("${id}") matches empty text`);
    }
    return { id, pattern: compiled, betrays };
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
 *
 * What counts as copied is judged per match, not per pattern. A whole-pattern
 * rule is right for a token and blind for a character class: one Turkish word
 * quoted from a test fixture in the pack once silenced the language canary for
 * a seat that answered its whole position in Turkish. So each match is widened
 * to the word it sits in, and the hit is an echo only when every such word is
 * a whole word of the brief, compared after Unicode normalization and case
 * folding. An inflected form is a different word, and stays evidence.
 *
 * Only the seat's own voice counts. In what it wrote inside its answer's
 * strings, a quotation or a code span is something it cites, and a single
 * letter is a letter being discussed: two seats reviewing this very rule
 * tripped it both ways, in English. Text outside any document, a preamble or
 * an answer cut short, is read as it stands, because that is where a leak
 * shows first and where a quotation mark may be structure.
 */
export function canaryEvidence(
  output: string,
  brief: string,
  canaries: readonly Canary[],
): readonly string[] {
  const briefWords = new Set((brief.normalize("NFC").match(WORD) ?? []).flatMap(folds));
  const text = spokenText(output)
    .map(({ text: piece, from }) => {
      const normal = piece.normalize("NFC");
      return from === "json" ? normal.replace(CODE_SPAN, " ").replace(QUOTATION, " ") : normal;
    })
    .join("\n");
  return canaries
    .filter((canary) =>
      matchedWords(text, canary.pattern).some(
        (word) => [...word].length > 1 && !folds(word).some((form) => briefWords.has(form)),
      ),
    )
    .map((canary) => canary.id);
}

/**
 * The evidence across several streams of one seat, each read on its own: a
 * stderr line appended to stdout would break the document stdout carries,
 * and the seat's own quotations would then read as raw text.
 */
export function streamEvidence(
  streams: readonly string[],
  brief: string,
  canaries: readonly Canary[],
): readonly string[] {
  const hit = new Set(streams.flatMap((stream) => canaryEvidence(stream, brief, canaries)));
  return canaries.filter((canary) => hit.has(canary.id)).map((canary) => canary.id);
}

/** An inline code span in a seat's own text: what it quotes or names. */
const CODE_SPAN = /`[^`\n]*`/gu;
/** A quotation in a seat's own text: what it cites, not what it says. */
const QUOTATION = /"[^"\n]*"|“[^”\n]*”/gu;

/** Letters, marks, digits, `_` and `-`: what a word, or a token, is made of. */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_-]/u;
const WORD = /[\p{L}\p{M}\p{N}_-]+/gu;

/**
 * The forms two words are compared in. Both casings count: Turkish folds İ
 * and ı right, while text capitalised the ordinary way writes ASCII I for i,
 * which only the root casing folds back.
 */
function folds(word: string): readonly string[] {
  return [word.toLowerCase(), word.toLocaleLowerCase("tr")];
}

/**
 * Every match of `pattern` in `text`, each widened to the word around it. A
 * match inside a word already widened adds nothing and is skipped, so a long
 * run of matches costs one pass, not one pass per match.
 */
function matchedWords(text: string, pattern: RegExp): readonly string[] {
  const every = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  const found: string[] = [];
  let reached = 0;
  for (const match of text.matchAll(every)) {
    if (match.index < reached) continue;
    let start = match.index;
    let end = start + match[0].length;
    while (start > 0 && WORD_CHARACTER.test(text[start - 1] ?? "")) start -= 1;
    while (end < text.length && WORD_CHARACTER.test(text[end] ?? "")) end += 1;
    reached = Math.max(end, match.index + 1);
    const word = text.slice(start, end);
    if (word !== "") found.push(word);
  }
  return found;
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
