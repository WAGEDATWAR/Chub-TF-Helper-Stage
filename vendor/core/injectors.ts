import { ContentError, indexById } from "./loader";

export const INJECTOR_TYPES = Object.freeze(["chemical", "mutagenic", "stabilizing"] as const);
export type InjectorType = (typeof INJECTOR_TYPES)[number];

export const STABILIZING_SUBTYPES = Object.freeze(["stabilizer", "reverter"] as const);
export type StabilizingSubtype = (typeof STABILIZING_SUBTYPES)[number];

export interface InjectorEffect {
  stat: string;
  op: "add" | "multiply" | "set";
  value: number;
  scales_with?: "dose" | "none";
}

export interface Injector {
  id: string;
  display_name?: string;
  type: InjectorType;
  subtype?: StabilizingSubtype;
  genome_reference?: string | null;
  base_dose?: number;
  dose_range?: [number, number];
  effects?: InjectorEffect[];
  incubation_seconds?: number;
  onset_curve?: string;
  batch_id?: string;
}

export class InjectorRegistry {
  private readonly byId: Map<string, Injector>;

  constructor(injectors: Injector[]) {
    this.byId = indexById(injectors, "injectors.json");
    for (const injector of injectors) {
      if (!(INJECTOR_TYPES as readonly string[]).includes(injector.type)) {
        throw new ContentError(`injector "${injector.id}" has unknown type "${injector.type}"`, "injectors.json");
      }
      if (injector.type === "mutagenic" && typeof injector.genome_reference !== "string") {
        throw new ContentError(`mutagenic injector "${injector.id}" needs a genome_reference`, "injectors.json");
      }
      if (
        injector.type === "stabilizing" &&
        injector.subtype !== undefined &&
        !(STABILIZING_SUBTYPES as readonly string[]).includes(injector.subtype)
      ) {
        throw new ContentError(`injector "${injector.id}" has unknown stabilizing subtype "${injector.subtype}"`, "injectors.json");
      }
      const range = injector.dose_range;
      if (range !== undefined) {
        if (!Array.isArray(range) || range.length !== 2 || range[0]! > range[1]!) {
          throw new ContentError(`injector "${injector.id}" has an invalid dose_range`, "injectors.json");
        }
      }
    }
  }

  get(id: string): Injector | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Injector[] {
    return [...this.byId.values()];
  }

  byType(type: InjectorType): Injector[] {
    return this.all().filter((i) => i.type === type);
  }
}

export function buildInjectorRegistry(data: unknown): InjectorRegistry {
  const injectors = (data as { injectors?: unknown } | null | undefined)?.injectors;
  if (!Array.isArray(injectors)) {
    throw new ContentError('injectors.json must declare an "injectors" array');
  }
  return new InjectorRegistry(injectors as Injector[]);
}
