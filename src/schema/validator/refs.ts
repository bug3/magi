/**
 * `$ref` resolution: local JSON pointers, and cross-artifact ids that go
 * through the resolver supplied in `CompileOptions`. Both are resolved lazily
 * so recursive and mutually-referencing schemas terminate.
 */

import { SchemaCompileError } from "./errors.ts";
import { resolvePointer } from "./pointer.ts";
import type { CompileContext, NodeValidator, SchemaRunner } from "./types.ts";

export function compileRef(ref: string, ctx: CompileContext, pointer: string): NodeValidator {
  if (ref.startsWith("#")) return compileLocalRef(ref, ctx, pointer);

  const resolve = ctx.options.resolveExternal;
  if (!resolve)
    throw new SchemaCompileError(
      pointer,
      `cannot resolve external $ref "${ref}": no resolver configured`,
    );
  // Resolved on first use, so artifacts may reference each other in a cycle.
  let resolved: SchemaRunner | undefined;
  return (data, path, issues) => {
    const schema = resolved ?? resolve(ref);
    resolved = schema;
    schema.run(data, path, issues);
  };
}

function compileLocalRef(ref: string, ctx: CompileContext, pointer: string): NodeValidator {
  const cached = ctx.cache.get(ref);
  if (cached) return cached;

  // Registered before compiling the target so recursive schemas terminate.
  let inner: NodeValidator | undefined;
  const lazy: NodeValidator = (data, path, issues) => {
    if (!inner) throw new SchemaCompileError(pointer, `unresolved $ref "${ref}"`);
    inner(data, path, issues);
  };
  ctx.cache.set(ref, lazy);
  const target = resolvePointer(ctx.root, ref.slice(1), pointer, ref);
  inner = ctx.compile(target, ctx, ref);
  return lazy;
}
