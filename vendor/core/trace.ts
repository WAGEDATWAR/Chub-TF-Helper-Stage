export const DEFAULT_TRACE_CAPACITY = 500;

export interface TraceEntry {
  at: number;
  winner?: string;
  loser?: string;
  key?: string;
  rule?: string;
  slot?: string;
  group?: string;
  [extra: string]: unknown;
}

export class TraceRing {
  readonly capacity: number;
  private entries: TraceEntry[];
  private nextAt: number;

  constructor(capacity = DEFAULT_TRACE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("trace: capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.entries = [];
    this.nextAt = 0;
  }

  get size(): number {
    return this.entries.length;
  }

  push(entry: Omit<TraceEntry, "at"> & { [k: string]: unknown }): TraceEntry {
    const record = { at: this.nextAt++, ...entry } as TraceEntry;
    this.entries.push(record);
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
    return record;
  }

  pushAll(entries: ReadonlyArray<Omit<TraceEntry, "at"> & { [k: string]: unknown }>): void {
    for (const entry of entries) this.push(entry);
  }

  all(): TraceEntry[] {
    return [...this.entries];
  }

  tail(n: number): TraceEntry[] {
    return this.entries.slice(-n);
  }

  latest(): TraceEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  clear(): void {
    this.entries = [];
  }

  explain(attributeId: string): TraceEntry[] {
    return this.entries.filter((e) => e.winner === attributeId || e.loser === attributeId);
  }
}
