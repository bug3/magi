/**
 * The harness-to-parser table, in one place.
 *
 * Three readers need it and each once kept its own copy: the validity gate,
 * the live smoke, and the rule that says whether a seat answered. A copy is
 * not a second opinion, it is a second place to forget, so the mapping lives
 * here and `test/spec/canonical-homes.test.ts` refuses a fourth.
 */

import { parseClaudeOutput } from "./claude.ts";
import { parseCodexOutput } from "./codex.ts";
import { parseGrokOutput } from "./grok.ts";
import type { ParseResult } from "./types.ts";
import type { Harness } from "../core/slots.ts";

/** Exhaustive over the harnesses: a new seat is a compile error here. */
export const SEAT_PARSERS: Readonly<Record<Harness, (stdout: string) => ParseResult>> = {
  claude: parseClaudeOutput,
  codex: parseCodexOutput,
  grok: parseGrokOutput,
};
