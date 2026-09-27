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
   * the seat's own. "raw": text outside any document, read as it stands.
   */
  readonly from: "json" | "raw";
}

/** How many documents nested in strings are opened, one inside another. */
const MAX_NESTING = 8;

export function spokenText(stream: string): readonly Spoken[] {
  const found: Spoken[] = [];
  const whole = embedded(stream);
  if (whole !== undefined) {
    walk(whole.value, found);
    found.push({ text: whole.around, from: "raw" });
    return found;
  }
  for (const line of stream.split("\n")) {
    const document = embedded(line);
    if (document === undefined) {
      found.push({ text: line, from: "raw" });
    } else {
      walk(document.value, found);
      found.push({ text: document.around, from: "raw" });
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
        found.push({ text: value, from: "json" });
      } else {
        pending.push({ value: document.value, depth: depth + 1 });
        found.push({ text: document.around, from: "json" });
      }
    } else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) pending.push({ value: child, depth });
    }
  }
}

/**
 * The document in `text`, if there is one: the text as a whole, or the span
 * from its first `{` or `[` to its last `}` or `]`, which covers a preamble in
 * front and a fence around. `around` is what is left of the text.
 */
function embedded(text: string): { value: object; around: string } | undefined {
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  for (const start of [text.indexOf("{"), text.indexOf("[")]) {
    if (start === -1 || end <= start) continue;
    const value = parsed(text.slice(start, end + 1));
    if (value !== null && typeof value === "object") {
      return { value, around: `${text.slice(0, start)}\n${text.slice(end + 1)}` };
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
