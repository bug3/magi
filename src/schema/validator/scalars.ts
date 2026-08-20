/**
 * Keyword compilers for scalars and value-equality: type, const, enum, string
 * and number constraints.
 */

import { SchemaCompileError } from "./errors.ts";
import { numberKeyword } from "./keywords.ts";
import type { CompileContext, JsonValue, NodeValidator } from "./types.ts";
import { deepEqual, describeType, matchesType, SIMPLE_TYPES } from "./values.ts";

export function compileType(
  node: Record<string, unknown>,
  _ctx: CompileContext,
  pointer: string,
): NodeValidator {
  if (!("type" in node)) return () => {};
  const raw = node["type"];
  const types = Array.isArray(raw) ? raw : [raw];
  for (const t of types) {
    if (typeof t !== "string" || !SIMPLE_TYPES.has(t)) {
      throw new SchemaCompileError(pointer, `type must be one of ${[...SIMPLE_TYPES].join(", ")}`);
    }
  }
  const allowed = types as string[];
  return (data, path, issues) => {
    if (allowed.some((t) => matchesType(data, t))) return;
    issues.push({
      path,
      keyword: "type",
      message: `must be ${allowed.join(" or ")}, got ${describeType(data)}`,
    });
  };
}

export function compileValueKeywords(
  node: Record<string, unknown>,
  pointer: string,
  checks: NodeValidator[],
): void {
  if ("const" in node) {
    const expected = node["const"] as JsonValue;
    checks.push((data, path, issues) => {
      if (!deepEqual(data, expected)) {
        issues.push({ path, keyword: "const", message: `must equal ${JSON.stringify(expected)}` });
      }
    });
  }

  if ("enum" in node) {
    const values = node["enum"];
    if (!Array.isArray(values) || values.length === 0) {
      throw new SchemaCompileError(pointer, "enum must be a non-empty array");
    }
    checks.push((data, path, issues) => {
      if (!values.some((v) => deepEqual(data, v as JsonValue))) {
        issues.push({
          path,
          keyword: "enum",
          message: `must be one of ${values.map((v) => JSON.stringify(v)).join(", ")}`,
        });
      }
    });
  }
}

export function compileStringKeywords(
  node: Record<string, unknown>,
  pointer: string,
  checks: NodeValidator[],
): void {
  const minLength = numberKeyword(node, "minLength", pointer);
  const maxLength = numberKeyword(node, "maxLength", pointer);
  if (minLength !== undefined) {
    checks.push((data, path, issues) => {
      if (typeof data === "string" && [...data].length < minLength) {
        issues.push({
          path,
          keyword: "minLength",
          message: `must be at least ${minLength} characters`,
        });
      }
    });
  }
  if (maxLength !== undefined) {
    checks.push((data, path, issues) => {
      if (typeof data === "string" && [...data].length > maxLength) {
        issues.push({
          path,
          keyword: "maxLength",
          message: `must be at most ${maxLength} characters`,
        });
      }
    });
  }
  if ("pattern" in node) {
    const raw = node["pattern"];
    if (typeof raw !== "string") throw new SchemaCompileError(pointer, "pattern must be a string");
    let regex: RegExp;
    try {
      regex = new RegExp(raw, "u");
    } catch (error) {
      throw new SchemaCompileError(
        pointer,
        `pattern is not a valid regular expression: ${String(error)}`,
      );
    }
    checks.push((data, path, issues) => {
      if (typeof data === "string" && !regex.test(data)) {
        issues.push({ path, keyword: "pattern", message: `must match ${raw}` });
      }
    });
  }
}

export function compileNumberKeywords(
  node: Record<string, unknown>,
  pointer: string,
  checks: NodeValidator[],
): void {
  const bounds: Array<
    [string, (value: number, limit: number) => boolean, (limit: number) => string]
  > = [
    ["minimum", (v, l) => v >= l, (l) => `must be >= ${l}`],
    ["maximum", (v, l) => v <= l, (l) => `must be <= ${l}`],
    ["exclusiveMinimum", (v, l) => v > l, (l) => `must be > ${l}`],
    ["exclusiveMaximum", (v, l) => v < l, (l) => `must be < ${l}`],
  ];
  for (const [keyword, ok, message] of bounds) {
    const limit = numberKeyword(node, keyword, pointer);
    if (limit === undefined) continue;
    checks.push((data, path, issues) => {
      if (typeof data === "number" && !ok(data, limit)) {
        issues.push({ path, keyword, message: message(limit) });
      }
    });
  }
  const multipleOf = numberKeyword(node, "multipleOf", pointer);
  if (multipleOf !== undefined) {
    if (multipleOf <= 0) throw new SchemaCompileError(pointer, "multipleOf must be > 0");
    checks.push((data, path, issues) => {
      if (typeof data !== "number") return;
      const quotient = data / multipleOf;
      if (!Number.isFinite(quotient) || Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        issues.push({
          path,
          keyword: "multipleOf",
          message: `must be a multiple of ${multipleOf}`,
        });
      }
    });
  }
}
