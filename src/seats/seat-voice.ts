/**
 * The text a seat wrote, taken out of the stream its harness prints.
 *
 * A stream is one JSON document, JSON lines, a document behind a preamble, or
 * none of these; the answer itself is usually a document nested in a string
 * of its envelope, sometimes fenced. A reader that treats the raw stream as
 * prose cannot tell the seat quoting a word from the envelope's own quotation
 * marks, so every document found is taken apart down to its strings, a string
 * that holds a document is opened in turn, and whatever is not JSON, a
 * preamble or a document cut short, is kept exactly as it stands.
 */

/** A piece of what a seat wrote, and whether it came out of a JSON string. */
export interface Spoken {
  readonly text: string;
  /**
   * "json": the content of a string the seat wrote, where a quotation mark is
   * the seat's own. "raw": text outside any document, or a document that
   * does not parse, read as it stands.
   */
  readonly from: "json" | "raw";
}

/** How many documents nested in strings are opened, one inside another. */
const MAX_NESTING = 8;

/** An inline code span in a seat's own text: what it quotes or names. */
export const CODE_SPAN = /`[^`\n]*`/gu;

/**
 * What stands where a document or a cited span was taken out of a string the
 * seat wrote: no whitespace, no word character and no opener, so the words on
 * either side stay apart and what follows keeps its place on its line, where
 * a space would read as indentation. Raw text is never classified, and gets a
 * plain space.
 */
export const TAKEN = "\uFFFC";

/**
 * Where a JSON document opens: an object's first key, anywhere, or an array
 * of documents or strings at the start of a line. A quote may follow a
 * backslash, as in an answer written out escaped. Text that still carries one
 * outside the code spans it cites, once whatever parsed was taken out, is an
 * answer cut short or slightly invalid, and is read as raw text: its
 * quotation marks are structure, and stripping them would strip its prose.
 * A bracket or a brace in prose, `env["HOME"` or `["word"`, opens nothing.
 */
const OPENS_DOCUMENT = /\{\s*\\?"[^"\n]*"\s*:|(?:^|\n)[ \t]*\[\s*(?:[[{]|\\?")/u;

/**
 * A code span the seat cites closes every string it opens. One holding an odd
 * number of quotes runs across a string boundary of a cut answer, from before
 * its opener into its prose, and cites nothing.
 */
function cited(span: string): string {
  return (span.match(/"/gu) ?? []).length % 2 === 0 ? TAKEN : span;
}

/** Whether the quotation marks in `text` are the seat's own or structure. */
function voiceOf(text: string): Spoken["from"] {
  return OPENS_DOCUMENT.test(text.replace(CODE_SPAN, cited)) ? "raw" : "json";
}

export function spokenText(stream: string): readonly Spoken[] {
  const found: Spoken[] = [];
  const whole = embedded(stream);
  if (whole !== undefined) {
    walk(whole.value, found);
    found.push({ text: `${whole.before} ${whole.after}`, from: "raw" });
    return found;
  }
  for (const line of stream.split("\n")) {
    const document = embedded(line);
    if (document === undefined) {
      found.push({ text: line, from: "raw" });
    } else {
      walk(document.value, found);
      found.push({ text: `${document.before} ${document.after}`, from: "raw" });
    }
  }
  return found;
}

/**
 * Takes a document apart without recursion, so no depth of nesting in what a
 * seat prints can overflow the stack.
 */
function walk(root: object, found: Spoken[]): void {
  const pending: { readonly value: unknown; readonly depth: number }[] = [
    { value: root, depth: 0 },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, depth } = next;
    if (typeof value === "string") {
      const document = depth < MAX_NESTING ? embedded(value) : undefined;
      if (document === undefined) {
        found.push({ text: value, from: voiceOf(value) });
      } else {
        pending.push({ value: document.value, depth: depth + 1 });
        const around = `${document.before}${TAKEN}${document.after}`;
        found.push({ text: around, from: voiceOf(around) });
      }
    } else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push({ value: child, depth });
    }
  }
}

/**
 * The document in `text`, if there is one: the text as a whole, or the span
 * from its first `{` or `[` to its last `}` or `]`, which covers a preamble in
 * front and a fence around, with the text before it and after it.
 */
function embedded(
  text: string,
): { value: object; before: string; after: string } | undefined {
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  for (const start of [text.indexOf("{"), text.indexOf("[")]) {
    if (start === -1 || end <= start) continue;
    const value = parsed(text.slice(start, end + 1));
    if (value !== null && typeof value === "object") {
      return { value, before: text.slice(0, start), after: text.slice(end + 1) };
    }
  }
  return undefined;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
