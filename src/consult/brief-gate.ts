/**
 * The brief prebuild gate: the rendered brief is checked against the
 * manifest before any seat is spawned. A brief once shipped a stale
 * hand-inlined document beside a fresh evidence pack and nothing noticed;
 * this gate makes that drift a loud failure. The header must carry the
 * manifest's consult id and mode, and a fenced block of ANY length must be a
 * pack excerpt byte for byte; the only exception is a cumulative budget of
 * non-pack fenced lines per brief, because a per-block allowance can be
 * split under. What the budget admits is accounted: the manifest records the
 * cumulative count and a hash of the non-pack fenced content.
 */

import { sha256Text } from "../util/fs.ts";

/** Cumulative non-pack fenced lines allowed per brief; an operator setting. */
export const NON_PACK_FENCE_BUDGET_LINES = 20;

export interface BriefGateInputs {
  readonly brief: string;
  readonly consult: string;
  readonly mode: string;
  readonly packMarkdown: string;
}

export interface BriefGateReport {
  /** An empty list is a pass. */
  readonly failures: readonly string[];
  /** Cumulative lines of fenced content that is not a pack excerpt. */
  readonly nonPackFencedLines: number;
  /** Hash over the non-pack fenced blocks, in order; absent when none. */
  readonly nonPackFencedSha256?: string;
}

export function gateBrief(inputs: BriefGateInputs): BriefGateReport {
  const failures: string[] = [];
  const lines = inputs.brief.split("\n");

  if (!lines.includes(`Consult: ${inputs.consult}`)) {
    failures.push(`brief header disagrees with the manifest: expected "Consult: ${inputs.consult}"`);
  }
  if (!lines.includes(`Mode: ${inputs.mode}`)) {
    failures.push(`brief header disagrees with the manifest: expected "Mode: ${inputs.mode}"`);
  }

  const nonPack: string[] = [];
  let nonPackFencedLines = 0;
  for (const block of fencedBlocks(lines)) {
    if (block.content.length === 0) continue;
    const text = block.content.join("\n");
    if (inputs.packMarkdown.includes(text)) continue;
    nonPack.push(text);
    nonPackFencedLines += block.content.length;
  }
  if (nonPackFencedLines > NON_PACK_FENCE_BUDGET_LINES) {
    failures.push(
      `brief inlines artifacts: ${nonPackFencedLines} fenced lines are not pack excerpts ` +
        `(cumulative budget ${NON_PACK_FENCE_BUDGET_LINES})`,
    );
  }
  return {
    failures,
    nonPackFencedLines,
    ...(nonPack.length === 0 ? {} : { nonPackFencedSha256: sha256Text(JSON.stringify(nonPack)) }),
  };
}

interface FencedBlock {
  readonly content: readonly string[];
}

/**
 * A fence opens with three or more backticks at line start and closes at the
 * next line of at least as many backticks; shorter backtick runs inside are
 * content, which is how the pack's four-backtick fences carry markdown.
 */
function fencedBlocks(lines: readonly string[]): readonly FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let open: { readonly length: number; readonly content: string[] } | undefined;
  for (const line of lines) {
    const marker = /^(`{3,})/u.exec(line);
    if (open === undefined) {
      if (marker !== null) open = { length: (marker[1] as string).length, content: [] };
      continue;
    }
    if (marker !== null && (marker[1] as string).length >= open.length) {
      blocks.push({ content: open.content });
      open = undefined;
      continue;
    }
    open.content.push(line);
  }
  return blocks;
}
