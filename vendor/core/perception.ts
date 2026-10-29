import { ContentError, indexById } from "./loader";
import type { Subject } from "./subject";

/**
 * Perception, belief and memory (blueprint §17.5; D-134; S31).
 *
 * Truth and belief are different objects, and the distance between them is a
 * first-class quantity. `subject.know` holds what she *believes* about her own
 * body; the body holds the truth. Belief closes on truth by exactly three paths:
 *   felt  — a trait she can sense, once past its notice threshold;
 *   seen  — only where a place is observable (a mirror);
 *   told  — another person's reaction makes her look again.
 * A notice writes belief, pushes a bounded memory entry, and emits `notice`.
 */
export const PERCEPTION_VERSION = 1;

export const NOTICE_PATHS = Object.freeze(["felt", "seen", "told"] as const);
export type NoticePath = (typeof NOTICE_PATHS)[number];

export const MEMORY_TTL_TICKS = 2880;
export const MEMORY_CAP = 40;

export interface NoticableTrait {
  id: string;
  family: string;
  /** How this trait can be noticed. Absent means never noticed. */
  notice?: NoticePath;
  notice_threshold: number;
}

export interface PerceptionConfig {
  default_threshold: number;
  memory_ttl: number;
  memory_cap: number;
}

export const DEFAULT_PERCEPTION_CONFIG: PerceptionConfig = Object.freeze({
  default_threshold: 0.15,
  memory_ttl: MEMORY_TTL_TICKS,
  memory_cap: MEMORY_CAP,
});

export interface MemoryEntry {
  tick: number;
  kind: "notice";
  ref: string;
  until: number;
}

export interface BeliefEntry {
  /** What she believes the value/state is (a truth value she has accepted). */
  belief: number;
  noticedAtTick: number;
  path: NoticePath;
}

/**
 * Awareness as the **sum of her knowledge** (D-213). A noticed body change
 * contributes **proportional to how far along it is** (a thickening nail is barely
 * noticed; it builds as the change continues), so awareness is recomputed from the
 * belief set rather than incremented — a re-notice **replaces** its prior
 * contribution instead of adding on top. A stat/mind realization contributes flat.
 */
export function knowledgeAwareness(
  belief: Record<string, BeliefEntry>,
  weightOf: (traitId: string) => number,
): number {
  let total = 0;
  for (const [id, entry] of Object.entries(belief)) {
    if (id.startsWith("attr.")) {
      const progress = Math.max(0, Math.min(1, entry.belief));
      total += progress * 4.6 * weightOf(id);
    } else {
      total += 6; // a stat/mind realization is whole once noticed
    }
  }
  return total;
}


/** Truth values for everything noticeable, keyed by trait id. */
export interface TruthFrame {
  [traitId: string]: number;
}

export class NoticableRegistry {
  private readonly byId: Map<string, NoticableTrait>;

  constructor(traits: NoticableTrait[]) {
    this.byId = indexById(traits, "perception traits");
    for (const t of traits) {
      if (t.notice !== undefined && !(NOTICE_PATHS as readonly string[]).includes(t.notice)) {
        throw new ContentError(`trait "${t.id}" has unknown notice path "${t.notice}"`);
      }
    }
  }

  get(id: string): NoticableTrait | null {
    return this.byId.get(id) ?? null;
  }

  all(): NoticableTrait[] {
    return [...this.byId.values()];
  }
}

export function buildNoticableRegistry(traits: NoticableTrait[]): NoticableRegistry {
  return new NoticableRegistry(traits);
}

/**
 * Which traits she has *not* noticed: truth differs from belief by at least the
 * threshold. `anywhere` is true for the social path (a `seen` trait is still a
 * real difference when she is somewhere with no mirror).
 */
export function unseen(
  truth: TruthFrame,
  belief: Record<string, BeliefEntry>,
  registry: NoticableRegistry,
  { anywhere = false }: { anywhere?: boolean | undefined } = {},
): string[] {
  const out: string[] = [];
  for (const trait of registry.all()) {
    if (!trait.notice) continue;
    if (trait.notice === "seen" && !anywhere) {
      // still a real difference, handled by the caller passing `observable`
    }
    const t = truth[trait.id] ?? 0;
    const b = belief[trait.id]?.belief ?? 0;
    if (Math.abs(t - b) >= trait.notice_threshold) out.push(trait.id);
  }
  return out;
}

/**
 * Record a notice: write belief toward truth, push a bounded memory entry.
 * Returns the changed trait ids.
 */
export function mark(
  subject: Subject,
  truth: TruthFrame,
  registry: NoticableRegistry,
  tick: number,
  skills: { path: NoticePath; ids?: string[] | undefined; anywhere?: boolean | undefined; thresholdScale?: number | undefined } = { path: "felt" },
): string[] {
  const scale = skills.thresholdScale ?? 1;
  const candidates = skills.ids ?? unseen(truth, subject.know, registry, { anywhere: skills.anywhere });
  const changed: string[] = [];
  for (const id of candidates) {
    const trait = registry.get(id);
    if (!trait || !trait.notice) continue;
    if (trait.notice === "seen" && skills.path === "seen" && !skills.anywhere) {
      // an observable place is required for a `seen` notice; caller decides
    }
    const target = truth[id] ?? 0;
    const prior = subject.know[id]?.belief ?? 0;
    if (Math.abs(target - prior) < trait.notice_threshold * scale) continue;
    subject.know[id] = { belief: target, noticedAtTick: tick, path: skills.path };
    subject.memory.push({ tick, kind: "notice", ref: id, until: tick + DEFAULT_PERCEPTION_CONFIG.memory_ttl });
    changed.push(id);
  }
  return changed;
}

/** Advance the memory ring: drop expired entries, enforce the cap. */
export function ageMemory(subject: Subject, tick: number, cap = MEMORY_CAP): void {
  subject.memory = subject.memory.filter((m) => m.until > tick).slice(-cap);
}

/** Does a place let a `seen` trait be noticed? */
export function isObservable(place: { observe?: boolean } | null | undefined): boolean {
  return place?.observe === true;
}
