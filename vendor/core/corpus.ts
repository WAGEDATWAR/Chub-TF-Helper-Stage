import type { Session } from "./session";
import { masteryOf, abilityStates, type AbilityRegistry } from "./abilities";
import { mindGrowthFactor } from "./transformation_coupling";

/**
 * Corpus measurement (D-206, Wave 6). A live run with **defined observational
 * goals that also exist as data in the sim**, scored and summarised so pillar
 * adherence and problem points surface in a structured way. Pure reads — the
 * harness drives the run; this derives the measurements.
 *
 * The goals, and where their data lives:
 *   - settle time / rate / agency      → resolver settle + mind.agency + coupling
 *   - discovery opinion (start→settle→end) → realization sign + mood valence + self
 *   - sex-drive impact + coping        → arousal floor, held arousal, sex actions
 *   - psyche change + carryover        → mind value deltas from baseline
 *   - ability timeline                 → first practice + mastery progression
 *
 * Items marked `(2)` capture both start-to-settle and settle-to-end, for comparison.
 */
export const CORPUS_VERSION = 1;

export interface PhaseSample {
  tick: number;
  day: number;
  exposure: number;
  moodValence: number;
  coherence: number;
  dysmorphia: number;
  arousalFloor: number;
  arousal: number;
  agency: number;
  awareness: number;
  /** Signed opinion in -100..100 (positive = leaning in). */
  opinion: number;
  /** Per mind-value signed delta from its baseline. */
  psyche: Record<string, number>;
}

export interface AbilityTimeline {
  /** Day she first practised, or null if she never did. */
  firstPracticeDay: number | null;
  /** Per-ability mastery at end, and whether it was still unmastered. */
  masteries: Array<{ id: string; name: string; mastery: number; held: boolean }>;
  /** Sessions practised. */
  sessions: number;
}

export interface CorpusRun {
  genome: string;
  seed: number;
  /** Standardised length all runs share. */
  lengthDays: number;
  settledDay: number | null;
  /** The rate the mind lent the change, averaged over growth (0.6..1.5). */
  rateInfluence: number;
  /** Normalised agency score 0..1: how much she steered the change. */
  agencyScore: number;
  trainingCount: number;
  sexActionCount: number;
  phases: { discovery: PhaseSample | null; settle: PhaseSample | null; end: PhaseSample };
  /** (2) discovery opinion: start→settle and settle→end. */
  opinionShift: { toSettle: number; toEnd: number; combined: number };
  /** (2) sex-drive impact and cope: settle→end. */
  sexDrive: { floorRise: number; heldArousalPeak: number; coped: number };
  /** (2) psyche change per value to settle, and carryover to end. */
  psyche: { toSettle: Record<string, number>; toEnd: Record<string, number>; totalAbsChange: number };
  abilities: AbilityTimeline;
  summary: string;
}

/** Signed opinion from the live reads: leaning in (+) vs against (-). */
export function opinionOf(session: Session): number {
  const s = session.subject;
  const valence = (s.mood?.point().valence ?? 50) - 50; // -50..50
  const coherence = (s.self?.coherence ?? 60) - 60;
  const dysmorphia = -(s.self?.dysmorphia ?? 0);
  return Math.round(Math.max(-100, Math.min(100, valence * 1.2 + coherence + dysmorphia)));
}

/** Per-value signed delta of the mind from each value's baseline. */
export function psycheOf(session: Session): Record<string, number> {
  const out: Record<string, number> = {};
  const mind = session.subject.mind;
  if (!mind) return out;
  for (const id of mind.ids()) out[id] = Math.round(mind.read(id) - mind.get(id)!.baseline);
  return out;
}

export function samplePhase(session: Session): PhaseSample {
  const s = session.subject;
  const mind = s.mind;
  return {
    tick: session.clock.tick,
    day: session.clock.day,
    exposure: Math.round(s.derived.exposure ?? 0),
    moodValence: s.mood?.point().valence ?? 50,
    coherence: Math.round(s.self?.coherence ?? 60),
    dysmorphia: Math.round(s.self?.dysmorphia ?? 0),
    arousalFloor: Math.round(s.derived.arousalFloor ?? 0),
    arousal: Math.round(s.stats.arousal ?? 0),
    agency: Math.round(mind?.agency ?? 50),
    awareness: Math.round(mind?.awareness ?? 0),
    opinion: opinionOf(session),
    psyche: psycheOf(session),
  };
}

/** People she coped with a raised sex drive: masturbation + sexual-control practice. */
function copeScoreOf(trace: RunTrace): number {
  return Math.min(1, (trace.heldArousalPeak / 40) * 0.4 + Math.min(1, trace.trainingCount / 8) * 0.3 + Math.min(1, trace.sexActionCount / 6) * 0.3);
}

export interface RunTrace {
  genome: string;
  seed: number;
  lengthDays: number;
  settledDay: number | null;
  rateSamples: number[];
  agencySamples: number[];
  discoverySample: PhaseSample | null;
  settleSample: PhaseSample | null;
  endSample: PhaseSample;
  heldArousalPeak: number;
  trainingCount: number;
  sexActionCount: number;
  firstPracticeDay: number | null;
}

