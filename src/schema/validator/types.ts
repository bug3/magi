/**
 * The vocabulary the validator parts share: what a schema check is, what it
 * reports, and how a compilation is configured.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ValidationIssue {
  /** JSON pointer to the offending value ("" is the document root). */
  readonly path: string;
  /** The schema keyword that rejected the value. */
  readonly keyword: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: ValidationIssue[] };

/**
 * What a `$ref` needs from whatever it resolves to. Declared here rather than
 * importing CompiledSchema, so the type graph inside `validator/` stays acyclic.
 */
export interface SchemaRunner {
  readonly run: NodeValidator;
}

export interface CompileOptions {
  /**
   * Resolves a cross-artifact `$ref` (any ref that does not start with `#`)
   * to another compiled schema. Without it, non-local refs are a compile error.
   */
  readonly resolveExternal?: (ref: string) => SchemaRunner;
  /**
   * Allows `properties` without an explicit `additionalProperties`. Off by
   * default so the artifacts this repository ships stay closed by construction.
   */
  readonly allowImplicitAdditionalProperties?: boolean;
  /**
   * Compiles the subschema at this JSON pointer instead of the document root,
   * while keeping local `#/$defs/...` refs resolving against the document.
   */
  readonly entryPointer?: string;
}

export type NodeValidator = (data: unknown, path: string, issues: ValidationIssue[]) => void;

/**
 * Compilation state. `compile` is the recursion hook: keyword compilers need to
 * compile subschemas, and passing it here keeps the parts free of import cycles.
 */
export interface CompileContext {
  readonly root: unknown;
  readonly cache: Map<string, NodeValidator>;
  readonly options: CompileOptions;
  readonly compile: (node: unknown, ctx: CompileContext, pointer: string) => NodeValidator;
}
