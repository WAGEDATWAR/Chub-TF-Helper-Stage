import { ContentError, indexById } from "./loader";

export interface FeralProfile {
  id: string;
  debt_mult: number;
  [key: string]: unknown;
}

export class FeralRegistry {
  private readonly byId: Map<string, FeralProfile>;

  constructor(profiles: FeralProfile[]) {
    this.byId = indexById(profiles, "feral.json");
    for (const profile of profiles) {
      if (typeof profile.debt_mult !== "number") {
        throw new ContentError(`feral profile "${profile.id}" is missing a numeric "debt_mult"`, "feral.json");
      }
    }
  }

  get(id: string): FeralProfile | null {
    return this.byId.get(id) ?? null;
  }

  all(): FeralProfile[] {
    return [...this.byId.values()];
  }
}

export function buildFeralRegistry(data: unknown): FeralRegistry {
  const profiles = (data as { profiles?: unknown } | null | undefined)?.profiles;
  if (!Array.isArray(profiles)) {
    throw new ContentError('feral.json must declare a "profiles" array');
  }
  return new FeralRegistry(profiles as FeralProfile[]);
}

export interface ExposureBand {
  id: string;
  min: number;
  max: number;
  [key: string]: unknown;
}

export class ExposureBandRegistry {
  readonly bands: readonly ExposureBand[];

  constructor(bands: ExposureBand[]) {
    this.bands = [...bands].sort((a, b) => a.min - b.min);
    for (const band of this.bands) {
      if (typeof band.min !== "number" || typeof band.max !== "number") {
        throw new ContentError(`exposure band "${band.id}" needs numeric min/max`, "exposure_bands.json");
      }
      if (band.max < band.min) {
        throw new ContentError(`exposure band "${band.id}" max < min`, "exposure_bands.json");
      }
    }
  }

  bandFor(exposure: number): ExposureBand | null {
    for (const band of this.bands) {
      if (exposure >= band.min && exposure <= band.max) return band;
    }
    return null;
  }

  all(): ExposureBand[] {
    return [...this.bands];
  }
}

export function buildExposureBandRegistry(data: unknown): ExposureBandRegistry {
  const bands = (data as { bands?: unknown } | null | undefined)?.bands;
  if (!Array.isArray(bands)) {
    throw new ContentError('exposure_bands.json must declare a "bands" array');
  }
  return new ExposureBandRegistry(bands as ExposureBand[]);
}

export interface Flag {
  id: string;
  lifetime: string;
  description?: string;
  [key: string]: unknown;
}

export class FlagRegistry {
  private readonly byId: Map<string, Flag>;

  constructor(flags: Flag[]) {
    this.byId = indexById(flags, "flags.json");
    for (const flag of flags) {
      if (typeof flag.lifetime !== "string") {
        throw new ContentError(`flag "${flag.id}" is missing a string "lifetime"`, "flags.json");
      }
    }
  }

  get(id: string): Flag | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Flag[] {
    return [...this.byId.values()];
  }
}

export function buildFlagRegistry(data: unknown): FlagRegistry {
  const flags = (data as { flags?: unknown } | null | undefined)?.flags;
  if (!Array.isArray(flags)) {
    throw new ContentError('flags.json must declare a "flags" array');
  }
  return new FlagRegistry(flags as Flag[]);
}

export interface Token {
  id: string;
  fallback: string;
  [key: string]: unknown;
}

export class TokenRegistry {
  private readonly byId: Map<string, Token>;

  constructor(tokens: Token[]) {
    this.byId = indexById(tokens, "tokens.json");
    for (const token of tokens) {
      if (typeof token.fallback !== "string") {
        throw new ContentError(`token "${token.id}" is missing a string "fallback"`, "tokens.json");
      }
    }
  }

  get(id: string): Token | null {
    return this.byId.get(id) ?? null;
  }

  all(): Token[] {
    return [...this.byId.values()];
  }
}

export function buildTokenRegistry(data: unknown): TokenRegistry {
  const tokens = (data as { tokens?: unknown } | null | undefined)?.tokens;
  if (!Array.isArray(tokens)) {
    throw new ContentError('tokens.json must declare a "tokens" array');
  }
  return new TokenRegistry(tokens as Token[]);
}

export const REACTION_TYPES = Object.freeze(["soft", "hard", "phobia", "fetish"] as const);
export type ReactionType = (typeof REACTION_TYPES)[number];

export interface Reaction {
  id: string;
  type: ReactionType;
  match: { tags?: string[]; roles?: string[] };
  reaction_key: string;
  [key: string]: unknown;
}

/** Catalog of possible reactions (blueprint §22.3). */
export class ReactionCatalog {
  private readonly byId: Map<string, Reaction>;

  constructor(reactions: Reaction[]) {
    this.byId = indexById(reactions, "reactions.json");
    for (const reaction of reactions) {
      if (!(REACTION_TYPES as readonly string[]).includes(reaction.type)) {
        throw new ContentError(`reaction "${reaction.id}" has unknown type "${reaction.type}"`, "reactions.json");
      }
      if (!reaction.match || (!reaction.match.tags && !reaction.match.roles)) {
        throw new ContentError(`reaction "${reaction.id}" needs a match by tags or roles`, "reactions.json");
      }
      if (typeof reaction.reaction_key !== "string") {
        throw new ContentError(`reaction "${reaction.id}" is missing a reaction_key`, "reactions.json");
      }
    }
  }

  get(id: string): Reaction | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Reaction[] {
    return [...this.byId.values()];
  }

  byType(type: ReactionType): Reaction[] {
    return this.all().filter((r) => r.type === type);
  }

  /** Every catalog reaction whose tag match is satisfied by `tags`. */
  matching(tags: readonly string[]): Reaction[] {
    return this.all().filter((r) => (r.match.tags ?? []).every((t) => tags.includes(t)));
  }
}

export function buildReactionCatalog(data: unknown): ReactionCatalog {
  const reactions = (data as { reactions?: unknown } | null | undefined)?.reactions;
  if (!Array.isArray(reactions)) {
    throw new ContentError('reactions.json must declare a "reactions" array');
  }
  return new ReactionCatalog(reactions as Reaction[]);
}

export interface Axis {
  id: string;
  weight: number;
  bands: string[];
}

export class AxisRegistry {
  private readonly byId: Map<string, Axis>;

  constructor(axes: Axis[]) {
    this.byId = indexById(axes, "axes.json");
    for (const axis of axes) {
      if (!Array.isArray(axis.bands) || axis.bands.length === 0) {
        throw new ContentError(`axis "${axis.id}" must declare a non-empty "bands" array`, "axes.json");
      }
      if (typeof axis.weight !== "number") {
        throw new ContentError(`axis "${axis.id}" is missing a numeric "weight"`, "axes.json");
      }
    }
  }

  get(id: string): Axis | null {
    return this.byId.get(id) ?? null;
  }

  all(): Axis[] {
    return [...this.byId.values()];
  }

  weight(id: string): number {
    return this.get(id)?.weight ?? 0;
  }
}

export function buildAxisRegistry(data: unknown): AxisRegistry {
  const axes = (data as { axes?: unknown } | null | undefined)?.axes;
  if (!Array.isArray(axes)) {
    throw new ContentError('axes.json must declare an "axes" array');
  }
  return new AxisRegistry(axes as Axis[]);
}
