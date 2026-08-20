/**
 * Rendering foreign text safely.
 *
 * Captured seat logs, harness versions and anything echoed to the orchestrator
 * terminal are foreign text. Terminal control sequences in that text are not
 * cosmetic: OSC 52 writes the system clipboard, OSC 8 hides a link target
 * behind friendly text, and a bare carriage return can overwrite the line MAGI
 * just printed, which is enough to fake a passing gate.
 *
 * Raw streams stay on disk as private artifacts; only the rendered copy is
 * sanitized, so the audit trail keeps the original bytes.
 */

export interface SanitizeOptions {
  /** Truncate to this many characters, with a marker. */
  readonly maxLength?: number;
  /** Keep newlines (default) or fold them into spaces for one-line contexts. */
  readonly singleLine?: boolean;
}

// CSI (ESC [ ... final byte), OSC (ESC ] ... BEL or ST), then any remaining
// two-byte escape. Order matters: CSI and OSC are consumed before the catch-all.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/gu;
// ESC, any intermediate bytes, then one final byte: covers ESC c (terminal
// reset), ESC ( B (charset selection) and the rest of the two-byte family.
const REMAINING_ESCAPES = /\u001b[ -/]*[0-~]?/gu;
// C0 controls except tab and newline, plus DEL and the C1 range.
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu;

/**
 * Strips escape sequences and control characters, leaving text that renders as
 * itself. Newlines and tabs survive; everything else that could move the cursor,
 * repaint the screen or talk to the terminal does not.
 */
export function sanitizeForDisplay(text: string, options: SanitizeOptions = {}): string {
  // CONTROLS deliberately spares tab and newline; carriage return is not spared,
  // because "PASS\rFAIL" renders as a lie.
  let out = text
    .replaceAll(CSI, "")
    .replaceAll(OSC, "")
    .replaceAll(REMAINING_ESCAPES, "")
    .replaceAll(CONTROLS, "");
  if (options.singleLine === true) out = out.replaceAll(/\s*\n+\s*/gu, " ");
  out = out.trimEnd();

  const limit = options.maxLength;
  if (limit !== undefined && out.length > limit) {
    return `${out.slice(0, Math.max(0, limit - 3))}...`;
  }
  return out;
}

/** One-line form for table cells and status rows. */
export function sanitizeLine(text: string, maxLength = 200): string {
  return sanitizeForDisplay(text, { singleLine: true, maxLength });
}
