/**
 * A compiled schema: the handle callers keep and validate against.
 */

import { SchemaValidationError } from "./errors.ts";
import type { NodeValidator, ValidationIssue, ValidationResult } from "./types.ts";

export class CompiledSchema {
  /** @internal */ readonly run: NodeValidator;
  readonly id: string | undefined;

  /** @internal */
  constructor(run: NodeValidator, id: string | undefined) {
    this.run = run;
    this.id = id;
  }

  validate(data: unknown): ValidationResult {
    const issues: ValidationIssue[] = [];
    this.run(data, "", issues);
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  /** Throws {@link SchemaValidationError} when `data` does not validate. */
  assert(data: unknown, label = this.id ?? "value"): void {
    const result = this.validate(data);
    if (!result.ok) throw new SchemaValidationError(label, result.issues);
  }
}
