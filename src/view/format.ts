/**
 * Pure view formatters (H5). Turn a snapshot field into a plain string/row so the
 * pane renders it and a headless test can lock a digest. No derivation of state.
 */
import type { CastFrame } from "../sim/cast";

export interface BandRead {
  /** 0..100 exposure, for the drawn bar. */
  pct: number;
  /** "baseline", "cosmetic", … */
  state: string;
  /** A one-glance phrase. */
  phrase: string;
  /** A coarse colour token the pane maps to a hue. */
  tone: "calm" | "warm" | "hot" | "wild";
}

const BAND_PHRASE: Record<string, string> = {
  "band.baseline": "unchanged",
  "band.cosmetic": "a first shimmer",
  "band.light_hybrid": "visibly between",
  "band.heavy_hybrid": "more animal than not",
  "band.near_animal": "nearly beast",
  "band.feral_lock": "consumed",
};

const BAND_TONE: Record<string, BandRead["tone"]> = {
  "band.baseline": "calm",
  "band.cosmetic": "calm",
  "band.light_hybrid": "warm",
  "band.heavy_hybrid": "hot",
  "band.near_animal": "wild",
  "band.feral_lock": "wild",
};

export function bandRead(frame: CastFrame): BandRead {
  return {
    pct: Math.max(0, Math.min(100, frame.exposure)),
    state: frame.band.replace(/^band\./, "").replace(/_/g, " "),
    phrase: BAND_PHRASE[frame.band] ?? "changing",
    tone: BAND_TONE[frame.band] ?? "warm",
  };
}

/** A character's headline line, one string. */
export function frameHeadline(frame: CastFrame): string {
  const b = bandRead(frame);
  return `${frame.name} — exposure ${frame.exposure}% · ${b.state} · ${b.phrase}`;
}

export function speciesLabel(genome: string | null): string {
  return genome ? genome.replace(/^genome\./, "").replace(/_/g, " ") : "human";
}

export function moonRead(moon: { phase: string; intensity: number; daysToFull: number }): string {
  if (moon.intensity < 0.05) return "new moon";
  const pct = Math.round(moon.intensity * 100);
  if (moon.intensity > 0.9) return `full moon (${pct}%)`;
  return `${moon.phase} — ${pct}% bright, full in ${moon.daysToFull}d`;
}

/** A coarse confidence band for a proposal/marker (H9). */
export function confidenceBand(confidence: number): "sure" | "likely" | "maybe" {
  if (confidence >= 0.65) return "sure";
  if (confidence >= 0.45) return "likely";
  return "maybe";
}

/** A short human reason for a proposal, from its source + token (H9). */
export function proposalReason(source: string, token: string): string {
  const t = token.replace(/^~/, "").replace(/^#/, "");
  if (token.startsWith("~")) return `implied by “${t}”`;
  if (token.startsWith("#")) return `anatomy ${t.replace(/\+/g, " + ")}`;
  return source === "card" ? `card says “${t}”` : `said “${t}”`;
}

/** A compact, order-stable digest of the pane's reads (golden test). */
export function digest(frames: CastFrame[], moon: { phase: string; intensity: number; daysToFull: number }, coupling: Array<{ characterId: string; shifted: boolean; pressure: number }>): string {
  const parts = [`moon: ${moonRead(moon)}`];
  for (const f of frames) {
    const c = coupling.find((x) => x.characterId === f.id);
    parts.push(frameHeadline(f) + (c ? ` · pressure ${Math.round(c.pressure * 100)}%${c.shifted ? " SHIFTED" : ""}` : ""));
    if (f.changing.length > 0) parts.push(`  changing: ${f.changing.join(", ")}`);
    if (f.parts.length > 0) parts.push(`  parts: ${f.parts.map((p) => `${p.label}${p.count > 1 ? ` ×${p.count}` : ""} (${p.pct}%)`).join(", ")}`);
  }
  return parts.join("\n");
}
