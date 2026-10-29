/**
 * The journal (blueprint §34/§55/§2 recap). A read-model over events: an
 * in-world log of what happened, doubling as player recap and save history.
 * Divergence D-116: keyed on `tick`/`day` (the clock), not the reference's day.
 */
export const JOURNAL_CAPACITY = 1000;

export interface JournalEntry {
  at: number;
  tick: number;
  day: number;
  type: string;
  summary: string;
  data: Record<string, unknown>;
}

export interface RecordSpec {
  type: string;
  tick?: number;
  day?: number;
  summary: string;
  data?: Record<string, unknown>;
  /** Collapse a repeat of the immediately-previous entry (idle lines). */
  dedupe?: boolean;
}

export class Journal {
  readonly capacity: number;
  private entries: JournalEntry[];
  private nextAt: number;

  constructor(capacity = JOURNAL_CAPACITY) {
    this.capacity = capacity;
    this.entries = [];
    this.nextAt = 0;
  }

  get size(): number {
    return this.entries.length;
  }

  record(spec: RecordSpec): JournalEntry {
    if (typeof spec.type !== "string" || typeof spec.summary !== "string") {
      throw new Error("journal: an entry needs a type and a summary");
    }
    // collapse a repeat of the newest entry (an unchanged idle line each hour)
    if (spec.dedupe) {
      const last = this.entries[this.entries.length - 1];
      if (last && last.type === spec.type && last.summary === spec.summary) {
        last.tick = spec.tick ?? last.tick;
        last.day = spec.day ?? last.day;
        return last;
      }
    }
    const entry: JournalEntry = {
      at: this.nextAt++,
      tick: spec.tick ?? 0,
      day: spec.day ?? 1,
      type: spec.type,
      summary: spec.summary,
      data: spec.data ?? {},
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  recordChange({ tick, day, slot, attribute, stageName, direction }: { tick: number; day: number; slot: string; attribute: string; stageName: string | null; direction?: string }): JournalEntry {
    return this.record({
      type: "change",
      tick,
      day,
      summary: `${direction === "reverse" ? "Reverted" : "Advanced"} ${slot} ${attribute} to ${stageName ?? "a new stage"}.`,
      data: { slot, attribute, stageName, direction: direction ?? "forward" },
    });
  }

  recordPower({ tick, day, powerId, genomeId, coverage }: { tick: number; day: number; powerId: string; genomeId: string | null; coverage: number }): JournalEntry {
    return this.record({
      type: "power",
      tick,
      day,
      summary: `Worked ${powerId}${genomeId ? ` (${genomeId})` : ""} at coverage ${coverage.toFixed(2)}.`,
      data: { powerId, genomeId, coverage },
    });
  }

  recordObservation({ tick, day, note, dedupe = false }: { tick: number; day: number; note: string; dedupe?: boolean }): JournalEntry {
    return this.record({ type: "observation", tick, day, summary: note, dedupe });
  }

  all(): JournalEntry[] {
    return [...this.entries];
  }

  tail(n: number): JournalEntry[] {
    return this.entries.slice(-n);
  }

  byType(type: string): JournalEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  byDay(day: number): JournalEntry[] {
    return this.entries.filter((e) => e.day === day);
  }

  recap({ sinceDay = 0 }: { sinceDay?: number } = {}): Array<{ day: number; summary: string }> {
    return this.entries
      .filter((e) => e.day >= sinceDay)
      .map((e) => ({ day: e.day, summary: e.summary }))
      .reverse();
  }

  toJSON(): { entries: JournalEntry[] } {
    return { entries: this.all() };
  }

  static fromJSON(json: { entries?: JournalEntry[] } | null | undefined): Journal {
    const journal = new Journal();
    for (const entry of json?.entries ?? []) {
      journal.entries.push({ ...entry });
      journal.nextAt = Math.max(journal.nextAt, (entry.at ?? 0) + 1);
    }
    return journal;
  }
}
