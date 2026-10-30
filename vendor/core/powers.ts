import { ContentError } from "./loader";
import { Resolver } from "./resolver";
import { applyGenitalPolicy, GENITAL_POLICIES, PRIMARY_PARTS, SECONDARY_PARTS } from "./genital";
import { sexualityBias } from "./sexuality";
import { slotDesire } from "./transformation_coupling";
import { tolerance, painPressure, stopCause, outcomeBand, responseComposureDelta, composureGateApplies } from "./consequence";
import { resistanceCeiling, stabilityDrain, familiarityMultipliers, recordExposure } from "./psychology";
import { compress, stretch, phaseShift } from "./temporal";
import { clampStat } from "./stats";
import { attemptAwakening, reactionsMatching, type FormedReaction } from "./reactions";
import { phaseWhenOpen } from "./mind_wiring";
import { fromHours } from "./time";
import type { Session } from "./session";
import type { ResolverRegistries } from "./types";
import type { Injector } from "./injectors";
import type { Genome } from "./genomes";
import type { AttributeRegistry } from "./attributes";

/** Onset span for a fresh dose, in minutes (D-292: was 40 hours). */
export const ONSET_TICKS = fromHours(40);
export const ONSET_MIN_TICKS = fromHours(12);
export const RESONANCE_FORGIVES_AT = 70;

/** The power palette (blueprint §11). A power is the Observer's verb; until M11
 *  deepens this, a `bestow` power is a thin wrapper of an `injector`. */
export const POWER_CATEGORIES = Object.freeze(["bestow", "temper", "hold", "unmake", "sway", "reveal"] as const);
export type PowerCategory = (typeof POWER_CATEGORIES)[number];

export const POWER_TARGETS = Object.freeze(["subject", "part", "object", "location", "scene"] as const);
export type PowerTargetKind = (typeof POWER_TARGETS)[number];

export interface PowerTarget {
  kind: PowerTargetKind;
  scope?: string;
}

export interface PowerEffect {
  stat: string;
  op: "add" | "multiply" | "set";
  value: number;
  scales_with?: "dose" | "none";
}

export interface PowerBacklash {
  if: string;
  threshold: number;
  note: string;
}

export interface Power {
  id: string;
  label: string;
  category: PowerCategory;
  genome?: string | null;
  target: PowerTarget;
  effects: PowerEffect[];
  cost: number;
  cooldownTicks: number;
  tier: number;
  unlocksOn?: { day_min?: number; discovered_genomes?: number } | undefined;
  backlash?: PowerBacklash | null | undefined;
  sway?: { op: string; field?: string; value?: string; state?: string } | undefined;
  reveal?: { mode: string; part?: string | null } | undefined;
  hold?: { ticks: number; scope: string } | undefined;
  unmake?: { mode: string } | undefined;
  temporal?: { mode: string; factor?: number; ticks?: number; hours?: number } | undefined;
}

/** Map an injector to a bestow/hold/unmake/temper power (§11.2 categories). */
export function powerFromInjector(injector: Injector): Power {
  const category: PowerCategory =
    injector.subtype === "stabilizer"
      ? "hold"
      : injector.type === "mutagenic"
        ? "bestow"
        : injector.type === "stabilizing"
          ? "unmake"
          : "temper";
  return {
    id: `power.${injector.id.replace(/^injector\./, "")}`,
    label: injector.display_name ?? injector.id,
    category,
    genome: injector.genome_reference ?? null,
    target: { kind: injector.type === "mutagenic" ? "subject" : "subject", scope: injector.subtype ?? "whole" },
    effects: (injector.effects ?? []).map((e) => ({ ...e })),
    cost: category === "bestow" ? 10 : 6,
    cooldownTicks: 3,
    tier: 1,
  };
}

interface RawPower {
  id: string;
  display_name: string;
  category: PowerCategory;
  target?: PowerTarget;
  effects?: PowerEffect[];
  cost?: { charge?: number };
  cooldown_ticks?: number;
  tier?: number;
  unlocks_on?: { day_min?: number; discovered_genomes?: number };
  backlash?: PowerBacklash;
  sway?: Power["sway"];
  reveal?: Power["reveal"];
  hold?: Power["hold"];
  unmake?: Power["unmake"];
  temporal?: Power["temporal"];
}

export class PowerRegistry {
  private readonly byId: Map<string, Power>;

