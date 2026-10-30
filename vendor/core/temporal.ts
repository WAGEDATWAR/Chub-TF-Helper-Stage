import type { Session } from "./session";
import { fromHours, dayOf } from "./time";

/**
 * Temporal powers (blueprint §27, M14). Time as a tool: compress a slow change so
 * it lands fast, stretch it so it is gentle, or shift the phase of the day so a
 * scene lands at a different block. These are `sway`-class verbs on the clock.
 *
 * A temporal effect is a *modifier* the tick honours: a growth-rate multiplier
 * that eases from a start to an end, or a one-shot phase shift. It is stored on
 * the session and saved.
 */
export const TEMPORAL_VERSION = 1;

export interface GrowthModifier {
  id: string;
  /** Multiplies growth while active (1 = normal). */
  rate: number;
  /** Tick it expires; 0 means until cleared. */
  untilTick: number;
}

export function createTemporalState(): { growth: number; modifiers: GrowthModifier[] } {
  return { growth: 1, modifiers: [] };
}

/** A fast-forward: grow change several times faster for a span. */
export function compress(session: Session, factor = 3, hours = 48): GrowthModifier {
  const span = fromHours(hours);
  const mod: GrowthModifier = { id: `temporal.compress.${session.clock.tick}`, rate: factor, untilTick: session.clock.tick + span };
  session.temporal.modifiers.push(mod);
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `Time runs fast: change lands ${factor}x for ${hours}h.` });
  session.markDirty();
  return mod;
}

/** A stretch: grow change more slowly for a span, gentler. */
export function stretch(session: Session, factor = 0.5, hours = 72): GrowthModifier {
  const span = fromHours(hours);
  const mod: GrowthModifier = { id: `temporal.stretch.${session.clock.tick}`, rate: factor, untilTick: session.clock.tick + span };
  session.temporal.modifiers.push(mod);
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `Time runs slow: change lands ${factor}x for ${hours}h.` });
  session.markDirty();
  return mod;
}

/** A phase shift: move the clock a few hours, so a scene lands at another block. */
export function phaseShift(session: Session, hours = 6): number {
  session.clock.tick = Math.max(0, session.clock.tick + fromHours(hours));
  session.clock.day = dayOf(session.clock.tick);
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `The hour is nudged ${hours > 0 ? "forward" : "back"}.` });
  session.markDirty();
  return session.clock.tick;
}

/** The current effective growth multiplier, dropping expired modifiers. */
export function growthRate(session: Session): number {
  session.temporal.modifiers = session.temporal.modifiers.filter((m) => m.untilTick === 0 || m.untilTick > session.clock.tick);
  return session.temporal.modifiers.reduce((rate, m) => rate * m.rate, 1);
}
