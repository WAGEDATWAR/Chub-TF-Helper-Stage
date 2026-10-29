/**
 * H8 Visualize. A deterministic image **prompt** built from the same facts the
 * prose comes from: the character's species, band, exposure, most-progressed
 * changed parts, the moon/light, and any scene props. The image is never
 * authoritative — the composed text is; the picture is a rendering of the sim.
 *
 * Pure: no network, no DOM. The network call (`generator.makeImage`) lives in
 * `Stage.tsx`; this module only builds a stable prompt, negative prompt, and a
 * cache key so a rerequest of an unchanged frame is cheap.
 */
import type { CastFrame } from "../sim/cast";

export interface VisualBundle {
  prompt: string;
  negative: string;
  /** Stable for a given frame state; changes only when the body meaningfully does. */
  key: string;
}

/** A tasteful, consistent house style. Kept as data so it is one place to edit. */
export const VISUAL_STYLE =
  "soft digital painting, muted warm palette, natural light, full-body portrait, standing, observational, no text";

export const VISUAL_NEGATIVE =
  "text, watermark, multiple people, extra limbs, deformed hands, harsh saturation, frame";

/** Per-band framing words so the picture reads at a glance. */
const BAND_PHRASE: Record<string, string> = {
  "band.baseline": "an ordinary human",
  "band.cosmetic": "a human with the first faint animal touches",
  "band.light_hybrid": "a person visibly caught between human and animal",
  "band.heavy_hybrid": "a person more animal than human now",
  "band.near_animal": "an almost fully animalistic beast-person",
  "band.feral_lock": "a feral creature that was once human",
};

const TONE_PHRASE: Record<string, string> = {
  calm: "calm and at ease",
  warm: "warm and unsettled",
  hot: "flushed and tense",
  wild: "wild-eyed and bristling",
};

/** Humanise a `slot: attr` change line into a part phrase, dropping the slot prefix. */
function partPhrase(changing: string): string {
  const afterColon = changing.includes(":") ? changing.slice(changing.indexOf(":") + 1) : changing;
  return afterColon.trim().replace(/\.[LR]$/, "").replace(/_/g, " ");
}

/** The most-progressed changed parts as short phrases, most first, deduped. */
export function salientParts(frame: CastFrame, limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of frame.changing) {
    const p = partPhrase(c);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build the visualize bundle for one frame. Deterministic: identical frame state →
 * identical prompt. `style` overrides the house style; `seed` is folded into the key.
 */
export function visualBundle(
  frame: CastFrame,
  moon: { phase: string; intensity: number },
  scene?: { ambient?: string; objects?: string[] },
  opts?: { style?: string; seed?: number },
): VisualBundle {
  const species = frame.genome ? frame.genome.replace(/^genome\./, "").replace(/_/g, " ") : "human";
  const band = BAND_PHRASE[frame.band] ?? "a person mid-change";
  const tone = TONE_PHRASE[toneFor(frame.exposure)] ?? "at ease";
  const parts = salientParts(frame);
  const who = `${band}, a ${species} strain, ${tone}`;
  const changed = parts.length > 0 ? `, with ${parts.join(", ")}` : "";
  const ambient = scene?.ambient ? `, ${scene.ambient}` : "";
  const objects = scene?.objects && scene.objects.length > 0 ? `, near ${scene.objects.slice(0, 3).join(", ")}` : "";
  const moonLight = moon.intensity > 0.5 ? `, ${moon.phase} moonlight` : "";
  const prompt = `${frame.name}, ${who}${changed}${objects}${ambient}${moonLight}. Day ${frame.day}. ${opts?.style ?? VISUAL_STYLE}`;
  const key = `chrysalis:v1:${frame.id}:d${frame.day}:${frame.band}:${frame.exposure}:${parts.join("|")}:${opts?.seed ?? 0}`;
  return { prompt, negative: VISUAL_NEGATIVE, key };
}

function toneFor(exposure: number): string {
  if (exposure < 15) return "calm";
  if (exposure < 45) return "warm";
  if (exposure < 75) return "hot";
  return "wild";
}

/** A stable cache key for a frame at a given seed (mirrors `visualBundle().key`). */
export function visualKey(frame: CastFrame, seed = 0): string {
  return visualBundle(frame, { phase: "", intensity: 0 }, undefined, { seed }).key;
}