  constructor(raw: readonly RawPower[]) {
    this.byId = new Map();
    for (const p of raw) {
      if (!(POWER_CATEGORIES as readonly string[]).includes(p.category)) {
        throw new ContentError(`power "${p.id}" has unknown category "${p.category}"`, "powers.json");
      }
      if (p.target && !(POWER_TARGETS as readonly string[]).includes(p.target.kind)) {
        throw new ContentError(`power "${p.id}" has unknown target "${p.target.kind}"`, "powers.json");
      }
      if (this.byId.has(p.id)) throw new ContentError(`duplicate power "${p.id}"`, "powers.json");
      this.byId.set(p.id, {
        id: p.id,
        label: p.display_name ?? p.id,
        category: p.category,
        genome: null,
        target: p.target ?? { kind: "subject", scope: "whole" },
        effects: p.effects ?? [],
        cost: p.cost?.charge ?? 5,
        cooldownTicks: p.cooldown_ticks ?? 0,
        tier: p.tier ?? 1,
        unlocksOn: p.unlocks_on,
        backlash: p.backlash ?? null,
        sway: p.sway,
        reveal: p.reveal,
        hold: p.hold,
        unmake: p.unmake,
        temporal: p.temporal,
      });
    }
  }

  get(id: string): Power | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Power[] {
    return [...this.byId.values()];
  }
}

export function buildPowerRegistry(data: unknown): PowerRegistry {
  const powers = (data as { powers?: unknown } | null | undefined)?.powers;
  if (!Array.isArray(powers)) throw new ContentError('powers.json must declare a "powers" array');
  return new PowerRegistry(powers as RawPower[]);
}

