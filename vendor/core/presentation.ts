import { ContentError } from "./loader";
import type { EventDef } from "./events";

/**
 * Tone preset vs graphic filter (Playground borrow, S77). Two **independent**
 * controls that never touch the event record:
 *
 *   - **Tone preset** (`cozy` | `standard` | `mature`) scales the *likelihood* of
 *     event categories only. An event that is rolled resolves exactly the same way
 *     whatever the preset; only the odds of rolling it change.
 *   - **Graphic filter** (`full` | `reduced` | `minimal`) changes *text detail* only
 *     — how a line is worded, whether a feature is named — never the event, rules or
 *     state. A test proves the record is byte-identical at every filter level.
 *
 * Both are data (`presentation.json`); both are settings, never authority.
 */
export const PRESENTATION_VERSION = 1;

export const TONE_PRESETS = ["cozy", "standard", "mature"] as const;
export type TonePreset = (typeof TONE_PRESETS)[number];

export const FILTER_LEVELS = ["full", "reduced", "minimal"] as const;
export type FilterLevel = (typeof FILTER_LEVELS)[number];

export interface PresentationData {
  /** Category -> per-preset likelihood multiplier (permille). */
  tone_likelihood: Record<string, Partial<Record<TonePreset, number>>>;
  /** Filter level -> feature visibility (which named details are shown). */
  filter_detail: Record<FilterLevel, "all" | "major" | "core">;
}

export function buildPresentationData(data: unknown): PresentationData {
  const d = data as Partial<PresentationData> | null | undefined;
  if (!d || typeof d !== "object") throw new ContentError("presentation.json must be an object", "presentation.json");
  return {
    tone_likelihood: d.tone_likelihood ?? {},
    filter_detail: d.filter_detail ?? { full: "all", reduced: "major", minimal: "core" },
  };
}

export function isTonePreset(v: string): v is TonePreset {
  return (TONE_PRESETS as readonly string[]).includes(v);
}
export function isFilterLevel(v: string): v is FilterLevel {
  return (FILTER_LEVELS as readonly string[]).includes(v);
}

/**
 * The tone preset: a likelihood multiplier (permille) for an event of a category.
 * It scales *when* an event fires, never *what* it does.
 */
export class TonePreset_ {
  readonly id: TonePreset;
  private readonly data: PresentationData;

  constructor(id: TonePreset, data: PresentationData) {
    this.id = id;
    this.data = data;
  }
  /** Permille multiplier for a category under this preset (1000 = unchanged). */
  likelihood(category: string): number {
    return this.data.tone_likelihood[category]?.[this.id] ?? 1000;
  }
  /** Scale a base salience by the category's preset multiplier, clamped 0..1. */
  scaleSalience(category: string, base: number): number {
    return Math.max(0, Math.min(1, (base * this.likelihood(category)) / 1000));
  }
}

/**
 * The graphic filter: how much named detail the *presentation* shows. The record is
 * untouched; only which detail survives to the line.
 */
export class GraphicFilter {
  readonly level: FilterLevel;
  private readonly data: PresentationData;

  constructor(level: FilterLevel, data: PresentationData) {
    this.level = level;
    this.data = data;
  }
  /** How much detail is shown: `all`, `major` (big changes only), `core`. */
  get detail(): "all" | "major" | "core" {
    return this.data.filter_detail[this.level] ?? "all";
  }
  /** Should a named feature of the given prominence be shown at this level? */
  shows(prominence: "core" | "major" | "minor"): boolean {
    const d = this.detail;
    if (d === "all") return true;
    if (d === "major") return prominence !== "minor";
    return prominence === "core";
  }
  /** Pick the most-filtered variant text: variant_full/reduced/minimal else `base`. */
  pick(base: string, variants: Partial<Record<FilterLevel, string>>): string {
    return variants[this.level] ?? base;
  }
}

export interface PresentationSettings {
  tone: TonePreset;
  filter: FilterLevel;
}

export const DEFAULT_PRESENTATION: PresentationSettings = Object.freeze({ tone: "standard", filter: "full" });

/** A variant-aware description of an event, filtered by the level (never the record). */
export function filteredLine(def: EventDef, pay: Record<string, unknown>, filter: GraphicFilter, interpolate: (t: string, p: Record<string, unknown>) => string): string {
  const variants: Partial<Record<FilterLevel, string>> = {};
  const full = (def as { line_full?: string }).line_full;
  const reduced = (def as { line_reduced?: string }).line_reduced;
  const minimal = (def as { line_minimal?: string }).line_minimal;
  if (full !== undefined) variants.full = full;
  if (reduced !== undefined) variants.reduced = reduced;
  if (minimal !== undefined) variants.minimal = minimal;
  const chosen = filter.pick(def.line, variants);
  return interpolate(chosen, pay);
}
