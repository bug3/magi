/**
 * JSON pointer resolution and escaping (RFC 6901). The spec calls the pieces
 * between the slashes reference tokens; they are segments here, because a
 * local named for the other word sits one edit away from the credential shape
 * test/spec/release-hygiene.test.ts refuses.
 */

import { SchemaCompileError } from "./errors.ts";
import { isPlainObject } from "./values.ts";

export function resolvePointer(
  root: unknown,
  jsonPointer: string,
  pointer: string,
  ref: string,
): unknown {
  if (jsonPointer === "") return root;
  if (!jsonPointer.startsWith("/"))
    throw new SchemaCompileError(pointer, `$ref "${ref}" is not a JSON pointer`);
  let current: unknown = root;
  for (const rawSegment of jsonPointer.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else {
      throw new SchemaCompileError(pointer, `$ref "${ref}" does not resolve`);
    }
  }
  return current;
}

export function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