/** The full palette: authored powers plus a `bestow` power per mutagenic injector. */
export function buildPowerPalette(injectors: readonly Injector[], authored?: readonly Power[]): Power[] {
  const fromInjectors = injectors
    .filter((i) => i.type === "mutagenic" || i.type === "stabilizing")
    .map(powerFromInjector);
  const all = [...(authored ?? []), ...fromInjectors.filter((p) => p.category !== "hold")];
  return all.sort((a, b) => a.tier - b.tier || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

/** Targeting: does this power aim at a specific body slot? (§11.4) */
export function targetsPart(power: Power, slot: string): boolean {
  if (power.target.kind !== "part") return false;
  const scope = power.target.scope;
  if (!scope || scope === "whole") return true;
  return slot === scope || slot.startsWith(`${scope}.`);
}

/** Which tier-1 default powers a fresh Observer holds. */
export function isUnlocked(power: Power, ctx: { day: number; discovered: number }): boolean {
  const req = power.unlocksOn;
  if (!req) return power.tier <= 1;
  if (req.day_min !== undefined && ctx.day < req.day_min) return false;
  if (req.discovered_genomes !== undefined && ctx.discovered < req.discovered_genomes) return false;
  return true;
}

function noveltyFor(n: number): number {
  return Math.max(0.15, 1 - 0.12 * n);
}

export function magnitudeOf(injector: { base_dose?: number }, genome: { saturation_point?: number }, dose: number): number {
  return ((injector?.base_dose ?? 1) * dose) / (genome?.saturation_point ?? 1);
}

export function doseForMagnitude(injector: { base_dose?: number }, genome: { saturation_point?: number }, magnitude: number): number {
  return (magnitude * (genome?.saturation_point ?? 1)) / (injector?.base_dose ?? 1);
}

/** Reaction catalog entries the genome's tags trigger. */
export function reactionsTriggered(reactions: readonly FormedReaction[], catalogs: AttributeRegistry | null, tags: readonly string[], catalog: import("./registries").ReactionCatalog): FormedReaction[] {
  void catalogs;
  return reactionsMatching(reactions, catalog, tags);
}

export function reactionStopType(triggered: readonly FormedReaction[]): string | null {
  if (triggered.some((r) => r.type === "phobia")) return "phobia";
  if (triggered.some((r) => r.type === "hard")) return "hard";
  return null;
}

export function genitalPartFor(genome: Genome, library: { get(id: string): { tags?: string[] } | null }): string | null {
  // prefer the genome's own declared genital target (D-202): the exact species form
  // it plans, so a policy replace/swap lands *that* animal's anatomy, not a guess.
  for (const kind of ["penis", "vulva", "hemipenes"] as const) {
    const to = genome.genital?.[kind]?.to;
    if (to && library.get(to)) return to;
  }
  const tags = genome.limit_tags ?? [];
  for (const id of [...PRIMARY_PARTS, ...SECONDARY_PARTS]) {
    const template = library.get(id);
    if (!template || (template.tags ?? []).includes("human_tag")) continue;
    if ((template.tags ?? []).some((t) => tags.includes(t))) return id;
  }
  return null;
}

export interface PowerForecast {
  genome: string;
  injector: string;
  dose: number;
  doseRange: [number, number];
  estimate: { mean: number; sd: number; n: number; band: { low: number; high: number } | null };
  confidence: string;
  risk: string;
  zones: { safeUntil: number; overshootFrom: number } | null;
  landingPct: number;
  landingLabel: string;
  stabilityDrain: number;
  stabilityAfter: number;
  novelty: number;
  chargeAfter: number;
  /** How wide the Observer's own touch may land the dose (percent, 0 = exact). */
  touchSpread: number;
  /** The Observer's current touch steadiness (0..1). */
  steadiness: number;
  /** The genome's genital part, when it carries one, for a policy choice (§18). */
  genital: { part: string; label: string } | null;
}

export function forecastPower({ session, injector, genome, dose, chargeCost = 10, library = null }: { session: Session; injector: Injector; genome: Genome; dose: number; chargeCost?: number; library?: { get(id: string): { tags?: string[]; display_name?: string } | null } | null }): PowerForecast {
  if (!injector || !genome) throw new ContentError("power: injector and genome are required");
  const estimate = session.research.for(genome.id);
  const band = session.research.band(genome.id);
  const magnitude = magnitudeOf(injector, genome, dose);
  const [minDose, maxDose] = injector.dose_range ?? [0.1, 5];
  let risk = "unknown";
  let zones: PowerForecast["zones"] = null;
  if (band) {
    risk = magnitude < band.low ? "low" : magnitude < band.high ? "uncertain" : "likely";
    zones = {
      safeUntil: Math.max(minDose, Math.min(maxDose, doseForMagnitude(injector, genome, band.low))),
      overshootFrom: Math.max(minDose, Math.min(maxDose, doseForMagnitude(injector, genome, band.high))),
    };
  }
  const landing = Math.min(1, magnitude);
  const drain = stabilityDrain(genome.stability_cost ?? 0, dose);
  const stability = session.subject.stats.stability ?? 100;
  // the Observer reads her own hand (§11.5): a steady touch projects confidently,
  // a shaking one (tired, hungry, low finesse) downgrades the shown confidence.
  const steadiness = session.observer.touchSteadiness();
  const order = ["guess", "low", "medium", "high"] as const;
  let confidence: string = estimate.n === 0 ? "guess" : estimate.n < 3 ? "low" : estimate.n < 6 ? "medium" : "high";
  if (steadiness < 0.4) confidence = order[Math.max(0, order.indexOf(confidence as never) - 2)]!;
  else if (steadiness < 0.6) confidence = order[Math.max(0, order.indexOf(confidence as never) - 1)]!;
  return {
    genome: genome.id,
    injector: injector.id,
    dose,
    doseRange: [minDose, maxDose],
    estimate: { mean: estimate.mean, sd: estimate.sd, n: estimate.n, band: band ? { low: band.low, high: band.high } : null },
    confidence,
    risk,
    zones,
    landingPct: Math.round(landing * 100),
    landingLabel: landing >= 0.95 ? "full" : landing >= 0.5 ? "partial" : "light",
    stabilityDrain: Number(drain.toFixed(1)),
    stabilityAfter: Math.max(0, Math.round(stability - drain)),
    novelty: Number(noveltyFor(estimate.n).toFixed(2)),
    chargeAfter: Math.max(0, session.observer.charge - chargeCost),
    touchSpread: Number((session.observer.doseScatter() * 100).toFixed(1)),
    steadiness: Number(steadiness.toFixed(2)),
    genital: (() => {
      if (!library) return null;
      const partId = genitalPartFor(genome, library);
      return partId ? { part: partId, label: library.get(partId)?.display_name ?? partId.replace(/^part\./, "") } : null;
    })(),
  };
}

export interface CommitResult {
  genome: string;
  injector: string;
  dose: number;
  coverage: number;
  winners: unknown[];
  genital: { changes: unknown[]; policy: string; note?: string };
  triggeredReactions: Array<{ id: string; type: string }>;
  awakened: FormedReaction | null;
  frames: unknown[];
  stop: { cause: string; reactionType: string | null; pressure: number } | null;
}

/** Apply a temporal power (compress/stretch/phase, §27). */
function applyTemporal(session: Session, power: Power, dose: number): string {
  const mode = power.temporal?.mode ?? "compress";
  if (mode === "compress") {
    compress(session, power.temporal?.factor ?? 3, Math.round((power.temporal?.ticks ?? 48) * dose));
    session.bus.emit("temporal.shifted", { line: "the days race by" }, { final: true });
    return "she races through the change";
  }
  if (mode === "stretch") {
    stretch(session, power.temporal?.factor ?? 0.5, Math.round((power.temporal?.ticks ?? 72) * dose));
    session.bus.emit("temporal.shifted", { line: "the change slows and softens" }, { final: true });
    return "she draws the change out";
  }
  phaseShift(session, Math.round((power.temporal?.hours ?? 6) * dose));
  session.bus.emit("temporal.shifted", { line: "the hour turns" }, { final: true });
  return "the hour turns";
}

function resolverFrom(registries: ResolverRegistries, session: Session): Resolver {
  return new Resolver({
    traits: registries.traits,
    attributes: registries.attributes,
    incubation: session.incubation,
    morphTracks: registries.morphTracks,
    library: registries.library,
    distribution: registries.distribution ?? null,
    phases: registries.phases ?? null,
    genomes: registries.genomes ?? null,
    rng: session.rng,
    whenOpen: registries.whenOpen ?? phaseWhenOpen(session),
  });
}

export function commitPower({ session, registries, injector, genome, dose, policy = "preserve", ticks = ONSET_TICKS, cause = 0 }: {
  session: Session;
  registries: ResolverRegistries;
  injector: Injector;
  genome: Genome;
  dose: number;
  policy?: string;
  ticks?: number;
  cause?: number;
}): CommitResult {
  if (!session || !injector || !genome) throw new ContentError("power: session, injector and genome are required");
  if (!(GENITAL_POLICIES as readonly string[]).includes(policy)) throw new ContentError(`power: unknown genital policy "${policy}"`);
  const subject = session.subject;
  const stats = subject.stats;

  // Familiarity (§23): a repeated family is easier (less pain) but blander (less
  // novelty, hence less drive). This is the one novelty source for a commit.
  const family = genome.familiarity_class ?? genome.id;
  const exposures = subject.familiarity[family] ?? 0;
  const { painMult, noveltyMult } = familiarityMultipliers(exposures);
  subject.familiarity = recordExposure(subject.familiarity, family);
  const novelty = noveltyMult;
  // carry the genome so stat/mentality modifiers and exposure can read it
  if (!subject.genomes.includes(genome.id)) subject.genomes.push(genome.id);

  const resolver = resolverFrom(registries, session);
  const result = resolver.applyInjector(subject, injector as never, dose, { genome, desireFor: (tags) => slotDesire(session, tags) });

  for (const w of result.winners) {
    const entry = subject.body.get(w.slot)?.attributes.find((a) => a.id === w.attribute);
    if (entry && cause) entry.causes = [...(entry.causes ?? []), cause];
    session.bus.emit("attribute.applied", { slot: w.slot, attribute: w.attribute }, { path: `${w.slot}:${w.attribute}`, causes: cause ? [cause] : [] });
  }

  for (const effect of injector.effects ?? []) {
    if (!(effect.stat in stats)) continue;
    const scale = effect.scales_with === "dose" ? dose : 1;
    const value = effect.op === "multiply" ? effect.value : effect.value * (effect.stat === "pain" ? painMult : 1);
    stats[effect.stat] = clampStat(effect.op === "multiply" ? stats[effect.stat]! * effect.value : (stats[effect.stat] ?? 0) + value * scale);
  }
  stats.overload = clampStat((stats.overload ?? 0) + (genome.stability_cost ?? 0) * dose * novelty);
  stats.drive = clampStat((stats.drive ?? 0) + Math.round(6 * novelty));

  let genital: CommitResult["genital"] = { changes: [], policy };
  if (policy !== "preserve") {
    const partId = genitalPartFor(genome, registries.library);
    genital = partId
      ? (applyGenitalPolicy(subject.body, registries.library, partId, policy as never) as CommitResult["genital"])
      : { changes: [], policy, note: "this genome carries no genital part" };
    if (genital.changes.length > 0) {
      session.bus.emit("genital.changed", { policy, count: genital.changes.length }, { causes: cause ? [cause] : [] });
    }
  }

  // reaction effects: a matched fetish raises the ceiling (drive/arousal bump)
  const triggered = reactionsMatching(subject.reactions, registries.reactions, genome.limit_tags ?? []);
  for (const reaction of triggered.filter((r) => r.type === "fetish")) {
    const catalog = registries.reactions.get(reaction.id);
    stats.drive = clampStat((stats.drive ?? 0) + ((catalog?.drive_bonus as number) ?? 0));
    stats.arousal = clampStat((stats.arousal ?? 0) + ((catalog?.arousal_bonus as number) ?? 0));
  }

  subject.recomputeDerived();

  // Schedule the growth; the clock lands it (D-123). A power no longer resolves
  // its whole onset inside the commit call.
  session.resolver = resolver;

  // awakening (D-101, D-202): a reaction forms on what is *actually* being
  // changed — the species tags of the winning attributes — not the genome's
  // blanket promise, so a tail reaction waits for the tail to be growing in.
  const awakened = tryAwakening(session, registries, genome, stats, result.winners);

  session.research.recordTrial(genome.id, { dose, observedCoverage: result.coverage, safeCeiling: 1.0 });
  if (!session.progression.discoveredGenomes.includes(genome.id)) session.progression.discoveredGenomes.push(genome.id);
  session.journal.recordPower({ tick: session.clock.tick, day: session.clock.day, powerId: injector.id, genomeId: genome.id, coverage: result.coverage });
  session.markDirty();
  session.refresh();

  const reactionType = reactionStopType(triggered);
  const stop = stopCheck(session, reactionType);
  void ticks;
  return {
    genome: genome.id,
    injector: injector.id,
    dose,
    coverage: result.coverage,
    winners: result.winners,
    genital,
    triggeredReactions: triggered.map((r) => ({ id: r.id, type: r.type })),
    awakened,
    frames: [],
    stop,
  };
}

function tryAwakening(session: Session, registries: ResolverRegistries, genome: Genome, stats: Record<string, number>, winners: Array<{ slot: string; attribute: string }> = []): FormedReaction | null {
  if (!registries.reactions || !registries.dispositionTable) return null;
  // the tags of what is actually being scheduled: the winning attributes' tags
  // (the species intent) plus the changed parts' tags. A winner whose part is
  // still an *absent* placeholder is skipped, so a tail reaction waits until the
  // tail is really growing rather than firing the instant the mutagen lands.
  const changedTags: string[] = [];
  for (const w of winners) {
    const inst = session.subject.body.get(w.slot);
    if (inst && (inst.tags ?? []).includes("absent_tag")) continue;
    const attr = registries.attributes.get(w.attribute);
    if (attr?.tags) changedTags.push(...attr.tags);
    if (inst?.tags) changedTags.push(...inst.tags);
  }
  const tags = changedTags.length > 0 ? [...new Set(changedTags)] : (genome.limit_tags ?? []);
  // attraction is the pull of the change itself, nudged by whether the body is
  // drifting toward the sex she is drawn to (S68).
  const attractionBias = ((stats.resonance ?? 50) - 50) / 100 + ((stats.drive ?? 50) - 50) / 200 + sexualityBias(session.subject);
  const result = attemptAwakening(
    session.subject.dispositions,
    registries.reactions,
    registries.dispositionTable,
    {
      tick: session.clock.tick,
      tags,
      intense: (stats.pain ?? 0) > 40 || (stats.arousal ?? 0) > 50,
      novel: session.research.for(genome.id).n <= 1,
      private: true,
      witnessed: false,
      engineered: true,
      attractionBias,
    },
    session.rng,
  );
  if (!result) return null;
  const formed = result.reaction;
  // a reaction can only form once; a re-awakening deepens it rather than duplicating.
  const existing = session.subject.reactions.find((r) => r.id === formed.id);
  session.subject.dispositions = session.subject.dispositions.filter((d) => d.reactionId !== formed.id);
  if (existing) {
    existing.strength = Math.min(1, existing.strength + 0.15);
    session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `${formed.id} deepens [${formed.type}] to ${existing.strength.toFixed(2)}.` });
    return existing;
  }
  session.subject.reactions.push(formed);
  session.bus.emit("reaction.awakened", { reaction: formed.id, type: formed.type }, { ctx: session.conditionContext() as never });
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `A reaction awakens: ${formed.id} [${formed.type}].` });
  // provenance (R12): an awakening leaves a memory, so its card can show when/why
  session.town?.remember("subject", { type: "reaction.awakened", participants: [], severity: 3, impact: formed.type === "fetish" ? 5 : -5, topic: formed.id, summary_key: `reaction.${formed.id}` });
  return formed;
}

