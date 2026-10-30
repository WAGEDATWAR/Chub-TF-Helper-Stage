import { ContentError } from "./loader";
import { TICKS_PER_DAY } from "./time";

/**
 * Preferences + the reaction log (blueprint §22; D-184–D-188; M15.5c).
 *
 * The old "reaction" concept is split:
 *   - a **Reaction** is *how she felt* — one crystallizing memory (`awakening` or
 *     `trauma`) recorded with a **topic** and an importance score;
 *   - a **Preference** is *what became of it* — the settled fetish/limit/phobia
 *     on that topic, which tiers up as more reactions accumulate.
 *
 * Uncrystallized reactions sit in a **log** and decay, slower the more important
 * they are. Opinion accrues on a **topic**; past threshold, with matching
 * criteria, a repeated reaction crystallizes into (or escalates) a Preference.
 *
 * `subject.reactions` (the legacy view) is derived from crystallized preferences
 * so existing systems keep reading `{ id, type, strength }`.
 */
export const PREFERENCES_VERSION = 1;

export type PreferenceKind = "fetish" | "limit" | "phobia";
export type ReactionKind = "awakening" | "trauma";

/** Ascending tiers per path. A trauma never crystallizes straight to phobia. */
export const FETISH_TIERS = Object.freeze(["interested", "entangled", "obsessed"] as const);
export const TRAUMA_TIERS = Object.freeze(["unease", "aversion", "phobia"] as const);
export type FetishTier = (typeof FETISH_TIERS)[number];
export type TraumaTier = (typeof TRAUMA_TIERS)[number];

export const OPINION_THRESHOLD = 65;
export const LOG_CAPACITY = 60;

export interface Preference {
  /** The topic this settles on. */
  topic: string;
  kind: PreferenceKind;
  tier: string;
  /** Signed opinion, -100..100 (fetishes positive, limits negative). */
  opinion: number;
  settledAtTick: number;
  /** The named condition rule that crystallized it (M16.5c). */
  rule?: string;
}

export interface ReactionMemory {
  id: number;
  topic: string;
  kind: ReactionKind;
  /** Signed opinion this reaction carries into the topic. */
  opinion: number;
  importance: number;
  tick: number;
  /** Last tick the topic was touched by a matching reaction (decay anchor). */
  touchedAtTick: number;
}

export interface PreferenceTopicDef {
  id: string;
  label: string;
  /** Generic data-driven parent (a species tag, a part role, or a self topic). */
  parent: string;
  parentKind: "tag" | "role" | "self";
  tags?: string[];
}

export interface TopicRegistryData {
  topics: PreferenceTopicDef[];
}

export class TopicRegistry {
  private readonly byId: Map<string, PreferenceTopicDef>;
  readonly childrenOf = new Map<string, string[]>();

  constructor(data: TopicRegistryData) {
    this.byId = new Map();
    for (const t of data.topics) {
      if (!t.id || !t.parent) throw new ContentError(`topic "${t.id}" needs an id and parent`, "topics.json");
      if (this.byId.has(t.id)) throw new ContentError(`duplicate topic "${t.id}"`, "topics.json");
      this.byId.set(t.id, t);
    }
    for (const t of data.topics) {
      const list = this.childrenOf.get(t.parent) ?? [];
      list.push(t.id);
      this.childrenOf.set(t.parent, list);
    }
  }

  get(id: string): PreferenceTopicDef | null {
    return this.byId.get(id) ?? null;
  }

  all(): PreferenceTopicDef[] {
    return [...this.byId.values()];
  }

  /** The topic whose tags are all carried by `tags`, if any. */
  match(tags: readonly string[]): PreferenceTopicDef | null {
    let best: PreferenceTopicDef | null = null;
    for (const t of this.all()) {
      const wanted = t.tags ?? [];
      if (wanted.length > 0 && wanted.every((tag) => tags.includes(tag))) {
        if (!best || wanted.length > (best.tags?.length ?? 0)) best = t;
      }
    }
    return best;
  }
}

export function buildTopicRegistry(data: unknown): TopicRegistry {
  const topics = (data as { topics?: unknown } | null | undefined)?.topics;
  if (!Array.isArray(topics)) throw new ContentError('topics.json must declare a "topics" array', "topics.json");
  return new TopicRegistry({ topics: topics as PreferenceTopicDef[] });
}

export function tiersFor(kind: PreferenceKind): readonly string[] {
  return kind === "fetish" ? FETISH_TIERS : TRAUMA_TIERS;
}

/** The kind a first crystallization takes: awakening→fetish, trauma→limit. */
export function kindForReaction(kind: ReactionKind): PreferenceKind {
  return kind === "awakening" ? "fetish" : "limit";
}

export class Preferences {
  version = PREFERENCES_VERSION;
  private readonly map: Map<string, Preference> = new Map();
  private log: ReactionMemory[] = [];
  private nextReactionId = 1;

