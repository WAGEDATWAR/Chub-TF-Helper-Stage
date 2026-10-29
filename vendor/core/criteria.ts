import { ContentError } from "./loader";

/**
 * The criteria system (blueprint §22; D-184; M15.5c). Crystallization is not one
 * formula — it is a set of **registered, rules-conditioned groups**: a group
 * composes conditions over real exposed data (mind values, mood, perception,
 * stats, parts, flags) and, when all match, awards signed **opinion** to a
 * **topic**. Enough opinion + a matching reaction = an awakening/trauma.
 *
 * Same clause vocabulary as `scene_graph.evaluateCondition` (all_of/any_of/
 * none_of + comparators), extended with mind/mood keys. Data-authored, so new
 * dynamics are content, not code.
 */
export const CRITERIA_VERSION = 1;

export interface CriteriaContext {
  stats: Record<string, number>;
  mind: Record<string, number>;
  awareness: number;
  awarenessTier: string;
  moodValence: number;
  moodArousal: number;
  moodBand: string;
  partTags: string[];
  partRoles: string[];
  flags: Set<string>;
  tick: number;
  day: number;
  realized: boolean;
  memorySignificance: number;
  /** Is anyone (family/friend) nearby right now. */
  alliesNear: boolean;
  /** A memory significance for the triggering moment, 0..1. */
  phase?: string;
  [k: string]: unknown;
}

export interface CriterionGroup {
  id: string;
  topic: string;
  /** Signed opinion awarded when the group matches. */
  opinion: number;
  kind: "awakening" | "trauma";
  when: Record<string, unknown>;
  priority?: number;
}

export function buildCriteria(data: unknown): CriterionGroup[] {
  const groups = (data as { groups?: unknown } | null | undefined)?.groups;
  if (!Array.isArray(groups)) return [];
  const seen = new Set<string>();
  for (const g of groups as CriterionGroup[]) {
    if (!g.id || !g.topic) throw new ContentError("every criteria group needs an id and topic", "criteria.json");
    if (seen.has(g.id)) throw new ContentError(`duplicate criteria group "${g.id}"`, "criteria.json");
    seen.add(g.id);
    if (g.kind !== "awakening" && g.kind !== "trauma") throw new ContentError(`criteria group "${g.id}" needs kind awakening|trauma`, "criteria.json");
  }
  return groups as CriterionGroup[];
}

/** Evaluate a criteria `when` block against a context. All keys must hold. */
export function matches(when: unknown, ctx: CriteriaContext): boolean {
  if (when === null || when === undefined) return true;
  for (const [key, value] of Object.entries(when as Record<string, unknown>)) {
    if (!matchesClause(key, value, ctx)) return false;
  }
  return true;
}

function matchesClause(key: string, value: unknown, ctx: CriteriaContext): boolean {
  switch (key) {
    case "all_of":
      return (value as unknown[]).every((c) => matches(c, ctx));
    case "any_of":
      return (value as unknown[]).some((c) => matches(c, ctx));
    case "none_of":
      return (value as unknown[]).every((c) => !matches(c, ctx));
    case "stat_min":
      return entries(value).every(([s, min]) => (ctx.stats[s] ?? 0) >= min);
    case "stat_max":
      return entries(value).every(([s, max]) => (ctx.stats[s] ?? 0) <= max);
    case "mind_min":
      return entries(value).every(([s, min]) => (ctx.mind[s] ?? 0) >= min);
    case "mind_max":
      return entries(value).every(([s, max]) => (ctx.mind[s] ?? 0) <= max);
    case "awareness_min":
      return ctx.awareness >= (value as number);
    case "awareness_max":
      return ctx.awareness <= (value as number);
    case "awareness_tier":
      return ctx.awarenessTier === value;
    case "mood_valence_min":
      return ctx.moodValence >= (value as number);
    case "mood_valence_max":
      return ctx.moodValence <= (value as number);
    case "mood_arousal_min":
      return ctx.moodArousal >= (value as number);
    case "mood_arousal_max":
      return ctx.moodArousal <= (value as number);
    case "mood_band":
      return ctx.moodBand === value;
    case "has_part_tag":
      return ctx.partTags.includes(value as string);
    case "has_part_role":
      return ctx.partRoles.includes(value as string);
    case "flag":
      return ctx.flags.has(value as string);
    case "realized":
      return ctx.realized === value;
    case "allies_near":
      return ctx.alliesNear === value;
    case "memory_significance_min":
      return ctx.memorySignificance >= (value as number);
    case "day_min":
      return ctx.day >= (value as number);
    case "phase":
      return ctx.phase === value;
    case "stability_min":
      return (ctx.stats.stability ?? 0) >= (value as number);
    case "stability_max":
      return (ctx.stats.stability ?? 0) <= (value as number);
    default:
      return false;
  }
}

function entries(value: unknown): Array<[string, number]> {
  return Object.entries((value as Record<string, number>) ?? {});
}

export const CRITERIA_KEYS = Object.freeze([
  "all_of", "any_of", "none_of",
  "stat_min", "stat_max", "mind_min", "mind_max",
  "stability_min", "stability_max",
  "awareness_min", "awareness_max", "awareness_tier",
  "mood_valence_min", "mood_valence_max", "mood_arousal_min", "mood_arousal_max", "mood_band",
  "has_part_tag", "has_part_role", "flag", "realized", "allies_near",
  "memory_significance_min", "day_min", "phase",
]);

/** Validate a criteria condition against the criteria vocabulary. */
export function validateCriteriaKeys(condition: unknown, path = "when"): string[] {
  const errors: string[] = [];
  if (condition === null || condition === undefined) return errors;
  if (typeof condition !== "object" || Array.isArray(condition)) {
    errors.push(`${path}: condition must be an object`);
    return errors;
  }
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (!(CRITERIA_KEYS as readonly string[]).includes(key)) {
      errors.push(`${path}: unknown criteria key "${key}"`);
      continue;
    }
    if (key === "all_of" || key === "any_of" || key === "none_of") {
      if (!Array.isArray(value)) { errors.push(`${path}.${key}: must be an array`); continue; }
      value.forEach((sub, i) => errors.push(...validateCriteriaKeys(sub, `${path}.${key}[${i}]`)));
    }
  }
  return errors;
}

/**
 * Which groups match, and the net opinion they award per topic. Highest-priority
 * group per topic wins (so a specific rule beats a generic one).
 */
export function applyCriteria(groups: readonly CriterionGroup[], ctx: CriteriaContext): Array<{ topic: string; opinion: number; kind: "awakening" | "trauma"; groupId: string; ruleName: string }> {
  const byTopic = new Map<string, { topic: string; opinion: number; kind: "awakening" | "trauma"; groupId: string; ruleName: string; priority: number }>();
  for (const g of groups) {
    if (!matches(g.when, ctx)) continue;
    const existing = byTopic.get(g.topic);
    const priority = g.priority ?? 0;
    if (!existing || priority > existing.priority) {
      byTopic.set(g.topic, { topic: g.topic, opinion: g.opinion, kind: g.kind, groupId: g.id, ruleName: (g as { name?: string }).name ?? g.id.replace(/^crit\./, "").replace(/_/g, " "), priority });
    }
  }
  return [...byTopic.values()].map(({ priority, ...rest }) => { void priority; return rest; });
}
