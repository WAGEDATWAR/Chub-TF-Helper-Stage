/**
 * Time model. One `tick` is the simulation's atomic step — **one minute** (D-292):
 * the growth/onset machinery is sub-stepped per minute so a change reads as a smooth
 * slide rather than hourly jumps, and every authored duration is a count of minutes.
 * Hourly/weekly cadences (drift, ambient, town blocks, daily recovery) fire on a
 * tick-modulo gate so their *rates* are unchanged; only discrete durations convert.
 * Nothing should hardcode seconds or hours elsewhere.
 */
export const SECONDS_PER_TICK = 60;
export const TICK_MINUTES = 1;

export const MINUTES_PER_HOUR = 60;
export const TICKS_PER_HOUR = MINUTES_PER_HOUR;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;
export const TICKS_PER_WEEK = TICKS_PER_DAY * 7;

/** The engine day (1-based) for a tick. */
export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

/** The hour of the day (0..23) for a tick. */
export function hourOf(tick: number): number {
  return Math.floor((((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY) / TICKS_PER_HOUR);
}

/** Does this tick land on an hour boundary? (drift/ambient/observer cadence) */
export function isHourTick(tick: number): boolean {
  return tick % TICKS_PER_HOUR === 0;
}

/** Does this tick land on a day boundary? (daily recovery/regen) */
export function isDayTick(tick: number): boolean {
  return tick % TICKS_PER_DAY === 0;
}

/** Minutes for `n` hours — for converting an authored hour span to ticks. */
export function fromHours(n: number): number {
  return Math.round(n * TICKS_PER_HOUR);
}

/** Whole hours in `n` ticks (floored). */
export function toHours(n: number): number {
  return Math.floor(n / TICKS_PER_HOUR);
}

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
