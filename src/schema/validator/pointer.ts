/**
 * JSON pointer resolution and escaping (RFC 6901).
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
  for (const rawToken of jsonPointer.slice(1).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (isPlainObject(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else if (Array.isArray(current) && /^\d+$/.test(token)) {
      current = current[Number(token)];
    } else {
      throw new SchemaCompileError(pointer, `$ref "${ref}" does not resolve`);
    }
  }
  return current;
}

export function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}
