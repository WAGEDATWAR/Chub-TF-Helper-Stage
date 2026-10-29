import { ContentError } from "./loader";
import { clampStat } from "./stats";
import { abilityStates, type AbilityRegistry } from "./abilities";
import { rollFaults, applyFaultEffect, type FaultRegistry, type FiredFault } from "./faults";
import type { Subject } from "./subject";
import type { Rng } from "./rng";

/**
 * Play (blueprint §48.5; D-097/D2). Na lab bench: Play is a *situation*, and its
 * options are gated by **formed reactions** as much as by composure — a fetish
 * opens playful lines, a phobia closes them. Ability options come from each
 * ability's `scene_unlocks`, so a locked option always names its requirement.
 */
export interface PlayOption {
  id: string;
  label: string;
  effect: Record<string, number>;
  hint: string;
  composure_min: number;
  requires: { ability: string; at: number } | { reaction: string } | null;
  kind: string;
}

export interface PlayConfig {
  beats_per_scene: number;
  arousal_climax_at: number;
  pain_gate: number;
  options: PlayOption[];
}

export interface PlayBlock {
  beat: number;
  option: string | null;
  finished: boolean;
}

export function emptyPlayBlock(): PlayBlock {
  return { beat: 0, option: null, finished: false };
}

export function buildPlayConfig(data: unknown): PlayConfig {
  const d = data as PlayConfig | null | undefined;
  if (!d || !Array.isArray(d.options) || d.options.length === 0) {
    throw new ContentError('play_options.json must declare a non-empty "options" array', "play_options.json");
  }
  const ids = new Set<string>();
  for (const o of d.options) {
    if (ids.has(o.id)) throw new ContentError(`duplicate play option "${o.id}"`, "play_options.json");
    ids.add(o.id);
    if (typeof o.label !== "string" || typeof o.effect !== "object") {
      throw new ContentError(`play option "${o.id}" needs a label and an effect`, "play_options.json");
    }
  }
  return d;
}

export interface PlayRow extends PlayOption {
  locked: boolean;
  lockReason: string | null;
}

/** Why an option is unavailable, or null if open. */
export function lockReason({ option, subject, abilities, states, config }: {
  option: PlayOption; subject: Subject; abilities: AbilityRegistry; states: ReturnType<typeof abilityStates>; config: PlayConfig;
}): string | null {
  if ((subject.stats.composure ?? 0) < (option.composure_min ?? 0)) return `needs Composure ${option.composure_min}`;
  if ((subject.stats.pain ?? 0) >= (config.pain_gate ?? 60) && option.kind !== "base") return "too much pain for this";
  const req = option.requires;
  if (!req) return null;
  if ("reaction" in req) {
    if (!subject.reactions.some((r) => r.id === req.reaction)) return `not yet awakened (${req.reaction.replace(/^react\./, "")})`;
    return null;
  }
  const ability = abilities.get(req.ability);
  const state = states.find((s) => s.id === req.ability);
  if (!state || !state.held) return `not present (${ability?.display_name ?? req.ability})`;
  if (state.effective < req.at) {
    const tier = ability?.mastery_tiers.find((t) => t.at >= req.at)?.tier ?? 4;
    return `needs tier ${tier} (${ability?.display_name})`;
  }
  return null;
}

export function playOptions({ subject, abilities, config }: { subject: Subject; abilities: AbilityRegistry; config: PlayConfig }): PlayRow[] {
  const states = abilityStates(subject, abilities, { exposure: subject.derived.exposure ?? 0 });
  const rows = config.options.map((option) => {
    const locked = lockReason({ option, subject, abilities, states, config });
    return { ...option, locked: locked !== null, lockReason: locked };
  });
  const rank = (r: PlayRow) => (r.locked ? 1 : 0) * 2 + (r.kind === "base" ? 0 : 1);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

export interface BeatResult {
  option: string;
  label: string;
  applied: Record<string, number>;
  faults: FiredFault[];
  beat: number;
  beatsMax: number;
  climax: boolean;
  finished: boolean;
}

export function resolveBeat({ session, abilities, faults, config, optionId }: {
  session: { subject: Subject; play: PlayBlock; rng: Rng }; abilities: AbilityRegistry; faults: FaultRegistry; config: PlayConfig; optionId: string;
}): BeatResult | { error: string } {
  const subject = session.subject;
  const option = config.options.find((o) => o.id === optionId);
  if (!option) return { error: `unknown play option "${optionId}"` };
  const states = abilityStates(subject, abilities, { exposure: subject.derived.exposure ?? 0 });
  const locked = lockReason({ option, subject, abilities, states, config });
  if (locked) return { error: locked };
  const block = session.play;
  if (block.finished) return { error: "the scene is over" };

  const stats = subject.stats;
  const applied: Record<string, number> = {};
  for (const [key, value] of Object.entries(option.effect)) {
    if (key in stats) {
      stats[key] = clampStat((stats[key] ?? 0) + value);
      applied[key] = value;
    }
  }

  const fired: FiredFault[] = [];
  const req = option.requires;
  if (req && "ability" in req) {
    const ability = abilities.get(req.ability);
    if (ability) {
      const mastery = states.find((s) => s.id === ability.id)?.effective ?? 0;
      for (const fault of rollFaults({ ability, mastery, abilities, faults, subject, rng: session.rng })) {
        fired.push({ id: fault.id, name: fault.display_name, text: fault.text, netPositive: fault.net_positive === true, applied: applyFaultEffect({ frustration: 0 }, 12, subject, fault) });
      }
    }
  }
  block.beat += 1;
  block.option = option.id;
  const climax = (stats.arousal ?? 0) >= (config.arousal_climax_at ?? 85);
  const finished = climax || block.beat >= (config.beats_per_scene ?? 3);
  block.finished = finished;
  if (finished) stats.arousal = clampStat(Math.round((stats.arousal ?? 0) * 0.4));
  return { option: option.id, label: option.label, applied, faults: fired, beat: block.beat, beatsMax: config.beats_per_scene ?? 3, climax, finished };
}
export function resetPlay(session: { play: PlayBlock }): PlayBlock {
  session.play = emptyPlayBlock();
  return session.play;
}
