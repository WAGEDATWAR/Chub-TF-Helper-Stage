import { ContentError } from "./loader";
import { createBody, type Body } from "./body";
import { createStatBlock, clampStat, clampRange, SUBJECT_STATS, SUBJECT_STAT_IDS, fromFixedPoint } from "./stats";
import { computeExposure, bandFor, transformState, speechMultiplier, instinctOverrideActive, applyExposureBand } from "./exposure";
import { hormoneBalance, toFixedHormone, genitalProfile } from "./genital";
import { weightedHealth } from "./health";
import { deriveCapacities, capacitiesFromBody } from "./capacity";
import type { Skeleton } from "./skeleton";
import type { PartLibrary } from "./parts";
import type { AttributeRegistry } from "./attributes";
import { statModifiersFor, type GenomeRegistry } from "./genomes";
import type { Mind } from "./mind";
import type { Mood } from "./mood";
import { Preferences, createPreferences, reactionTypeFor } from "./preferences";
import type { CriteriaContext } from "./criteria";
import type { ExposureBandRegistry } from "./registries";
import type { PartAttributeEntry } from "./parts";
import type { Disposition, FormedReaction } from "./reactions";
import type { BeliefEntry, MemoryEntry } from "./perception";
import type { SelfPerception } from "./self_perception";
import type { FeralState } from "./feral";

export const SUBJECT_VERSION = 1;

export interface SubjectDerived {
  exposure: number;
  perSlot: Record<string, number>;
  band: string | null;
  transformState: string;
  genitalProfile: string;
  hormoneBalance: number;
  hormoneBalanceFixed: number;
  speechMultiplier: number;
  instinctOverride: boolean;
  globalHealth: number;
  /** Arousal floor (0..100) a body imposes (M15.5f). */
  arousalFloor: number;
  /** Derived permille capabilities (S76): what systems read instead of body parts. */
  capacities: import("./capacity").Capacities;
  /** Effective stats after the exposure band's mods (B: applyExposureBand consumed). */
  bandStats: Record<string, number>;
}

export interface SubjectOptions {
  id: string;
  displayName?: string | undefined;
  body: Body;
  stats: Record<string, number>;
  genomes?: string[] | undefined;
  genomesRegistry?: GenomeRegistry | null | undefined;
  exposureBands?: ExposureBandRegistry | null | undefined;
  attributeRegistry?: AttributeRegistry | null | undefined;
  personalitySeed?: string | null | undefined;
  dispositions?: Disposition[] | undefined;
  reactions?: FormedReaction[] | undefined;
  baseGender?: string | undefined;
  pronouns?: string | undefined;
  age?: number | null | undefined;
  height?: number | null | undefined;
  weight?: number | null | undefined;
  sexuality?: string | null | undefined;
  mind?: Mind | null | undefined;
  mood?: Mood | null | undefined;
}

export class Subject {
  version = SUBJECT_VERSION;
  readonly id: string;
  displayName: string;
  readonly body: Body;
  readonly stats: Record<string, number>;
  genomes: string[];
  genomesRegistry: GenomeRegistry | null;
  exposureBands: ExposureBandRegistry | null;
  attributeRegistry: AttributeRegistry | null;
  /** Capacity rules (S76): derived abilities from body tags/attrs. */
  capacityRegistry: import("./capacity").CapacityRegistry | null = null;
  personalitySeed: string | null;
  dispositions: Disposition[];
  reactions: FormedReaction[];
  /** Preferences + reaction log (M15.5c, D-184): authoritative; `reactions` is derived. */
  preferences: Preferences = createPreferences();
  baseGender: string;
  hormoneBalance = 0;
  /** Per-ability mastery (authoritative, §15). Latent memory survives reversion. */
  abilities: Record<string, { mastery: number; peak: number }> = {};
  /** What she *believes* about her own body, versus the truth (D-134). */
  know: Record<string, BeliefEntry> = {};
  /** A bounded decaying ring of notices (D-134). */
  memory: MemoryEntry[] = [];
  /** Counts that drive behaviour (familiarity per family, arcs). */
  familiarityClass: string | null = null;
  /** Per-family exposure counts — repeats are easier but blander (§23). */
  familiarity: Record<string, number> = {};
  /** How she reads her own change (coherence/dysmorphia/pride, §24). */
  self: SelfPerception | null = null;
  /** Feral lock and lock debt state (§19.2, §27). */
  feral: FeralState | null = null;
  /** The genome currently driving a feral lock, if any. */
  feralGenome: { feral_profile?: string | null } | null = null;
  /** Story arc (P7/D-071): has she begun to perceive the Observer? */
  flaggedPerceived = false;
  /** Creation fields (D-158): stored now, light mechanics wired later (D-163). */
  age: number | null = null;
  height: number | null = null;
  weight: number | null = null;
  /** Sexuality (D-166): a value linked into reactions/attraction where it fits. */
  sexuality: string | null = null;
  /**
   * How far her attraction has drifted from its baseline (-1..1), moved by the
   * transformation itself through the matrix + notice/accept (D-169). 0 = baseline.
   */
  sexualityDrift = 0;
  /** Genome stat modifiers already baked into `stats` (M15.5a, idempotent sync). */
  appliedGenomeMods: Record<string, number> = {};
  /** The mind model (M15.5a, D-173): mental values + settling targets + awareness. */
  mind: Mind | null = null;
  /** The named-emotion mood (M15.5a, D-174); the gamut is derived from it. */
  mood: Mood | null = null;
  derived: Partial<SubjectDerived> = {};
  pronouns?: string | undefined;
  dispositionWarnings?: string[];

