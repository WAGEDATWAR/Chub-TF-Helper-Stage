import { ContentError, indexById } from "./loader";
import { resolveModifier, type Modifier } from "./modifiers";
import type { CriteriaContext } from "./criteria";

export const SOFT_CAP_THRESHOLD = 22;
export const SOFT_CAP_CEILING = 45;

export function softCapStatModifier(total: number): number {
  const abs = Math.abs(total);
  if (abs <= SOFT_CAP_THRESHOLD) {
    return total;
  }
  const capped = SOFT_CAP_THRESHOLD + Math.pow(abs - SOFT_CAP_THRESHOLD, 0.6);
  const signed = Math.sign(total) * capped;
  return Math.sign(signed) * Math.min(Math.abs(signed), SOFT_CAP_CEILING);
}

export function stackStatModifiers(
  modifiersList: ReadonlyArray<Record<string, Modifier> | undefined>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const mods of modifiersList) {
    for (const [stat, mod] of Object.entries(mods ?? {})) {
      totals[stat] = (totals[stat] ?? 0) + rawValue(mod);
    }
  }
  const out: Record<string, number> = {};
  for (const [stat, total] of Object.entries(totals)) {
    out[stat] = softCapStatModifier(total);
  }
  return out;
}

/** The stacked stat modifiers a set of carried genomes imposes (soft-capped). */
export function statModifiersFor(genomeIds: readonly string[], registry: GenomeRegistry, ctx?: CriteriaContext | null): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const id of genomeIds) {
    for (const [stat, mod] of Object.entries(registry.get(id)?.stat_modifiers ?? {})) {
      totals[stat] = (totals[stat] ?? 0) + (ctx ? resolveModifier(mod, ctx) : rawValue(mod));
    }
  }
  const out: Record<string, number> = {};
  for (const [stat, total] of Object.entries(totals)) out[stat] = softCapStatModifier(total);
  return out;
}

/** The stacked mind pull a set of carried genomes imposes, keyed by mind value. */
export function mentalityFor(genomeIds: readonly string[], registry: GenomeRegistry, ctx?: CriteriaContext | null): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const id of genomeIds) {
    for (const [value, mod] of Object.entries(registry.get(id)?.mentality ?? {})) {
      totals[value] = (totals[value] ?? 0) + (ctx ? resolveModifier(mod, ctx) : rawValue(mod));
    }
  }
  return totals;
}

function rawValue(mod: Modifier): number {
  return typeof mod === "number" ? mod : mod.value;
}

export interface Genome {
  id: string;
  display_name?: string;
  description_key?: string;
  class?: string;
  familiarity_class?: string;
  limit_tags?: string[];
  traits: string[];
  priority?: number;
  saturation_point?: number;
  overshoot_threshold?: number;
  stability_cost: number;
  stat_modifiers?: Record<string, Modifier>;
  /** Mind-model pull (D-194): base personality drift toward these values. */
  mentality?: Record<string, Modifier>;
  feral_profile?: string | null;
  /** The genome's native genitalia (D-202), keyed by **genital kind** (what the
   *  body currently has: `penis`/`vulva`/`scrotum`/`cloaca`). Each entry is the
   *  part this species morphs that kind toward, optionally via an intermediate.
   *  Applied by tag, so a body shifts exactly the genitals it has. */
  genital?: Record<string, GenitalTarget>;
  /** Per-role morph-track override (D-202): a shared driver attribute (e.g. a
   *  muzzle) morphs toward the species' own head/face rather than one hardcoded
   *  track. Keyed by instance role. */
  morph_role_tracks?: Record<string, string>;
}

export interface GenitalTarget {
  to: string;
  via?: string;
}

export class GenomeRegistry {
  private readonly byId: Map<string, Genome>;

  constructor(genomes: Genome[]) {
    this.byId = indexById(genomes, "genomes.json");
    for (const genome of genomes) {
      if (!Array.isArray(genome.traits)) {
        throw new ContentError(`genome "${genome.id}" must declare a "traits" array`, "genomes.json");
      }
      if (typeof genome.stability_cost !== "number") {
        throw new ContentError(
          `genome "${genome.id}" is missing a numeric "stability_cost"`,
          "genomes.json",
        );
      }
      if (genome.saturation_point !== undefined && genome.saturation_point <= 0) {
        throw new ContentError(`genome "${genome.id}" saturation_point must be positive`, "genomes.json");
      }
    }
  }

  get(id: string): Genome | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Genome[] {
    return [...this.byId.values()];
  }

  allTraitIds(): string[] {
    return [...new Set(this.all().flatMap((g) => g.traits ?? []))].sort();
  }

  allStatNames(): string[] {
    return [...new Set(this.all().flatMap((g) => Object.keys(g.stat_modifiers ?? {})))].sort();
  }
}

export function buildGenomeRegistry(data: unknown): GenomeRegistry {
  const genomes = (data as { genomes?: unknown } | null | undefined)?.genomes;
  if (!Array.isArray(genomes)) {
    throw new ContentError('genomes.json must declare a "genomes" array');
  }
  return new GenomeRegistry(genomes as Genome[]);
}
