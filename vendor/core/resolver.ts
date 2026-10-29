import { ContentError } from "./loader";
import { clamp } from "./rng";
import { TraceRing } from "./trace";import { strain } from "./health";

/** A later phase unlocks once every earlier phase is this fraction done (D-202). */
export const PHASE_GATE = 0.55;
/** Max random ticks a part's first application is staggered by (D-219). */
export const ONSET_JITTER_TICKS = 10;

/** A stable 0..N jitter from a slot id, for when no rng is present. */
function stableJitter(slot: string): number {
  let h = 0;
  for (let i = 0; i < slot.length; i++) h = (h * 31 + slot.charCodeAt(i)) >>> 0;
  return h % (ONSET_JITTER_TICKS + 1);
}
import {
  growthDelta,
  stageIndexFor,
  crossedStages,
  painFromCrossings,
  progressBlockFor,
  PROGRESS_MAX,
  type ProgressBlock,
} from "./progress";
import type { AttributeRegistry } from "./attributes";
import type { TraitRegistry, Trait } from "./traits";
import type { Genome } from "./genomes";
import type { PartInstance } from "./parts";
type PartAttributeEntry = PartInstance["attributes"][number];
import type { Body } from "./body";
import type { IncubationScheduler } from "./incubation";
import type { MorphTrackRegistry } from "./morph";
import type { Distribution, DistributionWinner } from "./distribution";
import { PhaseSequencer, type TempoContext } from "./phases";
import type { Rng } from "./rng";
import { chainPart, genitalMorphFor } from "./genital_plan";
import type { PartLibrary } from "./parts";

export interface SubjectLike {
  body: Body;
  stats?: { stability?: number; pain?: number };
  stability?: number;
  baseGender?: string;
}

/** The tempo a subject's body/history lends to sequencing (M14.5, §14). */
function tempoOf(subject: SubjectLike, dose: number): TempoContext {
  const s = subject as { stats?: Record<string, number>; familiarity?: Record<string, number>; abilities?: Record<string, { mastery: number }> };
  const stats = s.stats ?? {};
  const familiarity = Object.values(s.familiarity ?? {}).reduce((a, b) => a + b, 0);
  const masteryValues = Object.values(s.abilities ?? {}).map((a) => a.mastery);
  const mastery = masteryValues.length > 0 ? masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length : 0;
  return {
    stability: readStability(subject),
    dose,
    familiarity,
    mastery,
    desire: (stats.drive ?? 50) / 100,
    exposure: stats.exposure ?? 0,
  };
}

export function readStability(subject: SubjectLike): number {
  return subject?.stats?.stability ?? subject?.stability ?? 100;
}

export function writeStability(subject: SubjectLike, value: number): number {
  if (subject?.stats && typeof subject.stats.stability === "number") subject.stats.stability = value;
  else subject.stability = value;
  return value;
}

export function computeCoverage(injector: { base_dose?: number }, genome: Genome, dose: number): number {
  const magnitude = (injector.base_dose ?? 1.0) * dose;
  const saturation = genome.saturation_point ?? 1.0;
  const overshoot = genome.overshoot_threshold ?? 1.0;
  return clamp(magnitude / saturation, 0, overshoot);
}

export function magnitudeFactor(coverage: number): number {
  return clamp(coverage, 0, 1);
}

export interface Candidate extends DistributionWinner {
  inst: PartInstance;
  attr: NonNullable<ReturnType<AttributeRegistry["get"]>>;
  coverage: number;
  genome: Genome;
  phaseIndex?: number;
  phaseId?: string;
  phaseFeralOnly?: boolean;
  phaseExposureMin?: number;
  /** The phase's `when` gate (D-248), stamped by schedule(). */
  phaseWhen?: Record<string, unknown> | null;
}

export function matchesTargets(instance: Pick<PartInstance, "tags" | "role">, targets: { match_tags?: string[]; match_roles?: string[] } | undefined): boolean {
  const tags = targets?.match_tags;
  const roles = targets?.match_roles;
  if (tags && tags.length > 0) {
    const instTags = instance.tags ?? [];
    if (!tags.every((t) => instTags.includes(t))) return false;
  }
  if (roles && roles.length > 0) {
    if (!roles.includes(instance.role)) return false;
  }
  return true;
}

