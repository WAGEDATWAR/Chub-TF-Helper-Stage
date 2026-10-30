/**
 * Time-unit re-exports (D-292): the parent's sim tick is now **one minute** (was one
 * hour), so `advance(n)` advances n minutes. Every helper site that reasoned in hours
 * or days goes through these constants instead of a hardcoded 24, so a future unit
 * change is a one-line edit here — never scattered `* 24`.
 */
export { TICKS_PER_HOUR, TICKS_PER_DAY, TICKS_PER_WEEK, MINUTES_PER_HOUR, hourOf, dayOf } from "@core/time";

import { TICKS_PER_DAY, TICKS_PER_HOUR } from "@core/time";

/** Ticks (minutes) in `days` days. */
export function days(days: number): number {
  return Math.round(days * TICKS_PER_DAY);
}
/** Ticks (minutes) in `hours` hours. */
export function hours(hours: number): number {
  return Math.round(hours * TICKS_PER_HOUR);
}
/** Whole days in `ticks` (floored). */
export function toDays(ticks: number): number {
  return Math.floor(ticks / TICKS_PER_DAY);
}
