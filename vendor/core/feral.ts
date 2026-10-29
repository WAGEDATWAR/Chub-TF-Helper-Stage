import { clampStat } from "./stats";
import { feralRamp } from "./exposure";
import { lockDebtGain, lockDebtRecovery, lockDebtTexture, DRIVE_FERAL_RECOVERY_BONUS } from "./psychology";
import type { FeralRegistry } from "./registries";
import type { Subject } from "./subject";

/**
 * Feral lock and lock debt (blueprint §19.2, §27). Feral is the terminal state:
 * reachable only with overshoot active, it still allows `unmake`, and it leaves
 * **Intelligence debt** — a receding hangover, never a permanent loss, never
 * reverted with the body. Debt recovers by training, a booster, and slow time.
 */
export const FERAL_VERSION = 1;

/** Fenagle: the feral lock state lives on the subject, saved. */
export interface FeralState {
  locked: boolean;
  lockedAtDay: number;
  peakExposure: number;
  profile: string | null;
}

export function createFeralState(): FeralState {
  return { locked: false, lockedAtDay: 0, peakExposure: 0, profile: null };
}

export interface FeralCheck {
  feral: boolean;
  reason: string;
  profile: string | null;
}

/**
 * Evaluate the feral ramp for a subject. True only when overshoot is active and
 * exposure is at the lock. Returns the genome's feral profile for the debt mult.
 */
export function checkFeral(subject: Subject, overshootActive: boolean): FeralCheck {
  const exposure = subject.derived.exposure ?? 0;
  const ramp = feralRamp(exposure, overshootActive);
  return { ...ramp, profile: subject.feralGenome?.feral_profile ?? null };
}

/** Lock her feral. Rolls debt scaled by the profile's debt_mult. */
export function lockFeral(subject: Subject, profileId: string | null, feralRegistry: FeralRegistry | null, day: number): { debt: number; profile: string | null } {
  const profile = profileId ? feralRegistry?.get(profileId) ?? null : null;
  const mult = (profile?.debt_mult as number | undefined) ?? 1;
  const peakExposure = Math.max(100, subject.derived.exposure ?? 100);
  const daysLocked = 1;
  const debt = lockDebtGain({ peakExposure, daysLocked, debtMult: mult });
  subject.stats.intelligence_debt = clampStat((subject.stats.intelligence_debt ?? 0) + debt);
  subject.feral = { locked: true, lockedAtDay: day, peakExposure, profile: profileId };
  return { debt, profile: profileId };
}

/** Recover from feral: debt persists, and she comes back more eager (drive bonus). */
export function recoverFeral(subject: Subject): { driveBonus: number } {
  if (!subject.feral?.locked) return { driveBonus: 0 };
  subject.feral = { ...subject.feral, locked: false };
  subject.stats.drive = clampStat((subject.stats.drive ?? 0) + DRIVE_FERAL_RECOVERY_BONUS);
  return { driveBonus: DRIVE_FERAL_RECOVERY_BONUS };
}

/** Does debt block a `hold` power (§27: above 30 she cannot hold)? */
export function debtBlocksHold(subject: Subject): boolean {
  return (subject.stats.intelligence_debt ?? 0) > 30;
}

/** The texture of current debt (§27). */
export function debtTexture(subject: Subject): { slurredSpeech: boolean; greyedOptions: boolean; holdLockout: boolean; debt: number } {
  const debt = subject.stats.intelligence_debt ?? 0;
  return { ...lockDebtTexture(debt), debt };
}

export interface DebtRecoveryContext {
  trainedToday?: boolean;
  booster?: boolean;
  days?: number;
}

/** Daily debt recovery: training ~1.5, booster +8 instant, time 0.2/day (§27). */
export function recoverDebt(subject: Subject, ctx: DebtRecoveryContext): number {
  const next = lockDebtRecovery(subject.stats.intelligence_debt ?? 0, {
    trainingDays: ctx.trainedToday ? 1 : 0,
    booster: ctx.booster ?? false,
    days: ctx.days ?? 1,
  });
  subject.stats.intelligence_debt = clampStat(next);
  return subject.stats.intelligence_debt;
}

/** Recovery always leaves her more eager than before (§27 criterion). */
export function recoveryDriveBonus(debtCleared: number): number {
  return Math.round(Math.min(12, debtCleared / 2));
}

/**
 * Advance feral/debt one day. Clears a lock once exposure drops (via unmake) and
 * applies debt recovery whether locked or not; a cleared lock grants the eager
 * drive bonus.
 */
export function tickFeralDay(subject: Subject, { trainedToday = false, days = 1 } = {}): { clearedLock: boolean } {
  let cleared = false;
  const exposure = subject.derived.exposure ?? 0;
  if (subject.feral?.locked && exposure < 100) {
    recoverFeral(subject);
    cleared = true;
  }
  const before = subject.stats.intelligence_debt ?? 0;
  recoverDebt(subject, { trainedToday, days });
  if (cleared) {
    subject.stats.drive = clampStat((subject.stats.drive ?? 0) + recoveryDriveBonus(before));
  }
  return { clearedLock: cleared };
}

export function buildFeralProfileId(genomeId: string): string {
  return `feral.${genomeId.replace(/^genome\./, "")}`;
}
