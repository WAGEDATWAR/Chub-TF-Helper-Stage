import { clampStat } from "./stats";
import type { Subject } from "./subject";

/**
 * Self-perception (blueprint §24; D-134). How she reads her own change:
 *
 *   coherence  — does the body make sense to her; rises with Resonance and with
 *                the ratio of change she has *noticed* (a change she sees is
 *                less uncanny than one that happens behind her back);
 *   dysmorphia — estrangement from the body; rises with unnoticed change and
 *                with drift;
 *   pride      — the positive read; rises as coherence does at high Resonance.
 *
 * Coherence and dysmorphia are opposed but not mirrors: a rare save can be both
 * coherent and a little proud-estranged. Resonance moves coherence and pride;
 * exposure *above her acceptance* moves dysmorphia.
 */
export const SELF_VERSION = 1;

export const COHERENCE_START = 60;

export interface SelfPerception {
  coherence: number;
  dysmorphia: number;
  pride: number;
  /** The exposure at which she starts to feel estranged; rises with Resonance. */
  acceptance: number;
}

export function createSelfPerception(): SelfPerception {
  return { coherence: COHERENCE_START, dysmorphia: 0, pride: 0, acceptance: 55 };
}

/** Derive self-perception from resonance, unnoticeable change, and arc. */
export function readSelf(subject: Subject, { unnoticedShare = 0, drift = 0 } = {}): SelfPerception {
  const resonance = subject.stats.resonance ?? 50;
  const exposure = subject.derived.exposure ?? 0;
  const known = Math.min(6, Object.keys(subject.know).length);
  const acceptance = clampStat(45 + 0.5 * resonance);

  // coherence is the *target*: high resonance + a change she has seen is a body
  // that makes sense; unseen change subtracts from it.
  const coherence = clampStat(resonance * 0.9 + known * 3 - unnoticedShare * 45);
  // dysmorphia rises with change she cannot see and with exposure past acceptance
  const pastAccept = Math.max(0, exposure - acceptance);
  const dysmorphia = clampStat(0.6 * (unnoticedShare * 60 + pastAccept) - 0.3 * resonance + drift);
  const pride = clampStat(Math.max(0, coherence - 40) * 1.3 + Math.max(0, resonance - 50) * 0.6 - dysmorphia * 0.3);
  return { coherence, dysmorphia, pride, acceptance };
}

/** Step the stored read toward the derived read (slow, so it does not jitter). */
export function stepSelf(subject: Subject, derived: SelfPerception, rate = 0.15): SelfPerception {
  const s = subject.self ?? createSelfPerception();
  s.coherence = clampStat(stepToward(s.coherence, derived.coherence, rate));
  s.dysmorphia = clampStat(stepToward(s.dysmorphia, derived.dysmorphia, rate));
  s.pride = clampStat(stepToward(s.pride, derived.pride, rate));
  s.acceptance = derived.acceptance;
  subject.self = s;
  return s;
}

function stepToward(from: number, to: number, rate: number): number {
  return from + (to - from) * rate;
}

/** Resonance arc: the trajectory her resonance is on. Recoverable, telegraphed. */
export type ResonanceArc = "acceptance" | "settling" | "denial" | "estrangement";

export function resonanceArc(self: SelfPerception): ResonanceArc {
  if (self.dysmorphia >= 60) return "estrangement";
  if (self.dysmorphia >= 45) return "denial";
  if (self.coherence >= 70) return "acceptance";
  return "settling";
}

/** Does pride suppress resistance? High coherence + pride eases pressure. */
export function prideSuppresses(self: SelfPerception): boolean {
  return self.pride >= 55 && self.dysmorphia < 35;
}

/** Does low coherence raise resistance? */
export function dysmorphiaRaises(self: SelfPerception): boolean {
  return self.dysmorphia >= 55;
}
