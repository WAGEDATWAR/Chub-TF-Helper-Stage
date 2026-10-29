import type { InterestLabel } from "./interest";

/**
 * The canonical timeline (blueprint §34; S67, D-170). The main text view is no
 * longer a scene-prose column plus a separate story log: it is **one ordered
 * walk** of what happened. A prose entry (a scene render, speech) is *context*;
 * events **interleave under their source entry** as attributed chips. The
 * timeline is non-visual and pure, so it is walkable for rewind, diffing and
 * (later) a graphical view.
 *
 * It is deliberately compact: entries store ids + already-composed prose, never
 * derived state. A marker (an `isInteresting` label) records a rewind point.
 */
export const TIMELINE_VERSION = 1;
/** Large enough to hold a full run without dropping a day's entries (D-215). */
export const TIMELINE_CAPACITY = 20000;

export type TimelineKind = "scene" | "speech" | "thought" | "event" | "status";

export interface TimelineEntry {
  id: number;
  tick: number;
  day: number;
  kind: TimelineKind;
  /** The composed prose (scene/speech) or the chip text (event/status). */
  text: string;
  /** The entry a chip is attributed to and shown under (null for a root entry). */
  parentId: number | null;
  /** A stable type key (scene id, event type), for filtering. */
  type: string;
  sal: number;
  /** Markers that fired at this entry's tick (rewind points, §29.4). */
  markers: InterestLabel[];
  /** The event payload, so a paragraph builder can read typed fields (D-215). */
  pay?: Record<string, unknown>;
}

export interface TimelineJSON {
  version: number;
  nextId: number;
  entries: TimelineEntry[];
}

export class Timeline {
  version = TIMELINE_VERSION;
  private readonly entries: TimelineEntry[] = [];
  private nextId = 1;
  private currentParentId: number | null = null;
  readonly capacity: number;

  constructor(capacity = TIMELINE_CAPACITY) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Open a prose entry; events until the next one attribute under it. */
  openEntry(kind: Extract<TimelineKind, "scene" | "speech" | "thought">, type: string, text: string, at: { tick: number; day: number; sal?: number }): TimelineEntry {
    // assembly runs on every render; if this exact entry already opened at this
    // tick, reuse it (and re-anchor events under it) rather than duplicating.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (e.tick !== at.tick) break;
      if (e.kind === kind && e.type === type && e.text === text) {
        this.currentParentId = e.id;
        return e;
      }
    }
    const entry = this.push(kind, type, text, at, null);
    this.currentParentId = entry.id;
    return entry;
  }

  /** Interleave an event/status chip under the current prose entry. */
  event(type: string, text: string, at: { tick: number; day: number; sal?: number; pay?: Record<string, unknown> }): TimelineEntry {
    return this.push("event", type, text, at, this.currentParentId);
  }

  private push(kind: TimelineKind, type: string, text: string, at: { tick: number; day: number; sal?: number; pay?: Record<string, unknown> }, parentId: number | null): TimelineEntry {
    const entry: TimelineEntry = {
      id: this.nextId++,
      tick: at.tick,
      day: at.day,
      kind,
      type,
      text,
      parentId,
      sal: at.sal ?? 0.5,
      markers: [],
      ...(at.pay ? { pay: at.pay } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      const dropped = this.entries.shift()!;
      // a child whose parent dropped is re-rooted so nothing orphans
      for (const e of this.entries) if (e.parentId === dropped.id) e.parentId = null;
      if (this.currentParentId === dropped.id) this.currentParentId = null;
    }
    return entry;
  }

  /** Record a rewind marker at a tick (deduped per label+tick). */
  mark(tick: number, label: InterestLabel): void {
    let best: TimelineEntry | null = null;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.tick <= tick) { best = this.entries[i]!; break; }
    }
    if (!best) return;
    if (!best.markers.includes(label)) best.markers.push(label);
  }

  all(): TimelineEntry[] {
    return this.entries.map((e) => ({ ...e, markers: [...e.markers] }));
  }

  /** Entries (roots + children) in order, for the surface. */
  walk(): TimelineEntry[] {
    return this.all();
  }

  /** Every root entry with its children attached, newest context first is *not* applied here. */
  roots(): Array<TimelineEntry & { children: TimelineEntry[] }> {
    const byId = new Map(this.entries.map((e) => [e.id, { ...e, markers: [...e.markers], children: [] as TimelineEntry[] }]));
    const roots: Array<TimelineEntry & { children: TimelineEntry[] }> = [];
    for (const e of byId.values()) {
      if (e.parentId === null || !byId.has(e.parentId)) roots.push(e);
      else byId.get(e.parentId)!.children.push(e);
    }
    return roots;
  }

  /** The last tick a marker was recorded at, per label — the rewind stops. */
  rewindTicks(): Array<{ tick: number; label: InterestLabel }> {
    const out: Array<{ tick: number; label: InterestLabel }> = [];
    for (const e of this.entries) for (const label of e.markers) out.push({ tick: e.tick, label });
    return out.sort((a, b) => a.tick - b.tick);
  }

  /** The nearest marker tick at or before `tick` (a rewind target), or null. */
  prevMarker(tick: number): { tick: number; label: InterestLabel } | null {
    let best: { tick: number; label: InterestLabel } | null = null;
    for (const m of this.rewindTicks()) if (m.tick <= tick) best = m;
    return best;
  }

  slice(loTick: number, hiTick: number): TimelineEntry[] {
    return this.all().filter((e) => e.tick >= loTick && e.tick <= hiTick);
  }

  /** Copy entries from another timeline into this one (rehydrate). */
  adopt(other: Timeline): void {
    this.entries.length = 0;
    for (const e of other.entries) this.entries.push({ ...e, markers: [...e.markers] });
    this.nextId = other.nextId;
    this.currentParentId = other.currentParentId;
  }

  toJSON(): TimelineJSON {
    return { version: this.version, nextId: this.nextId, entries: this.all() };
  }

  static fromJSON(json: TimelineJSON | null | undefined): Timeline {
    const t = new Timeline();
    if (!json) return t;
    t.nextId = json.nextId ?? (json.entries?.length ?? 0) + 1;
    for (const e of json.entries ?? []) t.entries.push({ ...e, markers: [...(e.markers ?? [])] });
    return t;
  }
}

export function createTimeline(capacity?: number): Timeline {
  return new Timeline(capacity);
}
