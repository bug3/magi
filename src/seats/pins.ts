/**
 * Model and reasoning-effort pins per slot.
 *
 * The ban is on the silent default, not on your preference: a pin brings the
 * preference back through an explicit, recorded flag. An absent pin is a
 * decision too: it means the CLI's own default is the value you want.
 */

import type { ProfileSelection } from "../core/profile.ts";
import type { SlotId } from "../core/slots.ts";

export interface SeatPin {
  /**
   * Model id or alias passed to the CLI's `--model`. Owner preference, not a
   * build-time fact: `magi doctor --live` verifies that the installed CLI still
   * accepts it. Absent means "let the CLI default decide" and the argv builder
   * omits the model flag entirely rather than guessing a value.
   */
  readonly model?: string;
  /**
   * Reasoning effort passed to the CLI's `--reasoning-effort`. Owner
   * preference, verified by `magi doctor --live`, never at build time. Absent
   * means the flag is omitted.
   */
  readonly reasoningEffort?: string;
}

export const SEAT_PINS: Readonly<Record<SlotId, SeatPin>> = {
  "melchior-1": {},
  // No model: codex keeps its own CLI default, so no --model flag is rendered.
  "balthasar-2": {},
  "casper-3": { model: "grok-4.6", reasoningEffort: "high" },
};

export function modelSelection(id: SlotId): ProfileSelection {
  return selection(SEAT_PINS[id].model);
}

export function reasoningEffortSelection(id: SlotId): ProfileSelection {
  return selection(SEAT_PINS[id].reasoningEffort);
}

function selection(value: string | undefined): ProfileSelection {
  return value === undefined ? { kind: "cli-default" } : { kind: "pinned", value };
}
