/**
 * Narration honesty (blueprint §32, §38.4; D-136). The narrator is a view: it may
 * not invent state, may not state a cause the subject could not have perceived,
 * and must show slow change at three decimals so a small move is not rounded
 * into a lie. These helpers are the shared rule for every surface.
 */

export const SLOW_DECIMALS = 3;

/** Format a slow-moving value so a small change survives rounding. */
export function slow(value: number): string {
  return value.toFixed(SLOW_DECIMALS);
}

/** A cause is perceivable when the subject noticed it or felt it herself. */
export const PERCEIVABLE_CAUSES = Object.freeze(["felt", "seen", "told", "power", "ambient"]);

export function perceivable(cause: string): boolean {
  return (PERCEIVABLE_CAUSES as readonly string[]).includes(cause);
}

/** Round a value for display without implying more precision than it has. */
export function displayValue(value: number): string {
  return Math.abs(value) < 1 ? slow(value) : String(Math.round(value * 100) / 100);
}
