/**
 * Compilation and validation failures. A compile error is a bug in a schema
 * MAGI ships; a validation error is untrusted input failing a contract.
 */

import type { ValidationIssue } from "./types.ts";

export class SchemaCompileError extends Error {
  constructor(pointer: string, message: string) {
    super(`schema${pointer === "" ? "" : ` at ${pointer}`}: ${message}`);
    this.name = "SchemaCompileError";
  }
}

export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(label: string, issues: readonly ValidationIssue[]) {
    super(`${label} failed validation:\n${formatIssues(issues)}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export function formatIssues(issues: readonly ValidationIssue[], limit = 10): string {
  const shown = issues
    .slice(0, limit)
    .map((i) => `  ${i.path === "" ? "(root)" : i.path}: ${i.message} [${i.keyword}]`);
  if (issues.length > limit) shown.push(`  ... and ${issues.length - limit} more`);
  return shown.join("\n");
}