export function hasGrowthPending(subject: Session["subject"]): boolean {
  for (const inst of subject.body.allInstances()) {
    for (const a of inst.attributes) {
      if (a.progress_block && a.progress < (a.target_progress ?? a.progress)) return true;
    }
  }
  return false;
}

export interface PowerResolution {
  power: string;
  category: PowerCategory;
  chargeSpent: number;
  cooldownTicks: number;
  note: string;
  backlash: string | null;
  changed: string[];
  bestow: CommitResult | null;
}

function applyStatEffects(session: Session, effects: readonly PowerEffect[], dose: number, scaleBacklash: boolean): void {
  const stats = session.subject.stats;
  for (const effect of effects) {
    if (!(effect.stat in stats)) continue;
    const scale = effect.scales_with === "dose" ? dose : 1;
    const mult = scaleBacklash ? 1.5 : 1;
    stats[effect.stat] = clampStat(
      effect.op === "multiply"
        ? stats[effect.stat]! * (1 + (effect.value - 1) * mult)
        : (stats[effect.stat] ?? 0) + effect.value * scale * mult,
    );
  }
}

function backlashFires(session: Session, power: Power): boolean {
  const b = power.backlash;
  if (!b) return false;
  if (b.if === "stability_below") return (session.subject.stats.stability ?? 100) < b.threshold;
  return false;
}

