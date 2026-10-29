import type { Subject } from "./subject";

/**
 * Milk fullness (D-212 mini-tweak). A tracked 0..100 read on the breasts that the
 * full descriptor ties to, so lactation is a real dynamic rather than a flag: it
 * rises with the lactation attribute's progress, is seeded by age/fertility, and
 * gives future fetish/interaction hooks something to act on. Derived, never
 * stored on a bar.
 */
export const MILK_VERSION = 1;

/** Fullness bands, ascending; the top label is what the part descriptor shows. */
export const FULLNESS_BANDS: ReadonlyArray<{ min: number; label: string }> = Object.freeze([
  { min: 0, label: "dry" },
  { min: 25, label: "filling" },
  { min: 55, label: "heavy" },
  { min: 80, label: "brimming" },
]);

/** How full her breasts are, 0..100, from lactation progress + a fertile body. */
export function milkFullness(subject: Subject): number {
  let lactation = 0;
  let hasBreasts = false;
  for (const inst of subject.body.allInstances()) {
    if (!/breast|chest|nipple/.test(inst.role)) continue;
    hasBreasts = true;
    for (const entry of inst.attributes) {
      if (entry.id === "attr.lactation" || entry.id === "attr.mammary_row") {
        lactation = Math.max(lactation, entry.progress / 1000);
      }
    }
  }
  if (!hasBreasts) return 0;
  // a mature, fertile body carries a base fullness; lactation drives the rest
  const base = subject.age !== null && subject.age !== undefined && subject.age >= 20 ? 12 : 4;
  return Math.round(Math.min(100, base + lactation * 88));
}

/** The descriptor band for a fullness value. */
export function fullnessLabel(value: number): string {
  let label = FULLNESS_BANDS[0]!.label;
  for (const band of FULLNESS_BANDS) if (value >= band.min) label = band.label;
  return label;
}

/** The standard cup ladder, for inflating a base size by fullness. */
export const CUP_LADDER: readonly string[] = Object.freeze(["AA", "A", "B", "C", "D", "DD", "E", "F", "G", "H"]);

/**
 * A fuller breast reads larger: fullness bumps the base cup up the ladder (up to
 * two steps at `brimming`). So milk fullness influences breast size, not just its
 * descriptor (D-212 mini-tweak).
 */
export function inflateCup(baseCup: string, fullness: number): string {
  const idx = CUP_LADDER.indexOf(baseCup.toUpperCase());
  if (idx < 0) return baseCup;
  const bump = fullness >= 80 ? 2 : fullness >= 55 ? 1 : 0;
  return CUP_LADDER[Math.min(CUP_LADDER.length - 1, idx + bump)]!;
}

