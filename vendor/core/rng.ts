export const CORE_VERSION = "0.1.0-m0";

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Named RNG streams (blueprint §41). Every random call must name a stream, so
 * adding a call in one stream never shifts the index of another.
 */
export const STREAMS = [
  "transform",
  "outcome",
  "dialogue",
  "drift",
  "reaction",
  "world",
  "schedule",
] as const;

export type Stream = (typeof STREAMS)[number];

const STREAM_SET: ReadonlySet<string> = new Set(STREAMS);

export function isStream(name: string): name is Stream {
  return STREAM_SET.has(name);
}

/** FNV-1a mixing of (seed, stream, index) into a float in [0, 1). */
export function hash(seed: number, stream: string, index: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  const s = `${stream}:${index}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final avalanche so low bits mix into the mantissa
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type RngCounters = Record<Stream, number>;

export interface Rng {
  readonly seed: number;
  readonly counters: RngCounters;
  /** float in [0, 1) from a named stream; advances that stream's counter. */
  next(stream: Stream): number;
  /** integer in [min, max] inclusive. */
  int(stream: Stream, min: number, max: number): number;
  /** true with probability p. */
  chance(stream: Stream, p: number): boolean;
  /** pick one element of a non-empty array. */
  pick<T>(stream: Stream, items: readonly T[]): T;
  /** weighted pick; weights must be non-negative and not all zero. */
  weighted<T>(stream: Stream, items: readonly T[], weight: (item: T) => number): T;
  /** snapshot for the save; counters are authoritative (blueprint §41). */
  toJSON(): { seed: number; counters: RngCounters };
}

function zeroCounters(): RngCounters {
  return STREAMS.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as RngCounters);
}

function assertStream(stream: string): asserts stream is Stream {
  if (!isStream(stream)) {
    throw new Error(`unknown RNG stream "${stream}" (known: ${STREAMS.join(", ")})`);
  }
}

export function createRng(seed: number, counters?: Partial<RngCounters>): Rng {
  if (!Number.isInteger(seed)) throw new Error(`seed must be an integer, got ${seed}`);
  const c = zeroCounters();
  if (counters) {
    for (const [k, v] of Object.entries(counters)) {
      assertStream(k);
      c[k] = v ?? 0;
    }
  }

  function next(stream: Stream): number {
    assertStream(stream);
    const value = hash(seed, stream, c[stream]);
    c[stream]++;
    return value;
  }

  return {
    seed,
    counters: c,
    next,
    int(stream, min, max) {
      if (max < min) throw new Error(`int range ${min}..${max} is empty`);
      return min + Math.floor(next(stream) * (max - min + 1));
    },
    chance(stream, p) {
      return next(stream) < p;
    },
    pick(stream, items) {
      if (items.length === 0) throw new Error("pick on an empty array");
      return items[Math.floor(next(stream) * items.length)]!;
    },
    weighted(stream, items, weight) {
      if (items.length === 0) throw new Error("weighted on an empty array");
      const weights = items.map(weight);
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) throw new Error("weighted weights sum to <= 0");
      let roll = next(stream) * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!;
        if (roll < 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
    toJSON() {
      return { seed, counters: { ...c } };
    },
  };
}
