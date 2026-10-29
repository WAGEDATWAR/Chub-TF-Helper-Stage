import { ContentError } from "./loader";
import { MemoryRing, specificityScore, variantSpecificity, SPECIFICITY_THRESHOLD, pickLine, type DialogueVariant } from "./dialogue";
import { interpolateTokens } from "./composer";
import type { Rng } from "./rng";

/**
 * Composer V2 prose pools (D-218). The paragraph *shape* is fixed (D-215); this
 * module fills it with **varied, context-conditioned** prose. Each paragraph kind
 * has a pool of authored variants selected by the same axis machinery as dialogue
 * (mood, awareness, stage, arousal, ...), with a seeded RNG and a per-key memory
 * ring so similar moments read differently, and a **templated floor** that always
 * yields a line. This is the hybrid: authored context + deterministic variation.
 *
 * A line may carry `{tokens}` (interpolated from the caller) so it stays data and
 * reuses live state rather than hardcoding it.
 */
export const PROSE_VERSION = 1;

export interface ProseKey {
  key: string;
  variants: DialogueVariant[];
}

export class ProseLibrary {
  private readonly byKey: Map<string, ProseKey>;
  private readonly weights: Record<string, number>;
  private readonly memories = new Map<string, MemoryRing>();

  constructor(keys: ProseKey[], weights: Record<string, number> = {}) {
    this.byKey = new Map();
    this.weights = weights;
    for (const k of keys) {
      if (typeof k.key !== "string" || !Array.isArray(k.variants) || k.variants.length === 0) {
        throw new ContentError(`prose key "${k.key ?? "?"}" must declare a variants array`, "prose.json");
      }
      if (!k.variants.some((v) => !v.axes || Object.keys(v.axes).length === 0)) {
        throw new ContentError(`prose key "${k.key}" has no zero-axis floor`, "prose.json");
      }
      this.byKey.set(k.key, k);
    }
  }

  /** Clear every key's memory ring so a rebuild is reproducible (D-218). */
  reset(): void {
    this.memories.clear();
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  private _memoryFor(key: string): MemoryRing {
    let m = this.memories.get(key);
    if (!m) {
      m = new MemoryRing(12);
      this.memories.set(key, m);
    }
    return m;
  }

  /**
   * Pick a line for `key`, interpolated with `tokens`. Returns null when the key is
   * unknown (so the caller falls back to its floor). Deterministic from `rng`.
   */
  pick(key: string, axes: Record<string, string>, tokens: Record<string, string | number | undefined> | null, rng: Rng | null): string | null {
    const entry = this.byKey.get(key);
    if (!entry) return null;
    const scored = entry.variants.map((variant, index) => ({
      variant,
      index,
      specificity: variantSpecificity(variant, this.weights),
      match: specificityScore(variant, axes, this.weights),
    }));
    const above = scored.filter((s) => s.match >= SPECIFICITY_THRESHOLD);
    const pool = above.length > 0 ? above : scored.filter((s) => !s.variant.axes || Object.keys(s.variant.axes).length === 0);
    const memory = this._memoryFor(key);
    const fresh = pool.filter((s) => !s.variant.lines.every((l) => memory.has(interpolateTokens(l, tokens))));
    const candidates = (fresh.length > 0 ? fresh : pool).sort(
      (a, b) => b.match - a.match || b.specificity - a.specificity || a.index - b.index,
    );
    const best = candidates[0];
    if (!best) return null;
    const line = pickLine(best.variant.lines, rng, memory);
    if (line === null) return null;
    const rendered = interpolateTokens(line, tokens);
    memory.record(rendered);
    return rendered;
  }
}

export function buildProseLibrary(data: unknown, weights: Record<string, number> = {}): ProseLibrary {
  const keys = (data as { keys?: unknown } | null | undefined)?.keys;
  if (!Array.isArray(keys)) throw new ContentError('prose.json must declare a "keys" array', "prose.json");
  return new ProseLibrary(keys as ProseKey[], weights);
}
