import { ContentError, indexById } from "./loader";
import { familiarityTaper } from "./reactions";
import type { Rng } from "./rng";
import type { Town, AgentState } from "./town";

/**
 * Social reactions (M16b, §45; P2, Q5). The town *reacts to change*: a visible
 * transformation draws comment, and how it lands depends on **who** is looking
 * (a friend warms, a stranger is guarded — the relationship) and on **how used to
 * it** they are (a familiarity taper, §23: the first time it is startling, then it
 * is simply her). Every reaction is an **event** that moves a bond, so relationships
 * change through interaction, not random drift (§45).
 *
 * All of it is data (`social.json`); the subject is one participant among many.
 */
export const SOCIAL_VERSION = 1;

export type Valence = "warm" | "curious" | "cold";

export interface SocialReaction {
  id: string;
  label: string;
  /** Subject part/attr tags that trigger this. */
  when_tags: string[];
  valence: Valence;
  /** A key that familiarity tapers on (defaults to id). */
  familiarity_key?: string;
  /** Bond delta to the observer before valence/taper scaling. */
  bond?: number;
  /** Templates; `{observer}`, `{subject}`, `{change}` are interpolated. */
  lines: string[];
  /** Household members react more strongly (a child asks, a partner adjusts). */
  household_extra?: boolean;
}

interface SocialIndex {
  byId: Map<string, SocialReaction>;
}

export class SocialCatalog {
  private readonly index: SocialIndex;

  constructor(list: SocialReaction[]) {
    for (const r of list) {
      if (typeof r.id !== "string" || !Array.isArray(r.lines) || r.lines.length === 0) {
        throw new ContentError(`social reaction "${r.id ?? "?"}" needs an id and lines`, "social.json");
      }
    }
    this.index = { byId: indexById(list, "social.json") };
  }

  get(id: string): SocialReaction | null {
    return this.index.byId.get(id) ?? null;
  }
  all(): SocialReaction[] {
    return [...this.index.byId.values()];
  }
  /** Reactions whose trigger tags are all present in the given tag set. */
  matching(tags: readonly string[]): SocialReaction[] {
    if (tags.length === 0) return [];
    return this.all().filter((r) => r.when_tags.length > 0 && r.when_tags.every((t) => tags.includes(t)));
  }
}

export function buildSocialCatalog(data: unknown): SocialCatalog {
  const list = (data as { reactions?: unknown } | null | undefined)?.reactions;
  if (!Array.isArray(list)) throw new ContentError('social.json must declare a "reactions" array', "social.json");
  return new SocialCatalog(list as SocialReaction[]);
}

/** The valence's sign: how a reaction pulls a bond. */
export function valenceSign(v: Valence): number {
  return v === "warm" ? 1 : v === "cold" ? -1 : 0.4;
}

export interface SocialBeat {
  observer: string;
  reaction: SocialReaction;
  /** Familiarity before this reaction (0 = first time). */
  familiarity: number;
  /** Effective strength after the taper (0..1). */
  strength: number;
  /** Bond delta actually applied. */
  bondDelta: number;
  bondAfter: number;
  /** True when the observer shares the subject's household. */
  household: boolean;
  line: string;
}

const OBSERVER_WARMTH: Record<string, number> = { friend: 1.3, partner: 1.5, family: 1.4, colleague: 0.8, neighbour: 0.9, acquaintance: 1 };

function interpolate(template: string, observer: string, subject: string, change: string): string {
  return template
    .replace(/\{observer\}/g, observer)
    .replace(/\{subject\}/g, subject)
    .replace(/\{change\}/g, change);
}

/**
 * How a single observer reacts to the subject's visible change right now. Null when
 * nothing about the change registers (no matching reaction, or they are inured).
 * Mutates the bond and familiarity — the two are the *durable* residue of a beat.
 */
export function reactTo(
  town: Town,
  catalog: SocialCatalog,
  rng: Rng,
  observer: AgentState,
  subjectId: string,
  tags: readonly string[],
  changeLabel: string,
): SocialBeat | null {
  const matches = catalog.matching(tags);
  if (matches.length === 0) return null;

  const reaction = rng.weighted("world", matches, (r) => (r.household_extra && town.bond(observer.id, subjectId) ? 1.2 : 1));
  const key = reaction.familiarity_key ?? reaction.id;

  const rel = town.bond(observer.id, subjectId);
  const familiarity = town.familiarityOf(observer.id, key);
  // a long, lived history keeps a trace even after minor memories fade (B2):
  // the forgotten rollup nudges the bond pull the way a present relationship does.
  const trace = town.forgottenTrace(observer.id, subjectId);
  const tracePull = Math.min(0.2, trace * 0.02);
  // familiarity wears the surprise off; a strong bond *notices more* (a lover sees
  // the small change a stranger misses), so it raises salience before the taper.
  const bondPull = (rel ? 0.6 + (rel.bond / 100) * 0.8 : 0.8) + tracePull;
  const strength = Math.max(0, Math.min(1, bondPull * familiarityTaper(familiarity)));

  // a first, surprising reaction is the one that lands in the journal
  if (strength < 0.2 && familiarity > 0) return null;

  const observerName = town.def(observer.id)?.name ?? observer.id;
  const subjectName = town.def(subjectId)?.name ?? subjectId;
  const line = interpolate(rng.pick("world", reaction.lines), observerName, subjectName, changeLabel);

  const household = Boolean(observer.household && observer.household === town.state(subjectId)?.household);
  const relType = rel?.type ?? "acquaintance";
  // `bond` in data is a **magnitude**; the valence signs it (§45). So a cold
  // reaction with a big bond value drops the bond hard, and double-negation is
  // impossible.
  const base = Math.abs(reaction.bond ?? 3);
  const bondDelta = Math.round(base * valenceSign(reaction.valence) * (OBSERVER_WARMTH[relType] ?? 1) * strength * 10) / 10;
  const bondAfter = town.changeBond(observer.id, subjectId, bondDelta, relType);
  town.bumpFamiliarity(observer.id, key, 1);

  return { observer: observer.id, reaction, familiarity, strength, bondDelta, bondAfter, household, line };
}

/**
 * Everyone present reacts to the subject's visible change this block. Order is by
 * `presentAt` (stable), one beat per observer, so a scene has an audience, not a
 * chorus. Household members are always given the chance to react first (§45).
 */
export function runSocialReactions(
  town: Town,
  catalog: SocialCatalog,
  rng: Rng,
  subjectId: string,
  tags: readonly string[],
  changeLabel: string,
): SocialBeat[] {
  const subject = town.state(subjectId);
  if (!subject || tags.length === 0) return [];
  const present = town.presentAt(subject.at, subjectId);
  const ordered = present.slice().sort((a, b) => Number(b.household === subject.household) - Number(a.household === subject.household) || a.id.localeCompare(b.id));
  const beats: SocialBeat[] = [];
  for (const observer of ordered) {
    const beat = reactTo(town, catalog, rng, observer, subjectId, tags, changeLabel);
    if (beat) beats.push(beat);
  }
  return beats;
}
