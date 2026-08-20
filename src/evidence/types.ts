/**
 * Shapes shared by the evidence-pack builder's parts.
 *
 * An evidence pack is what every seat receives identically, so these types
 * describe a value that is hashed and quoted verbatim: nothing here may carry
 * an absolute path or anything else that differs between two machines.
 */

import type { CitationId } from "../core/ids.ts";

/** One excerpt the orchestrator asks for. Absent bounds mean the whole file. */
export interface ExcerptRequest {
  /** Repo-relative path; resolved against the pack's `repoDir`. */
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  /** Why this excerpt is in the pack. Rendered next to the citation id. */
  readonly note?: string;
}

/** One verbatim floor section (plan mode): named by source, not by path. */
export interface FloorSection {
  readonly source: string;
  readonly text: string;
}

export interface EvidencePackInputs {
  readonly repoDir: string;
  readonly excerpts: readonly ExcerptRequest[];
  /**
   * Project convention files, copied in whole. No line bounds are accepted:
   * an orchestrator that could window its own conventions could curate away
   * the rule it is about to break.
   */
  readonly conventions: readonly string[];
  /** The plan-mode floor, rendered verbatim after the conventions. */
  readonly floor?: readonly FloorSection[];
  /** The diff under review, quoted verbatim. */
  readonly patch?: string;
  /** Test output, quoted verbatim. */
  readonly testOutput?: string;
}

/** A resolved excerpt: the bytes that will be rendered, and where they came from. */
export interface ResolvedExcerpt {
  /** Repo-relative path, or the literal source name "patch" / "test-output". */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly note?: string;
}

export interface EvidenceIndexEntry {
  readonly id: CitationId;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Digest of the excerpt text as rendered, not of the whole source file. */
  readonly sha256: string;
}

export interface EvidencePack {
  readonly markdown: string;
  readonly index: readonly EvidenceIndexEntry[];
  /** Digest of `markdown`: the value a run manifest records. */
  readonly packSha256: string;
}
