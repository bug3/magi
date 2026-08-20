/**
 * Chronic-failure counters from the ledger, per seat: the council must not
 * silently collapse toward monoculture. Alerting
 * is mechanical: a seat whose last CHRONIC_WINDOW appearances were all
 * invalid is flagged, whatever anyone thinks of its opinions.
 */

export interface SeatHealth {
  readonly slot: string;
  readonly appearances: number;
  readonly invalid: number;
  /** True when the seat's last CHRONIC_WINDOW appearances were all invalid. */
  readonly chronic: boolean;
}

const CHRONIC_WINDOW = 3;

export function healthFromLedger(lines: readonly string[]): readonly SeatHealth[] {
  const bySlot = new Map<string, boolean[]>();
  for (const line of lines) {
    const text = line.trim();
    if (text === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(text);
    } catch {
      continue;
    }
    const seats = (row as { seats?: readonly { slot?: unknown; valid?: unknown }[] }).seats ?? [];
    for (const seat of seats) {
      if (typeof seat.slot !== "string") continue;
      const history = bySlot.get(seat.slot) ?? [];
      history.push(seat.valid === true);
      bySlot.set(seat.slot, history);
    }
  }
  return [...bySlot.entries()].map(([slot, history]) => {
    const recent = history.slice(-CHRONIC_WINDOW);
    return {
      slot,
      appearances: history.length,
      invalid: history.filter((valid) => !valid).length,
      chronic: recent.length === CHRONIC_WINDOW && recent.every((valid) => !valid),
    };
  });
}
