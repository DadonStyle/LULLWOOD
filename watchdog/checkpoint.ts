/**
 * Checkpoint the active ticket at end-of-cycle so work resumes exactly where it
 * paused after a wait. Plain JSON on disk; writing it costs no tokens.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Checkpoint {
  issueId: string;
  /** Free-form resume state the game/build loop needs to continue. */
  state: Record<string, unknown>;
  /** Decision line captured when the checkpoint was written. */
  lastLine: string;
  /** ISO time the cycle paused. */
  pausedAt: string;
  /** ISO time the watchdog intends to resume (the binding reset). */
  resumeAt: string | null;
}

export function writeCheckpoint(path: string, cp: Checkpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cp, null, 2), "utf8");
}

export function readCheckpoint(path: string): Checkpoint | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
  } catch {
    return null;
  }
}