  constructor(opts: SubjectOptions) {
    this.id = opts.id;
    this.displayName = opts.displayName ?? opts.id;
    this.body = opts.body;
    this.stats = opts.stats;
    this.genomes = opts.genomes ?? [];
    this.genomesRegistry = opts.genomesRegistry ?? null;
    this.exposureBands = opts.exposureBands ?? null;
    this.attributeRegistry = opts.attributeRegistry ?? null;
    this.personalitySeed = opts.personalitySeed ?? null;
    this.dispositions = opts.dispositions ?? [];
    this.reactions = opts.reactions ?? [];
    this.baseGender = opts.baseGender ?? "female";
    this.pronouns = opts.pronouns;
    this.age = opts.age ?? null;
    this.height = opts.height ?? null;
    this.weight = opts.weight ?? null;
    this.sexuality = opts.sexuality ?? null;
    this.mind = opts.mind ?? null;
    this.mood = opts.mood ?? null;
    this.recomputeDerived();
  }

  setStat(statId: string, value: number): number {
    if (!(SUBJECT_STAT_IDS as readonly string[]).includes(statId)) {
      throw new ContentError(`subject: unknown stat "${statId}"`, "subject");
    }
    this.stats[statId] = clampStat(value);
    return this.stats[statId]!;
  }

  adjustStat(statId: string, delta: number): number {
    return this.setStat(statId, (this.stats[statId] ?? 0) + delta);
  }

  getGenome(id: string): ReturnType<GenomeRegistry["get"]> {
    return this.genomesRegistry?.get(id) ?? null;
  }

  /**
   * The arousal floor a body imposes from its attributes (M15.5f). A whole-body
   * attribute (body heat) lands on many parts, so we take the max per attribute
   * (its coverage) rather than the sum, then combine additively across attributes.
   */
  attributeArousalFloor(): number {
    if (!this.attributeRegistry) return 0;
    const perAttr = new Map<string, number>();
    for (const inst of this.body.allInstances()) {
      for (const entry of inst.attributes) {
        const eff = this.attributeRegistry.get(entry.id)?.effects?.arousal_floor;
        if (typeof eff !== "number") continue;
        const covered = eff * (entry.progress / 1000);
        perAttr.set(entry.id, Math.max(perAttr.get(entry.id) ?? 0, covered));
      }
    }
    let floor = 0;
    for (const v of perAttr.values()) floor += v;
    return Math.min(1, floor);
  }

  /** A criteria context from the subject's own state (M15.5c2), for gated modifiers. */
  mindContext(): CriteriaContext {
    return {
      stats: this.stats,
      mind: this.mind ? Object.fromEntries(this.mind.ids().map((id) => [id, this.mind!.read(id)])) : {},
      awareness: this.mind?.awareness ?? 0,
      awarenessTier: this.mind?.tier() ?? "blind",
      moodValence: this.mood?.point().valence ?? 50,
      moodArousal: this.mood?.point().arousal ?? 30,
      moodBand: this.mood?.band() ?? "neutral-still",
      partTags: this.body.allInstances().flatMap((i) => i.tags),
      partRoles: this.body.allInstances().map((i) => i.role),
      flags: new Set<string>(),
      tick: 0,
      day: 1,
      realized: this.mind?.realized ?? false,
      memorySignificance: 0,
      alliesNear: false,
    };
  }

