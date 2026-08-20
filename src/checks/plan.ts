/**
 * Turning a seat-proposed check string into either an argv or a refusal.
 *
 * There is no shell anywhere in this path, so the only thing that can turn
 * one proposal into two programs is this tokenizer, and it refuses instead:
 * an unquoted shell metacharacter, a double quote, or an unterminated quote
 * disqualifies the whole proposal. Single quotes group one argument whose
 * content is inert bytes to the receiving program; they cannot compose,
 * redirect or substitute because nothing here interprets them.
 */

import { vocabularyEntry } from "./vocabulary.ts";

export type CheckPlan =
  | { readonly kind: "run"; readonly argv: readonly string[] }
  | { readonly kind: "refuse"; readonly reason: string };

/** What an unquoted word may contain. No `|&;<>$"\` backtick or whitespace. */
const WORD = /^[A-Za-z0-9_@%+=:,.^~/-]+$/;

function refuse(reason: string): CheckPlan {
  return { kind: "refuse", reason };
}

function tokenize(proposal: string): readonly string[] | { readonly reason: string } {
  const tokens: string[] = [];
  let at = 0;
  while (at < proposal.length) {
    const ch = proposal[at] as string;
    if (ch === " " || ch === "\t") {
      at += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") return { reason: "newline in proposal" };
    if (ch === "'") {
      const end = proposal.indexOf("'", at + 1);
      if (end === -1) return { reason: "unterminated quote" };
      const quoted = proposal.slice(at + 1, end);
      if (quoted.includes("\n")) return { reason: "newline in proposal" };
      const after = proposal[end + 1];
      if (after !== undefined && after !== " " && after !== "\t") {
        return { reason: "quote must end a word" };
      }
      tokens.push(quoted);
      at = end + 1;
      continue;
    }
    let end = at;
    while (end < proposal.length && !" \t\n\r".includes(proposal[end] as string)) end += 1;
    const word = proposal.slice(at, end);
    if (!WORD.test(word)) {
      return { reason: `unquoted word carries a character the planner refuses: ${word}` };
    }
    tokens.push(word);
    at = end;
  }
  return tokens;
}

export function planCheck(proposal: string): CheckPlan {
  const text = proposal.trim();
  if (text === "") return refuse("empty proposal");

  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return refuse((tokens as { reason: string }).reason);
  const [head, ...args] = tokens as string[];
  if (head === undefined) return refuse("empty proposal");

  const entry = vocabularyEntry(head);
  if (entry === undefined) return refuse(`not in the check vocabulary: ${head}`);

  const reason = entry.refuse(args);
  if (reason !== undefined) return refuse(reason);
  return { kind: "run", argv: [head, ...args] };
}