/** Resolve any power by category (§11). `bestow` and `unmake` need a genome
 *  context; `sway` and `reveal` write the world/session overlay the composer reads. */
export function resolvePower(args: {
  session: Session;
  registries: ResolverRegistries;
  power: Power;
  dose: number;
  injector?: Injector | null;
  genome?: Genome | null;
  policy?: string;
  slot?: string | null;
}): PowerResolution {
  const { session, registries, power, dose } = args;
  if (!session) throw new ContentError("power: a session is required");
  if (!(POWER_CATEGORIES as readonly string[]).includes(power.category)) {
    throw new ContentError(`power: unknown category "${power.category}"`);
  }
  if (!session.observer.hasCharge(power.cost)) throw new ContentError(`power: no charge for "${power.id}"`);

  const now = session.clock.tick;
  const until = session.cooldowns.get(power.id) ?? 0;
  if (now < until) throw new ContentError(`power: "${power.id}" on cooldown for ${until - now} more tick(s)`);

  session.observer.spendCharge(power.cost);
  session.cooldowns.set(power.id, now + power.cooldownTicks);
  if (power.genome && !session.progression.discoveredGenomes.includes(power.genome)) {
    session.progression.discoveredGenomes.push(power.genome);
  }

  const backlash = backlashFires(session, power);
  const changed: string[] = [];
  let note = power.label;
  let bestow: CommitResult | null = null;

  // The causal root: everything this power causes carries this id (§3.3, D-135).
  const root = session.bus.emit("power.applied", { power: power.id, label: power.label, category: power.category, dose }, { ctx: session.conditionContext() as never });

  switch (power.category) {
    case "bestow": {
      if (!args.injector || !args.genome) throw new ContentError(`power "${power.id}": bestow needs an injector and genome`);
      // the Observer's touch is not perfect (§11.5): steadiness scatters the dose
      const steadied = session.observer.scatterDose(dose, session.rng.next("outcome"));
      const appliedDose = steadied.dose;
      bestow = commitPower({
        session,
        registries,
        injector: args.injector,
        genome: args.genome,
        dose: appliedDose,
        policy: args.policy ?? "preserve",
        cause: root.id,
      });
      for (const w of bestow.winners as Array<{ slot: string; attribute: string }>) changed.push(`${w.slot}:${w.attribute}`);
      note = `${power.label} at dose ${appliedDose.toFixed(1)}${Math.abs(steadied.offset) >= 0.02 ? ` (touch ${steadied.offset > 0 ? "+" : ""}${Math.round(steadied.offset * 100)}%)` : ""}`;
      break;
    }
    case "temper": {
      if (power.temporal) {
        note = applyTemporal(session, power, dose);
        break;
      }
      applyStatEffects(session, power.effects, dose, backlash);
      for (const e of power.effects) changed.push(e.stat);
      note = `${power.label}${backlash ? " (backlash)" : ""}`;
      break;
    }
    case "hold": {
      const ticks = power.hold?.ticks ?? fromHours(24);
      session.growthHoldUntil = Math.max(session.growthHoldUntil, now + ticks);
      applyStatEffects(session, power.effects, dose, false);
      note = `${power.label} for ${Math.round(ticks / 60)}h`;
      break;
    }
    case "unmake": {
      if (!session.resolver) session.resolver = resolverFrom(registries, session);
      if (!session.resolver) throw new ContentError(`power "${power.id}": no resolver`);
      if (power.unmake?.mode === "revert") {
        const r = session.resolver.applyInjector(session.subject, { id: power.id, type: "stabilizing", subtype: "reverter" }, dose);
        for (const w of r.winners) changed.push(`${w.slot}:${w.attribute}`);
        note = "reverted toward baseline";
      } else {
        for (const inst of session.subject.body.allInstances()) {
          for (const attr of inst.attributes) {
            attr.target_progress = 0;
            changed.push(`${inst.slot}:${attr.id}`);
          }
        }
        note = "crowned genomes dropped";
      }
      break;
    }
    case "sway": {
      if (power.temporal) {
        note = applyTemporal(session, power, dose);
        break;
      }
      const scene = session.currentLocation;
      const kind = power.sway?.op ?? "ambient";
      if (kind === "open") {
        const loc = args.slot ?? scene ?? "loc.home";
        session.world.open(loc);
        changed.push(`open:${loc}`);
        note = `opened ${loc}`;
        session.bus.emit("world.ambient", { line: `a door opens to ${loc}` }, { causes: [root.id] });
      } else if (kind === "object_state") {
        const obj = args.slot ?? "obj.base";
        session.world.setObjectState(obj, power.sway?.state ?? "shifted");
        changed.push(`object:${obj}`);
        note = `${obj} shifted`;
        session.bus.emit("world.ambient", { line: `the ${obj.replace(/^obj\./, "").replace(/_/g, " ")} shifts` }, { causes: [root.id] });
      } else {
        const loc = args.slot ?? scene ?? "loc.home";
        const field = power.sway?.field ?? "light";
        session.world.setAmbient(loc, { [field]: power.sway?.value ?? "" } as never);
        changed.push(`ambient:${loc}.${field}`);
        note = `${loc} ${field} changed`;
        session.bus.emit("world.ambient", { line: `the ${field} turns to ${power.sway?.value ?? "something else"}` }, { causes: [root.id] });
      }
      break;
    }
    case "reveal": {
      const part = power.reveal?.part ?? args.slot ?? null;
      session.reveal = { mode: power.reveal?.mode ?? "magnify", part };
      changed.push(`reveal:${part ?? "scene"}`);
      note = power.reveal?.mode === "sight" ? "sight opens on her mind" : `magnifying ${part ?? "the body"}`;
      break;
    }
    default:
      break;
  }

  session.journal.recordPower({
    tick: session.clock.tick,
    day: session.clock.day,
    powerId: power.id,
    genomeId: power.genome ?? power.id,
    coverage: 0,
  });
  if (power.category !== "bestow") {
    session.bus.emit("power.resolved", { power: power.id, category: power.category, note }, { causes: [root.id], ctx: session.conditionContext() as never });
  }
  session.markDirty();
  session.refresh();
  return { power: power.id, category: power.category, chargeSpent: power.cost, cooldownTicks: power.cooldownTicks, note, backlash: backlash ? power.backlash!.note : null, changed, bestow };
}

