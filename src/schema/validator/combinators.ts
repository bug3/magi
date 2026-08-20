/**
 * allOf / anyOf / oneOf / not, plus the discriminated-union shortcut that keeps
 * error messages readable for a union with many members.
 */

import { SchemaCompileError } from "./errors.ts";
import { escapePointerToken } from "./pointer.ts";
import type { CompileContext, NodeValidator, ValidationIssue } from "./types.ts";
import { isPlainObject } from "./values.ts";

export function compileCombinators(
  node: Record<string, unknown>,
  ctx: CompileContext,
  pointer: string,
  checks: NodeValidator[],
): void {
  if ("allOf" in node) {
    const branches = compileBranches(node["allOf"], ctx, `${pointer}/allOf`);
    checks.push((data, path, issues) => {
      for (const branch of branches) branch(data, path, issues);
    });
  }

  if ("anyOf" in node) {
    const branches = compileBranches(node["anyOf"], ctx, `${pointer}/anyOf`);
    checks.push((data, path, issues) => {
      const attempts = branches.map((branch) => {
        const local: ValidationIssue[] = [];
        branch(data, path, local);
        return local;
      });
      if (attempts.some((local) => local.length === 0)) return;
      // Report one branch's complaints rather than every branch's: the one with
      // the fewest issues, or the first of those, which keeps the message short
      // without pretending to know which shape the author meant.
      const best = attempts.reduce((a, b) => (b.length < a.length ? b : a));
      issues.push({ path, keyword: "anyOf", message: "does not match any allowed shape" }, ...best);
    });
  }

  if ("oneOf" in node) {
    const rawBranches = node["oneOf"];
    const branches = compileBranches(rawBranches, ctx, `${pointer}/oneOf`);
    const discriminator = findDiscriminator(rawBranches as unknown[]);
    if (discriminator) {
      const { key, byValue } = discriminator;
      checks.push((data, path, issues) => {
        if (!isPlainObject(data)) return;
        const tag = data[key];
        const index = typeof tag === "string" ? byValue.get(tag) : undefined;
        if (index === undefined) {
          issues.push({
            path: `${path}/${escapePointerToken(key)}`,
            keyword: "oneOf",
            message: `must be one of ${[...byValue.keys()].map((v) => JSON.stringify(v)).join(", ")}`,
          });
          return;
        }
        const branch = branches[index];
        if (branch !== undefined) branch(data, path, issues);
      });
      return;
    }
    checks.push((data, path, issues) => {
      const matches = branches.filter((branch) => {
        const local: ValidationIssue[] = [];
        branch(data, path, local);
        return local.length === 0;
      });
      if (matches.length === 1) return;
      issues.push({
        path,
        keyword: "oneOf",
        message:
          matches.length === 0
            ? "does not match any allowed shape"
            : "matches more than one allowed shape",
      });
    });
  }

  if ("not" in node) {
    const branch = ctx.compile(node["not"], ctx, `${pointer}/not`);
    checks.push((data, path, issues) => {
      const local: ValidationIssue[] = [];
      branch(data, path, local);
      if (local.length === 0)
        issues.push({ path, keyword: "not", message: "must not match the excluded shape" });
    });
  }
}

function compileBranches(raw: unknown, ctx: CompileContext, pointer: string): NodeValidator[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SchemaCompileError(pointer, "must be a non-empty array of schemas");
  }
  return raw.map((entry, index) => ctx.compile(entry, ctx, `${pointer}/${index}`));
}

/**
 * Detects the "tagged union" shape (every branch pins one shared property to a
 * distinct string const). Error messages then name the failing branch instead
 * of dumping every branch's complaints, which is what keeps a union with many
 * members diagnosable.
 */
function findDiscriminator(
  branches: unknown[],
): { key: string; byValue: Map<string, number> } | undefined {
  const candidateKeys = new Map<string, Map<string, number>>();
  for (const [index, branch] of branches.entries()) {
    if (!isPlainObject(branch)) return undefined;
    const properties = branch["properties"];
    if (!isPlainObject(properties)) return undefined;
    for (const [key, schema] of Object.entries(properties)) {
      if (!isPlainObject(schema) || typeof schema["const"] !== "string") continue;
      let byValue = candidateKeys.get(key);
      if (!byValue) {
        byValue = new Map();
        candidateKeys.set(key, byValue);
      }
      if (byValue.has(schema["const"])) return undefined;
      byValue.set(schema["const"], index);
    }
  }
  for (const [key, byValue] of candidateKeys) {
    if (byValue.size === branches.length) return { key, byValue };
  }
  return undefined;
}
