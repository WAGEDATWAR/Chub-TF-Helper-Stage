/**
 * Power-category presentation (D-200). A short summary per category and a hint
 * per power, held in one place so the power bar can show what a category is for
 * and what a non-mutagen power does — the UI never invents these.
 */

export interface CategoryMeta {
  id: string;
  label: string;
  summary: string;
  /** True when the category changes the body (a mutagen bestow). */
  mutagenic: boolean;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  bestow: { id: "bestow", label: "Bestow", summary: "bestow a species — the deep change", mutagenic: true },
  temper: { id: "temper", label: "Temper", summary: "nudge her state: steady, elate, hurry a change", mutagenic: false },
  hold: { id: "hold", label: "Hold", summary: "freeze a change in place, or hold it still", mutagenic: false },
  unmake: { id: "unmake", label: "Unmake", summary: "strip a genome back toward baseline", mutagenic: false },
  sway: { id: "sway", label: "Sway", summary: "move the clock, light, and her attention", mutagenic: false },
  reveal: { id: "reveal", label: "Reveal", summary: "open her mind or magnify a part", mutagenic: false },
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? { id: category, label: category, summary: "", mutagenic: false };
}

/** Hints for the known non-mutagen powers, so a press is never a mystery. */
const POWER_HINTS: Record<string, string> = {
  "power.temper_steady": "raises composure, dulls pain",
  "power.temper_elate": "lifts mood and drive",
  "power.temper_drowse": "eases her toward rest",
  "power.temporal_compress": "hastens growth — the change comes sooner",
  "power.temporal_stretch": "draws growth out — the change slows",
  "power.hold_pause": "holds the current change in place",
  "power.hold_still": "stills an unstable body",
  "power.unmake_revert": "reverts toward baseline",
  "power.unmake_uncrown": "drops a crowned genome",
  "power.sway_shift": "shifts her attention",
  "power.sway_dim": "dims the room",
  "power.sway_stir": "stirs her",
  "power.sway_open": "opens her to the change",
  "power.temporal_shift": "moves the clock an hour",
  "power.reveal_sight": "opens her mind — you read her thought",
  "power.reveal_magnify": "magnifies a part in detail",
};

export function powerHint(powerId: string, fallback = ""): string {
  return POWER_HINTS[powerId] ?? fallback;
}
