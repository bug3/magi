/**
 * A small, dependency-free JSON Schema (draft 2020-12 subset) validator.
 *
 * Why not a library: this repository ships zero runtime dependencies, and the
 * validator sits on the untrusted-input boundary, where every part should be
 * readable in one sitting.
 *
 * The subset is enforced **fail closed**: anything the validator does not
 * positively understand rejects. A schema using a keyword it does not
 * implement is a compile error, never a silently-ignored constraint. Objects
 * that declare `properties` must also declare `additionalProperties`, so no
 * artifact can accidentally accept unknown fields.
 *
 * Supported: $ref/$defs (local JSON pointers and cross-artifact ids), type,
 * const, enum, properties, required, additionalProperties, patternProperties,
 * propertyNames, minProperties, maxProperties, items, prefixItems, minItems,
 * maxItems, uniqueItems, minLength, maxLength, pattern, minimum, maximum,
 * exclusiveMinimum, exclusiveMaximum, multipleOf, allOf, anyOf, oneOf, not.
 *
 * Callers import this file so a later split of `validator/` cannot leak into
 * the rest of the tree.
 */

export { compileSchema } from "./validator/compile.ts";
export { CompiledSchema } from "./validator/compiled-schema.ts";
export { formatIssues, SchemaCompileError, SchemaValidationError } from "./validator/errors.ts";
export type {
  CompileOptions,
  JsonValue,
  ValidationIssue,
  ValidationResult,
} from "./validator/types.ts";
export { isPlainObject } from "./validator/values.ts";
