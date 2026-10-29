import { ContentError } from "./loader";
import type { Body } from "./body";

/**
 * Capacities (Playground borrow, S76). A small, derived record of integer permille
 * abilities the *rest of the simulation reads*, so systems do not reach into body
 * parts or raw stats: whether she can be conscious, move, manipulate, talk, eat and
 * breathe. A changed body lowers a capacity once, in one place; movement, the town,
 * social and actions read the record, never the parts.
 *
 * Permille (0..1000; 1000 = full). Derived — never saved, recomputed from truth.
 */
export const CAPACITY_VERSION = 1;

export const CAPACITY_KEYS = ["consciousness", "moving", "manipulation", "talking", "eating", "breathing"] as const;
export type CapacityKey = (typeof CAPACITY_KEYS)[number];

export type Capacities = Record<CapacityKey, number>;

export const FULL_CAPACITY = 1000;
/** Below this, a capacity is "impaired": the action is possible but degraded. */
export const ACT_THRESHOLD = 500;

export interface CapacityInputs {
  /** Stats that gate capability: energy, pain, fatigue and the like. */
  stats: Record<string, number>;
  /** Body tags/attrs that impose a specific, legible impairment. */
  tags: string[];
  attrs: string[];
}

/** A data-driven rule: when a tag/attr/stat band holds, scale a capacity. */
export interface CapacityRule {
  id: string;
  /** Any of these tags present applies the rule. */
  when_tags?: string[];
  when_attrs?: string[];
  /** A stat above `stat_above` applies the rule. */
  stat?: string;
  stat_above?: number;
  /** Multiplier applied (permille) to each named capacity. */
  scale: number;
  affects: CapacityKey[];
}

export class CapacityRegistry {
  private readonly rules: CapacityRule[];

  constructor(rules: CapacityRule[]) {
    for (const r of rules) {
      if (typeof r.id !== "string" || typeof r.scale !== "number" || !Array.isArray(r.affects)) {
        throw new ContentError(`capacity rule "${r.id ?? "?"}" needs id/scale/affects`, "capacities.json");
      }
    }
    this.rules = rules;
  }
  all(): CapacityRule[] {
    return [...this.rules];
  }
}

export function buildCapacityRegistry(data: unknown): CapacityRegistry {
  const list = (data as { rules?: unknown } | null | undefined)?.rules;
  if (!Array.isArray(list)) throw new ContentError('capacities.json must declare a "rules" array', "capacities.json");
  return new CapacityRegistry(list as CapacityRule[]);
}

/** Which capacity a tag/attr impairs — the legible body→capacity map. */
export function capacitiesFromBody(body: Body): { tags: string[]; attrs: string[] } {
  const tags: string[] = [];
  const attrs: string[] = [];
  for (const inst of body.allInstances()) {
    for (const t of inst.tags ?? []) tags.push(t);
    for (const a of inst.attributes) attrs.push(a.id);
  }
  return { tags, attrs };
}

const clampPermille = (v: number): number => Math.max(0, Math.min(FULL_CAPACITY, Math.round(v)));

/**
 * Derive the capacity record. Base value from energy (a spent body cannot act) and
 * pain (agony impairs), then each registry rule scales what it names. A capacity
 * never rises above full.
 */
export function deriveCapacities(inputs: CapacityInputs, registry: CapacityRegistry | null): Capacities {
  const energy = inputs.stats.energy ?? 100;
  const pain = inputs.stats.pain ?? 0;
  const fatigue = inputs.stats.fatigue ?? 0;
  // a spent body and a pained body both degrade everything; energy matters most.
  const stamina = clampPermille(300 + energy * 7);
  const painFactor = clampPermille(FULL_CAPACITY - pain * 6);
  const fatigueFactor = clampPermille(FULL_CAPACITY - fatigue * 3);
  const baseline = clampPermille(Math.min(stamina, painFactor, fatigueFactor));

  const caps: Capacities = {
    consciousness: clampPermille(Math.min(FULL_CAPACITY, stamina + 300)),
    moving: baseline,
    manipulation: baseline,
    talking: fatigue > 70 ? 700 : FULL_CAPACITY,
    eating: clampPermille(Math.min(FULL_CAPACITY, baseline + 200)),
    breathing: FULL_CAPACITY,
  };

  if (registry) {
    for (const rule of registry.all()) {
      const tagHit = rule.when_tags?.some((t) => inputs.tags.includes(t)) ?? false;
      const attrHit = rule.when_attrs?.some((a) => inputs.attrs.includes(a)) ?? false;
      const statHit = rule.stat !== undefined && (inputs.stats[rule.stat] ?? 0) > (rule.stat_above ?? 0);
      if (!tagHit && !attrHit && !statHit) continue;
      for (const key of rule.affects) caps[key] = clampPermille((caps[key] * rule.scale) / 1000);
    }
  }
  return caps;
}

export function isImpaired(caps: Capacities, key: CapacityKey): boolean {
  return caps[key] < ACT_THRESHOLD;
}

/** A one-line read of the worst capacity, for the surface. */
export function capacityBand(caps: Capacities): string {
  const worst = Math.min(...CAPACITY_KEYS.map((k) => caps[k]));
  if (worst >= 900) return "capable";
  if (worst >= 250) return "impaired";
  return "disabled";
}
