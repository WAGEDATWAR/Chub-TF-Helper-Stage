/**
 * Age-driven physiology (D-212). Age is a **driver**: it sets a body's height,
 * weight and frame, and it pulls the mind toward age-typical values, giving the
 * mind/emotion systems a real age dimension (mood, arousal, temperament). The
 * values are derived from age, not authored per subject, so an age change
 * recomputes them.
 *
 * Bands are plausible, fact-anchored ranges (D-203): growth to ~20, a stable
 * prime, then the slow drift of middle and later life. Effects are deliberately
 * gradual across the span so "scaling the span" reads as a trend, not a cliff.
 */
export const PHYSIOLOGY_VERSION = 1;

export interface AgeBand {
  min: number;
  /** Sex-neutral base height (cm) and the adult ceiling; body grows toward `heightMax`. */
  heightMin: number;
  heightMax: number;
  /** Base weight (kg) and how much frame adds at the band's top. */
  weightMin: number;
  weightMax: number;
  /** A frame descriptor for the band. */
  frame: string;
}

/** Plausible, fact-anchored bands (D-212). */
export const AGE_BANDS: readonly AgeBand[] = Object.freeze([
  { min: 13, heightMin: 150, heightMax: 166, weightMin: 44, weightMax: 60, frame: "adolescent" },
  { min: 18, heightMin: 160, heightMax: 172, weightMin: 52, weightMax: 68, frame: "youthful" },
  { min: 25, heightMin: 165, heightMax: 175, weightMin: 58, weightMax: 76, frame: "prime" },
  { min: 40, heightMin: 163, heightMax: 173, weightMin: 62, weightMax: 82, frame: "settled" },
  { min: 55, heightMin: 161, heightMax: 171, weightMin: 60, weightMax: 76, frame: "seasoned" },
  { min: 70, heightMin: 156, heightMax: 166, weightMin: 54, weightMax: 70, frame: "elder" },
]);

function bandFor(age: number): AgeBand {
  let band = AGE_BANDS[0]!;
  for (const b of AGE_BANDS) if (age >= b.min) band = b;
  return band;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** How far through a band an age is, 0..1. */
function within(band: AgeBand, age: number): number {
  const idx = AGE_BANDS.indexOf(band);
  const next = AGE_BANDS[idx + 1];
  const span = (next?.min ?? band.min + 15) - band.min;
  return Math.max(0, Math.min(1, (age - band.min) / Math.max(1, span)));
}

export interface Physiology {
  age: number;
  /** Height (cm), driven by age. */
  height: number;
  /** Weight (kg), driven by age. */
  weight: number;
  /** A frame descriptor ("youthful" .. "elder"). */
  frame: string;
  /** A stature multiplier (0.9..1.1) for size-class reads. */
  stature: number;
}

/** Derive a plausible physiology from an age (D-212). */
export function physiologyFor(age: number, sex: "male" | "female" | string = "female"): Physiology {
  const band = bandFor(age);
  const t = within(band, age);
  const sexFactor = sex === "male" ? 1.07 : 1;
  const height = lerp(band.heightMin, band.heightMax, t) * sexFactor;
  const weight = lerp(band.weightMin, band.weightMax, t) * (sex === "male" ? 1.08 : 1);
  return {
    age,
    height: Math.round(height),
    weight: Math.round(weight),
    frame: band.frame,
    stature: Math.round((height / 170) * 100) / 100,
  };
}

export interface AgeMindInfluence {
  /** Value id -> signed pull (added to the pull, not the value). */
  pull: Record<string, number>;
}

/**
 * How age pulls the mind (D-212). Youth leans toward openness, curiosity and
 * drive; age leans toward calm, composure and lower libido — so mood and arousal
 * gain an age dimension. Centred on 40 with a gentle slope across the span.
 */
export function ageMindInfluence(age: number): AgeMindInfluence {
  const years = (age - 40) / 10; // negative when younger, positive when older
  return {
    pull: {
      curious: -years * 1.6,
      optimism: -years * 1.0,
      libidinous: -years * 1.4,
      outgoing: -years * 0.8,
      calm: years * 1.3,
      composed: years * 1.5,
      nervous: -years * 0.7,
      confident: years * 1.1,
    },
  };
}

/** A 0..1 driver for a cosmetic value: how grown a body is at this age. */
export function maturity(age: number): number {
  if (age <= 12) return 0.35;
  if (age >= 22) return 1;
  return Math.round((0.35 + (0.65 * (age - 12)) / 10) * 100) / 100;
}

/**
 * Age-driven cosmetic appearance (D-212): certain appearance values are set from
 * physiology, so age drives them. Hair grows with age up to a plateau; breast and
 * genital sizes reach their adult measure by maturity. Values live on the part.
 */
export function ageCosmetics(age: number, sex: string, body: { get(slot: string): { appearance: Record<string, string>; role: string } | null; allInstances(): Array<{ appearance: Record<string, string>; role: string }> }): void {
  const m = maturity(age);
  const adult = age >= 25;
  for (const inst of body.allInstances()) {
    if ("length" in inst.appearance && inst.role === "hair") {
      inst.appearance.length = String(Math.round(6 + 18 * m)); // 6" to 24"
    }
    if ("cup" in inst.appearance && inst.role === "breasts" && sex !== "male") {
      const cups = ["AA", "A", "B", "C", "D", "DD"];
      inst.appearance.cup = cups[Math.min(cups.length - 1, 1 + Math.round(m * 3))]!;
    }
    if ("length" in inst.appearance && inst.role === "genital_primary" && adult) {
      inst.appearance.length = String(Math.round(3 + m * 3)); // 3" to 6"
    }
  }
}

