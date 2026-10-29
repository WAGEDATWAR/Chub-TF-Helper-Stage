import { ContentError, indexById } from "./loader";
import { ReasonRing, buildReason } from "./reason";
import { MemoryStore, buildMemoryParams, type MemoryParams } from "./memory";
import type { Rng } from "./rng";

/**
 * Town simulation (M16a, §44/§46; S32-S34). A **world with weight**: townsfolk
 * with homes, needs that decay, an activity choice that is *scored* (not scripted),
 * and obligations whose failure is reachable. The focal subject runs on the same
 * machinery as everyone else, so a transformation genuinely disturbs a life.
 *
 * Discipline:
 *   - **single-writer** (S34): a position and every key quantity has one writer.
 *   - **needs are data** (S32): `rate`/`bounds`/`clamp`; a starved need abandons
 *     its current activity.
 *   - **obligations are data** (S33): a lateness window, a miss consequence, and a
 *     converging `leave` before the shift.
 */
export const TOWN_VERSION = 1;

export interface NeedDef {
  id: string;
  label: string;
  /** Decay per hour toward the lower bound. */
  rate: number;
  bounds: [number, number];
  /** Activity tags that satisfy this need. */
  met_by: string[];
  /** Activity-scoring weight of a deficit in this need. */
  weight: number;
  /** Below this, the need is "starved" and overrides other activities. */
  starve_below?: number;
}

export interface ActivityDef {
  id: string;
  label: string;
  tags: string[];
  block_pref: string[];
  where_kind: string;
  restores: number;
  duration_blocks: number;
  obligation?: boolean;
}

export class NeedRegistry {
  private readonly defs: Map<string, NeedDef>;
  readonly activities: Map<string, ActivityDef>;

  constructor(needs: NeedDef[], activities: ActivityDef[]) {
    this.defs = indexById(needs, "needs.json");
    this.activities = indexById(activities, "needs.json");
  }

  need(id: string): NeedDef | null {
    return this.defs.get(id) ?? null;
  }
  all(): NeedDef[] {
    return [...this.defs.values()];
  }
  activity(id: string): ActivityDef | null {
    return this.activities.get(id) ?? null;
  }
  allActivities(): ActivityDef[] {
    return [...this.activities.values()];
  }
}

export function buildNeedRegistry(data: unknown): NeedRegistry {
  const d = data as { needs?: unknown; activities?: unknown } | null | undefined;
  if (!Array.isArray(d?.needs)) throw new ContentError('needs.json must declare a "needs" array', "needs.json");
  if (!Array.isArray(d?.activities)) throw new ContentError('needs.json must declare an "activities" array', "needs.json");
  return new NeedRegistry(d.needs as NeedDef[], d.activities as ActivityDef[]);
}

export interface Relationship {
  to: string;
  type: string;
  bond: number;
}

export interface ScheduleEntry {
  block: string;
  activity: string;
  where?: string;
}

export interface AgentDef {
  id: string;
  name: string;
  archetype: string;
  /** Age in years (M16.5a); drives household coherence and body defaults. */
  age?: number;
  household?: string;
  home: string;
  needs?: Record<string, number>;
  relationships?: Relationship[];
  schedule?: ScheduleEntry[];
}

/** The live state of an agent — single-writer per field (S34). */
export interface AgentState {
  id: string;
  /** The location the agent is at (single writer: `moveTo`). */
  at: string;
  /** Live need values, keyed by need id (single writer: `decayNeeds`/`sate`). */
  needs: Record<string, number>;
  relationships: Relationship[];
  /** The household the agent belongs to (single writer: never after build). */
  household: string | null;
  /**
   * Per-observer, per-key familiarity (M16b, P2/Q5): how used to a kind of
   * change an observer is. Grows each time they react; tapers the next reaction.
   * Single writer: `bumpFamiliarity`.
   */
  familiarity: Record<string, number>;
  /** Durable memories this agent carries (S74); single writer: the MemoryStore. */
  memory: MemoryStore;
  /** The activity chosen this block (single writer: `chooseActivity`). */
  current: string | null;
  /** Ticks late on the current obligation, 0 when on time. */
  lateness: number;
  missed: number;
  /** Blocks until the agent converges on its next obligation (S33). */
  leaving: boolean;
  subject: boolean;
}

