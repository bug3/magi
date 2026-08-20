/**
 * The complete/degraded label. See `docs/protocol.md`, "Failure policy".
 *
 * Complete requires valid opinions from at least two distinct harness families,
 * including at least one non-Claude seat: the party under review must never
 * be the only voice left standing. A degraded consult proceeds only on an
 * explicit user decision, which is the caller's job to obtain.
 */

import type { ConsultStatus } from "../core/consult.ts";
import { slot, type SlotId } from "../core/slots.ts";

export function consultStatus(validSeats: readonly SlotId[]): ConsultStatus {
  const families = new Set(validSeats.map((id) => slot(id).harness));
  const hasForeign = [...families].some((family) => family !== "claude");
  return families.size >= 2 && hasForeign ? "complete" : "degraded";
}