  /** Rebuild the legacy `reactions` view from crystallized preferences (M15.5c). */
  syncReactionsFromPreferences(): void {
    const seen = new Set<string>();
    const out: FormedReaction[] = [];
    for (const pref of this.preferences.all()) {
      const id = `react.${pref.topic.replace(/^topic\./, "")}`;
      seen.add(id);
      out.push({
        id,
        type: reactionTypeFor(pref),
        strength: Math.min(1, Math.abs(pref.opinion) / 100),
        awakenedAtTick: pref.settledAtTick,
        context: pref.tier,
        source: "disposition",
      });
    }
    // preserve legacy reactions without a preference (older saves)
    for (const r of this.reactions) if (!seen.has(r.id)) out.push(r);
    this.reactions = out;
  }

  /**
   * Bake carried-genome stat modifiers into the stats, idempotently (M15.5a): the
   * delta between the target modifier set and what is already applied is added, so
   * adding or losing a genome shifts stats without double-counting drift. Gated
   * modifiers (D-194) resolve against the subject's own state.
   */
  syncGenomeModifiers(): void {
    if (!this.genomesRegistry) return;
    const ctx = this.mindContext();
    const target = statModifiersFor(this.genomes, this.genomesRegistry, ctx);
    const keys = new Set([...Object.keys(target), ...Object.keys(this.appliedGenomeMods)]);
    for (const key of keys) {
      if (!(key in this.stats)) continue;
      const delta = (target[key] ?? 0) - (this.appliedGenomeMods[key] ?? 0);
      if (delta !== 0) this.stats[key] = clampRange((this.stats[key] ?? 0) + delta, 0, 100);
    }
    this.appliedGenomeMods = target;
  }

  recomputeDerived(): Partial<SubjectDerived> {
    this.syncGenomeModifiers();
    const { exposure, perSlot } = computeExposure(this.body, this.genomes, this.attributeRegistry);
    this.stats.exposure = exposure;
    this.hormoneBalance = hormoneBalance(this.body);
    // attribute effects (M15.5f, was dead): an arousal floor / drive pull from parts
    const floor = this.attributeArousalFloor();
    const band = this.exposureBands ? bandFor(this.exposureBands, exposure) : null;
    this.derived = {
      exposure,
      perSlot,
      band: band ? band.id : null,
      transformState: band ? transformState(band) : "baseline",
      genitalProfile: genitalProfile(this.body),
      hormoneBalance: this.hormoneBalance,
      hormoneBalanceFixed: toFixedHormone(this.hormoneBalance),
      speechMultiplier: speechMultiplier(band),
      instinctOverride: instinctOverrideActive(band),
      globalHealth: weightedHealth(this.body.allInstances()),
      arousalFloor: Math.round(floor * 100),
      capacities: deriveCapacities({ stats: this.stats, ...capacitiesFromBody(this.body) }, this.capacityRegistry),
      bandStats: applyExposureBand(this.stats, band),
    };
    return this.derived;
  }

