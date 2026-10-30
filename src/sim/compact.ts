/**
 * Save compaction (H7). The per-message state budget is the top technical risk:
 * a character's serialized session is dominated by the *view* rings (journal,
 * timeline, story) that the simulation never reads — ~410 KB of a 424 KB save at
 * 60 days, and there are up to MAX_CAST of them.
 *
 * The blueprint's invariant (I2) says discarding every log line leaves the
 * simulation bit-identical, so trimming the persisted views is principled. This
 * operates on the serialized object only, never the live sim.
 */
import { serializeSession } from "@core/savegame";
import { serialize } from "@core/persistence";
import { TICKS_PER_DAY } from "@core/time";
import type { Session } from "@core/session";

export interface CompactOptions {
  timelineCap: number;
  journalCap: number;
  storyCap: number;
  /** Always keep entries within this many ticks, even beyond the cap. */
  floorTicks: number;
}

export const DEFAULT_COMPACT: CompactOptions = Object.freeze({
  // In a chat stage the conversation *is* the history, so the persisted view rings
  // only need to cover what the pane shows. Hard caps keep the 6-character save in
  // budget even after a year.
  timelineCap: 24,
  journalCap: 16,
  storyCap: 12,
  floorTicks: 0,
});

/** The design budget per character (bytes) at a hard cap. */
export const PER_CHAR_BUDGET = 40 * 1024;

interface TickEntry {
  tick?: number;
}
interface SaveShape {
  clock?: { tick?: number };
  timeline?: { entries?: TickEntry[] };
  journal?: { entries?: TickEntry[] };
  story?: { story?: TickEntry[] };
  flags?: string[];
}

function capView<T extends TickEntry>(list: T[] | undefined, cap: number, cutoff: number): T[] | undefined {
  if (!Array.isArray(list)) return list;
  if (list.length <= cap) return list;
  const tailStart = list.length - cap;
  return list.filter((e, i) => i >= tailStart || (e.tick ?? 0) >= cutoff);
}

function trimAll(save: SaveShape, opts: CompactOptions): void {
  const now = save.clock?.tick ?? 0;
  const cutoff = now - opts.floorTicks;
  if (save.timeline) save.timeline.entries = capView(save.timeline.entries, opts.timelineCap, cutoff);
  if (save.journal) save.journal.entries = capView(save.journal.entries, opts.journalCap, cutoff);
  if (save.story) save.story.story = capView(save.story.story, opts.storyCap, cutoff);
  // day-scoped block flags are only read within the current day
  if (Array.isArray(save.flags)) {
    const cutoffDay = Math.floor(cutoff / TICKS_PER_DAY) + 1;
    save.flags = save.flags.filter((f) => {
      const m = /^block_.*_(\d+)$/.exec(f);
      return !m || Number(m[1]) >= cutoffDay;
    });
  }
}

/** Serialize a session to a checksummed save, with view rings hard-capped. */
export function compactSave(session: Session, opts: CompactOptions = DEFAULT_COMPACT): string {
  const save = serializeSession(session) as SaveShape;
  trimAll(save, opts);
  return serialize(save as Record<string, unknown>);
}
