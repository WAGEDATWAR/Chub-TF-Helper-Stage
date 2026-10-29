import { matches, type CriteriaContext } from "./criteria";

/**
 * Gated modifiers (M15.5c2, D-194). A modifier is either a plain number (always on,
 * full rate) or a gated object: `{ value, rate?, when? }`. The `when` is a criteria
 * condition over exposed state (mind, mood, stats, parts, flags, phase); when it
 * fails the modifier contributes nothing. `rate` scales how fast the modifier bites
 * once its gate opens, so a change can be *teased in* rather than snapped.
 *
 * Used by genomes (`stat_modifiers`, `mentality`), parts, and attributes so the
 * change's *strength over time* is authored, not implicit.
 */
export const MODIFIER_VERSION = 1;

export type Modifier = number | { value: number; rate?: number; when?: Record<string, unknown> };

/** Normalise a modifier to its parts. */
export function readModifier(mod: Modifier): { value: number; rate: number; when: Record<string, unknown> | null } {
  if (typeof mod === "number") return { value: mod, rate: 1, when: null };
  return { value: mod.value, rate: mod.rate ?? 1, when: mod.when ?? null };
}

/** The effective contribution of a modifier against a context (0 if gated shut). */
export function resolveModifier(mod: Modifier, ctx: CriteriaContext): number {
  const { value, rate, when } = readModifier(mod);
  if (when && !matches(when, ctx)) return 0;
  return value * rate;
}

/** Stack a keyed modifier map into resolved totals against a context. */
export function resolveModifiers(mods: Record<string, Modifier> | undefined, ctx: CriteriaContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, mod] of Object.entries(mods ?? {})) {
    const v = resolveModifier(mod, ctx);
    if (v !== 0) out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

/** Validate a modifier map (used by the content validator). */
export function checkModifier(mod: Modifier): string | null {
  if (typeof mod === "number") return Number.isFinite(mod) ? null : "modifier number is not finite";
  if (!mod || typeof mod !== "object") return "modifier must be a number or an object";
  if (typeof mod.value !== "number") return "modifier.value must be a number";
  if (mod.rate !== undefined && (typeof mod.rate !== "number" || mod.rate < 0)) return "modifier.rate must be a non-negative number";
  if (mod.when !== undefined && (typeof mod.when !== "object" || mod.when === null)) return "modifier.when must be a condition object";
  return null;
}
