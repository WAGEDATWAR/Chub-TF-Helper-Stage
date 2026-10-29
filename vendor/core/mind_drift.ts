import { clampFloat } from "./mind";
import type { Mind } from "./mind";

/**
 * The drift engine (blueprint §17.5, §24; D-172–D-179; M15.5b). A mental value is
 * pulled gradually toward a settling **target** — never snapping. The pull is
 * **fast and insidious while unnoticed** and slows as she becomes aware, but
 * awareness also hands her the wheel (agency). Sustained resistance fatigues her
 * and blunts her influence. Once realized, opinionated and stable she steers the
 * target toward her own desired settling point — *convergence first, then
 * influence* (D-179).
 *
 * Pure: reads a context, mutates the mind, returns what changed. No rng, no DOM.
 */
export const MIND_DRIFT_VERSION = 1;

/** Fraction of the remaining gap closed per day at full force. */
export const DRIFT_BASE_RATE = 0.08;
/** The pull never drops below this, even at full awareness (D-177). */
export const PULL_FLOOR = 0.3;
/** Awareness at/above which the realization moment fires (top of the Blind tier). */
export const REVEAL_THRESHOLD = 15;
/** Awareness at/above which the subject may steer her own settling target. */
export const INFLUENCE_THRESHOLD = 35;

export interface DriftInputs {
  awareness: number;
  /** Her fight against the change, 0..100. */
  resistance: number;
  /** Her ability to act on the change, 0..100. */
  agency: number;
  /** Shared control stat, 0..100 (D-176): steadier = firmer steer. */
  stability: number;
  /** Accumulated resistance-fatigue, 0..100 (D-178): a penalty on influence. */
  fatigue: number;
  realized: boolean;
  /** How settled she reads her own body (0..100), for the steer gate. */
  selfCoherence: number;
  /** The signed pull toward a value's target from bodies/abilities/genomes. */
  pull: (valueId: string) => number;
}

export interface DriftStep {
  valueId: string;
  from: number;
  to: number;
  /** Sign of the movement. */
  direction: -1 | 0 | 1;
}

/** How strongly the natural pull acts this day (0..1) — high while unaware. */
export function pullStrength(inputs: DriftInputs): number {
  const unaware = 1 - clampUnit(inputs.awareness / 100);
  // awareness slows the insidious pull but never stops it (D-177): a floor keeps a
  // fully-aware subject still changed by the body she is in.
  return PULL_FLOOR + (1 - PULL_FLOOR) * unaware;
}

/** The subject's counter-pressure against the pull (0..1): fight, blunted by fatigue. */
export function resistanceStrength(inputs: DriftInputs): number {
  const fight = clampUnit(inputs.resistance / 100) * clampUnit(inputs.agency / 100);
  const fatiguePenalty = 1 - 0.5 * clampUnit(inputs.fatigue / 100);
  return clampUnit(fight * fatiguePenalty);
}

/** Whether she can steer her own settling target yet (D-179). */
export function canSteer(inputs: DriftInputs): boolean {
  return inputs.realized && inputs.awareness >= INFLUENCE_THRESHOLD && inputs.stability >= 55 && inputs.selfCoherence >= 45;
}

/**
 * One daily step for every value whose target differs from its reading. The value
 * closes `rate` of the gap; the target itself moves toward her desired point once
 * she can steer. Returns the values that moved.
 */
export function driftStep(mind: Mind, inputs: DriftInputs): DriftStep[] {
  const moved: DriftStep[] = [];
  const steer = canSteer(inputs);
  const pull = pullStrength(inputs);
  const pressure = resistanceStrength(inputs);

  for (const id of mind.ids()) {
    const state = mind.get(id)!;
    // the change's target: baseline + external pull, capped by the settling target
    const wanted = clampFloat(state.baseline + inputs.pull(id));
    state.target = state.target + (wanted - state.target) * 0.2; // target converges slowly
    // the value closes the gap to its cap, slowed by her awareness+fight
    const rate = DRIFT_BASE_RATE * pull * (1 - 0.6 * pressure);
    const gap = state.target - state.value;
    if (Math.abs(gap) < 0.02) continue;
    const before = state.value;
    state.value = clampFloat(state.value + gap * rate);
    if (state.value !== before) {
      moved.push({ valueId: id, from: before, to: state.value, direction: gap > 0 ? 1 : -1 });
    }
    // once she can steer, her desired settling point bends the target (convergence
    // first): a subject settles near where her stance points.
    if (steer) {
      const desired = clampFloat(state.baseline + (state.value >= state.baseline ? 1 : -1) * 12);
      state.target = clampFloat(state.target + (desired - state.target) * 0.05);
    }
  }
  return moved;
}

/** Awareness gains from a noticed change; more notice = faster realization. */
export function awarenessGain(noticedNow: number, overallKnowledge: number): number {
  if (noticedNow <= 0) return overallKnowledge > 6 ? 2.6 : 1.4; // ambient self-read
  return 5 + noticedNow * 3;
}

/**
 * The daily agency step (D-172, was dead). Agency is her *ability to act on* the
 * change — how much of the wheel she holds. It rises with awareness, confidence,
 * mastery and composure, and falls when resistance outruns her. This is the other
 * half of `resistanceStrength`: without it a subject could never genuinely steer,
 * so it is grown and spent here instead of sitting at its 50 start.
 */
export function agencyStep(mind: Mind, inputs: DriftInputs): number {
  const confident = inputs.pull("confident"); // pull frames confidence toward the target
  const aware = clampUnit(inputs.awareness / 100);
  const composure = clampUnit(inputs.stability / 100) * 0.5 + 0.5;
  const hold = clampUnit(inputs.resistance / 100) * clampUnit(inputs.fatigue / 100);
  // growth: awareness + a confident, composed read; drag: fought-to-fatigue
  const growth = 0.6 + 2.2 * aware * composure + 0.01 * (confident >= 0 ? confident : confident * 0.5);
  const drag = 1.4 * hold;
  const before = mind.agency;
  mind.agency = Math.max(0, Math.min(100, mind.agency + growth - drag));
  return mind.agency - before;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}
