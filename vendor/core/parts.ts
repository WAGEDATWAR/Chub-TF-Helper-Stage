import { ContentError, indexById } from "./loader";
import { formatPartName } from "./appearance";

export const MERGE_POLICIES = Object.freeze(["none", "absorb_siblings", "collapse_parents"] as const);
export type MergePolicy = (typeof MERGE_POLICIES)[number];

export type Criticality = "vital" | "major" | "minor";

export interface PartCompose {
  noun?: string;
  render?: string;
}

export interface PartProvide {
  role: string;
  rel?: string;
}

export interface PartTemplate {
  id: string;
  display_name?: string;
  tags?: string[];
  occupies_role: string;
  layers?: string[];
  merge_policy?: MergePolicy;
  provides?: PartProvide[];
  innate_attributes?: string[];
  mutable_aspects?: string[];
  integrity?: number;
  mass?: number;
  size_class?: string;
  criticality?: Criticality;
  compose?: PartCompose;
  /** Appearance slots this part accepts (D-212): colour, size, length. */
  appearance?: import("./appearance").AppearanceSchema;
}

export interface PartAttributeEntry {
  id: string;
  progress: number;
  stage_index: number;
  target_progress?: number;
  dose_mult?: number;
  start_delay?: number;
  /** The mandatory phase this attribute belongs to (D-202): it waits for earlier phases. */
  phase_index?: number;
  /** A feral-only phase (R6): the entry waits for the feral stage. */
  phase_feral_only?: boolean;
  /** The exposure the phase requires (R6): the entry waits below it. */
  phase_exposure_min?: number;
  /** An optional intra-phase priority; lower goes first, default 0. */
  phase_priority?: number;
  progress_block?: unknown;
  /** A per-socket morph chain (D-202): [from, ...via, to]. When present, the
   *  resolver walks it by progress instead of any attribute's morph_track. */
  morph_chain?: string[];
  /** Event ids that caused this attribute (the causal chain, §3.3 D-135). */
  causes?: number[];
}

export class PartLibrary {
  private readonly byId: Map<string, PartTemplate>;

  constructor(templates: PartTemplate[]) {
    this.byId = indexById(templates, "parts.json");
    for (const template of templates) {
      if (typeof template.occupies_role !== "string") {
        throw new ContentError(
          `part "${template.id}" is missing a string "occupies_role"`,
          "parts.json",
        );
      }
      if (
        template.merge_policy !== undefined &&
        !(MERGE_POLICIES as readonly string[]).includes(template.merge_policy)
      ) {
        throw new ContentError(
          `part "${template.id}" has unknown merge_policy "${template.merge_policy}"`,
          "parts.json",
        );
      }
      for (const provided of template.provides ?? []) {
        if (typeof provided.role !== "string") {
          throw new ContentError(
            `part "${template.id}" has a provides entry without a string role`,
            "parts.json",
          );
        }
      }
    }
  }

  get(id: string): PartTemplate | null {
    return this.byId.get(id) ?? null;
  }

  all(): PartTemplate[] {
    return [...this.byId.values()];
  }

  templatesForRole(role: string): PartTemplate[] {
    return this.all().filter((t) => t.occupies_role === role);
  }
}

export function buildPartLibrary(partsData: unknown): PartLibrary {
  const templates = (partsData as { parts?: unknown } | null | undefined)?.parts;
  if (!Array.isArray(templates)) {
    throw new ContentError('parts.json must declare a "parts" array');
  }
  return new PartLibrary(templates as PartTemplate[]);
}

export class PartInstance {
  template: PartTemplate;
  readonly slot: string;
  integrity: number;
  readonly flags: string[];
  readonly attributes: PartAttributeEntry[];
  flag_schedules: Record<string, number>;
  /** The part's live appearance values (D-212), keyed by slot name. */
  appearance: import("./appearance").Appearance;

  constructor(template: PartTemplate, slot: string) {
    this.template = template;
    this.slot = slot;
    this.integrity = template.integrity ?? 100;
    this.flags = [];
    this.attributes = [];
    this.flag_schedules = {};
    // seed appearance from the template defaults, so nothing is invented at render
    this.appearance = {};
    for (const [key, def] of Object.entries(template.appearance ?? {})) {
      if (def.default) this.appearance[key] = def.default;
    }
  }

  get id(): string {
    return this.template.id;
  }

  get role(): string {
    return this.template.occupies_role;
  }

  get merge_policy(): MergePolicy {
    return this.template.merge_policy ?? "none";
  }

  get tags(): string[] {
    return this.template.tags ?? [];
  }

  get mutable_aspects(): string[] {
    return this.template.mutable_aspects ?? [];
  }

  /** The part's display name with its appearance applied (D-212). */
  displayName(base: string): string {
    const schema = this.template.appearance;
    if (!schema || Object.keys(this.appearance).length === 0) return base;
    return formatPartName(base, schema, this.appearance);
  }

  /**
   * Add (or locate) an attribute entry. A re-add **preserves** existing progress
   * unless the caller passes a higher value — so re-dosing does not wipe growth
   * (D-202). The resolver passes 0 on each apply and expects preservation.
   */
  addAttribute(id: string, progress = 0, { preserve = true }: { preserve?: boolean } = {}): PartAttributeEntry {
    const existing = this.attributes.find((a) => a.id === id);
    if (existing) {
      if (progress > existing.progress || !preserve) existing.progress = progress;
      return existing;
    }
    const entry: PartAttributeEntry = { id, progress, stage_index: 0 };
    this.attributes.push(entry);
    return entry;
  }

  setIntegrity(value: number): number {
    const base = this.template.integrity ?? 100;
    this.integrity = Math.max(0, Math.min(base, Math.round(value)));
    return this.integrity;
  }
}

export function instantiate(template: PartTemplate | null, slot: string): PartInstance {
  if (!template) {
    throw new ContentError("cannot instantiate a null template", "parts.json");
  }
  if (typeof slot !== "string" || slot.length === 0) {
    throw new ContentError("instantiate requires a slot id", "parts.json");
  }
  return new PartInstance(template, slot);
}
