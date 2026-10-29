import { ContentError, indexById } from "./loader";
import type { Rng } from "./rng";
import type { Town, AgentState } from "./town";

/**
 * Town events (M16b, §47). Scheduled and emergent events — a neighbour's barbecue,
 * a fair, a power cut — that place agents together and produce a scene. They exist
 * **independently of the transformation**, so the world feels alive and a change
 * lands *into* a life. An event **resolves even if the subject is absent** (§47).
 *
 * Events are data (`town_events.json`); a resolution is a durable line plus the
 * bond deltas it left between those who attended.
 */
export const TOWN_EVENT_VERSION = 1;

export interface TownEventDef {
  id: string;
  label: string;
  /** Locations the event happens at (usually one). */
  where: string[];
  /** Blocks it may start. */
  window: string[];
  /** Daily chance to start when in-window and not already run today. */
  chance: number;
  /** Chance to reappear within the same week (a fair recurs; a power cut does not). */
  weekly?: boolean;
  /** How many blocks it lasts. */
  duration_blocks: number;
  /** Households whose members are pulled toward it (empty = gathering draws all). */
  draws?: string[];
  /** Per-attendee bond deltas: keyed by relationship type, default applied to all. */
  bond?: Record<string, number>;
  /** Resolution templates; `{here}`, `{subject}` interpolated. */
  lines: string[];
}

export interface TownEventState {
  id: string;
  def: string;
  where: string;
  block: string;
  /** Ticks until it resolves (counts down on each block). */
  remaining: number;
  attendees: string[];
  resolved: boolean;
}

export class TownEventRegistry {
  private readonly byId: Map<string, TownEventDef>;

  constructor(list: TownEventDef[]) {
    for (const e of list) {
      if (typeof e.id !== "string" || !Array.isArray(e.where) || e.where.length === 0) {
        throw new ContentError(`town event "${e.id ?? "?"}" needs an id and a where`, "town_events.json");
      }
    }
    this.byId = indexById(list, "town_events.json");
  }

  get(id: string): TownEventDef | null {
    return this.byId.get(id) ?? null;
  }
  all(): TownEventDef[] {
    return [...this.byId.values()];
  }
  /** Events that may start in this block. */
  inWindow(block: string): TownEventDef[] {
    return this.all().filter((e) => e.window.includes(block));
  }
}

export function buildTownEventRegistry(data: unknown): TownEventRegistry {
  const list = (data as { events?: unknown } | null | undefined)?.events;
  if (!Array.isArray(list)) throw new ContentError('town_events.json must declare an "events" array', "town_events.json");
  return new TownEventRegistry(list as TownEventDef[]);
}

export interface TownEventResolution {
  def: TownEventDef;
  /** Who was there when it resolved — the world, not the subject's frame. */
  attendees: string[];
  /** The subject attended (she was pulled by her own life, or chose to be). */
  subjectPresent: boolean;
  line: string;
  /** Bond deltas left behind, keyed `observer->target`. */
  bonds: Array<{ observer: string; to: string; delta: number }>;
}

/**
 * The event layer for a town. Holds live events, starts them on a seeded roll,
 * applies their gravity to the schedule, and resolves them **whether or not the
 * subject is involved** (§47).
 */
export class TownEvents {
  readonly registry: TownEventRegistry;
  private readonly live: TownEventState[] = [];
  private readonly rng: Rng | null;
  /** last day each event ran, so a non-weekly event does not repeat same-day. */
  private readonly lastDay = new Map<string, number>();
  private nextId = 1;

  constructor(registry: TownEventRegistry, rng: Rng | null) {
    this.registry = registry;
    this.rng = rng;
  }

  active(): TownEventState[] {
    return this.live.filter((e) => !e.resolved);
  }
  all(): TownEventState[] {
    return [...this.live];
  }

  /** Is an event already running at this location? */
  activeAt(where: string): boolean {
    return this.active().some((e) => e.where === where);
  }

