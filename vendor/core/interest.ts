import type { Session } from "./session";

/**
 * Interest signals (blueprint §29.4, D-067). Long timelines must never mean idle
 * waiting, and "interesting" must be data, not a hardcoded list. Any system
 * registers an interest hook; the skip engine steps one tick at a time and stops
 * at the *earliest* tick any hook fires — so a crossing is never skipped past.
 *
 * A hook returns a salience label when its condition becomes true *on this tick*,
 * or null. Hooks read the session; they must not mutate it.
 */
export type InterestLabel =
  | "stage_crossing"
  | "morph_step"
  | "mood_threshold"
  | "need_crisis"
  | "relationship_shift"
  | "scheduled_event"
  | "resistance_rise"
  | "notice"
  | "feral"
  | "debt_texture"
  | "realization"
  | "preference"
  | "ability"
  | "sex"
  | "practice"
  | "inspect"
  | "memory"
  | "genital";

export interface InterestSignal {
  id: string;
  label: InterestLabel;
  /** Fires when this returns a salience 0..1, or null. */
  test(session: Session, prev: SessionSnapshotView): number | null;
}

/** The slice of prior state a hook may compare against. */
export interface SessionSnapshotView {
  exposure: number;
  band: string | null;
  pain: number;
  stability: number;
  arousal: number;
  drive: number;
  strain: number;
  debt: number;
  feralLocked: boolean;
  reactions: number;
  beliefs: number;
  charge: number;
  /** Live town events count (M16b); a new event is a point of interest. */
  townEvents: number;
  /** The subject's highest bond value (M16b); a rising bond is a beat. */
  topBond: number;
  /** The subject's total memory count (S74); new memory is a beat. */
  memories: number;
  realized: boolean;
  preferences: number;
  heldAbilities: number;
  sessions: number;
  held: number;
  genitalProfile: string;
  inspects: number;
}

export function viewOf(session: Session): SessionSnapshotView {
  const s = session.subject;
  return {
    exposure: s.derived.exposure ?? 0,
    band: s.derived.band ?? null,
    pain: s.stats.pain ?? 0,
    stability: s.stats.stability ?? 100,
    arousal: s.stats.arousal ?? 0,
    drive: s.stats.drive ?? 0,
    strain: s.derived.globalHealth ?? 100,
    debt: s.stats.intelligence_debt ?? 0,
    feralLocked: s.feral?.locked ?? false,
    reactions: s.reactions.length,
    beliefs: Object.keys(s.know).length,
    charge: session.observer.charge,
    realized: s.mind?.realized ?? false,
    preferences: s.preferences.all().length,
    heldAbilities: Object.keys(s.abilities ?? {}).length,
    sessions: Object.values(session.training.sessions ?? {}).reduce((a, b) => a + b, 0),
    held: session.sex.heldArousalTicks,
    genitalProfile: s.derived.genitalProfile ?? "",
    inspects: session.inspectState.count,
    townEvents: session.townEvents?.active().length ?? 0,
    topBond: Math.round(Math.max(0, ...(session.town?.state("subject")?.relationships.map((r) => r.bond) ?? [0]))),
    memories: session.town?.state("subject")?.memory.memories.length ?? 0,
  };
}

export class InterestRegistry {
  private readonly signals: InterestSignal[] = [];

  register(signal: InterestSignal): void {
    this.signals.push(signal);
  }

  all(): InterestSignal[] {
    return [...this.signals];
  }

  /** The labels that fire on this advance, with their salience. */
  fire(session: Session, prev: SessionSnapshotView): Array<{ id: string; label: InterestLabel; sal: number }> {
    const out: Array<{ id: string; label: InterestLabel; sal: number }> = [];
    for (const signal of this.signals) {
      const sal = signal.test(session, prev);
      if (sal !== null && sal > 0) out.push({ id: signal.id, label: signal.label, sal });
    }
    return out;
  }
}

