import { ContentError } from "./loader";
import type { Rng } from "./rng";

/**
 * Memory (Playground borrow, S74). A memory is a durable, typed trace a person
 * carries: who it involved, how strong (severity), which way it pulled (impact),
 * how much it matters (importance) and how fast it fades. Important memories
 * persist; minor ones decay and are forgotten, and what is forgotten is **rolled up**
 * into the relationship it concerned so a bond never forgets everything.
 *
 * Retrieval scores by importance, recency, participant overlap and topic match and
 * **returns its reasons**, so the inspector can explain why a memory surfaced. Data
 * (`memory.json`); all integers.
 */
export const MEMORY_VERSION = 1;

export interface MemoryParams {
  /** A memory at or above this importance is never forgotten. */
  persist_threshold: number;
  /** Per-agent bound on **ordinary** (non-persistent) memories. */
  max_memories: number;
  /** Retention lost per day = max(1, decay_base / severity). */
  decay_base: number;
}

export const DEFAULT_MEMORY_PARAMS: MemoryParams = Object.freeze({ persist_threshold: 60, max_memories: 40, decay_base: 20 });

export function buildMemoryParams(data: unknown): MemoryParams {
  const d = (data as { memory?: Partial<MemoryParams> } | null | undefined)?.memory;
  if (!d || typeof d !== "object") throw new ContentError('memory.json must declare a "memory" object', "memory.json");
  return { ...DEFAULT_MEMORY_PARAMS, ...d };
}

export interface Memory {
  id: string;
  type: string;
  tick: number;
  /** Who it involved (ids). */
  participants: string[];
  /** 1..5 base weight by type. */
  severity: number;
  /** Signed pull on the person, from the outcome tone/magnitude. */
  impact: number;
  /** Derived: severity * (10 + |impact|). */
  importance: number;
  decay_per_day: number;
  retention: number;
  topic: string;
  /** A key for the sentence (`memory.<summary_key>`). */
  summary_key: string;
}

export function importance(severity: number, impact: number): number {
  return severity * (10 + Math.abs(impact));
}

export function decayPerDay(severity: number, params: MemoryParams): number {
  return Math.max(1, Math.floor(params.decay_base / Math.max(1, severity)));
}

export function isPersistent(m: Memory, params: MemoryParams): boolean {
  return m.importance >= params.persist_threshold;
}

export interface MemorySpec {
  type: string;
  tick: number;
  participants?: string[];
  severity: number;
  impact: number;
  topic?: string;
  summary_key?: string;
}

/** A relationship's rollup of what faded (so a bond keeps a faint trace, S74). */
export interface forgetRollup {
  forgotten: number;
  last_topic: string | null;
}

