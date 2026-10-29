import { buildAbilityRegistry, syncAbilities, type AbilityRegistry } from "./abilities";
import { buildFaultRegistry, type FaultRegistry } from "./faults";
import { buildTrainingConfig, buildStances, selfPractice, type TrainingConfig, type Stance } from "./training";
import { desires } from "./identity";
import { seeksChange } from "./psychology_wiring";
import type { ReactionCatalog } from "./registries";
import type { Session } from "./session";

/**
 * Practice wiring (blueprint §48.5; S45). Binds ability/fault/training registries
 * to a session so self-driven practice runs on the clock and body changes re-sync
 * held abilities. Content is injected once; the session never loads files.
 */
export interface PracticeKit {
  abilities: AbilityRegistry;
  faults: FaultRegistry;
  config: TrainingConfig;
  stances: Stance[];
  reactions?: ReactionCatalog | null;
}

export function buildPracticeKit(data: { abilities: unknown; faults: unknown; training: unknown; stances: unknown; reactions?: unknown }): PracticeKit {
  return {
    abilities: buildAbilityRegistry(data.abilities),
    faults: buildFaultRegistry(data.faults),
    config: buildTrainingConfig(data.training),
    stances: buildStances(data.stances),
    reactions: (data.reactions as ReactionCatalog | undefined) ?? null,
  };
}

/** The Observer's nudge lever (S44): steer what she practises and how hard. */
export interface Nudge {
  abilityId?: string | null;
  stanceId?: string | null;
  untilTick?: number;
}

/** Re-sync held abilities after any body change (power landed, reversion). */
export function syncAfterBodyChange(session: Session, kit: PracticeKit): { gained: string[]; lost: string[] } {
  const result = syncAbilities(session.subject, kit.abilities);
  for (const id of result.gained) {
    session.bus.emit("ability.granted", { ability: id, name: kit.abilities.get(id)?.display_name ?? id }, { ctx: session.conditionContext() as never });
    session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `A new capability: ${kit.abilities.get(id)?.display_name ?? id}.` });
    session.markDirty();
  }
  return result;
}

/**
 * One self-driven practice session, run on the daily boundary. She trains
 * herself; the Observer is not involved save for a standing nudge (S44). Emits a
 * story event and journals.
 */
export function runSelfPractice(session: Session, kit: PracticeKit): boolean {
  // her schedule drives practice (S48.5): resting at home she anchors a change in
  // place; out in the world she leans toward abilities she can show.
  const atHome = /^loc\.\w*_?home/.test(session.town?.state("subject")?.at ?? "loc.her_home");
  // a high-drive subject seeks change (R7, §20): she pushes an under-mastered
  // ability instead of letting the day drift.
  const seeking = seeksChange(session);
  if (seeking) session.setFlag("seeking-change");
  const contextWeight = (a: { category: string; mastery: number }): number => {
    if (a.mastery < 40) return seeking ? 1.4 : 1; // an eager subject chases the new
    if (atHome) return 1 + (100 - a.mastery) / 400; // quieter, anchoring
    return a.category === "social" || a.category === "movement" ? 1.25 : 1; // showier
  };
  const result = selfPractice({
    subject: session.subject,
    session,
    rng: session.rng,
    abilities: kit.abilities,
    faults: kit.faults,
    config: kit.config,
    stances: kit.stances,
    opts: {
      desiredFamilies: kit.reactions ? desires(session.subject, kit.reactions) : [],
      contextWeight,
      ...(session.nudge ? { nudgeAbility: session.nudge.abilityId ?? undefined, nudgeStance: session.nudge.stanceId ?? undefined } : {}),
    },
  });
  if (!result) return false;
  const ability = kit.abilities.get(result.abilityId);
  const name = ability?.display_name ?? result.abilityId;
  session.practising = result.abilityId;
  const kindLine = result.ending.kind === "breakthrough" ? "a breakthrough" : result.ending.kind === "frustration_cap" ? "frayed by the end" : "steady work";
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `She practises ${name} (${result.reason}); ${kindLine}. Mastery ${result.ending.mastery}.` });
  session.bus.emit("practice.done", { ability: result.abilityId, name, kind: result.ending.kind, mastery: result.ending.mastery }, { final: true });
  session.markDirty();
  session.refresh();
  return true;
}