  toJSON(): Record<string, unknown> {
    return {
      version: this.version,
      id: this.id,
      displayName: this.displayName,
      baseGender: this.baseGender,
      personalitySeed: this.personalitySeed,
      stats: { ...this.stats },
      genomes: [...this.genomes],
      dispositions: this.dispositions.map((d) => ({ ...d })),
      reactions: this.reactions.map((r) => ({ ...r })),
      abilities: Object.fromEntries(Object.entries(this.abilities).map(([id, s]) => [id, { ...s }])),
      know: Object.fromEntries(Object.entries(this.know).map(([id, b]) => [id, { ...b }])),
      memory: this.memory.map((m) => ({ ...m })),
      ...(this.self ? { self: { ...this.self } } : {}),
      ...(Object.keys(this.familiarity).length > 0 ? { familiarity: { ...this.familiarity } } : {}),
      ...(this.feral ? { feral: { ...this.feral } } : {}),
      ...(this.pronouns ? { pronouns: this.pronouns } : {}),
      ...(this.age !== null ? { age: this.age } : {}),
      ...(this.height !== null ? { height: this.height } : {}),
      ...(this.weight !== null ? { weight: this.weight } : {}),
      ...(this.sexuality ? { sexuality: this.sexuality } : {}),
      ...(this.sexualityDrift ? { sexualityDrift: this.sexualityDrift } : {}),
      ...(Object.keys(this.appliedGenomeMods).length > 0 ? { appliedGenomeMods: { ...this.appliedGenomeMods } } : {}),
      ...(this.mind ? { mind: this.mind.toJSON() } : {}),
      ...(this.mood ? { mood: this.mood.toJSON() } : {}),
      preferences: this.preferences.toJSON(),
      hormoneBalanceFixed: toFixedHormone(this.hormoneBalance),
      parts: this.body.allInstances().map((inst) => ({
        template: inst.id,
        slot: inst.slot,
        integrity: inst.integrity,
        flags: [...inst.flags],
        attributes: inst.attributes.map((a: PartAttributeEntry) => ({
          id: a.id,
          progress: a.progress,
          stage_index: a.stage_index,
          ...(a.target_progress !== undefined && a.target_progress !== a.progress ? { target_progress: a.target_progress } : {}),
          ...(a.dose_mult !== undefined ? { dose_mult: a.dose_mult } : {}),
          ...((a.start_delay ?? 0) > 0 ? { start_delay: a.start_delay } : {}),
          ...(a.phase_index !== undefined ? { phase_index: a.phase_index } : {}),
          // the phase gates must survive a reload, or a saved feral/exposure/`when`
          // change reopens and lands ahead of its phase (R6, D-248).
          ...(a.phase_feral_only ? { phase_feral_only: true } : {}),
          ...((a.phase_exposure_min ?? 0) > 0 ? { phase_exposure_min: a.phase_exposure_min } : {}),
          ...(a.phase_when ? { phase_when: a.phase_when } : {}),
          ...(a.morph_chain ? { morph_chain: a.morph_chain } : {}),
        })),
      })),
    };
  }
}

export interface CreateSubjectOptions {
  id?: string | undefined;
  displayName?: string | undefined;
  skeleton: Skeleton;
  library: PartLibrary;
  stats?: Record<string, number> | undefined;
  genomes?: string[] | undefined;
  genomesRegistry?: GenomeRegistry | null | undefined;
  exposureBands?: ExposureBandRegistry | null | undefined;
  attributeRegistry?: AttributeRegistry | null | undefined;
  personalitySeed?: string | null | undefined;
  dispositions?: Disposition[] | undefined;
  reactions?: FormedReaction[] | undefined;
  baseGender?: string | undefined;
  pronouns?: string | undefined;
  age?: number | null | undefined;
  height?: number | null | undefined;
  weight?: number | null | undefined;
  sexuality?: string | null | undefined;
  mind?: Mind | null | undefined;
  mood?: Mood | null | undefined;
}

export function createSubject(opts: CreateSubjectOptions): Subject {
  if (!opts.skeleton || !opts.library) {
    throw new ContentError("subject: skeleton and part library are required");
  }
  const body = createBody(opts.skeleton, opts.library);
  const stats = createStatBlock(SUBJECT_STATS, {
    intelligence: 50,
    strength: 50,
    agility: 50,
    endurance: 50,
    perception: 50,
    stability: 100,
    drive: 55,
    composure: 50,
    resonance: 50,
    ...(opts.stats ?? {}),
  });
  return new Subject({
    id: opts.id ?? "subject.default",
    displayName: opts.displayName,
    body,
    stats,
    genomes: opts.genomes,
    genomesRegistry: opts.genomesRegistry,
    exposureBands: opts.exposureBands,
    attributeRegistry: opts.attributeRegistry,
    personalitySeed: opts.personalitySeed,
    dispositions: opts.dispositions,
    reactions: opts.reactions,
    baseGender: opts.baseGender,
    pronouns: opts.pronouns,
    age: opts.age,
    height: opts.height,
    weight: opts.weight,
    sexuality: opts.sexuality,
    mind: opts.mind,
    mood: opts.mood,
  });
}

export { fromFixedPoint };
