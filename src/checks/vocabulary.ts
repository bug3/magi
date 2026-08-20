/**
 * The check vocabulary. See `docs/protocol.md`, "Seat-proposed checks".
 *
 * The built-in catalog of read-only command shapes a seat-proposed check may
 * take. A proposal that matches nothing here is refused and recorded, never
 * run. Project-code entry points such as npm and node are deliberately absent:
 * they can write, use the network, or invoke a shell through repository code.
 */

export interface VocabularyEntry {
  readonly head: string;
  /** Returns a refusal reason, or undefined when the args are acceptable. */
  readonly refuse: (args: readonly string[]) => string | undefined;
}

const GIT_READ_ONLY = new Set(["diff", "log", "show", "status", "grep", "rev-parse"]);
/** Flags that make a read-only git subcommand write or execute. */
const GIT_DENIED = ["--output", "--ext-diff", "--exec", "--upload", "--receive"];
/** A short-flag cluster carrying `f` smuggles a pattern-file read: -f, -rf, -f/etc/x. */
const SHORT_FILE_FLAG = /^-[a-zA-Z]*f/;

function pathEscape(token: string): string | undefined {
  if (token.startsWith("/") || token.startsWith("~")) return `absolute path: ${token}`;
  if (token.split("/").includes("..")) return `path escapes the repo: ${token}`;
  return undefined;
}

/** Non-flag tokens must stay inside the repo; the first `freeform` are exempt. */
function refuseEscapes(args: readonly string[], freeform = 0): string | undefined {
  let seen = 0;
  for (const token of args) {
    if (token.startsWith("-")) continue;
    seen += 1;
    if (seen <= freeform) continue;
    const refusal = pathEscape(token);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

function refuseFlags(
  args: readonly string[],
  longPrefixes: readonly string[],
  shortCluster?: RegExp,
): string | undefined {
  for (const token of args) {
    for (const prefix of longPrefixes) {
      if (token.startsWith(prefix)) return `denied flag: ${token}`;
    }
    if (shortCluster !== undefined && shortCluster.test(token)) {
      return `denied flag: ${token}`;
    }
  }
  return undefined;
}

export const CHECK_VOCABULARY: readonly VocabularyEntry[] = [
  {
    head: "git",
    refuse: (args) => {
      const sub = args[0];
      if (sub === undefined || !GIT_READ_ONLY.has(sub)) {
        return `git subcommand not in the read-only set: ${sub ?? "(none)"}`;
      }
      return (
        refuseFlags(args, GIT_DENIED, sub === "grep" ? SHORT_FILE_FLAG : undefined) ??
        refuseEscapes(args.slice(1), sub === "grep" ? 1 : 0)
      );
    },
  },
  {
    head: "grep",
    // The first non-flag token is the pattern and may contain anything;
    // -f/--file would read a pattern file from an unchecked location.
    refuse: (args) => refuseFlags(args, ["--file"], SHORT_FILE_FLAG) ?? refuseEscapes(args, 1),
  },
  {
    head: "rg",
    // --pre executes an arbitrary preprocessor per file; the file flags read.
    refuse: (args) =>
      refuseFlags(args, ["--pre", "--hostname-bin", "--file"], SHORT_FILE_FLAG) ??
      refuseEscapes(args, 1),
  },
  { head: "ls", refuse: (args) => refuseEscapes(args) },
  { head: "cat", refuse: (args) => refuseEscapes(args) },
  { head: "head", refuse: (args) => refuseEscapes(args) },
  { head: "tail", refuse: (args) => refuseEscapes(args) },
  { head: "wc", refuse: (args) => refuseEscapes(args) },
];

export function vocabularyEntry(head: string): VocabularyEntry | undefined {
  return CHECK_VOCABULARY.find((entry) => entry.head === head);
}
