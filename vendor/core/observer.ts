import type { SubjectStatId } from "./stats";

/**
 * The Observer (blueprint §3.5, §11.5). Divergence D-095: the reference's
 * in-world `Player` becomes the unseen **Observer**. It keeps the reference's
 * limited stats + wellbeing (useful as the "how sharp is your touch" model),
 * and gains **charge** — the pacing lever that replaces action slots.
 */
export const OBSERVER_VERSION = 1;

export const OBSERVER_STATS = Object.freeze([
  { id: "insight", range: [0, 100], source: "base; sharpens power previews" },
  { id: "finesse", range: [0, 100], source: "base; steadies a dose" },
  { id: "focus", range: [0, 100], source: "base; holds a scene steady" },
]);

export const OBSERVER_WELLBEING = Object.freeze([
  { id: "energy", range: [0, 100], source: "power cost, rest" },
  { id: "hunger", range: [0, 100], source: "blocks, meals" },
  { id: "health", range: [0, 100], source: "events, recovery" },
]);

export const OBSERVER_STAT_IDS = Object.freeze(OBSERVER_STATS.map((s) => s.id));
export const OBSERVER_WELLBEING_IDS = Object.freeze(OBSERVER_WELLBEING.map((s) => s.id));

/** Skills that grow through play (S67). All three feed the touch/read model. */
export const OBSERVER_SKILLS = Object.freeze(["insight", "finesse", "focus"] as const);
export type ObserverSkill = (typeof OBSERVER_SKILLS)[number];

/** Skill growth: xp to the next point rises with the current value (diminishing). */
export const SKILL_GAIN_BASE = 2;
export const SKILL_GAIN_STEP = 0.25;
export const SKILL_MAX = 100;

export function skillThreshold(value: number): number {
  return SKILL_GAIN_BASE + value * SKILL_GAIN_STEP;
}

export const DEFAULT_CHARGE_MAX = 100;
export const DEFAULT_CHARGE_REGEN_PER_TICK = 1;

export const WELLBEING_TICK = Object.freeze({ energy: -3, hunger: 2, health: 0 });

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface ObserverOptions {
  id?: string;
  stats?: Record<string, number>;
  wellbeing?: Record<string, number>;
  skillXp?: Record<string, number>;
  charge?: number;
  chargeMax?: number;
  chargeRegenPerTick?: number;
}

export class Observer {
  version = OBSERVER_VERSION;
  readonly id: string;
  readonly stats: Record<string, number>;
  readonly wellbeing: Record<string, number>;
  /** Accumulated xp toward the next point of each skill (S67). */
  readonly skillXp: Record<string, number>;
  charge: number;
  readonly chargeMax: number;
  readonly chargeRegenPerTick: number;

  constructor(opts: ObserverOptions) {
    this.id = opts.id ?? "observer";
    this.chargeMax = opts.chargeMax ?? DEFAULT_CHARGE_MAX;
    this.charge = Math.max(0, Math.min(this.chargeMax, opts.charge ?? this.chargeMax));
    this.chargeRegenPerTick = opts.chargeRegenPerTick ?? DEFAULT_CHARGE_REGEN_PER_TICK;
    this.stats = { insight: 55, finesse: 50, focus: 50, ...(opts.stats ?? {}) };
    this.wellbeing = { energy: 100, hunger: 0, health: 100, ...(opts.wellbeing ?? {}) };
    this.skillXp = { insight: 0, finesse: 0, focus: 0, ...(opts.skillXp ?? {}) };
  }

  hasCharge(cost: number): boolean {
    return this.charge >= cost;
  }

  spendCharge(cost: number): number {
    this.charge = Math.max(0, this.charge - cost);
    return this.charge;
  }

  regenCharge(ticks = 1): number {
    this.charge = Math.min(this.chargeMax, this.charge + this.chargeRegenPerTick * ticks);
    return this.charge;
  }

  adjustWellbeing(id: string, delta: number): number {
    if (!(id in this.wellbeing)) {
      throw new Error(`observer: unknown wellbeing stat "${id}"`);
    }
    this.wellbeing[id] = clampStat(this.wellbeing[id]! + delta);
    return this.wellbeing[id]!;
  }

