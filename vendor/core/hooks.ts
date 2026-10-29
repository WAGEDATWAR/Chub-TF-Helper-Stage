import { ContentError } from "./loader";
import { matches, type CriteriaContext } from "./criteria";

/**
 * Hooks (Playground borrow, S78). A **bounded value hook**: a registered source
 * (a genome, a part tag, a data rule) nudges a named value within a declared clamp,
 * and the engine — not the source — decides the final number. Hooks *bias, never
 * override*: a hook proposes a multiplier or a delta, several combine for one point
 * by a declared combiner, and the result is clamped to the point's range.
 *
 * Every application records its **origin**, so a nudged value can say who nudged it.
 * Data (`hooks.json`); deterministic; all finite numbers.
 */
export const HOOK_VERSION = 1;

export type Combiner = "sum" | "product_permille" | "min" | "max" | "first";

export interface HookPoint {
  id: string;
  /** How multiple sources at this point combine. */
  combiner: Combiner;
  /** Identity value when no hook fires (sum: 0, product: 1000). */
  neutral: number;
  /** Clamp applied to the combined value. */
  clamp: [number, number];
}

export interface HookPointData {
  points: HookPoint[];
}

export class HookRegistry {
  private readonly points: Map<string, HookPoint>;

  constructor(list: HookPoint[]) {
    this.points = new Map();
    for (const p of list) {
      if (typeof p.id !== "string" || !Array.isArray(p.clamp)) {
        throw new ContentError(`hook point "${p.id ?? "?"}" needs an id and a clamp`, "hooks.json");
      }
      const neutral = p.neutral ?? (p.combiner === "sum" ? 0 : 1000);
      this.points.set(p.id, { ...p, neutral });
    }
  }
  point(id: string): HookPoint | null {
    return this.points.get(id) ?? null;
  }
  all(): HookPoint[] {
    return [...this.points.values()];
  }
}

export function buildHookRegistry(data: unknown): HookRegistry {
  const d = data as { points?: unknown } | null | undefined;
  const list = d?.points;
  if (!Array.isArray(list)) throw new ContentError('hooks.json must declare a "points" array', "hooks.json");
  return new HookRegistry(list as HookPoint[]);
}

/** A registered hook: a source owns it, a gate may hold it, it contributes a value. */
export interface Hook {
  point: string;
  /** Who registered it (a genome id, `part:<tag>`, `rule`). */
  source: string;
  /** Contribution (a sum delta, or permille for a product combiner). */
  value: number;
  /** Optional condition; when it fails the hook contributes nothing. */
  when?: Record<string, unknown>;
}

export interface HookAnswer {
  source: string;
  value: number;
}

export interface HookResult {
  point: string;
  value: number;
  /** Each source's raw answer, in registration order (for attribution). */
  answers: HookAnswer[];
  clamped: boolean;
}

function combine(combiner: Combiner, answers: number[]): number {
  if (answers.length === 0) return NaN; // caller uses neutral
  switch (combiner) {
    case "sum": return answers.reduce((a, b) => a + b, 0);
    case "product_permille": return answers.reduce((a, b) => (a * b) / 1000, 1000);
    case "min": return Math.min(...answers);
    case "max": return Math.max(...answers);
    case "first": return answers[0]!;
  }
}

/**
 * Ask a hook point against a context. Only hooks whose gate holds answer; they
 * combine per the point, then clamp. Attribution (each source's answer) is kept.
 */
export function ask(registry: HookRegistry, pointId: string, hooks: readonly Hook[], ctx: CriteriaContext): HookResult | null {
  const point = registry.point(pointId);
  if (!point) return null;
  const answers: HookAnswer[] = [];
  for (const h of hooks) {
    if (h.point !== pointId) continue;
    if (h.when && !matches(h.when, ctx)) continue;
    answers.push({ source: h.source, value: h.value });
  }
  if (answers.length === 0) return { point: pointId, value: point.neutral, answers: [], clamped: false };
  const raw = combine(point.combiner, answers.map((a) => a.value));
  const clampedValue = Math.max(point.clamp[0], Math.min(point.clamp[1], raw));
  return { point: pointId, value: clampedValue, answers, clamped: clampedValue !== raw };
}

/** A short, attributed read: `needs.decay x1.2 (by genome.wolf, part:coat)`. */
export function explain(result: HookResult, format = (v: number): string => String(v)): string {
  if (result.answers.length === 0) return `${result.point} unchanged`;
  const who = result.answers.map((a) => a.source).join(", ");
  return `${result.point} -> ${format(result.value)} (by ${who})`;
}

/** Collect hooks off a body's parts/attributes and its genomes (the built-in sources). */
export function collectDataHooks(entries: Array<{ hook?: Hook; hooks?: Hook[] }>, source: string): Hook[] {
  const out: Hook[] = [];
  for (const e of entries) {
    if (e.hook) out.push({ ...e.hook, source });
    if (e.hooks) for (const h of e.hooks) out.push({ ...h, source });
  }
  return out;
}