export interface TownSnapshot {
  agents: Array<{ id: string; name: string; at: string; current: string | null; lateness: number; subject: boolean }>;
}

export class Town {
  readonly needs: NeedRegistry;
  private readonly defs: Map<string, AgentDef>;
  private readonly states = new Map<string, AgentState>();
  private readonly rng: Rng | null;
  /** The reason a choice was made (S72); derived, never saved. */
  readonly reasons: ReasonRing;
  /** Memory parameters (S74). */
  readonly memoryParams: MemoryParams;
  /** The tick the town is at, so reasons are stamped (set by the caller). */
  tick = 0;

  constructor(needs: NeedRegistry, agents: AgentDef[], rng: Rng | null, reasons = new ReasonRing(), memoryParams: MemoryParams = buildMemoryParams({ memory: {} })) {
    this.needs = needs;
    this.defs = indexById(agents, "agents.json");
    this.rng = rng;
    this.reasons = reasons;
    this.memoryParams = memoryParams;
    for (const a of agents) {
      this.states.set(a.id, {
        id: a.id,
        at: a.home,
        needs: { ...(a.needs ?? {}) },
        relationships: (a.relationships ?? []).map((r) => ({ ...r })),
        household: a.household ?? null,
        familiarity: {},
        memory: new MemoryStore(memoryParams),
        current: null,
        lateness: 0,
        missed: 0,
        leaving: false,
        subject: false,
      });
    }
  }

  def(id: string): AgentDef | null {
    return this.defs.get(id) ?? null;
  }

  /** Name an agent (M16c focus selection): the subject is a *real* townsperson. */
  renameAgent(id: string, name: string): void {
    const def = this.defs.get(id);
    if (def) def.name = name;
  }
  state(id: string): AgentState | null {
    return this.states.get(id) ?? null;
  }
  all(): AgentState[] {
    return [...this.states.values()];
  }

  /** Mark an agent as the focal subject (D-064: the subject is a full agent). */
  markSubject(id: string): void {
    const s = this.states.get(id);
    if (s) s.subject = true;
  }

  private clampNeed(def: NeedDef, v: number): number {
    return Math.max(def.bounds[0], Math.min(def.bounds[1], v));
  }

  /** Decay every agent's needs one block. Single writer for need values (S34). */
  decayNeeds(hours = 4): void {
    for (const state of this.states.values()) {
      for (const def of this.needs.all()) {
        const cur = state.needs[def.id] ?? def.bounds[1];
        state.needs[def.id] = this.clampNeed(def, cur - def.rate * hours);
      }
    }
  }

  private sateNeeds(state: AgentState, activity: ActivityDef): void {
    for (const def of this.needs.all()) {
      if (!activity.tags.some((t) => def.met_by.includes(t))) continue;
      state.needs[def.id] = this.clampNeed(def, (state.needs[def.id] ?? def.bounds[0]) + activity.restores);
    }
  }

