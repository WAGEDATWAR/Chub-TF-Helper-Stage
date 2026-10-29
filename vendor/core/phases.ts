import { ContentError } from "./loader";
import { matches } from "./criteria";
import type { Genome } from "./genomes";

/**
 * Transformation ordering (blueprint §13/§14; M14.5, S46).
 *
 * A mutagen declares **phases**: an ordered structure of *what comes before what*
 * (nails + teeth first, bone/skull restructuring last, a full form only at the
 * feral stage). Within a phase, parts do not land in lockstep — they emerge under
 * a **procedural** distribution weighted by her body and history (stability, dose,
 * familiarity, mastery, desire), never pure rng, so change is slow and per-part
 * along a legible, species-plausible order.
 */
export const PHASE_VERSION = 1;

export interface Phase {
  id: string;
  label: string;
  /** Families that emerge in this phase. */
  families?: string[];
  /** A role or role-prefix that emerges in this phase. */
  roles?: string[];
  /** Part tags that emerge in this phase. */
  tags?: string[];
  /** Opens only once exposure has reached this value. */
  exposure_min?: number;
  /** Opens only at the feral stage. */
  feral_only?: boolean;
  /** Opens only while this condition holds (D-194): a mind/mood/stat gate. */
  when?: Record<string, unknown>;
}

export interface PhasePlan {
  phases: Phase[];
  /** Ticks between one phase opening and the next. */
  spacing: number;
  /** Intra-phase spread: how many ticks a phase's parts may emerge across. */
  spread: number;
}

export const DEFAULT_PHASE_PLAN: Omit<PhasePlan, "phases"> = Object.freeze({ spacing: 16, spread: 10 });

/** The context that makes intra-phase emergence procedural, not pure rng. */
export interface TempoContext {
  stability: number;
  dose: number;
  familiarity: number;
  mastery: number;
  desire: number;
  exposure: number;
}

/** A winner as the sequencer sees it. */
export interface Sequencable {
  inst: { role: string; tags?: string[] };
  attr: { id: string; family?: string; tags?: string[] };
  coverage: number;
  delay?: number;
  /** Filled by schedule(): the phase this winner was placed in. */
  phaseIndex?: number;
  phaseId?: string;
  /** Filled by schedule(): the phase's gate, so the resolver honours it (R6). */
  phaseFeralOnly?: boolean;
  phaseExposureMin?: number;
}

export interface PhaseRegistry {
  planFor(genomeId: string): PhasePlan;
}

export class PhaseSequencer {
  readonly spacing: number;
  readonly spread: number;
  private readonly plans: Map<string, PhasePlan>;

