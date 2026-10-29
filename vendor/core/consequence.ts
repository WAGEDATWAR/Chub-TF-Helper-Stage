import { ContentError } from "./loader";
import { driveToleranceBonus } from "./psychology";

export const TOLERANCE_MIN = 10;
export const TOLERANCE_MAX = 95;

/** Divergence D-119: the reference's Yield/Soften/Push/Break become Comfort/Ease/Press/Force. */
export const RESPONSES = Object.freeze(["comfort", "ease", "press", "force"] as const);
export type Response = (typeof RESPONSES)[number];

export const STOP_PRIORITY = Object.freeze(["phobia", "hard", "overload", "pain"] as const);

export interface ToleranceInput {
  strength?: number;
  arousal?: number;
  resonance?: number;
  composure?: number;
  exposure?: number;
  stability?: number;
  fatigue?: number;
  drive?: number;
}

export function tolerance(input: ToleranceInput = {}): number {
  const { strength = 0, arousal = 0, resonance = 0, composure = 0, exposure = 0, stability = 100, fatigue = 0, drive = 0 } = input;
  const raw =
    35 +
    0.45 * strength +
    0.25 * arousal +
    0.15 * resonance +
    0.15 * composure -
    0.2 * exposure -
    0.3 * (100 - stability) -
    0.2 * fatigue +
    driveToleranceBonus(drive);
  return Math.max(TOLERANCE_MIN, Math.min(TOLERANCE_MAX, raw));
}

export function painPressure(pain: number, tol: number): number {
  if (tol <= 0) return Infinity;
  return pain / tol;
}

export interface OutcomeBand {
  max_pressure: number;
  weights: Record<string, number>;
}

export function outcomeBand(painPressureValue: number, pressOutcomes: OutcomeBand[]): OutcomeBand {
  for (const band of pressOutcomes) {
    if (painPressureValue <= band.max_pressure) return band;
  }
  return pressOutcomes[pressOutcomes.length - 1]!;
}

export function selectOutcome(band: OutcomeBand, roll: number): string {
  const total = Object.values(band.weights).reduce((s, w) => s + w, 0);
  let threshold = roll * total;
  for (const [outcome, weight] of Object.entries(band.weights)) {
    threshold -= weight;
    if (threshold <= 0) return outcome;
  }
  const keys = Object.keys(band.weights);
  return keys[keys.length - 1]!;
}

export interface StopCauseInput {
  reactionType?: string | null;
  overload?: number;
  ceiling?: number;
  painPressure?: number;
}

export function stopCause({ reactionType = null, overload = 0, ceiling = 100, painPressure: pressure = 0 }: StopCauseInput = {}): string | null {
  if (reactionType === "phobia") return "phobia";
  if (reactionType === "hard") return "hard";
  if (overload >= ceiling) return "overload";
  if (pressure >= 1) return "pain";
  return null;
}

export function composureGateApplies(composure: number, { pressingPast = false } = {}): boolean {
  return pressingPast && composure < 30;
}

export function responseComposureDelta(response: string, { gate = false } = {}): number {
  const base: Record<string, number> = { comfort: 1, ease: 0, press: -1, force: -2 };
  const value = base[response] ?? 0;
  if (value < 0 && gate) return value * 2;
  return value;
}

export const NEGATIVE_OUTCOMES = Object.freeze({
  integrity_damage: { cost: "part health, function", recovery: "rest", telegraphedBy: "integrity" },
  composure_loss: { cost: "ceilings, resistance", recovery: "rest, support, honoured reactions", telegraphedBy: "composure" },
  blackout: { cost: "forced reversion, lost time", recovery: "immediate, composure -5", telegraphedBy: "pain_pressure" },
  feral_lock: { cost: "intelligence debt", recovery: "training, booster, time", telegraphedBy: "exposure" },
  involuntary_drift: { cost: "unwanted attributes", recovery: "revert or accept", telegraphedBy: "stability" },
});

export class ConsequenceEngine {
  readonly pressOutcomes: OutcomeBand[];

  constructor({ pressOutcomes }: { pressOutcomes?: OutcomeBand[] } = {}) {
    if (!Array.isArray(pressOutcomes) || pressOutcomes.length === 0) {
      throw new ContentError("consequence: push_outcomes must be a non-empty array", "consequence.json");
    }
    for (let i = 1; i < pressOutcomes.length; i++) {
      if (pressOutcomes[i]!.max_pressure <= pressOutcomes[i - 1]!.max_pressure) {
        throw new ContentError("consequence: push_outcomes max_pressure must be strictly ascending", "consequence.json");
      }
    }
    this.pressOutcomes = [...pressOutcomes];
  }

  resolve({ response, stats, roll = 0.5, reactionType = null, ceiling = 100 }: { response: string; stats: Record<string, number>; roll?: number; reactionType?: string | null; ceiling?: number }) {
    const tol = tolerance(stats as ToleranceInput);
    const pressure = painPressure(stats.pain ?? 0, tol);
    const cause = stopCause({ reactionType, overload: stats.overload ?? 0, ceiling, painPressure: pressure });

    if (response === "comfort") {
      return { response, cause, pressure, tolerance: tol, outcome: "comforted", composureDelta: responseComposureDelta("comfort") };
    }
    if (response === "ease") {
      return { response, cause, pressure, tolerance: tol, outcome: "eased", composureDelta: 0, painMultiplier: 0.6 };
    }

    const band = outcomeBand(pressure, this.pressOutcomes);
    const outcome = selectOutcome(band, roll);
    const gate = composureGateApplies(stats.composure ?? 50, { pressingPast: true });
    return {
      response,
      cause,
      pressure,
      tolerance: tol,
      band: band.max_pressure,
      outcome,
      composureDelta: responseComposureDelta(response, { gate }),
      gate,
    };
  }
}

export function buildConsequenceEngine(data: unknown): ConsequenceEngine {
  const d = data as { push_outcomes?: OutcomeBand[]; press_outcomes?: OutcomeBand[] } | null | undefined;
  return new ConsequenceEngine({ pressOutcomes: d?.press_outcomes ?? d?.push_outcomes ?? [] });
}
