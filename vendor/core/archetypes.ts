import { createRng } from "./rng";
import { ContentError } from "./loader";
import { clampStat } from "./stats";

/**
 * Archetypes (blueprint §17.4; D-193, D-195; M15.5g). An archetype is a named,
 * participle-adjective personality type that defines **ranges** for the subject's
 * core + secondary mind values — not fixed assignments. A seeded roll draws each
 * value within its range (controlled randomness: every run is unique, the
 * structure is deterministic). The name implies several facets (Studious = prompt,
 * organised, cool to the social).
 *
 * Values are **source** values set at start; the sim may drift them but never
 * recomputes them whole (D-193). A sandbox may define a custom archetype editing
 * any non-derived value.
 */
export const ARCHETYPE_VERSION = 1;

export interface Range {
  min: number;
  max: number;
}

export interface Archetype {
  id: string;
  label: string;
  blurb: string;
  /** personality seed for the disposition table (legacy compatibility). */
  personality_seed: string;
  /** Default gender bias, optional (a roll may override). */
  base_gender?: string;
  dispositions?: string[];
  /** Per-mind-value ranges. */
  values?: Record<string, Range>;
  /** Secondary-state ranges, keyed the same way. */
  states?: Record<string, Range>;
  stat_overrides?: Record<string, number>;
}

export interface ArchetypeData {
  archetypes: Archetype[];
}

export class ArchetypeRegistry {
  private readonly byId: Map<string, Archetype>;

  constructor(data: ArchetypeData) {
    if (!Array.isArray(data.archetypes) || data.archetypes.length === 0) {
      throw new ContentError('archetypes.json must declare a non-empty "archetypes" array', "archetypes.json");
    }
    this.byId = new Map();
    for (const a of data.archetypes) {
      if (!a.id || !a.label) throw new ContentError("every archetype needs an id and label", "archetypes.json");
      if (this.byId.has(a.id)) throw new ContentError(`duplicate archetype "${a.id}"`, "archetypes.json");
      for (const [key, range] of Object.entries({ ...(a.values ?? {}), ...(a.states ?? {}) })) {
        if (!range || typeof range.min !== "number" || typeof range.max !== "number" || range.min > range.max) {
          throw new ContentError(`archetype "${a.id}" value "${key}" needs an ascending range`, "archetypes.json");
        }
      }
      this.byId.set(a.id, a);
    }
  }

  get(id: string): Archetype | null {
    return this.byId.get(id) ?? null;
  }

  all(): Archetype[] {
    return [...this.byId.values()];
  }
}

export function buildArchetypeRegistry(data: unknown): ArchetypeRegistry {
  return new ArchetypeRegistry(data as ArchetypeData);
}

/**
 * Roll every mind/state value within its archetype range (seeded). Values not
 * named by the archetype stay at their mind-data baseline. Returns a sparse map.
 */
export function rollArchetypeValues(archetype: Archetype, seed: number): Record<string, number> {
  const rng = createRng(seed);
  const out: Record<string, number> = {};
  for (const [key, range] of Object.entries({ ...(archetype.values ?? {}), ...(archetype.states ?? {}) })) {
    out[key] = clampStat(range.min + rng.next("world") * (range.max - range.min));
  }
  return out;
}

/** Apply rolled values onto a range table's base map (only keys that exist there). */
export function mergedValueRanges(archetypes: readonly Archetype[]): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const a of archetypes) for (const [k, r] of Object.entries(a.values ?? {})) out[k] = r;
  return out;
}

export function archetypeFor(archetypes: ArchetypeRegistry, id: string | null | undefined): Archetype | null {
  return id ? archetypes.get(id) : null;
}
