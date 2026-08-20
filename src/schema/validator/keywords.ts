/**
 * The keyword surface. Fail closed: anything not listed here is a compile
 * error rather than a silently ignored constraint.
 */

import { SchemaCompileError } from "./errors.ts";

export const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "title",
  "description",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

export const SUPPORTED_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);

export function numberKeyword(
  node: Record<string, unknown>,
  keyword: string,
  pointer: string,
): number | undefined {
  if (!(keyword in node)) return undefined;
  const value = node[keyword];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SchemaCompileError(pointer, `${keyword} must be a finite number`);
  }
  return value;
}
