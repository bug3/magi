/**
 * Allocating the next consult id from what is already on disk.
 *
 * The consult directory is the source of truth: no counter file can drift
 * from it, and a hand-created consult directory is counted like any other.
 */

import { existsSync, readdirSync } from "node:fs";

import { consultId, type ConsultId } from "../core/ids.ts";

const ORDINAL_WIDTH = 4;
const ORDINAL_PREFIX = /^(\d{4})-/;

export function nextConsultId(consultsDir: string, slug: string): ConsultId {
  const taken = existsSync(consultsDir)
    ? readdirSync(consultsDir)
        .map((name) => ORDINAL_PREFIX.exec(name)?.[1])
        .filter((ordinal): ordinal is string => ordinal !== undefined)
        .map((ordinal) => Number(ordinal))
    : [];
  const next = taken.length === 0 ? 1 : Math.max(...taken) + 1;
  return consultId(`${String(next).padStart(ORDINAL_WIDTH, "0")}-${slug}`);
}
