import { curveValue } from "./progress";
import { SECONDS_PER_TICK, secondsToTicks } from "./time";
import type { Stream } from "./rng";

export interface IncubationEntry {
  slot: string;
  attributeId: string;
  genomeId?: string | undefined;
  onsetCurve: string;
  coverage: number;
  dose: number;
  readyAt: number;
}

export interface IncubationSpec {
  slot: string;
  attributeId: string;
  genomeId?: string;
  onsetCurve?: string;
  incubationSeconds?: number;
  coverage?: number;
  dose?: number;
}

export class IncubationScheduler {
  readonly secondsPerTick: number;
  private pending: IncubationEntry[];
  now: number;
  rng: { nextInt(stream: Stream, min: number, max: number): number } | null;

  constructor(secondsPerTick = SECONDS_PER_TICK, rng: IncubationScheduler["rng"] = null) {
    this.secondsPerTick = secondsPerTick;
    this.pending = [];
    this.now = 0;
    this.rng = rng;
  }

  schedule(spec: IncubationSpec): IncubationEntry {
    const entry: IncubationEntry = {
      slot: spec.slot,
      attributeId: spec.attributeId,
      genomeId: spec.genomeId,
      onsetCurve: spec.onsetCurve ?? "linear",
      coverage: spec.coverage ?? 0,
      dose: spec.dose ?? 0,
      readyAt: this.now + secondsToTicks(spec.incubationSeconds, this.secondsPerTick),
    };
    this.pending.push(entry);
    return entry;
  }

  advance(ticks = 1): IncubationEntry[] {
    this.now += ticks;
    const ready: IncubationEntry[] = [];
    const still: IncubationEntry[] = [];
    for (const entry of this.pending) {
      if (this.now >= entry.readyAt) {
        ready.push(entry);
      } else {
        still.push(entry);
      }
    }
    this.pending = still;
    return ready;
  }

  onsetMultiplier(entry: IncubationEntry): number {
    return curveValue(entry.onsetCurve ?? "linear", 1);
  }

  pendingCount(): number {
    return this.pending.length;
  }

  all(): IncubationEntry[] {
    return [...this.pending];
  }

  toJSON(): { now: number; pending: IncubationEntry[] } {
    return { now: this.now, pending: this.pending.map((e) => ({ ...e })) };
  }

  static fromJSON(data: { now: number; pending: IncubationEntry[] }, secondsPerTick = SECONDS_PER_TICK): IncubationScheduler {
    const scheduler = new IncubationScheduler(secondsPerTick);
    scheduler.now = data.now;
    scheduler.pending = data.pending.map((e) => ({ ...e }));
    return scheduler;
  }
}

/** Alias kept for reference parity. */
export function onsetTicks(incubationSeconds: number | undefined | null, secondsPerTick = SECONDS_PER_TICK): number {
  return secondsToTicks(incubationSeconds, secondsPerTick);
}

export { secondsToTicks };
