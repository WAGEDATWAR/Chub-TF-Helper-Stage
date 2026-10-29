import { ContentError, indexById } from "./loader";
import { evaluateCondition, type ConditionContext } from "./scene_graph";
import { displayValue } from "./narration";

/**
 * The event spine (blueprint §3.3, §3.0; D-135). One channel from simulation to
 * surface: the tick emits registered, causal events; a salience floor and a
 * per-path throttle turn the stream into a *story log*; a raw ring keeps
 * everything for tools and tests. Emitting an unregistered type is a hard error.
 * The producer returns strings and never touches a DOM (D-012).
 */

export const EVENT_VERSION = 1;

export interface EventMod {
  when: Record<string, unknown>;
  add: number;
}

export interface EventDef {
  type: string;
  /** Broad grouping (`life`, `town`, `social`, `change`), for filters and the journal. */
  category: string;
  base: number;
  mods: EventMod[];
  line: string;
  throttle: boolean;
  pathKeys: string[];
  /** Declared payload field names (a typed catalog, S75); validated on emit. */
  fields: string[];
}

export interface EventsConfig {
  floor: number;
  throttle_window: number;
  quiet_threshold: number;
}

export const DEFAULT_EVENTS_CONFIG: EventsConfig = Object.freeze({ floor: 0.5, throttle_window: 3, quiet_threshold: 12 });

export class EventRegistry {
  readonly config: EventsConfig;
  private readonly byType: Map<string, EventDef>;
  /** The typed catalog (S75): kind -> declared field set. */
  private readonly catalog = new Map<string, Set<string>>();

  constructor(data: unknown) {
    const d = data as { events?: unknown; config?: Partial<EventsConfig> } | null | undefined;
    if (!Array.isArray(d?.events)) throw new ContentError('events.json must declare an "events" array');
    this.config = { ...DEFAULT_EVENTS_CONFIG, ...(d?.config ?? {}) };
    const list = d!.events as Array<Record<string, unknown>>;
    const defs = list.map((e) => {
      const fields = (e.fields as string[] | undefined) ?? [];
      this.catalog.set(String(e.type), new Set(fields));
      return {
        id: String(e.type),
        type: String(e.type),
        category: typeof e.category === "string" ? e.category : "life",
        base: Number(e.base ?? 0.5),
        mods: (e.mods as EventMod[] | undefined) ?? [],
        line: typeof e.line === "string" ? e.line : "",
        throttle: e.throttle === true,
        pathKeys: (e.path_keys as string[] | undefined) ?? [],
        fields,
      };
    });
    this.byType = indexById(defs, "events.json");
  }

  /** Validate a payload against the catalog; returns unknown-field names (S75). */
  unknownFields(type: string, payload: Record<string, unknown>): string[] {
    const declared = this.catalog.get(type);
    if (!declared || declared.size === 0) return [];
    return Object.keys(payload).filter((k) => !declared.has(k));
  }

  categoryOf(type: string): string {
    return this.byType.get(type)?.category ?? "life";
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  get(type: string): EventDef | null {
    return this.byType.get(type) ?? null;
  }

  types(): string[] {
    return [...this.byType.keys()];
  }

  /** Base salience plus every modifier whose condition holds, clamped to 0..1. */
  salience(type: string, ctx: ConditionContext = {}): number {
    const def = this.byType.get(type);
    if (!def) return 0.5;
    let sal = def.base;
    for (const mod of def.mods) if (evaluateCondition(mod.when, ctx)) sal += mod.add;
    return Math.max(0, Math.min(1, sal));
  }
}

export function buildEventRegistry(data: unknown): EventRegistry {
  return new EventRegistry(data);
}

export interface EventRecord {
  id: number;
  tick: number;
  type: string;
  sal: number;
  at: number;
  pay: Record<string, unknown>;
  causes: number[];
}

export interface StoryLine {
  id: number;
  tick: number;
  day: number;
  type: string;
  sal: number;
  text: string;
  causes: number[];
  path: string;
  /** The raw payload, so a paragraph builder can read typed fields (D-215). */
  pay?: Record<string, unknown>;
}

export interface EmitOptions {
  causes?: number[];
  path?: string | null;
  final?: boolean;
  ctx?: ConditionContext;
}

const SINGULAR: Record<string, string> = {
  feet: "foot",
  hands: "hand",
  ears: "ear",
  eyes: "eye",
  nails: "nail",
  legs: "leg",
  arms: "arm",
  breasts: "breast",
  shoulders: "shoulder",
  hips: "hip",
  wings: "wing",
};

/** Humanize a payload token: strip a namespace prefix, read slots, un-snake. */
export function humanize(value: unknown): string {
  if (value === undefined || value === null) return "";
  // a slow variable (a fractional factor between -1 and 1) reads to 3 decimals
  if (typeof value === "number" && Math.abs(value) < 1 && value !== 0) return displayValue(value);
  let s = String(value);
  s = s.replace(/^(attr|genome|react|ability|part|obj|loc|scene|power)\./, "");
  // a slot ending in a side marker reads "left hand", "right foot"
  const side = /\.(L|R)$/.exec(s);
  if (side) {
    const body = s.slice(0, -2).split(".").pop() ?? s;
    const noun = SINGULAR[body] ?? body;
    s = `${side[1] === "L" ? "left" : "right"} ${noun}`;
  }
  return s.replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();
}

function interpolate(template: string, pay: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const v = (pay as Record<string, unknown>)[key];
    return v === undefined || v === null ? "" : humanize(v);
  });
}

