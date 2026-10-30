/**
 * The lunar clock (H3). A deterministic moon phase + intensity derived purely from
 * the shared world tick — no wall clock, no rng. The cycle length is configurable so
 * a world can be fast or slow, and everything downstream reads `phase()`/`intensity()`.
 *
 * Phase is 0 at new moon, 0.5 at full moon, wrapping at 1. Intensity peaks at full
 * and is 0 at new, so "as the moon draws near" is `intensity` rising.
 */
export const DEFAULT_LUNAR_CYCLE_DAYS = 28;

import { TICKS_PER_DAY } from "@core/time";

export interface LunarConfig {
  cycleDays: number;
  /** Days either side of full that count as "full enough" to shift at peak. */
  peakWindowDays: number;
}

export const DEFAULT_LUNAR: LunarConfig = Object.freeze({ cycleDays: DEFAULT_LUNAR_CYCLE_DAYS, peakWindowDays: 1.25 });

export class Lunar {
  readonly config: LunarConfig;
  /**
   * A tick offset added to every read (H22). Lets the moon be *set* to a phase
   * without moving the shared day clock — "reset the moon to new" adds the delta
   * between the current phase and new. The same offset is applied to every Lunar
   * (game, triggers, each sim) so all phase gates stay in lockstep.
   */
  offsetTicks = 0;

  constructor(config: Partial<LunarConfig> = {}) {
    const cycleDays = config.cycleDays && config.cycleDays >= 4 ? config.cycleDays : DEFAULT_LUNAR.cycleDays;
    this.config = { cycleDays, peakWindowDays: config.peakWindowDays ?? DEFAULT_LUNAR.peakWindowDays };
  }

  /** Moon phase 0..1 (0 new, 0.5 full), from a tick. */
  phase(tick: number): number {
    const day = (tick + this.offsetTicks) / TICKS_PER_DAY;
    const p = (day / this.config.cycleDays) % 1;
    return p < 0 ? p + 1 : p;
  }

  /** Intensity 0..1, peaking at full moon (phase 0.5) and 0 at new. */
  intensity(tick: number): number {
    // a smooth cosine: 0 at new (phase 0), 1 at full (phase 0.5)
    const p = this.phase(tick);
    return Math.max(0, -Math.cos(p * Math.PI * 2) * 0.5 + 0.5);
  }

  /** True within the peak window either side of full. */
  atPeak(tick: number): boolean {
    const d = Math.abs(this.phase(tick) - 0.5) * this.config.cycleDays;
    return d <= this.config.peakWindowDays;
  }

  /** Whole days until the next full moon (0 = full today). */
  daysToFull(tick: number): number {
    const d = (0.5 - this.phase(tick) + 1) % 1;
    return d * this.config.cycleDays;
  }

  phaseName(tick: number): string {
    const p = this.phase(tick);
    if (p < 0.03 || p > 0.97) return "new";
    if (p < 0.22) return "waxing crescent";
    if (p < 0.28) return "first quarter";
    if (p < 0.47) return "waxing gibbous";
    if (p <= 0.53) return "full";
    if (p < 0.72) return "waning gibbous";
    if (p < 0.78) return "last quarter";
    return "waning crescent";
  }
}

export function createLunar(config?: Partial<LunarConfig>): Lunar {
  return new Lunar(config);
}

/** The tick offset that puts the moon at `targetPhase` (0..1) at `tick`. */
export function offsetForPhase(targetPhase: number, tick: number, cycleDays: number): number {
  const want = ((targetPhase % 1) + 1) % 1;
  // phase(tick) = (((tick+off)/TICKS_PER_DAY)/cycle)%1 = want
  const cycleTicks = cycleDays * TICKS_PER_DAY;
  const off = want * cycleTicks - tick;
  return ((off % cycleTicks) + cycleTicks) % cycleTicks;
}
