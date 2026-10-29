import { ContentError } from "./loader";
import type { ReactionCatalog, ReactionType } from "./registries";
import type { Rng } from "./rng";

/**
 * Reactions (blueprint §22, divergence D-097). A random subject does not arrive
 * with a transformation fetish: she carries **dispositions** (latent leanings)
 * that an **awakening** crystallizes into live **reactions**.
 */

export interface Disposition {
  reactionId: string;
  strength: number;
}

export interface FormedReaction {
  id: string;
  type: ReactionType;
  strength: number;
  awakenedAtTick: number;
  context: string;
  source: "disposition" | "bare" | "engineered";
}

export interface DispositionTable {
  polarity: { attraction: string[]; aversion: string[] };
  personalities: Record<string, { weights: Record<string, number>; precision: number }>;
  default: { weights: Record<string, number>; precision: number };
}

export function buildDispositionTable(data: unknown): DispositionTable {
  const d = data as Partial<DispositionTable> | null | undefined;
  if (!d || typeof d !== "object") {
    throw new ContentError("dispositions.json must be an object", "dispositions.json");
  }
  return {
    polarity: d.polarity ?? { attraction: [], aversion: [] },
    personalities: d.personalities ?? {},
    default: d.default ?? { weights: {}, precision: 0.2 },
  };
}

/** Is this an attraction personality (a bold, curious person greets change warmly)? */
export function matrixSign(personality: string | null, table: DispositionTable): number {
  if (!personality) return 0;
  if (table.polarity.attraction.includes(personality)) return 1;
  if (table.polarity.aversion.includes(personality)) return -1;
  return 0;
}

/** Generate 0-2 latent dispositions from a personality seed and the `reaction` stream. */
export function generateDispositions(
  personality: string | null,
  table: DispositionTable,
  rng: Rng,
  max = 2,
): Disposition[] {
  const entry = (personality && table.personalities[personality]) || table.default;
  const weights = Object.entries(entry.weights);
  if (weights.length === 0) return [];

  const count = rng.int("reaction", 0, max);
  const chosen: string[] = [];
  for (let i = 0; i < count; i++) {
    const pool = weights.filter(([id]) => !chosen.includes(id));
    if (pool.length === 0) break;
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let roll = rng.next("reaction") * total;
    let pick = pool[pool.length - 1]![0];
    for (const [id, w] of pool) {
      roll -= w;
      if (roll < 0) {
        pick = id;
        break;
      }
    }
    chosen.push(pick);
  }
  return chosen.map((reactionId) => ({
    reactionId,
    strength: Math.round((0.4 + rng.next("reaction") * 0.6) * 100) / 100,
  }));
}

export interface AwakeningContext {
  tick: number;
  tags: string[];
  /** scene signal flags that make a moment stick */
  intense: boolean;
  novel: boolean;
  private: boolean;
  witnessed: boolean;
  engineered: boolean;
  attractionBias: number;
}

export interface AwakeningResult {
  reaction: FormedReaction;
  fromDisposition: Disposition | null;
}

/**
 * Try to awaken a disposition (or, more weakly, a bare tag) into a reaction.
 * Returns the formed reaction, or null. Mutates nothing; the caller records it.
 */
export function attemptAwakening(
  dispositions: readonly Disposition[],
  catalog: ReactionCatalog,
  table: DispositionTable,
  ctx: AwakeningContext,
  rng: Rng,
): AwakeningResult | null {
  const matchingCatalog = catalog.matching(ctx.tags);
  if (matchingCatalog.length === 0) return null;

  const matchedDisposition =
    dispositions.find((d) => matchingCatalog.some((r) => r.id === d.reactionId)) ?? null;

  const baseChance = matchedDisposition ? 0.25 + matchedDisposition.strength * 0.35 : 0.06;
  const contextBonus =
    (ctx.intense ? 0.2 : 0) + (ctx.novel ? 0.15 : 0) + (ctx.engineered ? 0.1 : 0) + (ctx.witnessed ? 0.05 : 0);
  const chance = Math.min(0.95, baseChance + contextBonus);

  if (rng.next("reaction") >= chance) return null;

  const target =
    (matchedDisposition && catalog.get(matchedDisposition.reactionId)) ||
    catalog.matching(ctx.tags)[rng.int("reaction", 0, matchingCatalog.length - 1)]!;

  const attraction = (table.polarity.attraction.length ? ctx.attractionBias : 0) >= 0;
  const resolvedType = signType(target.type, attraction, ctx);

  // Strength is legible, not arbitrary: a disposition-driven reaction is deeper
  // than a bare one, and intensity/novelty deepen it further. Bucketed to 0.05.
  const base = matchedDisposition ? 0.5 + matchedDisposition.strength * 0.3 : 0.3;
  const deepen = (ctx.intense ? 0.1 : 0) + (ctx.novel ? 0.05 : 0);
  const strength = Math.min(1, Math.round((base + deepen) * 20) / 20);

  return {
    reaction: {
      id: target.id,
      type: resolvedType,
      strength,
      awakenedAtTick: ctx.tick,
      context: describeContext(ctx),
      source: matchedDisposition ? (ctx.engineered ? "engineered" : "disposition") : "bare",
    },
    fromDisposition: matchedDisposition,
  };
}

function signType(type: ReactionType, attraction: boolean, ctx: AwakeningContext): ReactionType {
  const wantAttraction = attraction || ctx.attractionBias > 0;
  if (type === "soft" || type === "hard") return wantAttraction ? "soft" : "hard";
  // a fetish/phobia is decided by the sign, not a coin flip.
  if (type === "fetish" || type === "phobia") return wantAttraction ? "fetish" : "phobia";
  return type;
}

function describeContext(ctx: AwakeningContext): string {
  const parts: string[] = [];
  if (ctx.private) parts.push("alone");
  if (ctx.witnessed) parts.push("watched");
  if (ctx.intense) parts.push("intense");
  if (ctx.novel) parts.push("first-time");
  if (ctx.engineered) parts.push("staged");
  return parts.join(",") || "ordinary";
}

/** Formed reactions whose catalog entry matches the given tags. */
export function reactionsMatching(
  reactions: readonly FormedReaction[],
  catalog: ReactionCatalog,
  tags: readonly string[],
): FormedReaction[] {
  if (tags.length === 0) return [];
  return reactions.filter((r) => {
    const def = catalog.get(r.id);
    const match = def?.match.tags ?? [];
    return match.length > 0 && match.every((t) => tags.includes(t));
  });
}

/** The strongest formed fetish matching the tags, if any (raises her ceiling). */
export function matchingFetish(
  reactions: readonly FormedReaction[],
  catalog: ReactionCatalog,
  tags: readonly string[],
): FormedReaction | null {
  const hits = reactionsMatching(reactions, catalog, tags).filter((r) => r.type === "fetish");
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.strength > a.strength ? b : a));
}

/**
 * A **familiarity taper** (blueprint P2/Q5, §23): a change wears in. The first
 * time a town reacts to a given kind the reaction is full-strength; each exposure
 * tempers it toward a floor, so an obvious change draws comment once and then
 * becomes, simply, the shape of her. Returns a 0.15..1 multiplier.
 */
export function familiarityTaper(familiarity: number, softenPer = 0.12, floor = 0.15): number {
  return Math.max(floor, 1 - familiarity * softenPer);
}
