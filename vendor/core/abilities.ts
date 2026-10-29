import { ContentError, indexById } from "./loader";
import { clampStat } from "./stats";
import type { Subject } from "./subject";

/**
 * Abilities and mastery (blueprint §15; D-114). An ability is a *capability*, not
 * anatomy: an active attribute names it. Every ability is a liability until
 * trained; mastery persists through reversion as latent memory, floored. Tier-1
 * abilities carry faults, tier 3+ carry none. Instinct abilities ignore mastery
 * above Exposure 75.
 */
export const ABILITY_CATEGORIES = Object.freeze(["physical", "sense", "chemical", "locomotion", "social", "mental"] as const);

export const MASTERY_MAX = 100;
export const LATENT_DEFAULT_FLOOR = 0.7;
export const INSTINCT_EXPOSURE = 75;

export interface MasteryTier {
  tier: number;
  at: number;
  name: string;
  faults: string[];
}

export interface SceneUnlock {
  at: number;
  id: string;
}

export interface Ability {
  id: string;
  display_name: string;
  category: string;
  granted_by: string[];
  requires_part_tags: string[];
  synergies: Array<{ with: string; id: string }>;
  conflicts_with: string[];
  test_stat: string;
  acquire_effects: Record<string, number>;
  mastery_tiers: MasteryTier[];
  scene_unlocks: Record<string, SceneUnlock[]>;
  instinct_behavior?: { at_exposure: number; auto_trigger: string };
  latent_floor: number;
  /** Progress (0..1) the granting attribute must reach before the ability is
   *  held. Default 0.25 so a bare stub does not grant the capability. */
  acquire_at?: number;
  /** Held without any attribute (a baseline capability, e.g. sexual control). */
  always_held?: boolean;
}

export class AbilityRegistry {
  private readonly byId: Map<string, Ability>;

  constructor(abilities: Ability[]) {
    this.byId = indexById(abilities, "abilities.json");
    for (const ability of abilities) {
      if (ability.category !== undefined && !(ABILITY_CATEGORIES as readonly string[]).includes(ability.category)) {
        throw new ContentError(`ability "${ability.id}" has unknown category "${ability.category}"`, "abilities.json");
      }
      if (!Array.isArray(ability.mastery_tiers) || ability.mastery_tiers.length === 0) {
        throw new ContentError(`ability "${ability.id}" must declare mastery_tiers`, "abilities.json");
      }
    }
  }

  get(id: string): Ability | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Ability[] {
    return [...this.byId.values()];
  }

  grantedBy(attributeId: string): Ability[] {
    return this.all().filter((a) => (a.granted_by ?? []).includes(attributeId));
  }

  /** The tier a mastery value sits in. */
  tierFor(abilityId: string, mastery: number): MasteryTier | null {
    const ability = this.get(abilityId);
    if (!ability) return null;
    let tier = ability.mastery_tiers[0]!;
    for (const t of ability.mastery_tiers) {
      if (mastery >= t.at) tier = t;
      else break;
    }
    return tier;
  }
}

export function buildAbilityRegistry(data: unknown): AbilityRegistry {
  const abilities = (data as { abilities?: unknown } | null | undefined)?.abilities;
  if (!Array.isArray(abilities)) throw new ContentError('abilities.json must declare an "abilities" array');
  return new AbilityRegistry(abilities as Ability[]);
}

// --- mastery state (authoritative, on the subject) --------------------------

export interface MasteryState {
  mastery: number;
  peak: number;
}

export function masteryOf(subject: Subject, abilityId: string): MasteryState {
  return subject.abilities[abilityId] ?? { mastery: 0, peak: 0 };
}

export function ensureAbility(subject: Subject, abilityId: string): MasteryState {
  subject.abilities[abilityId] ??= { mastery: 0, peak: 0 };
  return subject.abilities[abilityId]!;
}

/** Abilities the body currently grants: an active attribute names them **and**
 *  has grown to the stage the ability needs (`acquire_at`, D-148). A capability
 *  is not granted while the anatomy is still only a stub. */
