import type { Subject } from "./subject";
import type { SelfPerception } from "./self_perception";

/**
 * Sexuality in the system (§22; S68, D-166/D-169). Sexuality is not a display
 * field and not static: it shapes whether a change lands as *desirable*, and the
 * transformation itself **moves** it. Following the pillar that everything is
 * connected, the drift runs through the same machinery as an awakening:
 *
 *   transformation (a sex shift) → the personality **matrix** (attraction vs
 *   aversion) → gated by how much she **noticed** and whether she **accepts or
 *   rejects** (self-perception) → a slow movement of what she is drawn toward.
 *
 * So a straight man who feminizes *and accepts it* comes to be drawn to men; one
 * who *rejects it* stays drawn to women. It reads the hormonal lean, so an
 * intersex or transitioning body counts. Baseline is neutral, so only real change
 * moves her.
 */
export const SEXUALITY_VERSION = 2;

export type Attraction = "same" | "opposite" | "both" | "none" | "any";

const NEUTRAL_LEAN = 0.15;
/** A sex shift smaller than this does not move her at all. */
export const DRIFT_MIN_SHIFT = 0.08;
/** Per-day drift step scale (slow, legible). */
export const DRIFT_RATE = 0.03;

/** Map a sexuality id to a direction of attraction. */
export function attractionFor(sexuality: string | null, _ownSex: string): Attraction {
  switch (sexuality) {
    case "gay":
      return "same";
    case "straight":
      return "opposite";
    case "bi":
    case "pan":
      return "both";
    case "ace":
      return "none";
    default:
      return "any";
  }
}

/** Female -1, male +1. */
function ownSexSign(sex: string): number {
  return sex === "male" ? 1 : -1;
}

/** The presentation her body currently reads as (-1 feminine .. +1 masculine). */
export function bodyPresentation(subject: Subject): number {
  const own = ownSexSign(subject.baseGender);
  return clamp1(own * 0.5 + (subject.derived.hormoneBalance ?? 0) * 0.5);
}

/** The presentation she is drawn to at baseline (-1 feminine .. +1 masculine). */
function baselineTarget(subject: Subject): number {
  const dir = attractionFor(subject.sexuality, subject.baseGender);
  const own = ownSexSign(subject.baseGender);
  switch (dir) {
    case "opposite":
      return -own * 0.5;
    case "same":
      return own * 0.5;
    default:
      return 0;
  }
}

/** What she is drawn to *now*, after drift (-1..+1). */
export function targetLean(subject: Subject): number {
  return clamp1(baselineTarget(subject) + (subject.sexualityDrift ?? 0));
}

/**
 * How strongly the present body reads as what she is drawn toward, in -1..1.
 * Positive = the body is what she wants; negative = she has drifted away from it.
 */
export function orientationAlignment(subject: Subject): number {
  const dir = attractionFor(subject.sexuality, subject.baseGender);
  if (dir === "none" || dir === "any") return 0;
  const present = bodyPresentation(subject);
  if (Math.abs(present - ownSexSign(subject.baseGender) * 0.5) <= NEUTRAL_LEAN) return 0; // body unchanged
  if (dir === "both") return 0.2;
  const distance = Math.abs(present - targetLean(subject));
  return clamp1((1.0 - distance) * 1.4 - 0.1);
}

/** A signed nudge added to the awakening attraction bias (S68). */
export function sexualityBias(subject: Subject): number {
  return Number((orientationAlignment(subject) * 0.4).toFixed(3));
}

/** Does her present body agree with what she is drawn to? (sheet read) */
export function sexualCoherence(subject: Subject): string {
  const dir = attractionFor(subject.sexuality, subject.baseGender);
  if (dir === "none") return "asexual";
  if (dir === "any") return "unconcerned";
  if (dir === "both") return "broad";
  const a = orientationAlignment(subject);
  if (a > 0.2) return "drawn in";
  if (a < -0.2) return "turned outward";
  return "steady";
}

/** The read of her drift, for the dossier. */
export function sexualityRead(subject: Subject): string {
  const drift = subject.sexualityDrift ?? 0;
  if (Math.abs(drift) < 0.1) return "settled";
  return drift > 0 ? "drawn further toward men" : "drawn further toward women";
}

export interface DriftInputs {
  /** 0..1 — how much of the sex-relevant change she has noticed (belief gap closed). */
  noticedShare: number;
  /** Her self-perception: coherence/dysmorphia set accept vs reject. */
  self: SelfPerception;
  /** Matrix greeting: +1 personality leans attraction, -1 aversion, 0 neutral. */
  matrixSign: number;
}

/**
 * One drift step, run daily. Only a real **sex shift** moves her, only as much as
 * she **noticed**, in the direction the change implies, signed by the **matrix**
 * greeting and whether she **accepts or rejects** it. Returns the delta applied.
 */
export function sexualityDriftStep(subject: Subject, inputs: DriftInputs): number {
  const shift = subject.derived.hormoneBalance ?? 0; // + masculine, - feminine
  if (Math.abs(shift) < DRIFT_MIN_SHIFT) return 0;

  // accepted change pulls the target toward the complement of the new body (she
  // follows her body); rejected, she clings to the original.
  const accept = clamp1((inputs.self.coherence - inputs.self.dysmorphia) / 60);
  const greeting = clamp1(inputs.matrixSign * 0.6 + accept * 0.8);
  const towardComplement = -Math.sign(shift) * 0.5;
  const delta = DRIFT_RATE * towardComplement * inputs.noticedShare * greeting;
  subject.sexualityDrift = clamp1((subject.sexualityDrift ?? 0) + delta);
  return Number(delta.toFixed(5));
}

function clamp1(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
