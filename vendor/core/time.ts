/**
 * Time model. One `tick` is the simulation's atomic step; every timing value
 * (growth speed, incubation, recovery) is expressed in ticks or derives from
 * this constant. **Tick length is provisional** (D-091) — tuning may change it,
 * so nothing should hardcode seconds or hours elsewhere.
 */
export const SECONDS_PER_TICK = 3600;
export const TICK_MINUTES = SECONDS_PER_TICK / 60;

export const TICKS_PER_HOUR = 1;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;
export const TICKS_PER_WEEK = TICKS_PER_DAY * 7;

/** Target span for a default (dose 1.0) transformation, at default curve. */
export const DEFAULT_TRANSFORMATION_DAYS = 7;

/** Mean of the default `slow_start` shaping (∫x^2.2 over 0..1 = 1/3.2). */
const DEFAULT_CURVE_MEAN = 1 / 3.2;

/** Ticks for a dose-1 attribute to fill 0 -> full at the default pace. */
export const DEFAULT_ATTRIBUTE_TICKS = TICKS_PER_DAY * DEFAULT_TRANSFORMATION_DAYS;

/**
 * Default growth speed so a dose-1.0 attribute fills its full range in
 * `DEFAULT_ATTRIBUTE_TICKS` (D-202: ~7 days, slow onset to plateau), derived
 * from the default curve's mean.
 */
export const DEFAULT_SPEED_BASE = 1 / (DEFAULT_ATTRIBUTE_TICKS * DEFAULT_CURVE_MEAN);

/** Convert seconds to whole ticks (ceil), never negative. */
export function secondsToTicks(seconds: number | undefined | null, secondsPerTick = SECONDS_PER_TICK): number {
  if (seconds === undefined || seconds === null) return 0;
  if (secondsPerTick <= 0) throw new Error("secondsPerTick must be positive");
  return Math.max(0, Math.ceil(seconds / secondsPerTick));
}