  /**
   * Score every activity for an agent and pick one (S32): deficit-weighted, with a
   * small seeded jitter and an id tie-break. A starved need overrides everything —
   * the agent abandons its plan to meet it.
   */
  chooseActivity(id: string, block: string): ActivityDef | null {
    const def = this.defs.get(id);
    const state = this.states.get(id);
    if (!def || !state) return null;

    const activities = this.needs.allActivities();
    const starved = this.needs.all().find((n) => n.starve_below !== undefined && (state.needs[n.id] ?? 100) < n.starve_below!);
    // dawn uses its own plan entry when authored (M16.5a), else the tail of night
    const planBlock = block === "dawn" && !def.schedule?.some((s) => s.block === "dawn") ? "night" : block;
    const scheduled = def.schedule?.find((s) => s.block === planBlock) ?? null;

    const score = (a: ActivityDef): number => {
      let s = 0;
      for (const n of this.needs.all()) {
        if (a.tags.some((t) => n.met_by.includes(t))) {
          const deficit = 1 - (state.needs[n.id] ?? 100) / 100;
          s += deficit * n.weight;
        }
      }
      if (a.block_pref.includes(block)) s += 0.35;
      if (scheduled && scheduled.activity === a.id) s += 2.5; // the day-plan dominates
      if (this.rng) s += this.rng.next("schedule") * 0.3; // seeded jitter
      return s;
    };

    if (starved) {
      const best = activities
        .filter((a) => a.tags.some((t) => starved.met_by.includes(t)))
        .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
      if (best) {
        this.reasons.add(id, this.tick, buildReason("town.chose_starved", "town", { need: starved.id.replace(/^need\./, ""), value: Math.round(state.needs[starved.id] ?? 0), activity: best.id }));
        return best;
      }
    }

    const ranked = activities.slice().sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const winner = ranked[0] ?? null;
    if (winner) {
      const scheduledWin = scheduled && scheduled.activity === winner.id;
      // a scheduled entry dominates; else it is a deficit-weighted pick
      if (scheduledWin) {
        this.reasons.add(id, this.tick, buildReason("town.chose_scheduled", "town", { activity: winner.id }));
      } else {
        const met = this.needs.all().filter((n) => winner.tags.some((t) => n.met_by.includes(t)))
          .map((n) => ({ need: n.id, deficit: Math.round((1 - (state.needs[n.id] ?? 100) / 100) * 100) }))
          .sort((a, b) => b.deficit - a.deficit)[0];
        this.reasons.add(id, this.tick, met
          ? buildReason("town.chose_deficit", "town", { activity: winner.id, need: met.need.replace(/^need\./, ""), deficit: met.deficit })
          : buildReason("town.chose_leisure", "town", { activity: winner.id, roll: this.rng ? this.rng.next("schedule").toFixed(2) : "0" }));
      }
    }
    return winner;
  }

  /** Resolve the location an activity happens at for an agent. */
  resolveWhere(state: AgentState, activity: ActivityDef, block: string): string {
    const def = this.defs.get(state.id)!;
    let scheduled = def.schedule?.find((s) => s.block === block && s.activity === activity.id);
    // dawn falls back to the night plan when the agent authors none (M16.5a)
    if (!scheduled && block === "dawn") scheduled = def.schedule?.find((s) => s.block === "night" && s.activity === activity.id);
    if (scheduled?.where) return scheduled.where;
    // an off-plan activity (a starved override) resolves by kind near home
    const kind = activity.where_kind;
    const byKind: Record<string, string> = { room: `${def.home}_kitchen`, work: "loc.office", public: "loc.cafe", outdoor: "loc.park" };
    return byKind[kind] ?? def.home;
  }

  /** Move an agent (single writer for `at`, S34) and return the new location. */
  moveTo(id: string, location: string): string {
    const state = this.states.get(id);
    if (!state) return location;
    state.at = location;
    return location;
  }

  /** Run one block for every agent: choose, converge, move, sate, track lateness. */
  stepBlock(block: string): void {
    for (const state of this.states.values()) {
      const activity = this.chooseActivity(state.id, block);
      if (!activity) continue;
      state.current = activity.id;
      const where = this.resolveWhere(state, activity, block);
      // an obligation makes the agent converge a block early (S33 `leave`)
      state.leaving = Boolean(activity.obligation);
      this.moveTo(state.id, where);
      this.sateNeeds(state, activity);
    }
  }

  /** Note the agent was late to an obligation. Single writer for lateness/missed. */
  noteLateness(id: string, ticks: number, window: number): { late: boolean; missed: boolean } {
    const state = this.states.get(id);
    if (!state) return { late: false, missed: false };
    state.lateness += ticks;
    if (state.lateness > window) {
      state.missed += 1;
      state.lateness = 0;
      return { late: true, missed: true };
    }
    return { late: state.lateness > 0, missed: false };
  }

  /** An observer's relationship to a target, if any. */
  bond(observer: string, to: string): Relationship | null {
    return this.states.get(observer)?.relationships.find((r) => r.to === to) ?? null;
  }

