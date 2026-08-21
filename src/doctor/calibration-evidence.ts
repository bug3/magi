/**
 * What a seat was handed, told apart from what it went and fetched.
 *
 * The canary measures one thing: whether an ambient layer reaches a seat on
 * its own. A seat with tools has a second path to the same bytes, and codex
 * takes it. Pointed at the repository its layer lives in, it greps the tree,
 * reads `AGENTS.md` itself and echoes the token: proof that the seat can read
 * the file, not that the layer was injected. So an injection claim rests only
 * on what the stream carried before the seat fetched anything.
 *
 * This is the second false positive this canary has produced. The first was
 * the brief echoing its own token, answered by never naming the token in the
 * brief; see `NONCE_PREFIX`.
 */

/**
 * The events that mark a seat fetching something itself. Codex only: its
 * `exec --json` stream is one event per line, so position in the stream
 * orders cause and effect. Claude and grok emit a single document with no
 * such ordering, and their layers sit outside the working directory where a
 * repository grep cannot reach them, so neither needs this cut. Cases, not
 * branches: a stream that grows a new retrieval event is one more entry here,
 * re-verified against the installed CLI rather than trusted from this list.
 */
export const RETRIEVAL_MARKERS: readonly string[] = [
  '"type":"command_execution"',
  '"type":"mcp_tool_call"',
  '"type":"file_change"',
  '"type":"web_search"',
];

/**
 * The part of a seat's stdout that precedes its first retrieval, which is the
 * only part an injection claim may rest on. A stream that fetched nothing
 * comes back whole, so a harness without retrieval events is unaffected.
 */
export function beforeRetrieval(stdout: string): string {
  const lines = stdout.split("\n");
  const at = lines.findIndex((line) => RETRIEVAL_MARKERS.some((marker) => line.includes(marker)));
  return at === -1 ? stdout : lines.slice(0, at).join("\n");
}
