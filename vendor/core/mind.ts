import { ContentError } from "./loader";


/** A float clamp to 0..100 (mind values keep decimals; clampStat rounds). */
export function clampFloat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * The mind model (blueprint §17.5, §24; D-172–D-176; M15.5a). Mental values,
 * their **settling targets**, and the subject's awareness/resistance/agency live
 * here — on a dedicated object, *never* added to the stat bars (D-173).
 *
 * A settling value is an **influence cap** (D-175): the change may pull a value
 * toward `target`; the value itself stays open to every other interaction. The
 * drift engine that moves values toward targets lands in M15.5b; this module is
 * the shape + the registration plumbing so nothing is orphaned (D-154 style).
 *
 * Every input that may move the mind registers itself (a **modifier registry**),
 * so a validator can prove coverage — the antidote to missed wiring.
 */
export const MIND_VERSION = 1;

export type MindValueKind = "core" | "secondary";
/** An x↔y axis is one value: 0 = the negative pole, 100 = the positive pole, 50 = even. */
export interface MindValueDef {
  id: string;
  label: string;
  kind: MindValueKind;
  /** Present for core axes: [negativePole, positivePole]. */
  axis?: [string, string];
  baseline: number;
  /** The default influence cap for the settling target. */
  defaultTarget: number;
  source: string;
}

export interface MindData {
  values: MindValueDef[];
  /** Registry input ids expected to exist, with the kind they must declare. */
  inputs?: Array<{ id: string; kind: MindInputKind; owner: string }>;
}

export type MindInputKind = "rate" | "resistance" | "agency" | "target";

export interface MindValueState {
  value: number;
  /** The influence cap the drift pulls toward. */
  target: number;
  baseline: number;
}

export interface MindJSON {
  version: number;
  values: Record<string, MindValueState>;
  awareness: number;
  resistance: number;
  agency: number;
  /** Whether the subject has had their realization moment. */
  realized: boolean;
}

/** Awareness tiers (D-180): Blind → Dim → Aware → Lucid. */
export const AWARENESS_TIERS = Object.freeze([
  { id: "blind", min: 0, max: 15 },
  { id: "dim", min: 15, max: 35 },
  { id: "aware", min: 35, max: 75 },
  { id: "lucid", min: 75, max: 100 },
] as const);

export function awarenessTier(awareness: number): string {
  for (const t of AWARENESS_TIERS) if (awareness >= t.min && awareness < t.max) return t.id;
  return "lucid";
}

export function buildMindData(raw: unknown): MindData {
  const data = raw as MindData | null | undefined;
  if (!data || !Array.isArray(data.values) || data.values.length === 0) {
    throw new ContentError('mind.json must declare a non-empty "values" array', "mind.json");
  }
  const seen = new Set<string>();
  for (const v of data.values) {
    if (typeof v.id !== "string" || typeof v.baseline !== "number") {
      throw new ContentError('every mind value needs a string id and numeric baseline', "mind.json");
    }
    if (seen.has(v.id)) throw new ContentError(`duplicate mind value "${v.id}"`, "mind.json");
    seen.add(v.id);
  }
  return data;
}

export class Mind {
  version = MIND_VERSION;
  readonly values: Map<string, MindValueState> = new Map();
  readonly labels: Map<string, string> = new Map();
  /** The kind + axis of each value, for the surface's Personality/Mind split (D-211). */
  readonly kinds: Map<string, MindValueKind> = new Map();
  readonly axes: Map<string, [string, string] | undefined> = new Map();
  awareness = 0;
  resistance = 0;
  agency = 50;
  realized = false;

  constructor(data: MindData) {
    for (const def of data.values) {
      this.values.set(def.id, { value: def.baseline, target: def.defaultTarget, baseline: def.baseline });
      this.labels.set(def.id, def.label);
      this.kinds.set(def.id, def.kind);
      this.axes.set(def.id, def.axis);
    }
  }

  has(id: string): boolean {
    return this.values.has(id);
  }

  get(id: string): MindValueState | null {
    return this.values.get(id) ?? null;
  }

  /** The value's current reading (0..100). */
  read(id: string): number {
    return this.values.get(id)?.value ?? 0;
  }

  /** Adjust a value directly (used by events until the drift engine lands). */
  adjust(id: string, delta: number): number {
    const s = this.values.get(id);
    if (!s) throw new ContentError(`mind: unknown value "${id}"`, "mind.json");
    s.value = clampFloat(s.value + delta);
    return s.value;
  }

  /** Raise/lower a value's influence cap (a settling target). */
  setTarget(id: string, target: number): number {
    const s = this.values.get(id);
    if (!s) throw new ContentError(`mind: unknown value "${id}"`, "mind.json");
    s.target = clampFloat(target);
    return s.target;
  }

  /** Set where a value started (M16.5): an archetype-rolled value is her baseline,
   *  so a day-1 self-notice does not read a rolled personality as a *change*. */
  setBaseline(id: string, baseline: number): number {
    const s = this.values.get(id);
    if (!s) throw new ContentError(`mind: unknown value "${id}"`, "mind.json");
    s.baseline = clampFloat(baseline);
    return s.baseline;
  }

  gainAwareness(delta: number): number {
    this.awareness = clampFloat(this.awareness + delta);
    return this.awareness;
  }

  tier(): string {
    return awarenessTier(this.awareness);
  }

  ids(): string[] {
    return [...this.values.keys()];
  }

  toJSON(): MindJSON {
    return {
      version: this.version,
      values: Object.fromEntries([...this.values].map(([id, s]) => [id, { ...s }])),
      awareness: this.awareness,
      resistance: this.resistance,
      agency: this.agency,
      realized: this.realized,
    };
  }

  static fromJSON(json: MindJSON | null | undefined, data: MindData): Mind {
    const mind = new Mind(data);
    if (!json) return mind;
    for (const [id, s] of Object.entries(json.values ?? {})) {
      if (mind.values.has(id)) mind.values.set(id, { ...s });
    }
    mind.awareness = json.awareness ?? 0;
    mind.resistance = json.resistance ?? 0;
    mind.agency = json.agency ?? 50;
    mind.realized = json.realized ?? false;
    return mind;
  }
}

export function createMind(data: MindData): Mind {
  return new Mind(data);
}

// --- modifier registry (coverage plumbing) ----------------------------------

export interface MindInputContext {
  awareness: number;
  tier: string;
  resistance: number;
  agency: number;
  value(id: string): number;
}

export interface MindInput {
  id: string;
  kind: MindInputKind;
  owner: string;
  /** Contribution to the kind's total (sign + magnitude). */
  weight(ctx: MindInputContext): number;
}

export class MindRegistry {
  private readonly inputs: MindInput[] = [];

  register(input: MindInput): void {
    this.inputs.push(input);
  }

  all(): MindInput[] {
    return [...this.inputs];
  }

  byKind(kind: MindInputKind): MindInput[] {
    return this.inputs.filter((i) => i.kind === kind);
  }

  /** Sum every registered input of a kind against a live context. */
  total(kind: MindInputKind, ctx: MindInputContext): number {
    return this.byKind(kind).reduce((sum, i) => sum + i.weight(ctx), 0);
  }
}

export function createMindRegistry(): MindRegistry {
  return new MindRegistry();
}
