/**
 * JSON value predicates. Kept apart from the keyword compilers because "what
 * counts as an object" is a decision the whole validator leans on.
 */

export const SIMPLE_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);

export function matchesType(data: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return data === null;
    case "boolean":
      return typeof data === "boolean";
    case "string":
      return typeof data === "string";
    case "number":
      return typeof data === "number" && Number.isFinite(data);
    case "integer":
      return typeof data === "number" && Number.isInteger(data);
    case "array":
      return Array.isArray(data);
    case "object":
      return isPlainObject(data);
    default:
      return false;
  }
}

export function describeType(data: unknown): string {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  if (typeof data === "number" && !Number.isFinite(data)) return "non-finite number";
  return typeof data;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}
