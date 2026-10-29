import { canonicalJson, checksum } from "./persistence";
import type { Session } from "./session";

/**
 * Input log + replay (Playground borrow, S73). Every external influence on the
 * world is a **stamped input** applied at a tick; `(seed + content) + input log`
 * reproduces the same state, so a run can be replayed, diffed and bisected. A
 * **state digest** over the authoritative blocks turns a run into a hash that must
 * be identical across machines and thread counts.
 *
 * Inputs `commit` (a power) and `advance` (ticks) are the whole vocabulary today;
 * the shape is open so dialogue/setting inputs join without a format change.
 */
export const REPLAY_VERSION = 1;

export type SimInput =
  | { kind: "advance"; ticks: number }
  | { kind: "commit"; powerId: string; dose: number; slot: string | null; policy: string };

export interface StampedInput {
  tick: number;
  seq: number;
  input: SimInput;
}

export interface ReplayLog {
  version: number;
  seed: number;
  /** Content: the data ids the run depends on (a future content hash). */
  content: string[];
  inputs: StampedInput[];
  /** Day-boundary digests, for localising a divergence. */
  dayDigests: Array<{ day: number; digest: string }>;
  /** Per-row digests at the last day boundary, so a divergence names the row (S79). */
  rows?: Record<string, string>;
}

/** A digest of the authoritative state, so a replay can be compared as one value. */
export function stateDigest(session: Session): string {
  const json = session.toJSON();
  const picked: Record<string, unknown> = {};
  for (const key of ["clock", "subject", "town", "townEvents", "flags", "rng"]) {
    if (key in (json as Record<string, unknown>)) picked[key] = (json as Record<string, unknown>)[key];
  }
  return checksum(picked);
}

/**
 * Per-table (row-level) digests, so a divergence can be localised below the whole
 * state to the table that differs — and, within a table, the entity (S79).
 */
export function stateRows(session: Session): Record<string, string> {
  const json = session.toJSON() as Record<string, unknown>;
  const rows: Record<string, string> = {};
  for (const key of ["clock", "subject", "town", "townEvents", "flags", "rng"]) {
    if (key in json) rows[key] = checksum(canonicalJson(json[key]));
  }
  // the town splits into per-agent rows, so a divergence names the person
  const town = json.town as { agents?: Array<{ id: string }> } | undefined;
  for (const a of town?.agents ?? []) rows[`town.${a.id}`] = checksum(canonicalJson(a));
  return rows;
}

/** The first differing row key between two row sets, or null (S79 bisect). */
export function firstRowDifference(a: Record<string, string>, b: Record<string, string>): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...keys].sort()) if (a[key] !== b[key]) return key;
  return null;
}

/**
 * A recorder attached to a session. `apply` wraps the tick/commit seam so the log
 * is built as the run happens; nothing is recorded that did not also happen.
 */
export class ReplayRecorder {
  readonly log: ReplayLog;
  private seq = 0;

  constructor(seed: number, content: string[] = []) {
    this.log = { version: REPLAY_VERSION, seed, content, inputs: [], dayDigests: [] };
  }

  record(tick: number, input: SimInput): void {
    this.log.inputs.push({ tick, seq: this.seq++, input });
  }

  markDay(session: Session, day = session.clock.day): void {
    this.log.dayDigests.push({ day, digest: stateDigest(session) });
    this.log.rows = stateRows(session);
  }

  toJSON(): ReplayLog {
    return this.log;
  }
}

/** Compare two logs and return the first tick where a day digest differs, or null. */
export function firstDivergence(a: ReplayLog, b: ReplayLog): { day: number; a: string; b: string; row: string | null } | null {
  const n = Math.max(a.dayDigests.length, b.dayDigests.length);
  for (let i = 0; i < n; i++) {
    const da = a.dayDigests[i];
    const db = b.dayDigests[i];
    if (!da || !db || da.digest !== db.digest) {
      const row = a.rows && b.rows ? firstRowDifference(a.rows, b.rows) : null;
      return { day: da?.day ?? db?.day ?? i, a: da?.digest ?? "(none)", b: db?.digest ?? "(none)", row };
    }
  }
  return null;
}

export function logDigest(log: ReplayLog): string {
  return checksum(canonicalJson({ seed: log.seed, content: log.content, inputs: log.inputs }));
}
