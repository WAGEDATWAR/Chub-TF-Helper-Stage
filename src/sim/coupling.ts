/**
 * Fantasy coupling (H3). Turns the lunar clock, the subject's emotions, and a
 * hormone cycle into a **pressure** (0..1) that draws a coupled genome's change
 * near — and, past a threshold, forces the full shift. A werewolf by default is NOT
 * moon-only: the moon draws it, but fear/rage/desire and a hormonal cycle can force
 * it too — and `playstyle` lets the player choose which levers are live.
 *
 * Pure: reads state, writes only the coupling's own shift/revert flags and the
 * transient shift's growth. The base genome still grows normally underneath.
 */
import type { Lunar } from "./lunar";

export interface CouplingProfile {
  id: string;
  genome: string;
  kind: string;
  draw?: { dose_at_draw: number; dose_at_shift: number; pre_cues: string[] };
  ambient?: { night_recovery: number; sun_weariness: number; thrive_band: string };
  sources: Record<string, CouplingSource>;
  shift_at: number;
  revert_below: number;
  shift_ticks: number;
  playstyles: Record<string, Playstyle>;
}

export interface CouplingSource {
  weight: number;
  from: "lunar" | "mood" | "cycle" | "time" | "stress";
  curve?: string;
  emotions?: string[];
  threshold?: number;
  cycle_days?: number;
  arousal_floor?: number;
  /** For a `stress` source: how the named emotion builds it (threshold + weight). */
  emotions_stress?: string[];
}

export interface Playstyle {
  sources: string[];
  /** H10: once realized, the character may call the shift on purpose. */
  voluntary?: boolean;
  note: string;
}

/** Night/sun ambient block (H10): a vampire's thrive is nocturnal. */
export interface Ambient {
  night_recovery: number;
  sun_weariness: number;
  thrive_band: string;
}

export interface CouplingData {
  profiles: CouplingProfile[];
  defaultPlaystyle: string;
  settings: { checkEveryHours: number; emotionDecayPerCheck: number };
}

export function buildCouplingData(raw: unknown): CouplingData {
  const d = (raw ?? {}) as {
    profiles?: CouplingProfile[];
    default_playstyle?: string;
    settings?: { check_every_hours?: number; emotion_decay_per_check?: number };
  };
  return {
    profiles: d.profiles ?? [],
    defaultPlaystyle: d.default_playstyle ?? "full",
    settings: { checkEveryHours: d.settings?.check_every_hours ?? 6, emotionDecayPerCheck: d.settings?.emotion_decay_per_check ?? 1 },
  };
}

export interface PressureInput {
  tick: number;
  lunar: Lunar;
  /** Named emotion strengths (0..100), e.g. from subject.mood. */
  emotions: Record<string, number>;
  /** Days since the subject's own cycle reference + arousal floor, for hormonal. */
  cyclePhase: number;
  arousal: number;
  /** H10: true once the character has realized the change (enables `voluntary`). */
  realized?: boolean;
  /** H10: true when the player/character has chosen to shift now (this step). */
  willShift?: boolean;
}

export interface PressureReadout {
  pressure: number;
  /** Per-source contributions, for the pane/log. */
  breakdown: Array<{ source: string; value: number }>;
  /** The pre-shift cues that currently apply (moon drawing near). */
  cues: string[];
}

