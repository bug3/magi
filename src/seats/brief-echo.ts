/**
 * Whether a word a seat wrote was handed to it in its brief: the echo half of
 * the canary rule. See `docs/protocol.md`, "Isolation canaries".
 *
 * A word is a run of letters, marks, digits, `_` and `-`, read by code point.
 * One word is an echo when it is a whole word of the brief, compared after
 * Unicode normalization and case folding. A span a token canary widened
 * across a space or punctuation is never one word, so it is an echo when the
 * brief carries it with no word character on either side.
 */

/** Letters, marks, digits, `_` and `-`: what a word, or a token, is made of. */
export const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_-]/u;
const WORD = /[\p{L}\p{M}\p{N}_-]+/gu;
const ONE_WORD = /^[\p{L}\p{M}\p{N}_-]+$/u;

/**
 * The character that ends at `at`, or "" at the start. Characters are read
 * whole: a letter outside the BMP is two UTF-16 units, and either half alone
 * is no word character, so a boundary read unit by unit would split it.
 */
export function charBefore(text: string, at: number): string {
  const pair = at >= 2 && (text.codePointAt(at - 2) ?? 0) > 0xffff;
  return text.slice(Math.max(0, pair ? at - 2 : at - 1), at);
}

/** The character that starts at `at`, read whole, or "" at the end. */
export function charAfter(text: string, at: number): string {
  const point = text.codePointAt(at);
  return point === undefined ? "" : String.fromCodePoint(point);
}

/** Judges words against one brief; each word is judged once. */
export function echoJudge(brief: string): (word: string) => boolean {
  const briefText = brief.normalize("NFC");
  const briefWords = new Set((briefText.match(WORD) ?? []).flatMap(folds));
  const briefForms = folds(briefText);
  // A word is judged once: looking a repeat up in the brief again would cost
  // a pass over the brief per match.
  const judged = new Map<string, boolean>();
  return (word) => {
    let echo = judged.get(word);
    if (echo === undefined) {
      echo = ONE_WORD.test(word)
        ? folds(word).some((form) => briefWords.has(form))
        : folds(word).some((form) => briefForms.some((text) => standsAlone(form, text)));
      judged.set(word, echo);
    }
    return echo;
  };
}

/**
 * Whether `span` occurs in `text` with no word character on either side. A
 * span a token canary widened across a space or punctuation is never one of
 * the brief's words, so it is looked up in the brief's text instead.
 */
function standsAlone(span: string, text: string): boolean {
  for (let at = text.indexOf(span); at !== -1; at = text.indexOf(span, at + 1)) {
    const before = charBefore(text, at);
    const after = charAfter(text, at + span.length);
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

/**
 * The forms two words are compared in. Both casings count: Turkish folds İ
 * and ı right, while text capitalised the ordinary way writes ASCII I for i,
 * which only the root casing folds back.
 */
function folds(word: string): readonly string[] {
  return [word.toLowerCase(), word.toLocaleLowerCase("tr")];
}