  /** How much an observer has *forgotten* about a target (S74 rollup, B2). */
  forgottenTrace(observer: string, about: string): number {
    return this.states.get(observer)?.memory.rollups.get(about)?.forgotten ?? 0;
  }

  /**
   * Change a bond by an **event**, not random drift (§45): a warm beat raises it,
   * a cold one lowers it. Creates the relationship if it does not exist yet (a
   * friendship can be *formed* — S11). Single writer for bond values.
   */
  changeBond(observer: string, to: string, delta: number, type = "acquaintance"): number {
    const state = this.states.get(observer);
    if (!state) return 0;
    let rel = state.relationships.find((r) => r.to === to);
    if (!rel) {
      rel = { to, type, bond: 50 };
      state.relationships.push(rel);
    }
    rel.bond = Math.max(0, Math.min(100, rel.bond + delta));
    return rel.bond;
  }

  /** An agent forms a memory (S74). Single writer: the agent's MemoryStore. */
  remember(agent: string, spec: Omit<import("./memory").MemorySpec, "tick"> & { tick?: number }): void {
    const state = this.states.get(agent);
    if (!state) return;
    state.memory.add({ ...spec, tick: spec.tick ?? this.tick });
  }

  /** How familiar an observer is with a reaction key (0 = first time). */
  familiarityOf(observer: string, key: string): number {
    return this.states.get(observer)?.familiarity[key] ?? 0;
  }

  /** Grow an observer's familiarity for a key; single writer (P2/Q5) — S34. */
  bumpFamiliarity(observer: string, key: string, amount = 1): number {
    const state = this.states.get(observer);
    if (!state) return 0;
    state.familiarity[key] = (state.familiarity[key] ?? 0) + amount;
    return state.familiarity[key]!;
  }

  /** The members of a household, keyed by household id (S45). */
  householdMembers(household: string): AgentState[] {
    return this.all().filter((s) => s.household === household);
  }

  /** Agents present at a location, excluding the given agent (an audience). */
  presentAt(location: string, except: string): AgentState[] {
    return this.all().filter((s) => s.at === location && s.id !== except);
  }

  snapshot(): TownSnapshot {
    return {
      agents: [...this.states.values()].map((s) => ({ id: s.id, name: this.defs.get(s.id)?.name ?? s.id, at: s.at, current: s.current, lateness: s.lateness, subject: s.subject })),
    };
  }

  toJSON(): { agents: Array<{ id: string; at: string; needs: Record<string, number>; current: string | null; lateness: number; missed: number; relationships: Relationship[]; familiarity: Record<string, number>; household: string | null; subject: boolean; memory: ReturnType<MemoryStore["toJSON"]> }> } {
    return {
      agents: [...this.states.values()].map((s) => ({ id: s.id, at: s.at, needs: { ...s.needs }, current: s.current, lateness: s.lateness, missed: s.missed, relationships: s.relationships.map((r) => ({ ...r })), familiarity: { ...s.familiarity }, household: s.household, subject: s.subject, memory: s.memory.toJSON() })),
    };
  }

  adopt(json: ReturnType<Town["toJSON"]> | undefined | null): void {
    if (!json) return;
    for (const a of json.agents ?? []) {
      const state = this.states.get(a.id);
      if (!state) continue;
      state.at = a.at;
      state.needs = { ...a.needs };
      state.current = a.current;
      state.lateness = a.lateness;
      state.missed = a.missed;
      state.relationships = a.relationships.map((r) => ({ ...r }));
      state.familiarity = { ...(a.familiarity ?? {}) };
      state.memory.adopt(a.memory);
      if (a.household !== undefined) state.household = a.household;
      state.subject = a.subject;
    }
  }
}

export function buildTown(needsData: unknown, agentsData: unknown, rng: Rng | null, memoryData?: unknown): Town {
  const needs = buildNeedRegistry(needsData);
  const agents = (agentsData as { agents?: unknown } | null | undefined)?.agents;
  if (!Array.isArray(agents)) throw new ContentError('agents.json must declare an "agents" array', "agents.json");
  const memoryParams = memoryData ? buildMemoryParams(memoryData) : undefined;
  return new Town(needs, agents as AgentDef[], rng, undefined, memoryParams);
}
