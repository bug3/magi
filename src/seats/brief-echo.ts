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
  // Indexed only once a span needs it: most seats never widen across a space.
  let briefForms: readonly IndexedText[] | undefined;
  // A word is judged once: looking a repeat up in the brief again would cost
  // a lookup per match.
  const judged = new Map<string, boolean>();
  return (word) => {
    let echo = judged.get(word);
    if (echo === undefined) {
      if (ONE_WORD.test(word)) {
        echo = folds(word).some((form) => briefWords.has(form));
      } else {
        briefForms ??= folds(briefText).map(indexed);
        const forms = briefForms;
        echo = folds(word).some((form) => forms.some((text) => standsAlone(form, text)));
      }
      judged.set(word, echo);
    }
    return echo;
  };
}

/** A text and where each of its words starts, by word. */
interface IndexedText {
  readonly text: string;
  readonly starts: ReadonlyMap<string, readonly number[]>;
}

function indexed(text: string): IndexedText {
  const starts = new Map<string, number[]>();
  for (const match of text.matchAll(WORD)) {
    const at = starts.get(match[0]);
    if (at === undefined) starts.set(match[0], [match.index]);
    else at.push(match.index);
  }
  return { text, starts };
}

/**
 * Whether `span` occurs in the text with no word character on either side. A
 * span a token canary widened across a space or punctuation is never one of
 * the brief's words, so it is looked up in the brief's text instead.
 *
 * Where it stands alone, each of its words is a whole word of the text, so it
 * is looked for only where its rarest word starts: a pass over the brief per
 * distinct span made a seat echoing many of them cost the square of the brief.
 */
function standsAlone(span: string, { text, starts }: IndexedText): boolean {
  let rarest: { readonly offset: number; readonly at: readonly number[] } | undefined;
  for (const match of span.matchAll(WORD)) {
    const at = starts.get(match[0]) ?? [];
    if (rarest === undefined || at.length < rarest.at.length) rarest = { offset: match.index, at };
  }
  // A span with no word in it has nothing to index by, so the whole text is
  // searched; the canary scan never asks, since it skips any such span.
  const candidates = rarest === undefined ? occurrences(span, text) : rarest.at;
  const offset = rarest?.offset ?? 0;
  for (const position of candidates) {
    const start = position - offset;
    if (start < 0 || !text.startsWith(span, start)) continue;
    const before = charBefore(text, start);
    const after = charAfter(text, start + span.length);
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

/** Every position `span` starts at in `text`. */
function* occurrences(span: string, text: string): Generator<number> {
  for (let at = text.indexOf(span); at !== -1; at = text.indexOf(span, at + 1)) yield at;
}

/**
 * The forms two words are compared in. Both casings count: Turkish folds İ
 * and ı right, while text capitalised the ordinary way writes ASCII I for i,
 * which only the root casing folds back.
 */
function folds(word: string): readonly string[] {
  return [word.toLowerCase(), word.toLocaleLowerCase("tr")];
}
