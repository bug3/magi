/**
 * Turning an excerpt request into the exact lines it names.
 *
 * Every failure here is loud. A pack that silently dropped an unreadable file
 * or clamped an out-of-range window would still hash, still validate, and every
 * consult built on it would be weaker in a way nobody could see.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExcerptRequest, ResolvedExcerpt } from "./types.ts";

/**
 * Splits into addressable lines. A trailing newline terminates the last line
 * rather than starting an empty one, so line numbers match an editor's.
 */
function toLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function readText(repoDir: string, path: string): string {
  try {
    return readFileSync(join(repoDir, path), "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`evidence excerpt cannot be read: ${path} (${reason})`);
  }
}

export function resolveExcerpt(repoDir: string, request: ExcerptRequest): ResolvedExcerpt {
  const lines = toLines(readText(repoDir, request.path));
  const startLine = request.startLine ?? 1;
  const endLine = request.endLine ?? lines.length;

  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error(`evidence excerpt has non-integer line bounds: ${request.path}`);
  }
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new Error(
      `evidence excerpt window ${startLine}-${endLine} is out of range: ` +
        `${request.path} has ${lines.length} lines`,
    );
  }

  return {
    path: request.path,
    startLine,
    endLine,
    text: `${lines.slice(startLine - 1, endLine).join("\n")}\n`,
    ...(request.note === undefined ? {} : { note: request.note }),
  };
}

/** Verbatim text (a patch, test output) named by its source rather than a path. */
export function verbatimExcerpt(source: string, text: string): ResolvedExcerpt {
  const lines = toLines(text);
  return { path: source, startLine: 1, endLine: lines.length, text: `${lines.join("\n")}\n` };
}
