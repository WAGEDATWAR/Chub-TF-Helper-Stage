import type { Session } from "./session";
import type { DialogueRegistry } from "./dialogue";
import { axesFor } from "./voice";
import type { Rng } from "./rng";

/**
 * Inner life (blueprint §33/§36; D-198; Wave 3). The subject is not silent: from
 * her mind, mood and body she has **thoughts** (unspoken) and **spoken reactions**
 * the Observer overhears. These are authored dialogue keys selected by the same
 * axis machinery as `voice`, so the reaction fits her live state.
 *
 * A reaction fires on a *trigger* (a stage crossing, a power landing, a strong
 * mood shift) rather than every tick, so the log breathes rather than chatters.
 */
export const INNER_VERSION = 1;

export type ReactionChannel = "thought" | "speech";

export interface ReactionPick {
  key: string;
  channel: ReactionChannel;
  text: string;
}

/** Map a trigger to the dialogue key family it selects from. */
const TRIGGER_KEYS: Record<string, { thought: string; speech: string }> = {
  "stage.crossed": { thought: "react.thought.change", speech: "react.say.change" },
  "power.applied": { thought: "react.thought.dose", speech: "react.say.dose" },
  "realization": { thought: "react.thought.realize", speech: "react.say.realize" },
  "sex.overload": { thought: "react.thought.urge", speech: "react.say.urge" },
  "preference.changed": { thought: "react.thought.preference", speech: "react.say.preference" },
  "resistance.raised": { thought: "react.thought.resist", speech: "react.say.resist" },
  "mood.shift": { thought: "react.thought.mood", speech: "react.say.mood" },
  "ability.granted": { thought: "react.thought.ability", speech: "react.say.ability" },
  "inspect": { thought: "react.thought.inspect", speech: "react.say.inspect" },
};

export function triggerKeys(trigger: string): { thought: string; speech: string } | null {
  return TRIGGER_KEYS[trigger] ?? null;
}

/**
 * Pick a thought or a spoken reaction for a trigger, if her state warrants one.
 * Deterministic; returns null when she would stay quiet (a chance by trigger).
 */
export function reactTo(session: Session, registry: DialogueRegistry, trigger: string, rng: Rng): ReactionPick | null {
  const keys = triggerKeys(trigger);
  if (!keys) return null;
  const mind = session.subject.mind;

  // how likely she reacts: a lucid, emotional, invested subject is more vocal
  const arousal = (session.subject.stats.arousal ?? 0) / 100;
  const invested = session.subject.preferences.all().length > 0 ? 0.2 : 0;
  const lucid = mind ? mind.awareness / 220 : 0;
  const chance = Math.min(0.85, 0.2 + arousal * 0.3 + invested + lucid);
  if (rng.next("dialogue") >= chance) return null;

  // channel: high arousal/mood leans to speech, else thought
  const valence = session.subject.mood?.point().valence ?? 50;
  const charged = (session.subject.mood?.point().arousal ?? 0) >= 60;
  const channel: ReactionChannel = charged && valence !== 50 && rng.chance("dialogue", 0.6) ? "speech" : "thought";
  const key = keys[channel];
  if (!registry.has(key)) return null;
  const sel = registry.select(key, axesFor(session), { rng });
  if (!sel) return null;
  return { key, channel, text: sel.line };
}

/** De-lab a line that still addresses the reader (D-198): "you" -> the Observer's read. */
export function deLab(text: string): string {
  return text
    .replace(/\bthe player\b/g, "the Observer")
    .replace(/\bthe lab\b/g, "the room");
}
