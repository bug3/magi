/**
 * The fixed council crew: three seats, always.
 *
 * Machine ids are the interface; display labels are cosmetic and never
 * compared. The harness behind a slot is configuration, not identity, so a
 * future harness swap changes a Slot value here and nothing else.
 */

export type SlotId = "melchior-1" | "balthasar-2" | "casper-3";

/** Model family, the unit the ledger's adoption/rejection tallies group by. */
export type Harness = "claude" | "codex" | "grok";

export interface Slot {
  readonly id: SlotId;
  readonly label: string;
  readonly harness: Harness;
}

export const SLOTS: readonly [Slot, Slot, Slot] = [
  { id: "melchior-1", label: "Melchior-1", harness: "claude" },
  { id: "balthasar-2", label: "Balthasar-2", harness: "codex" },
  { id: "casper-3", label: "Casper-3", harness: "grok" },
];

export function slot(id: SlotId): Slot {
  const found = SLOTS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`unknown slot: ${id}`);
  return found;
}
