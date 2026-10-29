/**
 * Lunar clock (D-248). A deterministic world signal a phase `when` gate can read
 * (`{ moon_min: 0.8 }`, `{ moon_phase: "full" }`). Purely a function of the day, so
 * it needs no state and stays reproducible across a save/reload. One cycle is a
 * synodic month; `value` is 0 at new and 1 at full.
 */
export const LUNAR_CYCLE_DAYS = 29.53;

const PHASES = [
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
] as const;

export interface MoonState {
  /** Illumination 0..1 (0 new, 1 full). */
  value: number;
  /** The named phase. */
  phase: string;
}

/** The moon at a given (fractional or whole) day. Deterministic, stateless. */
export function moonState(day: number): MoonState {
  const cycle = ((day % LUNAR_CYCLE_DAYS) + LUNAR_CYCLE_DAYS) % LUNAR_CYCLE_DAYS;
  const frac = cycle / LUNAR_CYCLE_DAYS;
  const value = 0.5 - 0.5 * Math.cos(2 * Math.PI * frac);
  const index = Math.round(frac * PHASES.length) % PHASES.length;
  return { value, phase: PHASES[index]! };
}
