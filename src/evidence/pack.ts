/**
 * The evidence pack: the numbered, hashed set of excerpts every seat receives
 * identically.
 *
 * Two properties this file owns. Numbering is positional and total: sources are
 * consumed in one fixed order (conventions, requested excerpts, patch, test
 * output) and each gets the next citation id, so a citation in a seat opinion
 * resolves to the same excerpt for every seat. And the pack is a value, not a
 * side effect: identical inputs give identical markdown and identical
 * `packSha256`, which is what makes the manifest's hash worth recording.
 */


import { type CitationId, citationId } from "../core/ids.ts";
import { sha256Text } from "../util/fs.ts";
import { resolveExcerpt, verbatimExcerpt } from "./excerpt.ts";
import type {
  EvidenceIndexEntry,
  EvidencePack,
  EvidencePackInputs,
  ResolvedExcerpt,
} from "./types.ts";

export type {
  EvidenceIndexEntry,
  EvidencePack,
  EvidencePackInputs,
  ExcerptRequest,
} from "./types.ts";

/**
 * Four backticks: content may itself be markdown containing a three-backtick
 * fence (a convention file almost certainly is), and a fence that closed early
 * would hand a seat a truncated excerpt.
 */
const FENCE = "````";

/** The one place a digest is taken, so every hash in a pack is the same hash. */
function render(id: CitationId, excerpt: ResolvedExcerpt): string {
  const heading = `## ${id} ${excerpt.path}:${excerpt.startLine}-${excerpt.endLine}`;
  const note = excerpt.note === undefined ? "" : `${excerpt.note}\n\n`;
  return `${heading}\n\n${note}${FENCE}\n${excerpt.text}${FENCE}\n`;
}

/**
 * Sources in citation order. Conventions and the plan floor come first
 * because they are the parts the orchestrator does not choose; the caller's
 * own excerpts follow.
 */
function collect(inputs: EvidencePackInputs): ResolvedExcerpt[] {
  const excerpts: ResolvedExcerpt[] = [];
  for (const path of inputs.conventions) excerpts.push(resolveExcerpt(inputs.repoDir, { path }));
  for (const section of inputs.floor ?? []) {
    excerpts.push(verbatimExcerpt(section.source, section.text));
  }
  for (const request of inputs.excerpts) excerpts.push(resolveExcerpt(inputs.repoDir, request));
  if (inputs.patch !== undefined) excerpts.push(verbatimExcerpt("patch", inputs.patch));
  if (inputs.testOutput !== undefined) {
    excerpts.push(verbatimExcerpt("test-output", inputs.testOutput));
  }
  return excerpts;
}

export function buildEvidencePack(inputs: EvidencePackInputs): EvidencePack {
  const index: EvidenceIndexEntry[] = [];
  const sections: string[] = [];

  let ordinal = 0;
  for (const excerpt of collect(inputs)) {
    ordinal += 1;
    const id = citationId(`E${ordinal}`);
    index.push({
      id,
      path: excerpt.path,
      startLine: excerpt.startLine,
      endLine: excerpt.endLine,
      sha256: sha256Text(excerpt.text),
    });
    sections.push(render(id, excerpt));
  }

  const markdown = `# Evidence pack\n\n${sections.join("\n")}`;
  return { markdown, index, packSha256: sha256Text(markdown) };
}
