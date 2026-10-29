import { ContentError } from "./loader";
import type { Skeleton } from "./skeleton";
import type { Rng } from "./rng";

/**
 * Per-part mutagen distribution (blueprint §11/§31): an injection does not land
 * on every matching part in lockstep. For each resolved winner this decides,
 * under the seeded `transform` stream, whether the part is skipped, a coverage
 * jitter, and a start delay by the part-role's tier in the genome's body plan.
 */
export interface DistributionDefaults {
  miss_base: number;
  miss_min: number;
  coverage_jitter: number;
  tier_delay: number;
  delay_spread: number;
}

export const DEFAULT_DISTRIBUTION_DEFAULTS: DistributionDefaults = {
  miss_base: 0.35,
  miss_min: 0.18,
  coverage_jitter: 0.2,
  tier_delay: 3,
  delay_spread: 3,
};

export interface DistributionWinner {
  inst: { role: string };
  attr: { id: string };
  coverage: number;
  delay?: number;
}

export class Distribution {
  readonly defaults: DistributionDefaults;
  private readonly defaultOrder: string[][];
  private readonly orders: Record<string, string[][]>;

  constructor(data: unknown) {
    if (!data || typeof data !== "object") throw new ContentError("distribution: data is required", "distribution.json");
    const d = data as { defaults?: Partial<DistributionDefaults>; default_order?: unknown; orders?: Record<string, unknown> };
    this.defaults = { ...DEFAULT_DISTRIBUTION_DEFAULTS, ...(d.defaults ?? {}) };
    for (const key of ["miss_base", "miss_min", "coverage_jitter"] as const) {
      const v = this.defaults[key];
      if (typeof v !== "number" || v < 0 || v > 1) {
        throw new ContentError(`distribution: defaults.${key} must be 0..1`, "distribution.json");
      }
    }
    if (this.defaults.miss_min > this.defaults.miss_base) {
      throw new ContentError("distribution: miss_min must not exceed miss_base", "distribution.json");
    }
    this.defaultOrder = checkOrder(d.default_order, "default_order");
    this.orders = {};
    for (const [id, order] of Object.entries(d.orders ?? {})) {
      this.orders[id] = checkOrder(order, `orders.${id}`);
    }
  }

  orderFor(genomeId: string): string[][] {
    return this.orders[genomeId] ?? this.defaultOrder;
  }

  tierOf(genomeId: string, role: string): number {
    const order = this.orderFor(genomeId);
    for (let i = 0; i < order.length; i++) if (order[i]!.includes(role)) return i;
    return order.length - 1;
  }

  validateAgainst(skeleton: Skeleton): string[] {
    const problems: string[] = [];
    const check = (label: string, order: string[][]): void => {
      for (const tier of order) for (const role of tier) if (!skeleton.hasRole(role)) problems.push(`${label}: unknown role "${role}"`);
    };
    check("default_order", this.defaultOrder);
    for (const [id, order] of Object.entries(this.orders)) check(id, order);
    return problems;
  }

  distribute<T extends DistributionWinner>(
    winners: readonly T[],
    { rng, genomeId, coverage, guaranteed }: { rng: Rng | null; genomeId: string; coverage: number; guaranteed?: (attrId: string) => boolean },
  ): T[] {
    if (!rng || winners.length === 0) return winners.map((w) => ({ ...w, delay: 0 }));
    const d = this.defaults;
    const missChance = Math.max(d.miss_min, d.miss_base * (1 - Math.min(1, coverage)));
    const byAttr = new Map<string, T[]>();
    for (const w of winners) {
      const list = byAttr.get(w.attr.id) ?? [];
      list.push(w);
      byAttr.set(w.attr.id, list);
    }
    const kept: T[] = [];
    for (const [attrId, list] of byAttr) {
      // a guaranteed attribute (a species genital shift) never misses
      if (guaranteed?.(attrId)) {
        kept.push(...list);
        continue;
      }
      const survivors: T[] = [];
      for (const w of list) {
        if (rng.next("transform") >= missChance) survivors.push(w);
      }
      if (survivors.length === 0) survivors.push(list[rng.int("transform", 0, list.length - 1)]!);
      kept.push(...survivors);
    }
    return kept.map((w) => {
      const tier = this.tierOf(genomeId, w.inst.role);
      const delay = tier * d.tier_delay + rng.int("transform", 0, d.delay_spread);
      const jitter = 1 + (rng.next("transform") * 2 - 1) * d.coverage_jitter;
      return { ...w, delay, coverage: Math.max(0.05, w.coverage * jitter) };
    });
  }
}

function checkOrder(order: unknown, label: string): string[][] {
  if (
    !Array.isArray(order) ||
    order.length === 0 ||
    !order.every((t) => Array.isArray(t) && t.every((r) => typeof r === "string"))
  ) {
    throw new ContentError(`distribution: ${label} must be an array of role-id arrays`, "distribution.json");
  }
  return (order as string[][]).map((t) => [...t]);
}

export function buildDistribution(data: unknown): Distribution {
  return new Distribution(data);
}
