import type { Session } from "./session";
import { hourOf } from "./time";
import type { TimelineEntry } from "./timeline";
import { humanize } from "./events";
import { axesFor } from "./voice";
import { createRng, type Rng } from "./rng";
import { buildEntryProse, type EntryProse } from "./entry_prose";

/**
 * Composer V2 — the day view (D-215). Groups the canonical timeline into **days**;
 * within a day, entries are grouped by **moment** (one per tick/hour) so a scene,
 * a speech and any events at the same hour are one block with several paragraphs —
 * never several blocks repeating. A day also lists its changed values as chips.
 *
 * Nothing is derived twice: a paragraph reads live state (`entry_prose`); a chip
 * reads a real change event.
 */
export const DAY_VIEW_VERSION = 1;

export interface ChangedValue {
  label: string;
  from: number;
  to: number;
}

export interface DayEntry {
  id: number;
  tick: number;
  hour: number;
  kind: string;
  type: string;
  paragraphs: EntryProse["paragraphs"];
  text: string;
  /** The event chips at this moment (the ordered sub-timeline, minus prose). */
  chips: Array<{ id: number; type: string; text: string; kind: string }>;
  markers: string[];
  /** How many change notifications landed in this moment (D-220): a heat badge. */
  changeCount: number;
}

export interface SnapshotDay {
  day: number;
  entries: DayEntry[];
  changed: ChangedValue[];
  summary: string;
}

/** Per-day changed values, from the day's change events (first→last per attribute). */
function changedValuesFor(dayEntries: TimelineEntry[]): ChangedValue[] {
  const byKey = new Map<string, { label: string; from: number; to: number }>();
  for (const e of dayEntries) {
    if (!/attribute|stage|genital|ability/.test(e.type)) continue;
    const slot = String(e.pay?.slot ?? "");
    const attr = String(e.pay?.attribute ?? "");
    if (!slot && !attr) continue;
    const key = `${slot}:${attr}`;
    const pct = Math.round(Number(e.pay?.pct ?? 0));
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { label: `${humanize(slot)} · ${humanize(attr)}`.trim().replace(/^· /, ""), from: 0, to: pct });
    else cur.to = pct;
  }
  return [...byKey.values()].filter((v) => v.to !== v.from);
}

/** The one-line summary of a day, from its entries. */
function daySummary(session: Session, day: number, entries: TimelineEntry[], rng: Rng): string {
  if (entries.length === 0) return `Day ${day}.`;
  const changed = changedValuesFor(entries);
  const state = (session.subject.derived.transformState ?? "baseline").replace(/_/g, " ");
  const parts = changed.slice(0, 3).map((c) => c.label);
  const changes = parts.join(", ");
  const floor = changed.length === 0
    ? `Day ${day}: ${entries[0]!.text.replace(/\.$/, "").slice(0, 140)} (${state}).`
    : `Day ${day}: ${changes} changed.`;
  if (session.prose?.has("prose.day")) {
    const line = session.prose.pick("prose.day", axesFor(session), { day, state, changes: changes || "little", count: changed.length }, rng);
    if (line) return line;
  }
  return floor;
}

/** Group a day's entries by moment (tick), preserving order. */
function momentsOf(dayEntries: TimelineEntry[]): Map<number, TimelineEntry[]> {
  const byTick = new Map<number, TimelineEntry[]>();
  for (const e of [...dayEntries].sort((a, b) => a.tick - b.tick || a.id - b.id)) {
    byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
  }
  return byTick;
}

/** Build the whole multi-day view from the session's timeline. */
export function buildDayView(session: Session): SnapshotDay[] {
  // reset the prose memory ring so a re-render is reproducible, then rebuild the
  // whole view in a stable order (D-218)
  session.prose?.reset();
  const all = session.timeline.walk();
  const byDay = new Map<number, TimelineEntry[]>();
  for (const e of all) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  const days: SnapshotDay[] = [];
  for (const [day, dayEntries] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const entries: DayEntry[] = [];
    for (const [tick, moment] of momentsOf(dayEntries)) {
      const root = moment.find((e) => e.parentId === null) ?? moment[0]!;
      const block = buildEntryProse(session, moment, root.id);
      const chips = moment.filter((e) => e.kind === "event").map((c) => ({ id: c.id, type: c.type, text: c.text, kind: c.kind }));
      const changeCount = chips.filter((c) => /attribute|stage|notice|power|reaction|preference|genital|realization|ability|stance|stop|dose/.test(c.type)).length;
      entries.push({ id: root.id, tick, hour: hourOf(tick), kind: root.kind, type: root.type, paragraphs: block.paragraphs, text: proseOf(block), chips, markers: [...root.markers], changeCount });
    }
    days.push({ day, entries, changed: changedValuesFor(dayEntries), summary: daySummary(session, day, dayEntries, createRng(day * 40503)) });
  }
  return days;
}

function proseOf(block: EntryProse): string {
  return block.paragraphs.map((p) => p.text).join(" ");
}
