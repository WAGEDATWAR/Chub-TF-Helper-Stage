import { createRng, type Rng } from "./rng";
import { createSubject, type Subject } from "./subject";
import { ContentError } from "./loader";
import { applySexDefaults } from "./genital";
import { ageCosmetics } from "./physiology";
import { createMind, buildMindData } from "./mind";
import { createMood, buildMoodData } from "./mood";
import { rollArchetypeValues } from "./archetypes";
import { generateDispositions, type Disposition, type DispositionTable } from "./reactions";
import type { Skeleton } from "./skeleton";
import type { PartLibrary } from "./parts";
import type { GenomeRegistry } from "./genomes";
import type { ExposureBandRegistry } from "./registries";
import type { AttributeRegistry } from "./attributes";

export const BASE_GENDERS = Object.freeze(["female", "male"]);

/** Blueprint §17.4 step order; the order is a contract, not a layout choice. */
export const FOCUS_STEPS = Object.freeze(["origin", "identity", "build", "dispositions", "confirm"]);

export const DISPOSITION_CAP = 2;

export interface NameData {
  first: string[] | { feminine: string[]; masculine: string[]; neutral: string[] };
  last: string[];
}

function firstPool(nameData: NameData): string[] {
  const first = nameData.first;
  if (Array.isArray(first)) return first;
  return [...first.feminine, ...first.masculine, ...first.neutral];
}

export function generateName(rng: Rng, nameData: NameData): string {
  const first = rng.pick("dialogue", firstPool(nameData));
  const last = rng.pick("dialogue", nameData.last);
  return `${first} ${last}`;
}

export function resolveName({
  name,
  generate,
  seed,
  nameData,
}: {
  name?: string | null | undefined;
  generate?: boolean | undefined;
  seed?: number | null | undefined;
  nameData?: NameData | null | undefined;
}): { displayName: string; generated: boolean } {
  if (name) {
    return { displayName: name, generated: false };
  }
  if (!generate) {
    throw new ContentError("focus: a name or generate=true is required");
  }
  if (!nameData) {
    throw new ContentError("focus: nameData is required for generation", "names.json");
  }
  const rng = createRng(seed ?? 20261024);
  return { displayName: generateName(rng, nameData), generated: true };
}

export function pronounDefaults(baseGender: string): string {
  return baseGender === "male" ? "he / him / his" : "she / her / hers";
}

export function genitalDefaults(baseGender: string): string {
  return baseGender === "male" ? "penis" : "vulva";
}

/** Roll a subject's starting dispositions from their personality (§22.4). */
export function rollDispositions(
  personality: string | null,
  table: DispositionTable,
  seed: number,
  cap = DISPOSITION_CAP,
): Disposition[] {
  const rng = createRng(seed);
  return generateDispositions(personality, table, rng, cap);
}

export interface Preset {
  id: string;
  display_name?: string;
  base_gender?: string;
  personality_seed?: string;
  limits?: string[];
  starting_limits?: string[];
  fetish?: string | null;
  dispositions?: string[];
  stat_overrides?: Record<string, number>;
}

export function applyPreset(preset: Preset | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  if (!preset) return overrides;
  return {
    baseGender: overrides.baseGender ?? preset.base_gender,
    personalitySeed: overrides.personalitySeed ?? preset.personality_seed,
    stats: { ...(preset.stat_overrides ?? {}), ...((overrides.stats as Record<string, number>) ?? {}) },
  };
}

export function dispositionWarning(dispositions: readonly Disposition[]): string[] {
  if (dispositions.length === 0) {
    return ["no leanings — the arc opens blank and everything must be awakened in play"];
  }
  return [];
}

