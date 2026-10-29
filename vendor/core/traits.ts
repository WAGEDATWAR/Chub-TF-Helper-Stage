import { ContentError, indexById } from "./loader";
import type { PartInstance } from "./parts";

export const TRAIT_TIERS = Object.freeze([1, 2, 3] as const);

export interface TraitTargets {
  match_tags?: string[];
  match_roles?: string[];
}

export interface Trait {
  id: string;
  display_name?: string;
  family?: string;
  tier?: number;
  grants: string[];
  targets: TraitTargets;
  priority?: number;
  min_coverage?: number;
  /** Opens only once the body's exposure has reached this (a feral/deep gate). */
  min_exposure?: number;
  conflicts_with_families?: string[];
}

export class TraitRegistry {
  private readonly byId: Map<string, Trait>;

  constructor(traits: Trait[]) {
    this.byId = indexById(traits, "traits.json");
    for (const trait of traits) {
      if (!Array.isArray(trait.grants) || trait.grants.length === 0) {
        throw new ContentError(`trait "${trait.id}" must grant at least one attribute`, "traits.json");
      }
      if (trait.tier !== undefined && !(TRAIT_TIERS as readonly number[]).includes(trait.tier)) {
        throw new ContentError(`trait "${trait.id}" has unknown tier ${trait.tier}`, "traits.json");
      }
      const targets = trait.targets ?? {};
      if (!targets.match_tags && !targets.match_roles) {
        throw new ContentError(
          `trait "${trait.id}" must target by match_tags or match_roles`,
          "traits.json",
        );
      }
    }
  }

  get(id: string): Trait | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Trait[] {
    return [...this.byId.values()];
  }

  firesAt(traitId: string, coverage: number): boolean {
    const trait = this.get(traitId);
    if (!trait) {
      throw new ContentError(`unknown trait "${traitId}"`, "traits.json");
    }
    return coverage >= (trait.min_coverage ?? 0);
  }

  fires(traitId: string, coverage: number): boolean {
    return this.firesAt(traitId, coverage);
  }

  traitsForCoverage(coverage: number): Trait[] {
    return this.all()
      .filter((t) => coverage >= (t.min_coverage ?? 0))
      .sort((a, b) => (a.min_coverage ?? 0) - (b.min_coverage ?? 0) || a.id.localeCompare(b.id));
  }

  matchesInstance(traitId: string, instance: Pick<PartInstance, "tags" | "role">): boolean {
    const trait = this.get(traitId);
    if (!trait) return false;
    const { match_tags: tags, match_roles: roles } = trait.targets ?? {};
    if (tags && tags.length > 0) {
      const instTags = instance.tags ?? [];
      if (!tags.every((t) => instTags.includes(t))) return false;
    }
    if (roles && roles.length > 0) {
      if (!roles.includes(instance.role)) return false;
    }
    return true;
  }
}

export function buildTraitRegistry(data: unknown): TraitRegistry {
  const traits = (data as { traits?: unknown } | null | undefined)?.traits;
  if (!Array.isArray(traits)) {
    throw new ContentError('traits.json must declare a "traits" array');
  }
  return new TraitRegistry(traits as Trait[]);
}
