/**
 * A minimal per-character simulation: a `Subject` with the full registries, a
 * bare `Session` for the resolver/clock, and helpers to bestow a genome and
 * advance. No town, mind-wiring or dialogue is required to run a
 * transformation — those layer on later.
 */
import { createFocus } from "@core/focus";
import { createSession, type Session } from "@core/session";
import { createObserver } from "@core/observer";
import { TimeEngine } from "@core/time_engine";
import { resolvePower, powerFromInjector, type PowerResolution } from "@core/powers";
import { buildCriteriaContext } from "@core/mind_wiring";
import { matches, type CriteriaContext } from "@core/criteria";
import { createComposer, buildFragmentLibrary, buildToneLibrary, type Composer } from "@core/composer";
import { compactSave } from "./compact";
import { createLunar, type Lunar } from "./lunar";
import type { Registries } from "./registries";
import type { Subject } from "@core/subject";

/** A composer over the merged fragments/tone, for rendering a subject's body. */
export function buildComposer(regs: Registries, data: Record<string, unknown>): Composer {
  return createComposer({
    attributes: regs.attributes,
    fragments: buildFragmentLibrary(data.fragments ?? {}),
    tone: buildToneLibrary(data.tone ?? {}),
  });
}

export interface SimOptions {
  name: string;
  seed: number;
  baseGender?: string;
  regs: Registries;
  lunar?: { cycleDays?: number };
}

export interface Sim {
  subject: Subject;
  session: Session;
  engine: TimeEngine;
  regs: Registries;
  /** The lunar clock this sim's phase gates read (D-248). */
  lunar: Lunar;
}

/**
 * The phase `when` evaluator for one sim (D-248): a phase gate like
 * `{ moon_min: 0.8 }` holds only near a full moon. Moon state comes from the sim's
 * own clock, so a gate is deterministic and rides the shared world tick.
 */
export function whenOpenFor(sim: { session: Session; lunar: Lunar }): (when: Record<string, unknown>) => boolean {
  return (when) => {
    const tick = sim.session.clock.tick;
    const base = buildCriteriaContext(sim.session, [], []);
    const ctx: CriteriaContext = { ...base, moon: sim.lunar.intensity(tick), moonPhase: sim.lunar.phaseName(tick) };
    return matches(when, ctx);
  };
}

export function startSubject(opts: SimOptions): Sim {
  const { regs } = opts;
  const subject = createFocus({
    name: opts.name,
    baseGender: opts.baseGender ?? "female",
    skeleton: regs.skeleton,
    library: regs.library,
    genomesRegistry: regs.genomes,
    exposureBands: regs.exposureBands,
    attributeRegistry: regs.attributes,
    generate: false,
    nameData: null,
    // mind + mood give emotions for the emotional/hormonal coupling (H3)
    mindData: (regs.data.mind as { values?: unknown[] } | undefined)?.values ? regs.data.mind : null,
    moodData: regs.data.mood ?? null,
  });
  const session = createSession({ subject, observer: createObserver(), saveSeed: opts.seed, events: regs.events });
  const engine = new TimeEngine(session);
  const lunar = createLunar(opts.lunar);
  return { subject, session, engine, regs, lunar };
}

/** Push an emotion (0..100), for the emotional coupling and manual nudges. */
export function feel(sim: Sim, emotion: string, amount: number): void {
  sim.subject.mood?.impulse(emotion, amount);
}

/** The bestow power id the authoring gate expects for a genome. */
export function mutagenPowerId(genomeId: string): string {
  return `power.${genomeId.replace(/^genome\./, "")}_mutagen`;
}

/**
 * The single dose every bestow uses, until the dose system is designed.
 *
 * DEFERRED (DOSE): the core's `dose` genuinely scales a change (magnitude, observer
 * scatter), but the stage never surfaced it and the call sites had drifted (1.0 in
 * the cast/game vs 3.0 in `subject`). Everything now funnels through this one value
 * so behaviour is consistent and there is exactly one place to change when the
 * system is decided. See `DEFERRED.md`.
 */
export const DEFAULT_DOSE = 3.0;

/**
 * Apply a genome as a bestow, bypassing the observer's charge/cooldown — for
 * engine-driven triggers (a moon-shift, an emotional forced change) that are not
 * the player spending charge.
 */
export function bestowForced(sim: Sim, genomeId: string, dose = DEFAULT_DOSE): PowerResolution {
  sim.session.observer.charge = sim.session.observer.chargeMax;
  sim.session.cooldowns.clear();
  return bestow(sim, genomeId, dose);
}

/** Apply a genome as a bestow (preserve genitals). */
export function bestow(sim: Sim, genomeId: string, dose = DEFAULT_DOSE): PowerResolution {
  const id = mutagenPowerId(genomeId);
  const slug = id.replace(/^power\./, "");
  const injector = sim.regs.injectors.get(`injector.${slug}`);
  const genome = sim.regs.genomes.get(genomeId);
  if (!injector || !genome) throw new Error(`no injector/genome for ${genomeId}`);
  const power = powerFromInjector(injector);
  return resolvePower({
    session: sim.session,
    registries: {
      traits: sim.regs.traits,
      attributes: sim.regs.attributes,
      morphTracks: sim.regs.morphTracks,
      library: sim.regs.library,
      distribution: sim.regs.distribution,
      phases: sim.regs.phases,
      genomes: sim.regs.genomes,
      reactions: { reactions: [] } as never,
      dispositionTable: null,
      // a phase `when` gate (D-248) reads this sim's moon, so a lycan's later phases
      // only advance under the moon while its first phase lands from the bite alone
      whenOpen: whenOpenFor(sim),
    },
    power,
    dose,
    injector,
    genome,
    policy: "preserve",
  });
}

/** Advance the world `ticks` hours (progress, morph, phases). */
export function advance(sim: Sim, ticks: number): void {
  sim.engine.advance(ticks);
}

/** Serialize this character's world to a checksummed save string (view rings capped). */
export function saveSim(sim: Sim): string {
  return compactSave(sim.session);
}
