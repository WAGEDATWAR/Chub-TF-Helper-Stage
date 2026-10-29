import { VOICE_VERSION, PROMPT_VERSION } from "./llm";

/**
 * Line pool (blueprint §37; M15). A per-key pool holds authored lines and, when
 * generated lines are enabled, generated ones. Entries are tagged with
 * `voice_version` and `prompt_version`; a bump does not wipe the pool — it
 * **deprioritizes** stale entries, so a run of the same scene keeps offering fresh
 * material while old lines remain available.
 */
export const POOL_VERSION = 1;

export interface PoolEntry {
  line: string;
  authored: boolean;
  voice_version: number;
  prompt_version: number;
  addedAtTick: number;
  used: number;
}

export class LinePool {
  private readonly byKey = new Map<string, PoolEntry[]>();
  readonly capacityPerKey: number;

  constructor(capacityPerKey = 24) {
    this.capacityPerKey = capacityPerKey;
  }

  add(key: string, line: string, { authored = false, tick = 0 } = {}): PoolEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const list = this.byKey.get(key) ?? [];
    if (list.some((e) => e.line === trimmed)) return null;
    const entry: PoolEntry = { line: trimmed, authored, voice_version: VOICE_VERSION, prompt_version: PROMPT_VERSION, addedAtTick: tick, used: 0 };
    list.push(entry);
    if (list.length > this.capacityPerKey) {
      // drop the most-used stale non-authored entry first
      list.sort((a, b) => score(b) - score(a));
      list.pop();
    }
    this.byKey.set(key, list);
    return entry;
  }

  /** Fresh (current-version, unused) first; stale entries deprioritized (kept). */
  candidates(key: string): PoolEntry[] {
    const list = this.byKey.get(key) ?? [];
    return [...list].sort((a, b) => rank(b) - rank(a));
  }

  /** Pick the best entry, marking it used; skips the last N used for variety. */
  take(key: string, recent: readonly string[] = []): PoolEntry | null {
    const fresh = this.candidates(key).filter((e) => !recent.includes(e.line));
    const pool = fresh.length > 0 ? fresh : this.candidates(key);
    const best = pool[0];
    if (!best) return null;
    best.used += 1;
    return best;
  }

  size(key: string): number {
    return (this.byKey.get(key) ?? []).length;
  }

  keys(): string[] {
    return [...this.byKey.keys()];
  }

  toJSON(): Record<string, PoolEntry[]> {
    return Object.fromEntries([...this.byKey].map(([k, v]) => [k, v.map((e) => ({ ...e }))]));
  }

  static fromJSON(json: Record<string, PoolEntry[]> | undefined): LinePool {
    const pool = new LinePool();
    for (const [k, list] of Object.entries(json ?? {})) pool.byKey.set(k, list.map((e) => ({ ...e })));
    return pool;
  }

  /** Copy entries from another pool into this one (rehydrate). */
  adopt(other: LinePool): void {
    for (const [k, list] of other.byKey) this.byKey.set(k, list.map((e) => ({ ...e })));
  }
}

function staleness(e: PoolEntry): number {
  return (e.voice_version !== VOICE_VERSION ? 1 : 0) + (e.prompt_version !== PROMPT_VERSION ? 1 : 0);
}
function rank(e: PoolEntry): number {
  return (staleness(e) === 0 ? 100 : 0) + (e.authored ? 5 : 0) - e.used;
}
function score(e: PoolEntry): number {
  return (staleness(e) === 0 ? 10 : 0) + e.used - (e.authored ? 1 : 0);
}

export function createLinePool(capacityPerKey?: number): LinePool {
  return new LinePool(capacityPerKey);
}