export function stopCheck(session: Session, reactionType: string | null = null): { cause: string; reactionType: string | null; pressure: number } | null {
  const stats = session.subject.stats;
  const exposure = session.subject.derived.exposure ?? 0;
  const tol = tolerance({ ...stats, exposure } as never);
  const pressure = painPressure(stats.pain ?? 0, tol);
  const base = resistanceCeiling({ drive: stats.drive ?? 0, composure: stats.composure ?? 0, exposure });
  // her mind's counter-effort (B3) lowers the ceiling: the harder she resists,
  // the sooner a change stops her. The two "resistance" notions now meet here.
  const mindResist = session.subject.mind?.resistance ?? 0;
  // a formed fetish raises the ceiling (R4); a phobia/hard reaction adds a panic
  // risk floor so it can raise resistance even at zero pressure (R3).
  const ceiling = Math.max(10, base + fetishCeilingBonus(session) - mindResist * 0.3);
  const cause = stopCause({ reactionType, overload: stats.overload ?? 0, ceiling, painPressure: pressure });
  const panic = panicRisk(session, reactionType);
  if (!cause && panic > 0 && session.rng.chance("outcome" as never, panic)) {
    return { cause: reactionType === "phobia" || reactionType === "hard" ? reactionType : "panic", reactionType, pressure: Number(pressure.toFixed(2)) };
  }
  return cause ? { cause, reactionType, pressure: Number(pressure.toFixed(2)) } : null;
}

