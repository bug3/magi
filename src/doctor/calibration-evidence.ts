/**
 * What a seat was handed, told apart from what it went and fetched.
 *
 * The canary measures one thing: whether an ambient layer reaches a seat on
 * its own. A seat with tools has a second path to the same bytes, and codex
 * takes it. Pointed at the repository its layer lives in, it greps the tree,
 * reads `AGENTS.md` itself and echoes the token: proof that the seat can read
 * the file, not that the layer was injected.
 *
 * What separates the two is where the token turns up, not when. A retrieval
 * event that carried it in its own output is the seat fetching it. A token
 * anywhere else was in the seat's context, whatever the seat did before
 * saying so. Cutting the stream at the first retrieval instead reads far too
 * much: it clears a real leak the moment the seat touches a tool for any
 * unrelated reason, which is a false negative in the one direction that must
 * not have one.
 *
 * This is the second false positive this canary has produced; the first was a
 * brief echoing its own token, answered by never naming the token in the
 * brief. See `NONCE_PREFIX`.
 *
 * One ambiguity is left standing rather than guessed at: a token both
 * injected and fetched reads as fetched. Only a seat with no retrieval
 * capability removes it, which is what melchior's `--tools ""` already does
 * and what the other two seats would need to match.
 */

import type { Harness } from "../core/slots.ts";

/**
 * The harnesses whose stream says what a retrieval returned. Codex only: its
 * `exec --json` stream is one event per line and carries a command's own
 * output on that event. Claude and grok emit a single document that does not
 * separate the two, so nothing here can speak for them and it does not try;
 * their evidence stays the whole stream. Re-verify against the installed CLI
 * rather than trusting this list.
 */
export const RETRIEVAL_READABLE: ReadonlySet<Harness> = new Set<Harness>(["codex"]);

/**
 * Harnesses whose canary cannot separate a token the seat was handed from one
 * it fetched, so their directions are recorded as unproven rather than read as
 * proof. Grok only, and for both halves of the reason at once: its layer sits
 * at a fixed path under HOME, its profile keeps read tools, and its single
 * document does not say what a tool returned. Melchior is proven the other
 * way, by having no tools at all (`--tools ""`); balthasar by a stream that
 * reports each retrieval's own output.
 *
 * Denying grok's tools would settle it, and grok 1.0.5 cannot: verified
 * against the installed CLI, `--disallowed-tools` and `--deny` are both
 * accepted, name real built-in tools, and the seat reads the file anyway. A
 * flag that looks like isolation and is not is worse than none, so the gap is
 * recorded instead of papered over.
 */
export const UNPROVEN_BY_CONSTRUCTION: ReadonlySet<Harness> = new Set<Harness>(["grok"]);

/** The events that carry what a seat fetched, in codex's stream. */
export const RETRIEVAL_MARKERS: readonly string[] = [
  '"type":"command_execution"',
  '"type":"mcp_tool_call"',
  '"type":"file_change"',
  '"type":"web_search"',
];

/**
 * Whether a retrieval's own output carried the token: the seat read it for
 * itself, which says nothing about what reached it ambiently. False for a
 * harness whose stream cannot answer the question, so its evidence is
 * unchanged rather than quietly narrowed.
 */
export function tokenWasFetched(harness: Harness, stdout: string, token: string): boolean {
  if (!RETRIEVAL_READABLE.has(harness)) return false;
  return stdout
    .split("\n")
    .some(
      (line) => line.includes(token) && RETRIEVAL_MARKERS.some((marker) => line.includes(marker)),
    );
}
