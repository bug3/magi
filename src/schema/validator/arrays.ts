/**
 * Keyword compilers for arrays: items, prefixItems, bounds, uniqueItems.
 */

import { SchemaCompileError } from "./errors.ts";
import { numberKeyword } from "./keywords.ts";
import type { CompileContext, JsonValue, NodeValidator } from "./types.ts";
import { deepEqual } from "./values.ts";

export function compileArrayKeywords(
  node: Record<string, unknown>,
  ctx: CompileContext,
  pointer: string,
  checks: NodeValidator[],
): void {
  const prefix = "prefixItems" in node ? compilePrefixItems(node["prefixItems"], ctx, pointer) : [];
  if ("items" in node) {
    const itemValidator = ctx.compile(node["items"], ctx, `${pointer}/items`);
    checks.push((data, path, issues) => {
      if (!Array.isArray(data)) return;
      for (let i = prefix.length; i < data.length; i++)
        itemValidator(data[i], `${path}/${i}`, issues);
    });
  }
  if (prefix.length > 0) {
    checks.push((data, path, issues) => {
      if (!Array.isArray(data)) return;
      for (let i = 0; i < prefix.length && i < data.length; i++) {
        const validator = prefix[i];
        if (validator !== undefined) validator(data[i], `${path}/${i}`, issues);
      }
    });
  }
  const minItems = numberKeyword(node, "minItems", pointer);
  const maxItems = numberKeyword(node, "maxItems", pointer);
  if (minItems !== undefined) {
    checks.push((data, path, issues) => {
      if (Array.isArray(data) && data.length < minItems) {
        issues.push({ path, keyword: "minItems", message: `must have at least ${minItems} items` });
      }
    });
  }
  if (maxItems !== undefined) {
    checks.push((data, path, issues) => {
      if (Array.isArray(data) && data.length > maxItems) {
        issues.push({ path, keyword: "maxItems", message: `must have at most ${maxItems} items` });
      }
    });
  }
  if (node["uniqueItems"] === true) {
    checks.push((data, path, issues) => {
      if (!Array.isArray(data)) return;
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepEqual(data[i] as JsonValue, data[j] as JsonValue)) {
            issues.push({
              path,
              keyword: "uniqueItems",
              message: `items ${i} and ${j} are duplicates`,
            });
            return;
          }
        }
      }
    });
  } else if ("uniqueItems" in node && node["uniqueItems"] !== false) {
    throw new SchemaCompileError(pointer, "uniqueItems must be a boolean");
  }
}

function compilePrefixItems(raw: unknown, ctx: CompileContext, pointer: string): NodeValidator[] {
  if (!Array.isArray(raw)) throw new SchemaCompileError(pointer, "prefixItems must be an array");
  return raw.map((entry, index) => ctx.compile(entry, ctx, `${pointer}/prefixItems/${index}`));
}
