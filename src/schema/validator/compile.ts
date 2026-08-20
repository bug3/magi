/**
 * Compilation entry point and the per-node dispatch.
 *
 * A schema is compiled once into a tree of closures, so validating is a walk
 * over functions rather than a re-interpretation of the schema document.
 */

import { compileArrayKeywords } from "./arrays.ts";
import { compileCombinators } from "./combinators.ts";
import { CompiledSchema } from "./compiled-schema.ts";
import { SchemaCompileError } from "./errors.ts";
import { ANNOTATION_KEYWORDS, SUPPORTED_KEYWORDS } from "./keywords.ts";
import { compileObjectKeywords } from "./objects.ts";
import { resolvePointer } from "./pointer.ts";
import { compileRef } from "./refs.ts";
import {
  compileNumberKeywords,
  compileStringKeywords,
  compileType,
  compileValueKeywords,
} from "./scalars.ts";
import type { CompileContext, CompileOptions, NodeValidator } from "./types.ts";
import { isPlainObject } from "./values.ts";

export function compileSchema(schema: unknown, options: CompileOptions = {}): CompiledSchema {
  const ctx: CompileContext = { root: schema, cache: new Map(), options, compile: compileNode };
  const entry = options.entryPointer ?? "";
  const node = entry === "" ? schema : resolvePointer(schema, entry, "", `#${entry}`);
  const run = compileNode(node, ctx, entry);
  const id = isPlainObject(schema) && typeof schema["$id"] === "string" ? schema["$id"] : undefined;
  return new CompiledSchema(
    run,
    id === undefined ? undefined : `${id}${entry === "" ? "" : `#${entry}`}`,
  );
}

function compileNode(node: unknown, ctx: CompileContext, pointer: string): NodeValidator {
  if (node === true) return () => {};
  if (node === false) {
    return (_data, path, issues) =>
      issues.push({ path, keyword: "false", message: "no value is valid here" });
  }
  if (!isPlainObject(node))
    throw new SchemaCompileError(pointer, "schema must be an object or a boolean");

  for (const keyword of Object.keys(node)) {
    if (ANNOTATION_KEYWORDS.has(keyword) || SUPPORTED_KEYWORDS.has(keyword)) continue;
    throw new SchemaCompileError(
      pointer,
      `unsupported keyword "${keyword}" (this validator is fail-closed)`,
    );
  }

  if ("$ref" in node) {
    const ref = node["$ref"];
    if (typeof ref !== "string") throw new SchemaCompileError(pointer, "$ref must be a string");
    const siblings = Object.keys(node).filter(
      (k) => k !== "$ref" && !ANNOTATION_KEYWORDS.has(k) && k !== "$defs",
    );
    if (siblings.length > 0) {
      throw new SchemaCompileError(
        pointer,
        `$ref must not have sibling keywords (${siblings.join(", ")})`,
      );
    }
    return compileRef(ref, ctx, pointer);
  }

  const checks: NodeValidator[] = [];
  const typeCheck = compileType(node, ctx, pointer);

  compileValueKeywords(node, pointer, checks);
  compileStringKeywords(node, pointer, checks);
  compileNumberKeywords(node, pointer, checks);
  compileArrayKeywords(node, ctx, pointer, checks);
  compileObjectKeywords(node, ctx, pointer, checks);
  compileCombinators(node, ctx, pointer, checks);

  return (data, path, issues) => {
    const before = issues.length;
    typeCheck(data, path, issues);
    // A wrong type makes every other keyword noise, so stop here.
    if (issues.length > before) return;
    for (const check of checks) check(data, path, issues);
  };
}