/** Pressure from one source, 0..weight. */
function sourcePressure(src: CouplingSource, input: PressureInput): number {
  switch (src.from) {
    case "lunar":
      return src.weight * input.lunar.intensity(input.tick);
    case "time": {
      // night = the dark hours (18:00–06:00)
      const hour = input.tick % 24;
      const night = hour >= 18 || hour < 6;
      return night ? src.weight : 0;
    }
    case "mood": {
      const threshold = src.threshold ?? 55;
      const peak = (src.emotions ?? []).reduce((m, e) => Math.max(m, input.emotions[e] ?? 0), 0);
      if (peak < threshold) return 0;
      return src.weight * Math.min(1, (peak - threshold) / (100 - threshold));
    }
    case "cycle": {
      // a smooth monthly bump, lifted by a high arousal floor
      const days = src.cycle_days ?? 26;
      const p = ((input.cyclePhase % days) + days) % days / days;
      const bump = Math.max(0, -Math.cos(p * Math.PI * 2) * 0.5 + 0.5);
      const floor = (src.arousal_floor ?? 0) / 100;
      return src.weight * Math.min(1, bump + Math.max(0, floor * (input.arousal / 100 - floor)));
    }
    case "stress": {
      // stress builds from the named emotions past a threshold, like mood, but
      // framed as strain (fear/anger dominate)
      const names = src.emotions_stress ?? src.emotions ?? ["fear", "anger"];
      const threshold = src.threshold ?? 45;
      const peak = names.reduce((m, e) => Math.max(m, input.emotions[e] ?? 0), 0);
      if (peak < threshold) return 0;
      return src.weight * Math.min(1, (peak - threshold) / (100 - threshold));
    }
    default:
      return 0;
  }
}

/** Compute the current pressure for a profile under a playstyle. */
export function readPressure(profile: CouplingProfile, playstyleId: string, input: PressureInput): PressureReadout {
  const style = profile.playstyles[playstyleId] ?? profile.playstyles[Object.keys(profile.playstyles)[0]!];
  const sources = style?.sources ?? Object.keys(profile.sources);
  const breakdown: Array<{ source: string; value: number }> = [];
  let pressure = 0;
  for (const id of sources) {
    const src = profile.sources[id];
    if (!src) continue;
    const value = sourcePressure(src, input);
    if (value > 0) breakdown.push({ source: id, value: Math.round(value * 100) / 100 });
    pressure += value;
  }
  // `voluntary` (H10): distinct from `emotional` — once realized, a deliberate
  // choice forces the shift on its own, no matter the ambient pressure.
  const voluntaryReady = style?.voluntary === true && input.realized === true;
  if (voluntaryReady && input.willShift) {
    pressure = Math.max(pressure, profile.shift_at + 0.01);
    breakdown.push({ source: "choice", value: Math.round(profile.shift_at * 100) / 100 });
  }
  breakdown.sort((a, b) => b.value - a.value);
  const cues = pressure > 0.2 && profile.draw ? profile.draw.pre_cues : [];
  return { pressure: Math.min(1, pressure), breakdown, cues };
}

/** Whether a character on this playstyle may deliberately call the shift (H10). */
export function canWillShift(profile: CouplingProfile, playstyleId: string, realized: boolean): boolean {
  const style = profile.playstyles[playstyleId];
  return style?.voluntary === true && realized === true;
}

/**
 * The ambient nudge for a profile at a given tick (H10): a night-dwelling profile
 * recovers in the dark and wearies in the day. Returns a signed wellbeing delta and
 * the current "thriving" state, or null when the profile has no ambient block.
 */
export function ambientAt(profile: CouplingProfile, tick: number): { delta: number; thriving: boolean } | null {
  if (!profile.ambient) return null;
  const hour = ((tick % 24) + 24) % 24;
  const night = hour >= 20 || hour < 6;
  const thriving = profile.ambient.thrive_band === "night" ? night : !night;
  const delta = night ? profile.ambient.night_recovery : -profile.ambient.sun_weariness;
  return { delta, thriving };
}

export interface CouplingState {
  shifted: boolean;
  shiftedAtTick: number;
  lastPressure: number;
  /** H10: whether the ambient currently favors this profile (e.g. night for a vampire). */
  thriving?: boolean;
}

export function createCouplingState(): CouplingState {
  return { shifted: false, shiftedAtTick: 0, lastPressure: 0 };
}

/** The music: past shift_at → shift; below revert_below → revert. Never both. */
export function stepCoupling(profile: CouplingProfile, state: CouplingState, pressure: number, tick: number): "shift" | "revert" | "hold" {
  state.lastPressure = pressure;
  if (!state.shifted && pressure >= profile.shift_at) {
    state.shifted = true;
    state.shiftedAtTick = tick;
    return "shift";
  }
  if (state.shifted && pressure < profile.revert_below) {
    state.shifted = false;
    return "revert";
  }
  return "hold";
}