export function expandCandidates(
  subject: SubjectLike,
  genome: Genome,
  coverage: number,
  traits: TraitRegistry,
  attributes: AttributeRegistry,
): Candidate[] {
  const candidates: Candidate[] = [];
  const exposure = (subject as { stats?: Record<string, number> }).stats?.exposure ?? 0;
  for (const traitId of genome.traits ?? []) {
    const trait: Trait | null = traits.get(traitId);
    if (!trait) continue;
    if (coverage < (trait.min_coverage ?? 0)) continue;
    // a feral/deep trait waits for the body to be far enough along (D-202)
    if ((trait.min_exposure ?? 0) > exposure) continue;
    if (trait.grants.length === 0) continue;
    for (const instance of subject.body.allInstances()) {
      if (!matchesTargets(instance, trait.targets)) continue;
      for (const attrId of trait.grants) {
        const attr = attributes.get(attrId);
        if (!attr) continue;
        if (!instance.mutable_aspects.includes(attr.family)) continue;
        const required = attr.requires_part_tags ?? [];
        if (!required.every((t) => instance.tags.includes(t))) continue;
        candidates.push({ inst: instance, attr, coverage, genome });
      }
    }
  }
  return candidates;
}

export function resolveConflicts(candidates: Candidate[]): { winners: Candidate[]; log: TraceEntry[] } {
  if (!Array.isArray(candidates)) {
    throw new Error("resolver: candidates must be an array");
  }
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.inst.slot}:${candidate.attr.family}`;
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }

  const winners: Candidate[] = [];
  const log: TraceEntry[] = [];

  for (const [key, group] of groups) {
    group.sort(
      (a, b) =>
        b.coverage - a.coverage ||
        (b.genome.priority ?? 0) - (a.genome.priority ?? 0) ||
        (b.attr.priority ?? 0) - (a.attr.priority ?? 0) ||
        a.attr.id.localeCompare(b.attr.id),
    );
    const win = group[0]!;
    winners.push(win);
    for (const lose of group.slice(1)) {
      if ((lose.attr.stack_mode ?? "replace") === "additive") {
        winners.push(lose);
        continue;
      }
      log.push({
        at: 0,
        key: lose.genome.id,
        winner: win.attr.id,
        loser: lose.attr.id,
        rule: "attribute_priority",
        slot: lose.inst.slot,
        group: key,
      });
    }
  }

  return { winners, log };
}

interface TraceEntry {
  at?: number;
  key: string;
  winner: string;
  loser: string;
  rule: string;
  slot: string;
  group: string;
}

export interface ResolverOptions {
  traits: TraitRegistry;
  attributes: AttributeRegistry;
  traceCapacity?: number;
  incubation?: IncubationScheduler | null;
  morphTracks?: MorphTrackRegistry | null;
  library?: PartLibrary | null;
  distribution?: Distribution | null;
  phases?: PhaseSequencer | null;
  rng?: Rng | null;
  genomes?: { get(id: string): { morph_role_tracks?: Record<string, string> } | null } | null;
  /**
   * Evaluates a phase's `when` gate (D-248) against the caller's world state — e.g.
   * `{ moon_min: 0.8 }` holds only near a full moon. Returns true when the gate is
   * satisfied (or absent). The resolver is world-agnostic, so the caller supplies it.
   */
  whenOpen?: ((when: Record<string, unknown>) => boolean) | null;
}

export interface TickEvent {
  slot: string;
  attribute: string;
  from: number;
  to: number;
  stageName: string | null;
  pain: number;
  morph?: string;
}

export class Resolver {
  readonly traits: TraitRegistry;
  readonly attributes: AttributeRegistry;
  readonly trace: TraceRing;
  readonly incubation: IncubationScheduler | null;
  readonly morphTracks: MorphTrackRegistry | null;
  readonly library: ResolverOptions["library"];
  readonly distribution: Distribution | null;
  readonly phases: PhaseSequencer | null;
  readonly rng: Rng | null;
  readonly genomes: ResolverOptions["genomes"];
  readonly whenOpen: ((when: Record<string, unknown>) => boolean) | null;

  constructor(opts: ResolverOptions) {
    this.traits = opts.traits;
    this.attributes = opts.attributes;
    this.trace = new TraceRing(opts.traceCapacity);
    this.incubation = opts.incubation ?? null;
    this.morphTracks = opts.morphTracks ?? null;
    this.library = opts.library ?? null;
    this.distribution = opts.distribution ?? null;
    this.phases = opts.phases ?? null;
    this.genomes = opts.genomes ?? null;
    this.rng = opts.rng ?? null;
    this.whenOpen = opts.whenOpen ?? null;
  }

  /**
   * The morph track an entry walks, or null (genome role-override > role map >
   * attribute track > progress-block track).
   */
  private _morphTrackId(subject: SubjectLike, instance: PartInstance, entry: PartAttributeEntry): string | null {
    if (!this.morphTracks) return null;
    const attr = this.attributes.get(entry.id);
    const byRole = attr?.morph_tracks_by_role?.[instance.role];
    const genomeTrack = (subject as { genomes?: string[] }).genomes
      ?.map((gid) => this.genomes?.get(gid)?.morph_role_tracks?.[instance.role])
      .find((t) => t && this.morphTracks!.has(t));
    const trackId = genomeTrack ?? byRole ?? attr?.morph_track ?? (entry.progress_block as ProgressBlock | undefined)?.morph_track;
    if (!trackId || !this.morphTracks.has(trackId)) return null;
    if (this.morphTracks.get(trackId)!.occupies_role !== instance.role) return null;
    return trackId;
  }

  /**
   * The progress an entry may reach while phases up to `phase` are open. A morph
   * track whose later steps belong to a later phase caps here, so a first-phase
   * track stops partway (e.g. "sharpening nails") and only continues once the next
   * phase opens (D-245).
   */
  private _phaseTarget(subject: SubjectLike, instance: PartInstance, entry: PartAttributeEntry, phase: number): number {
    const trackId = this._morphTrackId(subject, instance, entry);
    if (trackId) return Math.max(1, Math.round(this.morphTracks!.capForPhase(trackId, phase) * PROGRESS_MAX));
    return entry.target_progress ?? PROGRESS_MAX;
  }

  /**
   * The highest phase index whose every earlier phase is `PHASE_GATE` done. A phase
   * with no attributes of its own counts as done, so an empty phase (or a gap) never
   * wedges the gate shut (D-247).
   */
  private _openPhase(completion: Map<number, number>): number {
    const max = completion.size > 0 ? Math.max(...completion.keys()) : 0;
    let open = 0;
    for (let p = 0; p <= max; p++) {
      if ((completion.get(p) ?? 1) >= PHASE_GATE) open = p + 1;
      else break;
    }
    return open;
  }

  /** Fraction of a phase's attributes that have reached their (phase-aware) target. */
  private _phaseCompletion(subject: SubjectLike): Map<number, number> {
    const totals = new Map<number, { done: number; all: number }>();
    for (const instance of subject.body.allInstances()) {
      for (const entry of instance.attributes) {
        const p = entry.phase_index;
        if (p === undefined) continue;
        const b = totals.get(p) ?? { done: 0, all: 0 };
        b.all += 1;
        if (entry.progress >= this._phaseTarget(subject, instance, entry, p)) b.done += 1;
        totals.set(p, b);
      }
    }
    const out = new Map<number, number>();
    for (const [p, b] of totals) out.set(p, b.all === 0 ? 1 : b.done / b.all);
    return out;
  }

  tick(subject: SubjectLike, ticks = 1, rateMult = 1, onsetMult = 1): { ready: unknown[]; events: TickEvent[] } {
    const ready = this.incubation ? this.incubation.advance(ticks) : [];
    const events: TickEvent[] = [];
    // phase gate: an attribute in phase N only grows once every earlier phase is
    // substantially done — ordering without a hard-coded delay (D-202).
    const completion = this._phaseCompletion(subject);
    const openPhase = this._openPhase(completion);
    const gateOpen = (phase: number | undefined): boolean => {
      if (phase === undefined) return true;
      return phase <= openPhase;
    };
    const stability = readStability(subject);
    // live exposure from body progress (R6): computed **per phase**, counting only
    // entries in *earlier* phases, so a phase that itself raises exposure is not
    // gated on the exposure it would create (no deadlock).
    const deepestByPhase = new Map<number, { sum: number; n: number }>();
    for (const instance of subject.body.allInstances()) {
      for (const a of instance.attributes) {
        const p = a.phase_index;
        if (p === undefined) continue;
        const b = deepestByPhase.get(p) ?? { sum: 0, n: 0 };
        b.sum += a.progress / 1000;
        b.n += 1;
        deepestByPhase.set(p, b);
      }
    }
    const exposureBefore = (phase: number): number => {
      let sum = 0;
      let n = 0;
      for (const [p, b] of deepestByPhase) if (p < phase) { sum += b.sum; n += b.n; }
      return n === 0 ? 0 : (sum / n) * 100;
    };
    // a phase may carry a `when` gate (D-248): e.g. later lycan phases wait for the
    // moon. Evaluated once per tick (the world state does not change within it).
    const whenOpen = (when: Record<string, unknown> | undefined): boolean =>
      !when || !this.whenOpen ? true : this.whenOpen(when);
    const feral = Boolean((subject as { feral?: { locked?: boolean } }).feral?.locked);
    for (const instance of subject.body.allInstances()) {
      for (const entry of instance.attributes) {
        const block = entry.progress_block as ProgressBlock | undefined;
        if (!block) continue;
        // the cap: a morph track's later steps wait for their phase (D-245), so a
        // first-phase track stops partway (at "sharpening nails") until phase 2 opens.
        const cap = Math.min(entry.target_progress ?? PROGRESS_MAX, this._phaseTarget(subject, instance, entry, openPhase));
        if (entry.progress >= cap) continue;
        if (!gateOpen(entry.phase_index)) continue;
        // a feral-only or exposure-gated phase waits for its condition (R6)
        if (entry.phase_feral_only && !feral) continue;
        if ((entry.phase_exposure_min ?? 0) > exposureBefore(entry.phase_index ?? 0)) continue;
        // a `when`-gated phase waits for its condition (D-248): a lycan's later
        // phases only advance under the moon, so a bite's first phase still lands.
        if (!whenOpen(entry.phase_when)) continue;
        // a jittered onset (D-219): parts scheduled this dose do not all begin at
        // once; a random few-tick delay staggers first application, so a whole
        // tier does not bulk-apply. Once moving, its own progress jitter keeps it
        // out of lockstep with its neighbours. The delay burns down under the
        // temporal rate (D-H02), so a compress or a pace knob speeds the whole
        // schedule, not just the ticks after a part starts.
        if ((entry.start_delay ?? 0) > 0) {
          entry.start_delay = (entry.start_delay ?? 0) - ticks * onsetMult;
          continue;
        }
        const doseMult = (entry.dose_mult ?? 1) * rateMult;
        const before = entry.progress;
        // a small per-tick jitter so parts move unevenly but never out of order
        const jitter = this.rng ? 0.7 + this.rng.next("transform") * 0.6 : 1;
        const delta = growthDelta(block, entry.progress, doseMult, stability, ticks, jitter);
        entry.progress = Math.min(cap, Math.max(0, Math.round(entry.progress + delta)));
        const stages = this.attributes.get(entry.id)?.stages ?? block.stages;
        const beforeStage = stageIndexFor(stages, before / PROGRESS_MAX);
        const afterStage = stageIndexFor(stages, entry.progress / PROGRESS_MAX);
        entry.stage_index = afterStage;
        if (afterStage !== beforeStage) {
          const crossings = crossedStages(stages, beforeStage, afterStage);
          const pain = painFromCrossings(crossings);
          if (pain > 0 && subject.stats && typeof subject.stats.pain === "number") {
            subject.stats.pain = Math.min(100, subject.stats.pain + pain);
          }
          events.push({
            slot: instance.slot,
            attribute: entry.id,
            from: beforeStage,
            to: afterStage,
            stageName: stages?.[afterStage]?.name ?? null,
            pain,
          });
        }
      }
    }
    if (this.morphTracks) {
      this._fireMorphTracks(subject, events);
    }
    return { ready, events };
  }

  private _fireMorphTracks(subject: SubjectLike, events: TickEvent[]): void {
    if (!this.library || !this.morphTracks) return;
    for (const instance of subject.body.allInstances()) {
      for (const entry of instance.attributes) {
        // a per-entry chain (D-202, e.g. species genitals) walks by progress; it
        // needs no registered track and works on any socket.
        if (entry.morph_chain && entry.morph_chain.length >= 2) {
          const target = chainPart(entry.morph_chain, entry.progress / 1000);
          if (target && instance.id !== target) {
            const template = this.library.get(target);
            if (template) {
              const from = instance.id;
              instance.template = template as PartInstance["template"];
              instance.integrity = Math.min(instance.integrity, template.integrity ?? 100);
              events.push({ slot: instance.slot, attribute: entry.id, from: 0, to: 0, stageName: null, pain: 0, morph: "morph.species_genital", ...{ fromPart: from, toPart: target } } as TickEvent);
            }
          }
          continue;
        }
        const attr = this.attributes.get(entry.id);
        const byRole = attr?.morph_tracks_by_role?.[instance.role];
        // a genome may override the role's track (D-202): a shared muzzle driver
        // lands a species' own head, not one hardcoded track.
        const genomeTrack = (subject as { genomes?: string[] }).genomes
          ?.map((gid) => this.genomes?.get(gid)?.morph_role_tracks?.[instance.role])
          .find((t) => t && this.morphTracks!.has(t));
        const trackId = genomeTrack ?? byRole ?? attr?.morph_track ?? (entry.progress_block as ProgressBlock | undefined)?.morph_track;
        if (!trackId || !this.morphTracks.has(trackId)) continue;
        if (this.morphTracks.get(trackId)!.occupies_role !== instance.role) continue;
        const target = this.morphTracks.partAt(trackId, entry.progress / 1000);
        if (target && instance.id !== target) {
          const template = this.library.get(target);
          const from = instance.id;
          if (template) {
            instance.template = template as PartInstance["template"];
            instance.integrity = Math.min(instance.integrity, template.integrity ?? 100);
          }
          events.push({ slot: instance.slot, attribute: entry.id, from: 0, to: 0, stageName: null, pain: 0, morph: trackId, ...{ fromPart: from, toPart: target } } as TickEvent);
        }
      }
    }
  }

  applyInjector(
    subject: SubjectLike,
    injector: { id?: string; type: string; genome_reference?: string | null; base_dose?: number; onset_curve?: string; incubation_seconds?: number; subtype?: string; effects?: unknown[] },
    dose = 1.0,
    options: { genome?: Genome; desireFor?: ((tags: readonly string[]) => number) | null } = {},
  ): InjectorResult {
    if (!subject || !injector) {
      throw new ContentError("resolver: subject and injector are required");
    }
    if (injector.type === "stabilizing") {
      return this._applyStabilizer(subject, injector, dose);
    }
    if (injector.type === "chemical") {
      return this._applyChemical(subject, injector, dose);
    }

    const genome = options.genome;
    if (!genome) {
      throw new ContentError(`resolver: no genome for injector "${injector.id}"`, "injectors.json");
    }

    const coverage = computeCoverage(injector, genome, dose);
    const candidates = expandCandidates(subject, genome, coverage, this.traits, this.attributes);
    const trace = resolveConflicts(candidates);
    const applied: AppliedWinner[] = [];
    let winners = this.distribution
      ? this.distribution.distribute(trace.winners, { rng: this.rng, genomeId: genome.id, coverage, guaranteed: (id) => this.attributes.get(id)?.guaranteed === true })
      : trace.winners;
    // Transformation sequencing (§14, M14.5): place winners in ordered phases and
    // spread them within a phase by a tempo read from her body and history.
    if (this.phases) {
      winners = this.phases.schedule(winners, genome, tempoOf(subject, dose), this.rng);
    }

    for (const winner of winners) {
      const targetProgress = Math.round(clamp(winner.coverage, 0, 1) * 1000);
      const entry = winner.inst.addAttribute(winner.attr.id, 0);
      entry.progress_block = progressBlockFor(winner.attr) as ProgressBlock;
      // a re-dose keeps the further target (never lowers) (D-202)
      if (targetProgress > (entry.target_progress ?? 0)) entry.target_progress = targetProgress;
      entry.dose_mult = dose;
      // her desire pulls a wanted part faster, an aversion holds it back (M15.5e);
      // a per-part rate nudge, so it says nothing about *whether* it happens (D-202)
      if (options.desireFor) {
        const want = options.desireFor([...(winner.attr.tags ?? []), ...(winner.inst.tags ?? [])]);
        if (want !== 1) entry.dose_mult = dose * want;
      }
      // the phase gate (not a delay) is what holds a part back
      if (winner.phaseIndex !== undefined && entry.phase_index === undefined) entry.phase_index = winner.phaseIndex;
      if (winner.phaseFeralOnly !== undefined) entry.phase_feral_only = winner.phaseFeralOnly;
      if (winner.phaseExposureMin !== undefined) entry.phase_exposure_min = winner.phaseExposureMin;
      // a `when` gate (D-248): hold the entry until the caller's world state holds
      if (winner.phaseWhen) entry.phase_when = winner.phaseWhen;
      // a jittered onset (D-219): stagger first application so parts scheduled in
      // the same phase do not all fire at once; preserve an existing delay on re-dose.
      if (entry.start_delay === undefined) {
        const base = (winner as { delay?: number }).delay ?? 0;
        // rng when present; else a stable hash of the slot so onsets still stagger
        const jitter = this.rng ? this.rng.int("transform", 0, ONSET_JITTER_TICKS) : stableJitter(winner.inst.slot);
        entry.start_delay = base + jitter;
      }
      // species genitals (D-202): give the entry its own [from..via..to] chain so
      // the socket morphs by progress, visibly, instead of snapping at the end.
      if (winner.attr.id === "attr.species_genital" && this.library && !entry.morph_chain) {
        const morph = genitalMorphFor(genome, winner.inst, this.library, subject.baseGender ?? "female");
        if (morph) entry.morph_chain = morph.chain;
      }
      const cost = strain(winner.inst, winner.attr, winner.coverage, readStability(subject));
      winner.inst.setIntegrity(winner.inst.integrity - cost);
      if (this.incubation && injector.type === "mutagenic") {
        this.incubation.schedule({
          slot: winner.inst.slot,
          attributeId: winner.attr.id,
          genomeId: genome.id,
          onsetCurve: injector.onset_curve ?? "linear",
          incubationSeconds: injector.incubation_seconds ?? 0,
          coverage: winner.coverage,
          dose,
        });
      }
      applied.push({
        slot: winner.inst.slot,
        attribute: winner.attr.id,
        progress: 0,
        targetProgress,
        strain: cost,
        delay: winner.delay ?? 0,
        ...(winner.phaseId !== undefined ? { phaseIndex: winner.phaseIndex, phaseId: winner.phaseId } : {}),
      });
    }

    if (trace.log.length > 0) {
      this.trace.pushAll(trace.log.map((entry) => ({ ...entry, coverage, injector: injector.id })));
    }

    writeStability(subject, clamp(readStability(subject) - (genome.stability_cost ?? 0) * Math.pow(dose, 1.3), 0, 100));

    return {
      injector: injector.id ?? null,
      genome: genome.id,
      dose,
      coverage,
      winners: applied,
      trace: trace.log,
      stability: readStability(subject),
    };
  }

  private _applyChemical(subject: SubjectLike, injector: { id?: string; effects?: unknown[] }, dose: number): InjectorResult {
    return {
      injector: injector.id ?? null,
      genome: null,
      dose,
      coverage: 0,
      chemical: true,
      winners: [],
      effects: injector.effects ?? [],
      trace: [],
      stability: readStability(subject),
    };
  }

  private _applyStabilizer(subject: SubjectLike, injector: { id?: string; subtype?: string; genome_reference?: string | null }, dose: number): InjectorResult {
    const reverter = injector.subtype === "reverter" || injector.genome_reference === "genome.human_baseline";
    const affected: AppliedWinner[] = [];
    for (const instance of subject.body.allInstances()) {
      for (const attr of instance.attributes) {
        if (reverter) {
          attr.progress = 0;
          attr.stage_index = 0;
        }
        affected.push({ slot: instance.slot, attribute: attr.id, progress: attr.progress, targetProgress: attr.target_progress ?? 0, strain: 0, delay: 0 });
      }
    }
    return {
      injector: injector.id ?? null,
      genome: injector.genome_reference ?? null,
      dose,
      coverage: 0,
      stabilizing: true,
      reverter,
      winners: affected,
      trace: [],
      stability: readStability(subject),
    };
  }
}

export interface AppliedWinner {
  slot: string;
  attribute: string;
  progress: number;
  targetProgress: number;
  strain: number;
  delay: number;
  phaseIndex?: number;
  phaseId?: string;
}

export interface InjectorResult {
  injector: string | null;
  genome: string | null;
  dose: number;
  coverage: number;
  winners: AppliedWinner[];
  trace: unknown[];
  stability: number;
  chemical?: boolean;
  stabilizing?: boolean;
  reverter?: boolean;
  effects?: unknown[];
}

export function createResolver(opts: ResolverOptions): Resolver {
  return new Resolver(opts);
}
