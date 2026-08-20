/**
 * Keyword compilers for objects, including the fail-closed rule that an object
 * declaring `properties` must also declare `additionalProperties`.
 */

import { SchemaCompileError } from "./errors.ts";
import { numberKeyword } from "./keywords.ts";
import { escapePointerToken } from "./pointer.ts";
import type { CompileContext, NodeValidator } from "./types.ts";
import { isPlainObject } from "./values.ts";

export function compileObjectKeywords(
  node: Record<string, unknown>,
  ctx: CompileContext,
  pointer: string,
  checks: NodeValidator[],
): void {
  const propertySchemas = new Map<string, NodeValidator>();
  if ("properties" in node) {
    const props = node["properties"];
    if (!isPlainObject(props))
      throw new SchemaCompileError(pointer, "properties must be an object");
    for (const [key, value] of Object.entries(props)) {
      propertySchemas.set(key, ctx.compile(value, ctx, `${pointer}/properties/${key}`));
    }
  }

  const patternSchemas: Array<[RegExp, NodeValidator]> = [];
  if ("patternProperties" in node) {
    const patterns = node["patternProperties"];
    if (!isPlainObject(patterns))
      throw new SchemaCompileError(pointer, "patternProperties must be an object");
    for (const [pattern, value] of Object.entries(patterns)) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "u");
      } catch (error) {
        throw new SchemaCompileError(
          pointer,
          `patternProperties key is not a valid regex: ${String(error)}`,
        );
      }
      patternSchemas.push([
        regex,
        ctx.compile(value, ctx, `${pointer}/patternProperties/${pattern}`),
      ]);
    }
  }

  if ("required" in node) {
    const required = node["required"];
    if (!Array.isArray(required) || required.some((k) => typeof k !== "string")) {
      throw new SchemaCompileError(pointer, "required must be an array of strings");
    }
    const keys = required as string[];
    checks.push((data, path, issues) => {
      if (!isPlainObject(data)) return;
      for (const key of keys) {
        if (!Object.hasOwn(data, key)) {
          issues.push({ path, keyword: "required", message: `missing required property "${key}"` });
        }
      }
    });
  }

  const hasProperties = propertySchemas.size > 0 || patternSchemas.length > 0;
  if (
    hasProperties &&
    !("additionalProperties" in node) &&
    !ctx.options.allowImplicitAdditionalProperties
  ) {
    throw new SchemaCompileError(
      pointer,
      "objects with properties must declare additionalProperties explicitly (fail-closed policy)",
    );
  }

  let additional: NodeValidator | undefined;
  if ("additionalProperties" in node) {
    additional = ctx.compile(node["additionalProperties"], ctx, `${pointer}/additionalProperties`);
  }

  if (hasProperties || additional) {
    checks.push((data, path, issues) => {
      if (!isPlainObject(data)) return;
      for (const [key, value] of Object.entries(data)) {
        const childPath = `${path}/${escapePointerToken(key)}`;
        const declared = propertySchemas.get(key);
        if (declared) {
          declared(value, childPath, issues);
          continue;
        }
        const matching = patternSchemas.filter(([regex]) => regex.test(key));
        if (matching.length > 0) {
          for (const [, validator] of matching) validator(value, childPath, issues);
          continue;
        }
        if (additional) {
          const before = issues.length;
          additional(value, childPath, issues);
          if (issues.length > before && node["additionalProperties"] === false) {
            issues.splice(before, issues.length - before, {
              path: childPath,
              keyword: "additionalProperties",
              message: `unknown property "${key}"`,
            });
          }
        }
      }
    });
  }

  if ("propertyNames" in node) {
    const nameValidator = ctx.compile(node["propertyNames"], ctx, `${pointer}/propertyNames`);
    checks.push((data, path, issues) => {
      if (!isPlainObject(data)) return;
      for (const key of Object.keys(data)) {
        const before = issues.length;
        nameValidator(key, `${path}/${escapePointerToken(key)}`, issues);
        if (issues.length > before) {
          issues.splice(before, issues.length - before, {
            path: `${path}/${escapePointerToken(key)}`,
            keyword: "propertyNames",
            message: `property name "${key}" is not allowed here`,
          });
        }
      }
    });
  }

  const minProperties = numberKeyword(node, "minProperties", pointer);
  const maxProperties = numberKeyword(node, "maxProperties", pointer);
  if (minProperties !== undefined) {
    checks.push((data, path, issues) => {
      if (isPlainObject(data) && Object.keys(data).length < minProperties) {
        issues.push({
          path,
          keyword: "minProperties",
          message: `must have at least ${minProperties} properties`,
        });
      }
    });
  }
  if (maxProperties !== undefined) {
    checks.push((data, path, issues) => {
      if (isPlainObject(data) && Object.keys(data).length > maxProperties) {
        issues.push({
          path,
          keyword: "maxProperties",
          message: `must have at most ${maxProperties} properties`,
        });
      }
    });
  }
}
