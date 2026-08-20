/**
 * Branded id types for the values that cross module boundaries.
 *
 * A ConsultId or CitationId is only ever produced by its parse function, so a
 * malformed string fails where it enters the system, not where it is finally
 * used. The `as` casts below are the single place each brand is minted.
 */

declare const brand: unique symbol;
type Branded<Name extends string> = string & { readonly [brand]: Name };

/** Consult directory name: zero-padded ordinal plus kebab slug, e.g. "0001-design-review". */
export type ConsultId = Branded<"ConsultId">;

/** Evidence-pack excerpt id, e.g. "E7". Numbering starts at 1. */
export type CitationId = Branded<"CitationId">;

const CONSULT_ID = /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/;
const CITATION_ID = /^E[1-9]\d*$/;

export function consultId(value: string): ConsultId {
  if (!CONSULT_ID.test(value)) {
    throw new Error(`not a consult id: "${value}" (expected NNNN-kebab-slug)`);
  }
  return value as ConsultId;
}

export function citationId(value: string): CitationId {
  if (!CITATION_ID.test(value)) {
    throw new Error(`not a citation id: "${value}" (expected E<n>, n >= 1)`);
  }
  return value as CitationId;
}