/** Fold a traced run into a scored, summarised measurement. */
export function measureRun(trace: RunTrace, abilities: AbilityRegistry, subject: Session["subject"]): CorpusRun {
  const rateInfluence = trace.rateSamples.length > 0 ? trace.rateSamples.reduce((a, b) => a + b, 0) / trace.rateSamples.length : 1;
  const agency = trace.agencySamples.length > 0 ? trace.agencySamples.reduce((a, b) => a + b, 0) / trace.agencySamples.length : 50;
  const agencyScore = Math.round(Math.max(0, Math.min(1, agency / 100)) * 100) / 100;

  const discovery = trace.discoverySample;
  const settle = trace.settleSample;
  const end = trace.endSample;
  const baseOpinion = discovery?.opinion ?? 0;
  const toSettle = (settle?.opinion ?? end.opinion) - baseOpinion;
  const toEnd = end.opinion - (settle?.opinion ?? end.opinion);
  const opinionShift = { toSettle, toEnd, combined: end.opinion - baseOpinion };

  const sexDrive = {
    floorRise: (end.arousalFloor ?? 0) - (discovery?.arousalFloor ?? 0),
    heldArousalPeak: trace.heldArousalPeak,
    coped: Math.round(copeScoreOf(trace) * 100) / 100,
  };

  const basePsyche = solveBase(trace);
  const toSettlePsyche: Record<string, number> = {};
  const toEndPsyche: Record<string, number> = {};
  let totalAbsChange = 0;
  for (const id of Object.keys(end.psyche)) {
    if (id in basePsyche) {
      toSettlePsyche[id] = (settle?.psyche[id] ?? end.psyche[id] ?? 0) - basePsyche[id]!;
      toEndPsyche[id] = (end.psyche[id] ?? 0) - (settle?.psyche[id] ?? end.psyche[id] ?? 0);
    }
    totalAbsChange += Math.abs(end.psyche[id] ?? 0);
  }

  const abilitiesTimeline: AbilityTimeline = {
    firstPracticeDay: trace.firstPracticeDay,
    sessions: trace.trainingCount,
    masteries: abilityStates(subject, abilities, { exposure: subject.derived.exposure ?? 0 })
      .filter((a) => a.held)
      .map((a) => ({ id: a.id, name: a.name, mastery: Math.round(a.mastery), held: a.held })),
  };

  return {
    genome: trace.genome,
    seed: trace.seed,
    lengthDays: trace.lengthDays,
    settledDay: trace.settledDay,
    rateInfluence: Math.round(rateInfluence * 1000) / 1000,
    agencyScore,
    trainingCount: trace.trainingCount,
    sexActionCount: trace.sexActionCount,
    phases: { discovery, settle, end },
    opinionShift,
    sexDrive,
    psyche: { toSettle: toSettlePsyche, toEnd: toEndPsyche, totalAbsChange },
    abilities: abilitiesTimeline,
    summary: summarize(trace, { rateInfluence, agencyScore, opinionShift, sexDrive, totalAbsChange }),
  };
}

function solveBase(trace: RunTrace): Record<string, number> {
  // the discovery sample carries the earliest psyche read we captured
  return trace.discoverySample?.psyche ?? {};
}

function summarize(trace: RunTrace, m: { rateInfluence: number; agencyScore: number; opinionShift: { combined: number }; sexDrive: { floorRise: number; coped: number }; totalAbsChange: number }): string {
  const settle = trace.settledDay !== null ? `settled day ${trace.settledDay}` : "did not settle";
  const opin = m.opinionShift.combined >= 10 ? "leaned in" : m.opinionShift.combined <= -10 ? "pushed back" : "stayed level";
  const cope = m.sexDrive.coped >= 0.5 ? "coped" : "little coping";
  const train = trace.firstPracticeDay !== null ? `trained from day ${trace.firstPracticeDay} (${trace.trainingCount})` : "never trained";
  return `${trace.genome} seed ${trace.seed}: ${settle}; rate ${m.rateInfluence}×, agency ${m.agencyScore}; opinion ${opin} (${m.opinionShift.combined}); sex-drive +${m.sexDrive.floorRise}, ${cope}; psyche ${m.totalAbsChange}pt abs; ${train}.`;
}

/** A whole-corpus roll-up across runs. */
export function rollUp(runs: CorpusRun[]): string {
  if (runs.length === 0) return "no runs";
  const settled = runs.filter((r) => r.settledDay !== null);
  const avg = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);
  const practised = runs.filter((r) => r.abilities.firstPracticeDay !== null);
  const mastered = runs.flatMap((r) => r.abilities.masteries.filter((m) => m.mastery >= 100));
  const lines = [
    `runs ${runs.length} · settled ${settled.length}/${runs.length}`,
    `avg settle day ${avg(settled.map((r) => r.settledDay!))} · avg agency ${avg(runs.map((r) => r.agencyScore))} · avg rate ${avg(runs.map((r) => r.rateInfluence))}`,
    `avg opinion shift ${avg(runs.map((r) => r.opinionShift.combined))} · avg sex-cope ${avg(runs.map((r) => r.sexDrive.coped))} · avg psyche abs ${avg(runs.map((r) => r.psyche.totalAbsChange))}`,
    `training: ${practised.length}/${runs.length} runs trained · avg first practice day ${avg(practised.map((r) => r.abilities.firstPracticeDay!))} · ${mastered.length} abilities mastered`,
  ];
  return lines.join("\n");
}

export { mindGrowthFactor };
export { masteryOf };