  all(): Preference[] {
    return [...this.map.values()];
  }

  get(topic: string): Preference | null {
    return this.map.get(topic) ?? null;
  }

  has(topic: string): boolean {
    return this.map.has(topic);
  }

  /** The preference log (uncrystallized reactions), newest last. */
  reactions(): ReactionMemory[] {
    return this.log.map((r) => ({ ...r }));
  }

  /** Record a crystallizing memory; returns it. */
  recordReaction(topic: string, kind: ReactionKind, opinion: number, importance: number, tick: number): ReactionMemory {
    const mem: ReactionMemory = { id: this.nextReactionId++, topic, kind, opinion, importance: clampUnit(importance), tick, touchedAtTick: tick };
    this.log.push(mem);
    if (this.log.length > LOG_CAPACITY) this.log.shift();
    return mem;
  }

  /**
   * Importance-weighted decay: every reaction loses opinion over time, scaled by
   * how long since its topic was last touched and inversely by its importance.
   * A high-importance memory persists far longer. Expired reactions are dropped.
   */
  decay(tick: number, rate = 1.5): number {
    let dropped = 0;
    const kept: ReactionMemory[] = [];
    for (const r of this.log) {
      // age in DAYS, scaled by 24 so the per-day loss matches the old hour-tick rate
      // (D-292): the unit changed, the felt pace did not.
      const age = Math.max(0, tick - r.touchedAtTick) / TICKS_PER_DAY;
      const loss = (rate * age * 24) / 100 / (0.4 + r.importance); // importance slows loss
      r.opinion = r.opinion - Math.sign(r.opinion || 1) * loss;
      if (Math.abs(r.opinion) >= 2) kept.push(r);
      else dropped++;
    }
    this.log = kept;
    return dropped;
  }

  /** Reactions on a topic (for the opinion check). */
  onTopic(topic: string): ReactionMemory[] {
    return this.log.filter((r) => r.topic === topic);
  }

  /**
   * Add signed opinion to a topic from reactions on it; past threshold, crystallize
   * or escalate. Returns the preference (new or changed) or null.
   */
  crystallize(topic: string, tick: number, rule?: string): Preference | null {
    const onTopic = this.onTopic(topic);
    const dominant = dominantKind(onTopic);
    if (!dominant) return null;
    const kind = kindForReaction(dominant);
    const opinion = onTopic.filter((r) => r.kind === dominant).reduce((s, r) => s + r.opinion, 0);
    if (Math.abs(opinion) < OPINION_THRESHOLD) return null;

    const existing = this.map.get(topic);
    if (!existing) {
      const pref: Preference = { topic, kind, tier: tiersFor(kind)[0]!, opinion, settledAtTick: tick, ...(rule ? { rule } : {}) };
      this.map.set(topic, pref);
      this.log = this.log.filter((r) => r.topic !== topic);
      return pref;
    }
    // escalate: enough *more* opinion on the same topic raises the tier
    existing.opinion = opinion;
    const tiers = tiersFor(existing.kind);
    const idx = tiers.indexOf(existing.tier);
    if (Math.abs(opinion) >= OPINION_THRESHOLD * (idx + 2) && idx < tiers.length - 1) {
      existing.tier = tiers[idx + 1]!;
      // a limit that escalates twice becomes a phobia (D-186)
      if (existing.kind === "limit" && existing.tier === "phobia") existing.kind = "phobia";
      this.log = this.log.filter((r) => r.topic !== topic);
      return existing;
    }
    return existing;
  }

  /** Restore from a save. */
  adopt(prefs: Preference[], log: ReactionMemory[]): void {
    this.map.clear();
    for (const p of prefs) this.map.set(p.topic, { ...p });
    this.log = log.map((r) => ({ ...r }));
    this.nextReactionId = Math.max(1, ...this.log.map((r) => r.id + 1));
  }

  toJSON(): { preferences: Preference[]; log: ReactionMemory[]; nextReactionId: number } {
    return { preferences: this.all(), log: this.reactions(), nextReactionId: this.nextReactionId };
  }
}

function dominantKind(reactions: ReactionMemory[]): ReactionKind | null {
  const pos = reactions.filter((r) => r.opinion > 0).reduce((s, r) => s + r.opinion, 0);
  const neg = reactions.filter((r) => r.opinion < 0).reduce((s, r) => s + Math.abs(r.opinion), 0);
  if (pos === 0 && neg === 0) return null;
  return pos >= neg ? "awakening" : "trauma";
}

function clampUnit(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createPreferences(): Preferences {
  return new Preferences();
}

/** The legacy reaction type a preference presents as (for existing consumers). */
export function reactionTypeFor(pref: Preference): "soft" | "hard" | "phobia" | "fetish" {
  if (pref.kind === "fetish") return "fetish";
  if (pref.kind === "phobia") return "phobia";
  return pref.tier === "unease" ? "soft" : "hard";
}