/** The default signal set — data, not engine code (§29.4 criterion). */
export function defaultInterestRegistry(): InterestRegistry {
  const reg = new InterestRegistry();
  reg.register({ id: "signal.stage", label: "stage_crossing", test: (s, p) => ((s.derived.exposure ?? 0) - p.exposure >= 8 ? 0.9 : null) });
  reg.register({ id: "signal.band", label: "mood_threshold", test: (s, p) => (s.derived.band && s.derived.band !== p.band ? 0.8 : null) });
  reg.register({ id: "signal.pain", label: "resistance_rise", test: (s, p) => ((s.subject.stats.pain ?? 0) >= 60 && p.pain < 60 ? 0.85 : null) });
  reg.register({ id: "signal.feral", label: "feral", test: (s, p) => ((s.subject.feral?.locked ?? false) && !p.feralLocked ? 1 : null) });
  reg.register({ id: "signal.strain", label: "need_crisis", test: (s, p) => ((s.derived.globalHealth ?? 100) <= 60 && p.strain > 60 ? 0.8 : null) });
  reg.register({ id: "signal.debt", label: "debt_texture", test: (s, p) => ((s.subject.stats.intelligence_debt ?? 0) > 30 && p.debt <= 30 ? 0.7 : null) });
  reg.register({ id: "signal.reaction", label: "mood_threshold", test: (s, p) => (s.subject.reactions.length > p.reactions ? 0.9 : null) });
  reg.register({ id: "signal.notice", label: "notice", test: (s, p) => (Object.keys(s.subject.know).length > p.beliefs ? 0.6 : null) });
  // new signals (D-220): the story beats a player should not skip past
  reg.register({ id: "signal.realization", label: "realization", test: (s, p) => ((s.subject.mind?.realized ?? false) && !p.realized ? 1 : null) });
  reg.register({ id: "signal.preference", label: "preference", test: (s, p) => (s.subject.preferences.all().length > p.preferences ? 0.85 : null) });
  reg.register({ id: "signal.ability", label: "ability", test: (s, p) => (Object.keys(s.subject.abilities ?? {}).length > p.heldAbilities ? 0.8 : null) });
  reg.register({ id: "signal.practice", label: "practice", test: (s, p) => (Object.values(s.training.sessions ?? {}).reduce((a, b) => a + b, 0) > p.sessions ? 0.7 : null) });
  reg.register({ id: "signal.sex", label: "sex", test: (s, p) => (s.sex.heldArousalTicks >= 3 && p.held < 3 ? 0.7 : null) });
  reg.register({ id: "signal.genital", label: "genital", test: (s, p) => (s.derived.genitalProfile && s.derived.genitalProfile !== p.genitalProfile ? 0.95 : null) });
  reg.register({ id: "signal.arousal", label: "sex", test: (s, p) => ((s.subject.stats.arousal ?? 0) >= 70 && p.arousal < 70 ? 0.65 : null) });
  reg.register({ id: "signal.inspect", label: "inspect", test: (s, p) => (s.inspectState.count > p.inspects ? 0.6 : null) });
  // town/social/memory points of interest (M16.5d #24): a skip should not blow
  // past a town event, a strengthening bond, or a fresh memory.
  reg.register({ id: "signal.town_event", label: "scheduled_event", test: (s, p) => (s.townEvents?.active().length ?? 0) > (p.townEvents ?? 0) ? 0.75 : null });
  reg.register({ id: "signal.bond", label: "relationship_shift", test: (s, p) => { const b = Math.max(0, ...(s.town?.state("subject")?.relationships.map((r) => r.bond) ?? [0])); return b - (p.topBond ?? 0) >= 4 ? 0.7 : null; } });
  reg.register({ id: "signal.memory", label: "memory", test: (s, p) => (s.town?.state("subject")?.memory.memories.length ?? 0) > (p.memories ?? 0) ? 0.55 : null });
  return reg;
}