export interface MemorySpec {
  type: string;
  tick: number;
  participants?: string[];
  severity: number;
  impact: number;
  topic?: string;
  summary_key?: string;
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A **content-derived** id, so two sessions in one process stay deterministic. */
function memId(spec: MemorySpec, seq: number): string {
  return `mem_${hash32(`${spec.type}:${spec.tick}:${spec.topic ?? ""}:${spec.participants?.join("+") ?? ""}:${seq}`).toString(36)}`;
}

/**
 * Add a memory. When over the ordinary bound, forget the lowest
 * `importance * retention` ordinary memory (ties: older, then id) and return it so
 * the caller can roll it into a relationship.
 */
export function remember(store: Memory[], spec: MemorySpec, params: MemoryParams): Memory | null {
  const m: Memory = {
    id: memId(spec, store.length),
    type: spec.type,
    tick: spec.tick,
    participants: spec.participants ?? [],
    severity: spec.severity,
    impact: spec.impact,
    importance: importance(spec.severity, spec.impact),
    decay_per_day: decayPerDay(spec.severity, params),
    retention: 1000,
    topic: spec.topic ?? "",
    summary_key: spec.summary_key ?? `${spec.type}.${spec.topic ?? "none"}`,
  };
  store.push(m);

  const ordinary = store.filter((x) => !isPersistent(x, params));
  if (ordinary.length <= params.max_memories) return null;
  const victim = ordinary
    .slice()
    .sort((a, b) => a.importance * a.retention - b.importance * b.retention || a.tick - b.tick || a.id.localeCompare(b.id))[0]!;
  const idx = store.indexOf(victim);
  if (idx >= 0) store.splice(idx, 1);
  return victim;
}

/** The daily fade. Returns the memories that expired this day (persistent exempt). */
export function ageMemories(store: Memory[], params: MemoryParams, nowTick: number): Memory[] {
  const expired: Memory[] = [];
  for (const m of store) {
    if (isPersistent(m, params)) continue;
    m.retention -= m.decay_per_day;
  }
  for (let i = store.length - 1; i >= 0; i--) {
    const m = store[i]!;
    if (isPersistent(m, params)) continue;
    if (m.retention <= 0 && m.tick !== nowTick) {
      expired.push(m);
      store.splice(i, 1);
    }
  }
  return expired;
}

export type Reason = { kind: "important"; value: number } | { kind: "recent" } | { kind: "participant" } | { kind: "topic" };

export interface Relevant {
  memory: Memory;
  score: number;
  reasons: Reason[];
}

export interface SelectContext {
  tick: number;
  /** A person in focus (for participant overlap). */
  about?: string;
  /** A topic in context. */
  topic?: string;
  /** Recency window in ticks. */
  recentTicks?: number;
}

/** Score and return the `n` most relevant memories, best first, each with reasons. */
export function selectRelevant(store: readonly Memory[], ctx: SelectContext, n = 5): Relevant[] {
  const recent = ctx.recentTicks ?? 48;
  const scored: Relevant[] = store.map((m) => {
    let score = m.importance;
    const reasons: Reason[] = [{ kind: "important", value: m.importance }];
    const age = Math.max(0, ctx.tick - m.tick);
    if (age < recent) {
      score += ((recent - age) * 300) / recent;
      reasons.push({ kind: "recent" });
    }
    if (ctx.about && m.participants.includes(ctx.about)) {
      score += 200;
      reasons.push({ kind: "participant" });
    }
    if (ctx.topic && m.topic === ctx.topic) {
      score += 150;
      reasons.push({ kind: "topic" });
    }
    return { memory: m, score, reasons };
  });
  return scored.sort((a, b) => b.score - a.score || b.memory.tick - a.memory.tick || a.memory.id.localeCompare(b.memory.id)).slice(0, n);
}

/**
 * A bounded memory store for one person, with the parameters it runs under. Held
 * per agent on the town (single writer: this class).
 */
export class MemoryStore {
  readonly params: MemoryParams;
  readonly memories: Memory[] = [];
  /** Rolled-up traces of forgotten memories, keyed by the other party. */
  readonly rollups = new Map<string, forgetRollup>();

  constructor(params: MemoryParams) {
    this.params = params;
  }

  add(spec: MemorySpec): Memory {
    const forgotten = remember(this.memories, spec, this.params);
    if (forgotten) this.rollInto(forgotten);
    return this.memories[this.memories.length - 1]!;
  }

  private rollInto(m: Memory): void {
    const other = m.participants[0];
    if (!other) return;
    const r = this.rollups.get(other) ?? { forgotten: 0, last_topic: null };
    r.forgotten += 1;
    if (m.topic) r.last_topic = m.topic;
    this.rollups.set(other, r);
  }

  age(nowTick: number): number {
    const expired = ageMemories(this.memories, this.params, nowTick);
    for (const m of expired) this.rollInto(m);
    return expired.length;
  }

  relevant(ctx: SelectContext, n = 5): Relevant[] {
    return selectRelevant(this.memories, ctx, n);
  }

  toJSON(): { memories: Memory[]; rollups: Array<[string, forgetRollup]> } {
    return { memories: this.memories.map((m) => ({ ...m, participants: [...m.participants] })), rollups: [...this.rollups.entries()] };
  }

  adopt(json: ReturnType<MemoryStore["toJSON"]> | undefined | null): void {
    if (!json) return;
    this.memories.length = 0;
    for (const m of json.memories ?? []) this.memories.push({ ...m, participants: [...m.participants] });
    this.rollups.clear();
    for (const [k, v] of json.rollups ?? []) this.rollups.set(k, { ...v });
  }
}

export function chooseSeverity(rng: Rng, base: number, jitter = 1): number {
  return Math.max(1, Math.min(5, base + rng.int("world", -jitter, jitter)));
}

export function buildMemoryStore(data: unknown): MemoryStore {
  return new MemoryStore(buildMemoryParams(data));
}