/** The ceiling lift a formed fetish adds on the genome's limit tags (R4). */
function fetishCeilingBonus(session: Session): number {
  const catalog = session.reactionCatalog;
  if (!catalog) return 0;
  let bonus = 0;
  for (const r of session.subject.reactions) {
    if (r.type !== "fetish") continue;
    bonus += (catalog.get(r.id) as { ceiling_bonus?: number } | undefined)?.ceiling_bonus ?? 0;
  }
  return bonus;
}

/** The panic risk of a matched reaction at the current pressure (R3). */
function panicRisk(session: Session, reactionType: string | null): number {
  const catalog = session.reactionCatalog;
  if (!catalog || (reactionType !== "phobia" && reactionType !== "hard")) return 0;
  let risk = 0;
  for (const r of session.subject.reactions) {
    if (r.type !== "phobia" && r.type !== "hard") continue;
    risk = Math.max(risk, (catalog.get(r.id) as { panic_risk?: number } | undefined)?.panic_risk ?? 0);
  }
  return risk;
}

function normalise(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
  const out: Record<string, number> = {};
  for (const [k, w] of Object.entries(weights)) out[k] = Math.round((w / total) * 100);
  return out;
}

function tableFor(response: string, pressure: number, table: outcomeBandTable) {
  const band = outcomeBand(pressure, table);
  if (response !== "force") return band;
  const index = table.indexOf(band);
  return table[Math.min(table.length - 1, index + 1)]!;
}

type outcomeBandTable = Array<{ max_pressure: number; weights: Record<string, number> }>;

const RESPONSE_COPY: Record<string, string> = {
  comfort: "ease off entirely; pain fades twice as fast, nothing gained",
  ease: "hold at 60%; pain eased",
  press: "keep going; outcome rolls on the pressure table",
  force: "force past; worse table, double payoff on success",
};