  adjustStat(id: string, delta: number): number {
    if (!(id in this.stats)) {
      throw new Error(`observer: unknown stat "${id}"`);
    }
    this.stats[id] = clampStat(this.stats[id]! + delta);
    return this.stats[id]!;
  }

  /**
   * Learn from doing (S67): xp accrues toward the next point of a skill; the cost
   * rises with the value, so a sharp skill sharpens slowly. Returns true on a point.
   */
  gainSkill(skill: ObserverSkill, xp = 1): boolean {
    if (!(skill in this.skillXp)) return false;
    if ((this.stats[skill] ?? 0) >= SKILL_MAX) {
      this.skillXp[skill] = 0;
      return false;
    }
    this.skillXp[skill] = (this.skillXp[skill] ?? 0) + xp;
    let gained = false;
    while ((this.stats[skill] ?? 0) < SKILL_MAX && this.skillXp[skill]! >= skillThreshold(this.stats[skill]!)) {
      this.skillXp[skill] = this.skillXp[skill]! - skillThreshold(this.stats[skill]!);
      this.stats[skill] = clampStat(this.stats[skill]! + 1);
      gained = true;
    }
    return gained;
  }

  /** Progress (0..1) toward the next point of a skill, for the read. */
  skillProgress(skill: ObserverSkill): number {
    const value = this.stats[skill] ?? 0;
    if (value >= SKILL_MAX) return 1;
    return clampUnit((this.skillXp[skill] ?? 0) / skillThreshold(value));
  }

  dosingPrecision(): number {
    const energy = this.wellbeing.energy! / 100;
    const hunger = this.wellbeing.hunger! / 100;
    return clampUnit(0.5 + 0.5 * energy - 0.3 * hunger);
  }

  /**
   * How steady the Observer's touch is (0..1): finesse carries a dose straight,
   * focus holds the read steady, rested-and-fed sharpens it, a straining Observer
   * scatters it (§11.5, §25).
   */
  touchSteadiness(): number {
    const finesse = (this.stats.finesse ?? 50) / 100;
    const focus = (this.stats.focus ?? 50) / 100;
    return clampUnit(0.25 + 0.3 * finesse + 0.15 * focus + 0.3 * this.dosingPrecision());
  }

  /** The fractional dose scatter at the current steadiness (fraction of the dose). */
  doseScatter(): number {
    return Number(((1 - this.touchSteadiness()) * 0.3).toFixed(4));
  }

  /** A steadied dose: scatter applied against the "outcome" stream (deterministic). */
  scatterDose(dose: number, roll: number): { dose: number; offset: number } {
    const mag = this.doseScatter();
    const offset = (roll * 2 - 1) * mag;
    const next = Math.max(0.05, dose * (1 + offset));
    return { dose: Number(next.toFixed(4)), offset: Number(offset.toFixed(4)) };
  }

  /** The Observer's own small life: rest when spent, eat when empty (§11.5). */
  dailyCare(): void {
    if (this.wellbeing.energy! < 45) this.rest();
    if (this.wellbeing.hunger! > 55) this.eat();
  }

  rest(): Record<string, number> {
    this.adjustWellbeing("energy", 60);
    this.adjustWellbeing("hunger", 10);
    this.adjustWellbeing("health", 10);
    return this.wellbeing;
  }

  eat(): Record<string, number> {
    this.adjustWellbeing("hunger", -50);
    this.adjustWellbeing("energy", 20);
    return this.wellbeing;
  }

  tick(): Record<string, number> {
    this.adjustWellbeing("energy", WELLBEING_TICK.energy);
    this.adjustWellbeing("hunger", WELLBEING_TICK.hunger);
    this.adjustWellbeing("health", WELLBEING_TICK.health);
    this.regenCharge(1);
    return this.wellbeing;
  }

  toJSON(): Record<string, unknown> {
    return {
      version: this.version,
      id: this.id,
      charge: this.charge,
      chargeMax: this.chargeMax,
      stats: { ...this.stats },
      wellbeing: { ...this.wellbeing },
      skillXp: { ...this.skillXp },
    };
  }
}

export function createObserver(opts: ObserverOptions = {}): Observer {
  return new Observer(opts);
}

export type ObserverStatId = SubjectStatId | string;
