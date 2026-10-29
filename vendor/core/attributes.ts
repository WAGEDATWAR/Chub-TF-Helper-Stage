import { ContentError, indexById } from "./loader";

export const STACK_MODES = Object.freeze(["replace", "additive", "multiply"] as const);
export type StackMode = (typeof STACK_MODES)[number];

export const CURVES = Object.freeze(["linear", "ease_in", "ease_in_out"] as const);
export type Curve = (typeof CURVES)[number];

export function applyCurve(curve: Curve | string, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (curve) {
    case "ease_in":
      return x * x;
    case "ease_in_out":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "linear":
    default:
      return x;
  }
}

export type EffectValue = number | string | boolean | null;
export type Effects = Record<string, EffectValue>;

export interface AttributeStage {
  at: number;
  name: string;
  pain_on_stage?: number;
  effects?: Effects;
  desc_key?: string;
}

export interface AttributeProgressBlock {
  speed_base: number;
  curve: Curve | string;
  reverse_mult: number;
  stall_below_stability: number;
  observe_drive_per_stage?: number;
}

export interface Attribute {
  id: string;
  display_name?: string;
  family: string;
  tags?: string[];
  target_roles?: string[];
  requires_part_tags?: string[];
  priority?: number;
  stack_mode?: StackMode;
  mutation_cost?: number;
  hidden?: boolean;
  counts_toward_exposure?: boolean;
  /** How this change can be noticed (D-213): `felt`, `seen`, or `none`. Defaults
   *  from the family; a hidden attribute is `none` unless it sets one. */
  notice?: "felt" | "seen" | "none";
  /** How strongly a notice of this builds awareness (D-213). Defaults from family. */
  notice_weight?: number;
  /** Always lands when it is a candidate — the per-part distribution never skips
   *  it (a species genital shift must not be dropped, D-202). */
  guaranteed?: boolean;
  effects?: Effects;
  grants_ability?: string;
  /** Progress (0..1) the attribute must reach before it grants its ability.
   *  Ability appears at the stage where the anatomy is actually ready. */
  grants_ability_at?: number;
  description_key?: string | null;
  progress?: AttributeProgressBlock;
  stages?: AttributeStage[];
  morph_track?: string;
  morph_tracks_by_role?: Record<string, string>;
  /** A bounded value hook (S78): a nudge to a named point while this attr is present. */
  hook?: import("./hooks").Hook;
}

export class AttributeRegistry {
  private readonly byId: Map<string, Attribute>;

  constructor(attributes: Attribute[]) {
    this.byId = indexById(attributes, "attributes.json");
    for (const attr of attributes) {
      if (typeof attr.family !== "string") {
        throw new ContentError(`attribute "${attr.id}" is missing a string "family"`, "attributes.json");
      }
      if (attr.stack_mode !== undefined && !(STACK_MODES as readonly string[]).includes(attr.stack_mode)) {
        throw new ContentError(
          `attribute "${attr.id}" has unknown stack_mode "${attr.stack_mode}"`,
          "attributes.json",
        );
      }
      if (attr.progress?.curve !== undefined && !(CURVES as readonly string[]).includes(attr.progress.curve)) {
        throw new ContentError(
          `attribute "${attr.id}" has unknown curve "${attr.progress.curve}"`,
          "attributes.json",
        );
      }
      this._assertStages(attr);
    }
  }

  private _assertStages(attr: Attribute): void {
    const stages = attr.stages;
    if (stages === undefined) return;
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new ContentError(`attribute "${attr.id}" stages must be a non-empty array`, "attributes.json");
    }
    let prev = -1;
    for (const stage of stages) {
      if (typeof stage.at !== "number" || stage.at < 0 || stage.at > 1) {
        throw new ContentError(`attribute "${attr.id}" stage "at" must be 0..1`, "attributes.json");
      }
      if (stage.at <= prev) {
        throw new ContentError(
          `attribute "${attr.id}" stage "at" values must be strictly ascending`,
          "attributes.json",
        );
      }
      prev = stage.at;
    }
  }

  get(id: string): Attribute | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Attribute[] {
    return [...this.byId.values()];
  }

  families(): string[] {
    return [...new Set(this.all().map((a) => a.family))].sort();
  }

  byFamily(family: string): Attribute[] {
    return this.all().filter((a) => a.family === family);
  }

  hidden(): Attribute[] {
    return this.all().filter((a) => a.hidden === true);
  }

  hasReplaceMember(family: string): boolean {
    return this.byFamily(family).some((a) => (a.stack_mode ?? "replace") === "replace");
  }

  stageIndexFor(attrId: string, progress: number): number {
    const attr = this.get(attrId);
    if (!attr || !attr.stages) return 0;
    let index = 0;
    for (let i = 0; i < attr.stages.length; i++) {
      if (progress >= attr.stages[i]!.at) index = i;
      else break;
    }
    return index;
  }

  resolveEffects(attrId: string, progress: number): Effects {
    const attr = this.get(attrId);
    if (!attr) {
      throw new ContentError(`unknown attribute "${attrId}"`, "attributes.json");
    }
    const base = attr.effects ?? {};
    const stages = attr.stages;
    if (!stages || stages.length === 0) {
      return { ...base };
    }
    const p = Math.max(0, Math.min(1, progress));
    let lo = stages[0]!;
    let hi = stages[0]!;
    for (let i = 0; i < stages.length; i++) {
      if (stages[i]!.at <= p) {
        lo = stages[i]!;
        hi = stages[i + 1] ?? stages[i]!;
      }
    }
    const span = hi.at - lo.at;
    const t = span === 0 ? 0 : (p - lo.at) / span;
    return interpolateEffects(lo.effects ?? {}, hi.effects ?? {}, t);
  }
}

export function interpolateEffects(from: Effects, to: Effects, t: number): Effects {
  const out: Effects = { ...from };
  for (const key of Object.keys(to)) {
    const a = from[key];
    const b = to[key];
    if (typeof a === "number" && typeof b === "number") {
      out[key] = a + (b - a) * t;
    } else {
      out[key] = b;
    }
  }
  return out;
}

export function buildAttributeRegistry(data: unknown): AttributeRegistry {
  const attributes = (data as { attributes?: unknown } | null | undefined)?.attributes;
  if (!Array.isArray(attributes)) {
    throw new ContentError('attributes.json must declare an "attributes" array');
  }
  return new AttributeRegistry(attributes as Attribute[]);
}