export function stopMatrix({ session, consequence, reactionType = null }: { session: Session; consequence: { pressOutcomes: outcomeBandTable }; reactionType?: string | null }) {
  const stats = session.subject.stats;
  const exposure = session.subject.derived.exposure ?? 0;
  const tol = tolerance({ ...stats, exposure } as never);
  const pressure = painPressure(stats.pain ?? 0, tol);
  const ceiling = Math.max(10, resistanceCeiling({ drive: stats.drive ?? 0, composure: stats.composure ?? 0, exposure }) + fetishCeilingBonus(session));
  const cause = stopCause({ reactionType, overload: stats.overload ?? 0, ceiling, painPressure: pressure }) ?? "pain";
  const table = consequence.pressOutcomes;
  const gate = composureGateApplies(stats.composure ?? 50, { pressingPast: true });
  const forgives = (stats.resonance ?? 0) >= RESONANCE_FORGIVES_AT;
  const options = ["comfort", "ease", "press", "force"].map((response) => {
    let delta = responseComposureDelta(response, { gate: response === "press" || response === "force" ? gate : false });
    if (delta < 0 && forgives) delta = Math.ceil(delta / 2);
    const odds =
      response === "comfort"
        ? { comforted: 100 }
        : response === "ease"
          ? { eased: 100 }
          : table.length > 0
            ? normalise(tableFor(response, pressure, table).weights)
            : {};
    return { response, effect: RESPONSE_COPY[response], composureDelta: delta, odds, ineffective: response === "ease" && cause === "overload", gated: (response === "press" || response === "force") && gate };
  });
  return {
    cause,
    reactionType,
    pressure: Number(pressure.toFixed(2)),
    tolerance: Number((tol / 100).toFixed(2)),
    headroom: Math.round(tol - (stats.pain ?? 0)),
    overload: stats.overload ?? 0,
    ceiling: Math.round(ceiling),
    composure: stats.composure ?? 0,
    resonance: stats.resonance ?? 0,
    pain: stats.pain ?? 0,
    gate,
    forgives,
    options,
  };
}

export function applyStopResponse({ session, consequence, response, reactionType = null, roll = 0.5 }: { session: Session; consequence: { pressOutcomes: outcomeBandTable }; response: string; reactionType?: string | null; roll?: number }) {
  const subject = session.subject;
  const stats = subject.stats;
  const matrix = stopMatrix({ session, consequence, reactionType });
  const option = matrix.options.find((o) => o.response === response);
  if (!option) throw new ContentError(`power: unknown stop response "${response}"`);
  let outcome: string | null = response === "comfort" ? "comforted" : response === "ease" ? "eased" : null;
  if (!outcome) {
    const weights = Object.entries(option.odds);
    let threshold = roll * 100;
    outcome = weights[weights.length - 1]?.[0] ?? "good";
    for (const [k, pct] of weights) {
      threshold -= pct;
      if (threshold <= 0) {
        outcome = k;
        break;
      }
    }
  }
  const payoff = response === "force" ? 2 : 1;
  stats.composure = clampStat((stats.composure ?? 0) + option.composureDelta);
  switch (outcome) {
    case "comforted":
      stats.pain = clampStat(Math.round((stats.pain ?? 0) * 0.5));
      break;
    case "eased":
      if (!option.ineffective) stats.pain = clampStat(Math.round((stats.pain ?? 0) * 0.6));
      break;
    case "good":
      stats.drive = clampStat((stats.drive ?? 0) + 3 * payoff);
      stats.resonance = clampStat((stats.resonance ?? 0) + payoff);
      break;
    case "strain":
      stats.pain = clampStat((stats.pain ?? 0) + 5);
      break;
    case "spasm":
      stats.pain = clampStat((stats.pain ?? 0) + 10);
      stats.stability = clampStat((stats.stability ?? 100) - 5);
      break;
    case "damage": {
      const worst = [...subject.body.allInstances()].sort((a, b) => b.attributes.length - a.attributes.length)[0];
      if (worst) {
        worst.setIntegrity(Math.max(0, worst.integrity - 10));
        if (!worst.flags.includes("inflamed")) worst.flags.push("inflamed");
      }
      break;
    }
    case "blackout":
      stats.pain = 0;
      stats.composure = clampStat((stats.composure ?? 0) - 5);
      // a blackout forces the change back (R5, §28): active attributes recede
      for (const inst of subject.body.allInstances()) {
        for (const a of inst.attributes) a.progress = 0;
      }
      session.bus.emit("attribute.reverted", { slot: "*", attribute: "*" }, { final: true });
      break;
    default:
      break;
  }
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `Resistance (${matrix.cause}): ${response} -> ${outcome}.` });
  session.markDirty();
  session.refresh();
  return { response, outcome, composureDelta: option.composureDelta, cause: matrix.cause };
}
