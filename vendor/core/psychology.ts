import { clampStat } from "./stats";

export const DRIVE_START = 55;
export const DRIVE_DECAY_PER_DAY = 6;
export const DRIVE_DAMAGE_PENALTY = 25;
export const DRIVE_BLACKOUT_PENALTY = 35;
export const DRIVE_ABILITY_BONUS = 12;
export const DRIVE_FERAL_RECOVERY_BONUS = 20;
export const DRIVE_ASK_THRESHOLD = 70;

export interface PsychologyState {
  drive: number;
  overload: number;
  composure: number;
  resonance: number;
  stability: number;
  familiarity: Record<string, number>;
  intelligenceDebt: number;
  daysKnown: number;
}

export function createPsychologyState(): PsychologyState {
  return {
    drive: DRIVE_START,
    overload: 0,
    composure: 50,
    resonance: 50,
    stability: 100,
    familiarity: {},
    intelligenceDebt: 0,
    daysKnown: 1,
  };
}

export function driveArousalFactor(drive: number): number {
  return 1 + clampStat(drive) / 100;
}

export function driveToleranceBonus(drive: number): number {
  return 0.2 * clampStat(drive);
}

export function driveAsksForMore(drive: number): boolean {
  return drive > DRIVE_ASK_THRESHOLD;
}

export function decayDrive(drive: number, { damage = false, blackout = false } = {}): number {
  let next = drive - DRIVE_DECAY_PER_DAY;
  if (damage) next -= DRIVE_DAMAGE_PENALTY;
  if (blackout) next -= DRIVE_BLACKOUT_PENALTY;
  return clampStat(next);
}

export function gainDrive(drive: number, amount: number): number {
  return clampStat(drive + amount);
}

export function overloadGain(entries: Array<{ stabilityCost?: number; dose?: number; novelty?: number }>): number {
  return entries.reduce((sum, e) => sum + (e.stabilityCost ?? 0) * (e.dose ?? 1) * (e.novelty ?? 1), 0);
}

export function resistanceCeiling({ drive = 0, composure = 0, exposure = 0 } = {}): number {
  return 60 + 0.35 * drive + 0.15 * composure - 0.2 * exposure;
}

export function decayOverload(overload: number, { rested = false } = {}): number {
  const rate = rested ? 20 : 10;
  return clampStat(overload - rate);
}

export function familiarityMultipliers(exposures: number): { painMult: number; noveltyMult: number } {
  const n = Math.max(0, exposures);
  return {
    painMult: Math.max(0.4, 1 - 0.15 * n),
    noveltyMult: Math.max(0.15, 1 - 0.12 * n),
  };
}

export function recordExposure(familiarity: Record<string, number>, family: string): Record<string, number> {
  const next = { ...familiarity };
  next[family] = (next[family] ?? 0) + 1;
  return next;
}

/** The composure gate (§24.2) lives in `consequence.composureGateApplies`; this
 *  is the thin §24 reading used by non-consequence callers. */
export function composureGate(composure: number, gate = 30): boolean {
  return composure < gate;
}

export function resonanceForgives(resonance: number, threshold = 70): boolean {
  return resonance > threshold;
}

export function stabilityDrain(stabilityCost: number, dose: number): number {
  return stabilityCost * Math.pow(dose, 1.3);
}

export function stabilityRegen(stability: number, { rested = false } = {}): number {
  return clampStat(stability + (rested ? 15 : 8));
}

export function stabilityBand(stability: number): string {
  if (stability >= 60) return "stable";
  if (stability >= 30) return "unstable";
  if (stability >= 10) return "volatile";
  return "collapse";
}

export function driftChance(stability: number): number {
  const band = stabilityBand(stability);
  if (band === "stable") return 0.05;
  if (band === "unstable") return 0.15;
  if (band === "volatile") return 0.35;
  if (band === "collapse") return 1.0;
  return 0;
}

export function lockDebtGain({ peakExposure = 100, daysLocked = 1, debtMult = 1 } = {}): number {
  return (4 + 0.5 * (peakExposure - 100) + 2 * daysLocked) * debtMult;
}

export function lockDebtTexture(debt: number): { slurredSpeech: boolean; greyedOptions: boolean; holdLockout: boolean } {
  return { slurredSpeech: debt > 10, greyedOptions: debt > 20, holdLockout: debt > 30 };
}

export function lockDebtRecovery(debt: number, { trainingDays = 0, booster = false, days = 0 } = {}): number {
  let next = debt - 1.5 * trainingDays - 0.2 * days;
  if (booster) next -= 8;
  return Math.max(0, next);
}

export interface PsychEvent {
  type: string;
  amount?: number;
  overloadGain?: number;
  [k: string]: unknown;
}

export function onEvent(state: PsychologyState, event: PsychEvent): PsychologyState {
  if (!state || !event || typeof event.type !== "string") {
    throw new Error("psychology: state and a typed event are required");
  }
  switch (event.type) {
    case "attribute.applied":
      state.drive = gainDrive(state.drive, 2);
      break;
    case "stage.crossed":
      state.drive = gainDrive(state.drive, 3);
      break;
    case "ability.granted":
      state.drive = gainDrive(state.drive, DRIVE_ABILITY_BONUS);
      break;
    case "power.resolved":
      state.overload = clampStat(state.overload + (event.overloadGain ?? 0));
      break;
    case "reaction.awakened":
      state.drive = gainDrive(state.drive, 4);
      break;
    case "blackout":
      state.drive = decayDrive(state.drive, { blackout: true });
      state.composure = clampStat(state.composure - 5);
      break;
    case "damage":
      state.drive = decayDrive(state.drive, { damage: true });
      break;
    case "feral.recovered":
      state.drive = gainDrive(state.drive, DRIVE_FERAL_RECOVERY_BONUS);
      break;
    default:
      break;
  }
  return state;
}