export function heldAbilityIds(subject: Subject, abilities: AbilityRegistry): Set<string> {
  const held = new Set<string>();
  // an always-held ability (e.g. sexual control) needs no attribute
  for (const ability of abilities.all()) if (ability.always_held) held.add(ability.id);
  for (const inst of subject.body.allInstances()) {
    for (const entry of inst.attributes) {
      if (entry.progress <= 0) continue;
      const progressFrac = entry.progress / 1000;
      for (const ability of abilities.grantedBy(entry.id)) {
        if (!ability.requires_part_tags.every((t) => inst.tags.includes(t))) continue;
        if (progressFrac < (ability.acquire_at ?? 0)) continue;
        held.add(ability.id);
      }
    }
  }
  return held;
}

/** Latent abilities act at their floored memory; instinct ignores mastery above Exposure 75. */
export function effectiveMastery(ability: Ability, state: MasteryState, held: boolean, exposure = 0): number {
  if (!held) return Math.round(state.peak * (ability.latent_floor ?? LATENT_DEFAULT_FLOOR));
  if (exposure > INSTINCT_EXPOSURE && ability.instinct_behavior) return MASTERY_MAX;
  return state.mastery;
}

export interface AbilityState {
  id: string;
  name: string;
  category: string;
  held: boolean;
  latent: boolean;
  mastery: number;
  peak: number;
  effective: number;
  tier: number;
  tierName: string;
  instinct: boolean;
  faults: string[];
  testStat: string;
}

export function abilityStates(subject: Subject, abilities: AbilityRegistry, { exposure = 0 } = {}): AbilityState[] {
  const held = heldAbilityIds(subject, abilities);
  const rows: AbilityState[] = [];
  const known = new Set([...held, ...Object.keys(subject.abilities)]);
  for (const id of known) {
    const ability = abilities.get(id);
    if (!ability) continue;
    const state = masteryOf(subject, id);
    const isHeld = held.has(id);
    const effective = effectiveMastery(ability, state, isHeld, exposure);
    const tier = abilities.tierFor(id, effective)!;
    rows.push({
      id,
      name: ability.display_name,
      category: ability.category,
      held: isHeld,
      latent: !isHeld,
      mastery: state.mastery,
      peak: state.peak,
      effective,
      tier: tier.tier,
      tierName: tier.name,
      instinct: isHeld && exposure > INSTINCT_EXPOSURE && ability.instinct_behavior !== undefined,
      faults: [...tier.faults],
      testStat: ability.test_stat,
    });
  }
  rows.sort((a, b) => Number(b.held) - Number(a.held) || b.mastery - a.mastery || a.name.localeCompare(b.name));
  return rows;
}

export function applyMastery(subject: Subject, abilityId: string, delta: number): MasteryState {
  const state = ensureAbility(subject, abilityId);
  state.mastery = Math.max(0, Math.min(MASTERY_MAX, state.mastery + delta));
  state.peak = Math.max(state.peak, state.mastery);
  return state;
}

/** On reacquiring an ability, mastery restarts at the floored fraction of its peak. */
export function reacquire(subject: Subject, ability: Ability): MasteryState {
  const state = ensureAbility(subject, ability.id);
  const floor = Math.round(state.peak * (ability.latent_floor ?? LATENT_DEFAULT_FLOOR));
  if (state.mastery < floor) state.mastery = floor;
  return state;
}

/** Call after any body change (power, reversion): latent abilities keep their peak. */
export function syncAbilities(subject: Subject, abilities: AbilityRegistry, { acquireStats = true } = {}): { gained: string[]; lost: string[] } {
  const held = heldAbilityIds(subject, abilities);
  const gained: string[] = [];
  const lost: string[] = [];
  for (const id of held) {
    const ability = abilities.get(id)!;
    const known = Boolean(subject.abilities[id]);
    const state = ensureAbility(subject, id);
    if (!known) {
      gained.push(id);
      if (acquireStats) {
        for (const [stat, value] of Object.entries(ability.acquire_effects ?? {})) {
          if (stat in subject.stats) subject.stats[stat] = clampStat(subject.stats[stat]! + value);
        }
      }
    } else if (state.mastery < Math.round(state.peak * (ability.latent_floor ?? LATENT_DEFAULT_FLOOR))) {
      reacquire(subject, ability);
    }
    state.peak = Math.max(state.peak, state.mastery);
  }
  for (const id of Object.keys(subject.abilities)) {
    if (!held.has(id)) lost.push(id);
  }
  return { gained, lost };
}
