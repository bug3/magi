/**
 * Consult-level shared types.
 *
 * A consult is "complete" only with valid opinions from at least two distinct
 * harness families including one non-Claude seat; anything less is "degraded"
 * and proceeds only on explicit user decision.
 */

export type ConsultMode = "plan" | "review";

export type ConsultStatus = "complete" | "degraded";