export interface CreateFocusOptions {
  name?: string | null | undefined;
  generate?: boolean | undefined;
  seed?: number | null | undefined;
  nameData?: NameData | null | undefined;
  dispositionTable?: DispositionTable | null | undefined;
  baseGender?: string | null | undefined;
  personalitySeed?: string | null | undefined;
  dispositions?: Disposition[] | undefined;
  preset?: Preset | null | undefined;
  skeleton: Skeleton;
  library: PartLibrary;
  genomesRegistry?: GenomeRegistry | null | undefined;
  exposureBands?: ExposureBandRegistry | null | undefined;
  attributeRegistry?: AttributeRegistry | null | undefined;
  /** Capacity rules (S76). */
  capacityRegistry?: import("./capacity").CapacityRegistry | null | undefined;
  statOverrides?: Record<string, number> | undefined;
  sexDefaultsData?: { sexes?: Record<string, { genital_primary: string | null; genital_secondary: string | null; overrides?: Record<string, string> }> } | null | undefined;
  dispositionSeed?: number | null | undefined;
  pronouns?: string | undefined;
  age?: number | null | undefined;
  height?: number | null | undefined;
  weight?: number | null | undefined;
  sexuality?: string | null | undefined;
  mindData?: unknown;
  moodData?: unknown;
  archetypes?: import("./archetypes").ArchetypeRegistry | null;
  archetypeId?: string | null;
}

export function createFocus(opts: CreateFocusOptions): Subject {
  const resolvedGender = opts.baseGender ?? opts.preset?.base_gender ?? "female";
  if (!(BASE_GENDERS as readonly string[]).includes(resolvedGender)) {
    throw new ContentError(`focus: unknown base_gender "${resolvedGender}"`);
  }
  const presetApplied = applyPreset(opts.preset ?? null, {
    baseGender: resolvedGender,
    personalitySeed: opts.personalitySeed,
    limits: opts.dispositions,
    stats: opts.statOverrides,
  });
  const personalitySeed = (presetApplied.personalitySeed as string) ?? null;

  const { displayName } = resolveName({ name: opts.name, generate: opts.generate, seed: opts.seed, nameData: opts.nameData });

  const dispositions: Disposition[] =
    opts.dispositions ??
    (opts.dispositionTable
      ? rollDispositions(personalitySeed, opts.dispositionTable, opts.dispositionSeed ?? opts.seed ?? 20261024)
      : []);

  const subject = createSubject({
    id: `subject.${(opts.name ?? displayName).toLowerCase().replace(/\s+/g, "_")}`,
    displayName,
    skeleton: opts.skeleton,
    library: opts.library,
    genomesRegistry: opts.genomesRegistry,
    exposureBands: opts.exposureBands,
    attributeRegistry: opts.attributeRegistry,
    baseGender: presetApplied.baseGender as string,
    personalitySeed,
    dispositions,
    stats: (presetApplied.stats as Record<string, number>) ?? {},
  });
  subject.capacityRegistry = opts.capacityRegistry ?? null;
  subject.pronouns = opts.pronouns ?? pronounDefaults(subject.baseGender);
  if (opts.age !== null && opts.age !== undefined) subject.age = opts.age;
  if (opts.height !== null && opts.height !== undefined) subject.height = opts.height;
  if (opts.weight !== null && opts.weight !== undefined) subject.weight = opts.weight;
  if (opts.sexuality !== null && opts.sexuality !== undefined) subject.sexuality = opts.sexuality;
  subject.body.fillDefaultBody();
  applySexDefaults(subject.body, subject.baseGender, opts.sexDefaultsData);
  // age drives cosmetic appearance (D-212): hair length, breast/genital size
  if (subject.age !== null && subject.age !== undefined) ageCosmetics(subject.age, subject.baseGender, subject.body);
  subject.dispositionWarnings = dispositionWarning(dispositions);
  // the mind + mood objects (M15.5a): created from content when supplied
  if (opts.mindData) {
    subject.mind = createMind(buildMindData(opts.mindData));
    // an archetype rolls its value ranges onto the mind (M15.5g, D-193)
    const archetype = opts.archetypes && opts.archetypeId ? opts.archetypes.get(opts.archetypeId) : null;
    if (archetype) {
      const rolled = rollArchetypeValues(archetype, opts.seed ?? 20261024);
      for (const [id, value] of Object.entries(rolled)) if (subject.mind.has(id)) { subject.mind.adjust(id, value - subject.mind.read(id)); subject.mind.setBaseline(id, value); }
    }
  }
  if (opts.moodData) subject.mood = createMood(buildMoodData(opts.moodData));
  subject.recomputeDerived();
  return subject;
}
