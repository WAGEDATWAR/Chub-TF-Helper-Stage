import { ContentError } from "./loader";
import type { Session } from "./session";


/**
 * Sex/masturbation actions (blueprint §48.5; D-190; M15.5f). An act is composed of
 * parts, each data-authored:
 *
 *   recipient (self | other) → category → action → target (a part role) → supporting
 *
 * Selection is weighted by her preferences, reactions and arousal, and biased by
 * context (a submissive subject favours being on the receiving end). Masturbation
 * omits `recipient`. Nothing here is player input — the sim picks.
 */
export const SEX_ACTION_VERSION = 1;

export interface SexAction {
  id: string;
  category: string;
  label: string;
  /** Part roles the action can target (empty = body-general). */
  targets?: string[];
  /** A supporting action may run alongside a primary when a limb is free. */
  supporting?: boolean;
  /** Arousal added. */
  arousal?: number;
  /** Topic tags the actor satisfies by performing it. */
  topics?: string[];
  /** Preference topic this act plays to, for weighting. */
  plays_to?: string[];
  requires?: { ability?: string; at?: number; reaction?: string };
  line?: string;
}

export interface SexCatalogData {
  actions: SexAction[];
}

export class SexCatalog {
  private readonly byId: Map<string, SexAction>;

  constructor(data: SexCatalogData) {
    this.byId = new Map();
    for (const a of data.actions) {
      if (!a.id || !a.category) throw new ContentError("sex action needs an id and category", "sex_actions.json");
      if (this.byId.has(a.id)) throw new ContentError(`duplicate sex action "${a.id}"`, "sex_actions.json");
      this.byId.set(a.id, a);
    }
  }

  get(id: string): SexAction | null {
    return this.byId.get(id) ?? null;
  }

  all(): SexAction[] {
    return [...this.byId.values()];
  }

  byCategory(): Map<string, SexAction[]> {
    const out = new Map<string, SexAction[]>();
    for (const a of this.all()) {
      const list = out.get(a.category) ?? [];
      list.push(a);
      out.set(a.category, list);
    }
    return out;
  }
}

export function buildSexCatalog(data: unknown): SexCatalog {
  const actions = (data as { actions?: unknown } | null | undefined)?.actions;
  if (!Array.isArray(actions)) throw new ContentError('sex_actions.json must declare an "actions" array', "sex_actions.json");
  return new SexCatalog({ actions: actions as SexAction[] });
}

export interface SexPick {
  recipient: "self" | "other";
  action: SexAction;
  target: string | null;
  supporting: SexAction | null;
  weight: number;
}

/** Can she perform this act right now (ability/reaction gate)? */
export function actUnlocked(session: Session, action: SexAction): boolean {
  const req = action.requires;
  if (!req) return true;
  if (req.reaction && !session.subject.reactions.some((r) => r.id === req.reaction)) return false;
  if (req.ability) {
    const m = session.subject.abilities[req.ability]?.mastery ?? 0;
    if (m < (req.at ?? 0)) return false;
  }
  return true;
}

/**
 * Choose a sex/masturbation act: weight by preference match (a fetish topic bias),
 * arousal, and a small personality flip (dominant leads, submissive receives).
 */
export function pickSexAction(session: Session, catalog: SexCatalog, opts: { masturbation?: boolean } = {}): SexPick | null {
  const s = session.subject;
  const prefs = s.preferences.all();
  const dominantBias = ((s.mind?.read("dominant") ?? 50) - 50) / 100; // -1..1
  const candidates: SexPick[] = [];
  for (const action of catalog.all()) {
    if (opts.masturbation && action.category === "penetration") continue;
    if (!actUnlocked(session, action)) continue;
    let weight = 1 + ((action.arousal ?? 0) / 30);
    for (const topic of action.plays_to ?? []) {
      const pref = prefs.find((p) => p.topic === topic || p.topic === `topic.${topic}`);
      if (pref) weight *= pref.kind === "fetish" ? 1 + Math.abs(pref.opinion) / 100 : 1 - Math.abs(pref.opinion) / 200;
    }
    const recipient: "self" | "other" = opts.masturbation ? "self" : dominantBias > 0.15 ? "other" : "self";
    const target = action.targets && action.targets.length > 0 ? action.targets[Math.abs(hash(action.id)) % action.targets.length]! : null;
    candidates.push({ recipient, action, target, supporting: null, weight });
  }
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = session.rng.next("outcome") * total;
  let picked = candidates[candidates.length - 1]!;
  for (const c of candidates) { roll -= c.weight; if (roll < 0) { picked = c; break; } }
  // a supporting action when one is free and unlocked
  const support = catalog.all().find((a) => a.supporting && actUnlocked(session, a) && a.id !== picked.action.id) ?? null;
  return { ...picked, supporting: support };
}

/** Perform a chosen act (no partner resolution yet — stub partners). */
export function performSex(session: Session, pick: SexPick): { arousal: number; topics: string[] } {
  const s = session.subject;
  const add = (pick.action.arousal ?? 0) + (pick.supporting?.arousal ?? 0) / 2;
  s.stats.arousal = Math.min(100, (s.stats.arousal ?? 0) + add);
  const topics = [...(pick.action.topics ?? []), ...(pick.supporting?.topics ?? [])];
  session.flags.add("had_sex");
  const line = pick.action.line ?? `She takes to ${pick.action.label.toLowerCase()}.`;
  session.bus.emit("sex.session", { act: pick.action.id, supporting: pick.supporting?.id ?? null, recipient: pick.recipient }, { final: true });
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: line });
  session.markDirty();
  return { arousal: add, topics };
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}