export const RAW_RING_CAPACITY = 2000;
export const STORY_LOG_CAPACITY = 500;

export class EventBus {
  private readonly subscribers: Map<string, Array<(e: EventRecord) => void>>;
  private readonly ring: EventRecord[];
  private readonly story: StoryLine[];
  private readonly registry: EventRegistry | null;
  private nextId = 1;
  private quietTicks = 0;
  private tickProvider: () => number;
  private readonly ringCapacity: number;
  /** Called for each story line pushed (the canonical timeline mirrors these). */
  storySink: ((line: StoryLine) => void) | null = null;
  /** Called for EVERY emit (below-floor included), so the timeline drops nothing. */
  eventSink: ((line: StoryLine) => void) | null = null;
  /** When true, an emit with an undeclared payload field is a hard error (S75). */
  validatePayload = true;
  /** Applied to every salience by its event category (S77, the tone preset). */
  toneScaler: ((category: string, salience: number) => number) | null = null;
  /** Chooses the event line variant (S77, the graphic filter). Receives the def's
   *  base line + optional variants; returns the line to interpolate. */
  linePicker: ((def: EventDef) => string) | null = null;

  constructor(registry: EventRegistry | null = null, opts: { tick?: () => number; ringCapacity?: number } = {}) {
    this.subscribers = new Map();
    this.ring = [];
    this.story = [];
    this.registry = registry;
    this.ringCapacity = opts.ringCapacity ?? RAW_RING_CAPACITY;
    this.tickProvider = opts.tick ?? (() => 0);
  }

  setTickProvider(fn: () => number): void {
    this.tickProvider = fn;
  }

  /** Render an event's line, letting the graphic filter choose the variant (S77). */
  private lineFor(def: EventDef, payload: Record<string, unknown>): string {
    const template = this.linePicker ? this.linePicker(def) : def.line;
    if (template) return interpolate(template, payload);
    return typeof payload.message === "string" ? payload.message : "";
  }

  on(event: string, handler: (e: EventRecord) => void): () => void {
    const list = this.subscribers.get(event) ?? [];
    list.push(handler);
    this.subscribers.set(event, list);
    return () => this.off(event, handler);
  }

  off(event: string, handler: (e: EventRecord) => void): void {
    const list = this.subscribers.get(event) ?? [];
    this.subscribers.set(event, list.filter((h) => h !== handler));
  }

  /** Emit a registered event. Throws when a registry is present and the type is unknown. */
  emit(type: string, payload: Record<string, unknown> = {}, opts: EmitOptions = {}): EventRecord {
    const def = this.registry?.get(type) ?? null;
    if (this.registry && !def) {
      throw new ContentError(`event bus: unregistered event type "${type}"`, "events.json");
    }
    // catalog validation (S75): an unknown payload field is a loud error in dev.
    if (this.registry && def && this.validatePayload && payload && typeof payload === "object") {
      const unknown = this.registry.unknownFields(type, payload as Record<string, unknown>);
      if (unknown.length > 0) throw new ContentError(`event "${type}" carries undeclared field(s): ${unknown.join(", ")}`, "events.json");
    }
    const tick = this.tickProvider();
    const baseSal = this.registry ? this.registry.salience(type, opts.ctx ?? {}) : 0.5;
    // the tone preset scales likelihood by category; it never changes the record (S77)
    const sal = this.toneScaler && def ? this.toneScaler(def.category, baseSal) : baseSal;
    const record: EventRecord = {
      id: this.nextId++,
      tick,
      type,
      sal,
      at: this.story.length,
      pay: payload,
      causes: opts.causes ?? [],
    };
    this.ring.push(record);
    if (this.ring.length > this.ringCapacity) this.ring.shift();

    for (const handler of this.subscribers.get(type) ?? []) handler(record);
    for (const handler of this.subscribers.get("*") ?? []) handler(record);

    const storyable = def && this.passesFloor(def, record, opts);
    if (storyable) {
      this.pushStory(def, record, payload, opts);
    } else if (!this.registry) {
      // permissive mode (registry-less bus): always story
      this.pushStoryFallback(record, payload);
    }
    // mirror every emit into the timeline (a skip must account for all of them);
    // the event sink is only set by a session, so a bare bus stays cheap.
    if (this.eventSink && def) {
      this.eventSink({ id: record.id, tick: record.tick, day: Math.floor(record.tick / 24) + 1, type, sal: record.sal, text: this.lineFor(def, payload), causes: opts.causes ?? [], path: this.pathKey(def, opts, record), pay: payload });
    }
    this.quietTicks = 0;
    return record;
  }