  /**
   * Start events for the block (a seeded roll). Non-weekly events are held to one
   * run per day; a weekly event (a fair) may recur but not on consecutive days.
   */
  startTick(town: Town, day: number, block: string): TownEventState[] {
    const started: TownEventState[] = [];
    for (const def of this.registry.inWindow(block)) {
      if (this.activeAt(def.where[0]!) || this.active().some((e) => e.def === def.id)) continue;
      const last = this.lastDay.get(def.id);
      const minGap = def.weekly ? 3 : 1;
      if (last !== undefined && day - last < minGap) continue;
      if (this.rng && !this.rng.chance("world", def.chance)) continue;
      const e: TownEventState = { id: `ev${this.nextId++}`, def: def.id, where: def.where[0]!, block, remaining: def.duration_blocks, attendees: [], resolved: false };
      this.live.push(e);
      this.lastDay.set(def.id, day);
      started.push(e);
      void town;
    }
    return started;
  }

  /** Pull agents toward a live event's location (the event's gravity, §47). */
  pull(town: Town, block: string): void {
    for (const e of this.active()) {
      const def = this.registry.get(e.def)!;
      if (!def.draws || def.draws.length === 0) continue;
      for (const state of town.all()) {
        if (state.household && def.draws.includes(state.household)) town.moveTo(state.id, e.where);
      }
    }
    void block;
  }

  /**
   * Advance live events one block; when an event's time is up it resolves. Returns
   * the resolutions this block. Attendance is read from *wherever agents are* —
   * so an event resolves fully even if the subject never came.
   */
  step(town: Town, subjectId: string, block: string): TownEventResolution[] {
    const done: TownEventResolution[] = [];
    for (const e of this.active()) {
      const def = this.registry.get(e.def)!;
      const here = town.all().filter((a) => a.at === e.where);
      if (here.length > 0) e.attendees = [...new Set([...e.attendees, ...here.map((a) => a.id)])];
      void block;
      e.remaining -= 1;
      if (e.remaining <= 0) {
        e.resolved = true;
        done.push(this.resolve(town, e, def, subjectId));
      }
    }
    return done;
  }

  private resolve(town: Town, e: TownEventState, def: TownEventDef, subjectId: string): TownEventResolution {
    const attendees = e.attendees.slice();
    const subjectPresent = attendees.includes(subjectId);
    const here = humanizeList(attendees.map((id) => town.def(id)?.name ?? id));
    const subjectName = town.def(subjectId)?.name ?? subjectId;
    const line = (this.rng ? this.rng.pick("world", def.lines) : def.lines[0]!).replace(/\{here\}/g, here || "no one").replace(/\{subject\}/g, subjectName);

    const bonds: Array<{ observer: string; to: string; delta: number }> = [];
    for (const a of attendees) {
      for (const b of attendees) {
        if (a === b) continue;
        const rel = town.bond(a, b);
        const delta = def.bond?.[rel?.type ?? "default"] ?? def.bond?.default ?? 1;
        if (delta === 0) continue;
        town.changeBond(a, b, delta, rel?.type ?? "acquaintance");
        bonds.push({ observer: a, to: b, delta });
      }
    }
    return { def, attendees, subjectPresent, line, bonds };
  }

  toJSON(): { live: TownEventState[]; lastDay: Array<[string, number]> } {
    return { live: this.live.map((e) => ({ ...e, attendees: [...e.attendees] })), lastDay: [...this.lastDay.entries()] };
  }

  adopt(json: ReturnType<TownEvents["toJSON"]> | undefined | null): void {
    if (!json) return;
    this.live.length = 0;
    for (const e of json.live ?? []) this.live.push({ ...e, attendees: [...e.attendees] });
    this.lastDay.clear();
    for (const [k, v] of json.lastDay ?? []) this.lastDay.set(k, v);
    this.nextId = this.live.length + 1;
  }
}

export function buildTownEvents(data: unknown, rng: Rng | null): TownEvents {
  return new TownEvents(buildTownEventRegistry(data), rng);
}

function humanizeList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type { AgentState };
