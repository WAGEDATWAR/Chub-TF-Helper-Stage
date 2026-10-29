import { ContentError } from "./loader";
import { clampStat } from "./stats";

/**
 * Mood (blueprint §17.5, §24; D-174; M15.5a). A **named emotion set** is the
 * simulated substrate — systems read/write named feelings, so links stay wireable
 * and validatable. A **gamut** (valence × arousal × dominance) is *derived from*
 * the set purely for representation: the mood map, the point, and a mixed label.
 *
 * Decays nightly toward calm; impulses push named emotions. Nothing reads the DOM.
 */
export const MOOD_VERSION = 1;

export interface EmotionDef {
  id: string;
  label: string;
  /** Pleasantness contribution 0..100. */
  valence: number;
  /** Activation contribution 0..100. */
  arousal: number;
  /** Dominance contribution 0..100. */
  dominance: number;
}

export interface MoodData {
  emotions: EmotionDef[];
  label_threshold: number;
}

export function buildMoodData(raw: unknown): MoodData {
  const data = raw as MoodData | null | undefined;
  if (!data || !Array.isArray(data.emotions) || data.emotions.length === 0) {
    throw new ContentError('mood.json must declare a non-empty "emotions" array', "mood.json");
  }
  const seen = new Set<string>();
  for (const e of data.emotions) {
    if (typeof e.id !== "string") throw new ContentError("every emotion needs a string id", "mood.json");
    if (seen.has(e.id)) throw new ContentError(`duplicate emotion "${e.id}"`, "mood.json");
    seen.add(e.id);
  }
  return { emotions: data.emotions, label_threshold: data.label_threshold ?? 12 };
}

export interface GamutPoint {
  valence: number;
  arousal: number;
  dominance: number;
}

export class Mood {
  version = MOOD_VERSION;
  readonly emotions: Map<string, number> = new Map();
  private readonly defs: Map<string, EmotionDef> = new Map();
  readonly labelThreshold: number;

  constructor(data: MoodData) {
    for (const e of data.emotions) {
      this.emotions.set(e.id, 0);
      this.defs.set(e.id, e);
    }
    this.labelThreshold = data.label_threshold;
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }

  get(id: string): number {
    return this.emotions.get(id) ?? 0;
  }

  /** Push an emotion (positive or negative impulse), clamped. */
  impulse(id: string, amount: number): number {
    if (!this.emotions.has(id)) return 0;
    const next = clampStat(this.get(id) + amount);
    this.emotions.set(id, next);
    return next;
  }

  /** Nightly decay toward calm. */
  decay(rate = 4): void {
    for (const [id, v] of this.emotions) if (v > 0) this.emotions.set(id, Math.max(0, v - rate));
  }

  /** The gamut point, weighted by each emotion's strength and its axis. */
  point(): GamutPoint {
    let total = 0;
    let v = 0;
    let a = 0;
    let d = 0;
    for (const [id, strength] of this.emotions) {
      if (strength <= 0) continue;
      const def = this.defs.get(id)!;
      total += strength;
      v += def.valence * strength;
      a += def.arousal * strength;
      d += def.dominance * strength;
    }
    if (total === 0) return { valence: 50, arousal: 30, dominance: 50 };
    return { valence: Math.round(v / total), arousal: Math.round(a / total), dominance: Math.round(d / total) };
  }

  /**
   * A mixed label from the top emotions above the threshold, joined. Ordering is
   * by strength so the dominant feeling leads ("bittersweet happiness").
   */
  label(): string {
    const lit = [...this.emotions.entries()]
      .filter(([, v]) => v >= this.labelThreshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => this.defs.get(id)!.label.toLowerCase());
    if (lit.length === 0) return "even";
    if (lit.length === 1) return lit[0]!;
    return `${lit[0]} and ${lit[1]}${lit[2] ? `, ${lit[2]}` : ""}`;
  }

  /** The band of the gamut point, for a coarse read. */
  band(): string {
    const p = this.point();
    const pleasant = p.valence >= 55 ? "pleasant" : p.valence <= 45 ? "unpleasant" : "neutral";
    const charged = p.arousal >= 60 ? "charged" : p.arousal <= 35 ? "still" : "temperate";
    return `${pleasant}-${charged}`;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.emotions);
  }

  static fromJSON(json: Record<string, number> | null | undefined, data: MoodData): Mood {
    const mood = new Mood(data);
    for (const [id, v] of Object.entries(json ?? {})) if (mood.emotions.has(id)) mood.emotions.set(id, v);
    return mood;
  }
}

export function createMood(data: MoodData): Mood {
  return new Mood(data);
}