  private passesFloor(def: EventDef, record: EventRecord, opts: EmitOptions): boolean {
    if (record.sal < this.registry!.config.floor) return false;
    if (!def.throttle) return true;
    if (opts.final) return true;
    const key = this.pathKey(def, opts, record);
    return !this.throttled(def, key, record.tick);
  }

  private pathKey(def: EventDef, opts: EmitOptions, record: EventRecord): string {
    if (opts.path) return `${def.type}:${opts.path}`;
    const parts = def.pathKeys.map((k) => String((record.pay as Record<string, unknown>)[k] ?? "")).filter(Boolean);
    return `${def.type}:${parts.join("|")}`;
  }

  private throttled(_def: EventDef, key: string, tick: number): boolean {
    const span = this.registry!.config.throttle_window;
    for (let i = this.story.length - 1; i >= 0; i--) {
      const line = this.story[i]!;
      if (tick - line.tick > span) break;
      if (line.path === key) return true;
    }
    return false;
  }

  private pushStory(def: EventDef, record: EventRecord, payload: Record<string, unknown>, opts: EmitOptions): void {
    const text = this.lineFor(def, payload);
    if (!text) return;
    const line: StoryLine = {
      id: record.id,
      tick: record.tick,
      day: Math.floor(record.tick / 24) + 1,
      type: record.type,
      sal: record.sal,
      text,
      causes: opts.causes ?? [],
      path: this.pathKey(def, opts, record),
      pay: payload,
    };
    this.story.push(line);
    if (this.story.length > STORY_LOG_CAPACITY) this.story.shift();
    this.storySink?.(line);
  }

  private pushStoryFallback(record: EventRecord, payload: Record<string, unknown>): void {
    const text = typeof payload.message === "string" ? payload.message : "";
    if (!text) return;
    this.story.push({ id: record.id, tick: record.tick, day: Math.floor(record.tick / 24) + 1, type: record.type, sal: 0.5, text, causes: [], path: record.type, pay: payload });
  }

  /** Call once per tick; fires `world.quiet` when the story has stalled. */
  noteTick(): void {
    this.quietTicks += 1;
    const threshold = this.registry?.config.quiet_threshold ?? DEFAULT_EVENTS_CONFIG.quiet_threshold;
    if (this.quietTicks >= threshold) {
      this.quietTicks = 0;
      this.emit("world.quiet", {}, { final: true });
    }
  }

  history(type: string | null = null): EventRecord[] {
    return type ? this.ring.filter((e) => e.type === type) : [...this.ring];
  }

  /** The raw ring: everything emitted. */
  raw(): EventRecord[] {
    return [...this.ring];
  }

  /** The story log: salience-gated, throttled, ready to read. */
  tale(): StoryLine[] {
    return [...this.story];
  }

  tail(n: number): StoryLine[] {
    return this.story.slice(-n);
  }

  /** Walk the causal chain from an event id back to its root. */
  chain(id: number): EventRecord[] {
    const byId = new Map(this.ring.map((e) => [e.id, e]));
    const out: EventRecord[] = [];
    const stack = [id];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const rec = byId.get(cur);
      if (!rec) continue;
      out.push(rec);
      for (const c of rec.causes) stack.push(c);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  toJSON(): { story: StoryLine[] } {
    return { story: this.story.map((l) => ({ ...l, causes: [...l.causes] })) };
  }

  loadJSON(json: { story?: StoryLine[] } | undefined): void {
    for (const line of json?.story ?? []) this.story.push({ ...line, causes: [...(line.causes ?? [])] });
  }
}

export function createEventBus(registry: EventRegistry | null, opts?: { tick?: () => number }): EventBus {
  return new EventBus(registry, opts);
}