  constructor(data: { default?: PhasePlan; plans?: Record<string, PhasePlan>; spacing?: number; spread?: number }) {
    this.spacing = data.spacing ?? DEFAULT_PHASE_PLAN.spacing;
    this.spread = data.spread ?? DEFAULT_PHASE_PLAN.spread;
    this.plans = new Map(Object.entries(data.plans ?? {}));
    if (data.default) this.plans.set("default", data.default);
    for (const [id, plan] of this.plans) {
      if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
        throw new ContentError(`phase plan "${id}" must declare non-empty "phases"`, "phases.json");
      }
      const seen = new Set<string>();
      for (const phase of plan.phases) {
        if (typeof phase.id !== "string" || seen.has(phase.id)) {
          throw new ContentError(`phase plan "${id}" has a duplicate or missing phase id`, "phases.json");
        }
        seen.add(phase.id);
        if (!phase.families?.length && !phase.roles?.length && !phase.tags?.length) {
          throw new ContentError(`phase "${phase.id}" of plan "${id}" matches nothing`, "phases.json");
        }
      }
    }
    if (this.plans.size === 0) throw new ContentError('phases.json must declare a "default" or "plans"', "phases.json");
  }

  planFor(genomeId: string): PhasePlan {
    return this.plans.get(genomeId) ?? this.plans.get("default")!;
  }

  has(genomeId: string): boolean {
    return this.plans.has(genomeId);
  }

  /** The phase index a winning part is placed in, or null if it does not match. */
  phaseFor(plan: PhasePlan, winner: Sequencable): number | null {
    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i]!;
      if (matchesPhase(phase, winner)) return i;
    }
    return null;
  }

  /**
   * Assign every winner to a phase and a start tick. Within a phase the tick is
   * spread by a **tempo** read from her body/history: a high-dose, high-familiarity,
   * high-mastery, desirous subject lands parts earlier and closer together; an
   * unstable, unfamiliar one spreads them out. `rng` only breaks the residue.
   */
  schedule<T extends Sequencable>(
    winners: readonly T[],
    genome: Genome,
    ctx: TempoContext,
    rng: { next(stream: string): number } | null,
  ): T[] {
    const plan = this.planFor(genome.id);
    const phaseStart = new Map<number, number>();
    let cursor = 0;
    for (let i = 0; i < plan.phases.length; i++) {
      phaseStart.set(i, cursor);
      cursor += this.spacing;
    }
    const tempo = tempoFactor(ctx);

    return winners.map((w) => {
      const index = this.phaseFor(plan, w) ?? plan.phases.length - 1;
      const phase = plan.phases[index]!;
      const within = spreadWithin(plan.spread || this.spread, tempo, rng);
      const base = phaseStart.get(index) ?? 0;
      // stamp the phase's gate onto the winner (R6) so the resolver can honour a
      // feral-only / exposure_min phase without re-reading the genome each tick.
      return { ...w, phaseIndex: index, phaseId: phase.id, delay: base + within, phaseFeralOnly: phase.feral_only ?? false, phaseExposureMin: phase.exposure_min ?? 0 };
    });
  }

  /** Phases whose gates are open at this exposure (and condition, D-194). */
  openPhases(genome: Genome, exposure: number, feral: boolean, ctx?: import("./criteria").CriteriaContext | null): string[] {
    const plan = this.planFor(genome.id);
    return plan.phases
      .filter((p) => (p.exposure_min ?? 0) <= exposure && (!p.feral_only || feral) && (!p.when || (ctx ? phaseGateOpen(p.when, ctx) : true)))
      .map((p) => p.id);
  }
}

/** Does a phase's `when` gate hold against a context? */
function phaseGateOpen(when: Record<string, unknown>, ctx: import("./criteria").CriteriaContext): boolean {
  return matches(when, ctx);
}

function matchesPhase(phase: Phase, winner: Sequencable): boolean {
  const family = winner.attr.family;
  if (family && phase.families?.includes(family)) return true;
  const role = winner.inst.role;
  if (phase.roles?.some((r) => role === r || role.startsWith(r))) return true;
  const tags = [...(winner.attr.tags ?? []), ...(winner.inst.tags ?? [])];
  if (phase.tags?.some((t) => tags.includes(t))) return true;
  return false;
}

/**
 * Tempo: >1 means parts land later and more spread; <1 means earlier and tighter.
 * Stability dominates (a frayed body transforms unevenly); dose and desire push
 * it forward; familiarity and mastery keep a repeated family on an even keel.
 */
function tempoFactor(ctx: TempoContext): number {
  const stability = clamp01(ctx.stability / 100);
  const push = 0.35 * clamp01(ctx.dose / 5) + 0.25 * clamp01(ctx.desire) + 0.2 * clamp01(ctx.familiarity / 8) + 0.15 * clamp01(ctx.mastery / 100);
  const fray = 0.6 * (1 - stability);
  return Math.max(0.4, 1 + fray - push);
}

function spreadWithin(spread: number, tempo: number, rng: { next(stream: string): number } | null): number {
  const base = Math.round(spread * tempo);
  const residue = rng ? Math.round(rng.next("transform") * Math.max(1, spread * 0.4)) : 0;
  return Math.max(0, base + residue);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function buildPhaseSequencer(data: unknown): PhaseSequencer {
  if (!data || typeof data !== "object") throw new ContentError("phases: data is required", "phases.json");
  return new PhaseSequencer(data as { default?: PhasePlan; plans?: Record<string, PhasePlan>; spacing?: number; spread?: number });
}
