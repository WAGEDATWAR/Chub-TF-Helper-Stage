/**
 * Non-content accessibility settings (blueprint §13, S19). These live in a
 * settings block that survives profiles; the core only *stores* them — the UI
 * reads them. Content toggles stay out of v1.
 */
export interface AccessibilitySettings {
  locale: string;
  textScale: number;
  reduceMotion: boolean;
  colourBlindBands: boolean;
  touchBoost: boolean;
  dyslexiaFont: boolean;
  /** Height unit for display (M14.11, D-200): metric or imperial. */
  heightUnit: "metric" | "imperial";
  /** Narration mode (M15): off, fill only holes, or prefer generated prose. */
  llmMode: "off" | "fill_holes" | "priority";
}

export const DEFAULT_SETTINGS: AccessibilitySettings = Object.freeze({
  locale: "en",
  textScale: 100,
  reduceMotion: false,
  colourBlindBands: false,
  touchBoost: false,
  dyslexiaFont: false,
  heightUnit: "metric",
  llmMode: "fill_holes",
});

export const TEXT_SCALE_MIN = 80;
export const TEXT_SCALE_MAX = 200;

export function normaliseSettings(input: Partial<AccessibilitySettings> = {}): AccessibilitySettings {
  const mode = input.llmMode;
  return {
    locale: typeof input.locale === "string" && input.locale.length > 0 ? input.locale : DEFAULT_SETTINGS.locale,
    textScale: Math.max(TEXT_SCALE_MIN, Math.min(TEXT_SCALE_MAX, Math.round(input.textScale ?? DEFAULT_SETTINGS.textScale))),
    reduceMotion: input.reduceMotion === true,
    colourBlindBands: input.colourBlindBands === true,
    touchBoost: input.touchBoost === true,
    dyslexiaFont: input.dyslexiaFont === true,
    heightUnit: input.heightUnit === "imperial" ? "imperial" : "metric",
    llmMode: mode === "off" || mode === "priority" ? mode : "fill_holes",
  };
}
