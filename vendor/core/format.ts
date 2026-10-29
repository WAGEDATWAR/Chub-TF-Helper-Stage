/**
 * Presentation formatting helpers (M14.11, D-200). These convert a canonical
 * value into a display string; the UI never derives (blueprint §54), so any
 * cross-cutting formatting lives here where it can be tested headless.
 */

/** Height in cm -> a metric or imperial display string (ft′in″). */
export function formatHeight(cm: number | null | undefined, unit: "metric" | "imperial"): string {
  if (cm === null || cm === undefined || Number.isNaN(cm)) return "—";
  if (unit === "imperial") {
    const totalIn = cm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn - ft * 12);
    // 5 ft 12 in -> 6 ft 0 in
    return inch === 12 ? `${ft + 1}′0″` : `${ft}′${inch}″`;
  }
  return `${Math.round(cm)} cm`;
}

/** A 0..100 value as a signed modifier string, at most 2 decimals ("+3", "−2.5", "0"). */
export function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

/** A value shown to at most 2 decimals, for normalized display (M16.5c). */
export function formatValue(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
