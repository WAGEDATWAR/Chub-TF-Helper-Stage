/**
 * Part-owned appearance (D-212). Colour, size and length live on the **part**,
 * not a global subject value, so the sim can track and modify them and the
 * surface can present the part as it is. This module owns the *naming*: a
 * joinable adjective (a colour) prefixes the noun ("green eyes"); an appended
 * measure (a size/length) trails in parentheses ("black hair (5 in.)").
 *
 * Authoring lives on the part template (`appearance`), and the values live on the
 * instance, so nothing is invented at render time.
 */
export const APPEARANCE_VERSION = 1;

export type AppearanceKind = "colour" | "size" | "length" | "fullness";

export interface AppearanceSlot {
  kind: AppearanceKind;
  /** Allowed values (a colour can be literally any string; sizes are enumerated). */
  values?: string[];
  /** A unit appended for a `size`/`length` value (e.g. "in.", "cc", "cm"). */
  unit?: string;
  /** A default value. */
  default?: string;
  /** For `fullness`: ascending bands a 0..100 tracked value maps to. */
  bands?: Array<{ min: number; label: string }>;
}

/** A part instance's live appearance values, keyed by slot name (e.g. "colour"). */
export type Appearance = Record<string, string>;

/** Which appearance slots a part accepts (from its template). */
export type AppearanceSchema = Record<string, AppearanceSlot>;

/**
 * Join an adjective form of `value` to a `noun` ("green" + "eyes" -> "green eyes").
 * A colour is joinable; a value that is already a phrase is used as-is.
 */
export function joinAdjective(value: string, noun: string): string {
  if (!value) return noun;
  // a value that already ends in a word like "coloured" / "toned" is used as-is
  return `${value} ${noun}`.replace(/\s+/g, " ").trim();
}

/**
 * Append a measured parenthetical to a `noun` ("hair" + "5" + "in." -> "hair (5 in.)").
 * Rule (D-212): parentheses are for appended sizes/lengths, never for joinable
 * adjectives.
 */
export function appendMeasure(noun: string, value: string, unit?: string): string {
  if (!value) return noun;
  const measure = unit && !value.includes(unit) ? `${value} ${unit}` : value;
  return `${noun} (${measure})`;
}

/**
 * The display name of a part: the base noun with joinable adjectives (colours)
 * prefixed and measured values (size/length) appended, in a stable order.
 */
export function formatPartName(base: string, schema: AppearanceSchema, values: Appearance): string {
  let name = base;
  // joinable values (colours, a fullness descriptor) prefix the noun, in schema order
  for (const [slot, def] of Object.entries(schema)) {
    if (def.kind !== "colour" && def.kind !== "fullness") continue;
    const value = values[slot];
    if (value) name = joinAdjective(value, name);
  }
  // sizes/lengths append in parentheses, in schema order
  let out = name;
  for (const [slot, def] of Object.entries(schema)) {
    if (def.kind === "colour" || def.kind === "fullness") continue;
    const value = values[slot];
    if (!value) continue;
    const measure = def.unit && !value.includes(def.unit) ? `${value} ${def.unit}` : value;
    out = `${out} (${measure})`;
  }
  return out;
}

