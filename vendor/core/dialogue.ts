import { ContentError } from "./loader";
import type { Rng } from "./rng";

export const SPECIFICITY_THRESHOLD = 3;
export const MAX_FLOOR_WORDS = 40;
export const MEMORY_RING_SIZE = 20;

export function countWords(text: string): number {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export interface DialogueVariant {
  axes?: Record<string, string>;
  weight?: number;
  lines: string[];
}

export interface DialogueKey {
  key: string;
  speaker?: string;
  intent?: string;
  variants: DialogueVariant[];
}

export function specificityScore(variant: DialogueVariant, axes: Record<string, string>, weights: Record<string, number>): number {
  if (!variant.axes) return 0;
  let score = 0;
  for (const [axis, band] of Object.entries(variant.axes)) {
    if (axes[axis] === band) {
      score += weights[axis] ?? 0;
    }
  }
  return score;
}

export function variantSpecificity(variant: DialogueVariant, weights: Record<string, number>): number {
  if (!variant.axes) return 0;
  let score = 0;
  for (const axis of Object.keys(variant.axes)) {
    score += weights[axis] ?? 0;
  }
  return score;
}

export class MemoryRing {
  readonly size: number;
  private entries: string[];

  constructor(size = MEMORY_RING_SIZE) {
    this.size = size;
    this.entries = [];
  }

  record(line: string): void {
    this.entries.push(line);
    if (this.entries.length > this.size) this.entries.shift();
  }

  has(line: string): boolean {
    return this.entries.includes(line);
  }

  recent(): string[] {
    return [...this.entries];
  }
}

export interface SelectionResult {
  key: string;
  line: string;
  specificity: number;
  matchedAxes: Record<string, string>;
  generic: boolean;
  speaker: string;
}

export class DialogueRegistry {
  private readonly byId: Map<string, DialogueKey>;
  readonly weights: Record<string, number>;
  readonly memory: MemoryRing;
  private readonly memoryPerKey: Map<string, MemoryRing>;

  constructor(keys: DialogueKey[], { weights = {}, memoryRing }: { weights?: Record<string, number>; memoryRing?: MemoryRing } = {}) {
    this.byId = new Map();
    this.weights = weights;
    this.memory = memoryRing ?? new MemoryRing();
    this.memoryPerKey = new Map();
    for (const key of keys) {
      if (!key || typeof key.key !== "string") {
        throw new ContentError('dialogue: entry is missing a string "key"', "dialogue");
      }
      if (this.byId.has(key.key)) {
        throw new ContentError(`dialogue: duplicate key "${key.key}"`, "dialogue");
      }
      if (!Array.isArray(key.variants) || key.variants.length === 0) {
        throw new ContentError(`dialogue key "${key.key}" must declare variants`, "dialogue");
      }
      if (!key.variants.some((v) => !v.axes || Object.keys(v.axes).length === 0)) {
        throw new ContentError(`dialogue key "${key.key}" has no zero-axis floor`, "dialogue");
      }
      this.byId.set(key.key, key);
    }
  }

  has(key: string): boolean {
    return this.byId.has(key);
  }

  get(key: string): DialogueKey | null {
    return this.byId.get(key) ?? null;
  }

  all(): DialogueKey[] {
    return [...this.byId.values()];
  }

  private _memoryFor(key: string): MemoryRing {
    let ring = this.memoryPerKey.get(key);
    if (!ring) {
      ring = new MemoryRing(this.memory.size);
      this.memoryPerKey.set(key, ring);
    }
    return ring;
  }

  select(key: string, axes: Record<string, string> = {}, { rng = null }: { rng?: Rng | null } = {}): SelectionResult | null {
    const entry = this.get(key);
    if (!entry) {
      throw new ContentError(`dialogue: unknown key "${key}"`, "dialogue");
    }

    const scored = entry.variants.map((variant, index) => ({
      variant,
      index,
      specificity: variantSpecificity(variant, this.weights),
      match: specificityScore(variant, axes, this.weights),
    }));

    const above = scored.filter((s) => s.match >= SPECIFICITY_THRESHOLD);
    const pool =
      above.length > 0
        ? above
        : scored.filter((s) => !s.variant.axes || Object.keys(s.variant.axes).length === 0);

    const memory = this._memoryFor(key);
    const fresh = pool.filter((s) => !s.variant.lines.every((l) => memory.has(l)));
    const candidates = (fresh.length > 0 ? fresh : pool).sort(
      (a, b) => b.match - a.match || b.specificity - a.specificity || a.index - b.index,
    );

    const best = candidates[0];
    if (!best) return null;

    const line = pickLine(best.variant.lines, rng, memory);
    if (line === null) return null;
    memory.record(line);
    return {
      key,
      line,
      specificity: best.match,
      matchedAxes: best.variant.axes ?? {},
      generic: above.length === 0,
      speaker: entry.speaker ?? "subject",
    };
  }
}

export function pickLine(lines: string[], rng: Rng | null, memory: MemoryRing): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const fresh = lines.filter((l) => !memory.has(l));
  const pool = fresh.length > 0 ? fresh : lines;
  if (rng) {
    return rng.pick("dialogue", pool);
  }
  return pool[0] ?? null;
}

export function buildDialogueRegistry(keys: unknown, options?: { weights?: Record<string, number>; memoryRing?: MemoryRing }): DialogueRegistry {
  if (!Array.isArray(keys)) {
    throw new ContentError("dialogue content must be an array of keys");
  }
  return new DialogueRegistry(keys as DialogueKey[], options);
}
