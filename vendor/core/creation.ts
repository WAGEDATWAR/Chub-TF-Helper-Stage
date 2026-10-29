import { createRng } from "./rng";
import { ContentError } from "./loader";
import { pronounDefaults } from "./focus";
import { physiologyFor } from "./physiology";
import type { NameData } from "./focus";

/**
 * Sandbox subject creation (§17.4; D-158, D-165). The player's choices live in a
 * plain **draft** — name, age, sex, pronouns, height, sexuality — which validates
 * against `data/creation.json` and then drives `createFocus`. The draft is pure
 * data, so "quick start" is just a deterministic roll of the same draft a player
 * edits.
 *
 * Base items only for now; genetics/aesthetics and world setup join the draft
 * later without changing this shape (P5, D-163).
 */
export const CREATION_VERSION = 2;

export interface CreationFieldBounds {
  min: number;
  max: number;
  default: number;
  unit: string;
}

export interface CreationSex {
  id: string;
  label: string;
  default_pronouns: string;
  genital: string | null;
}

export interface CreationSexuality {
  id: string;
  label: string;
  attracted_to: string[];
  self_sex: string;
}

export type NamePool = "feminine" | "masculine" | "neutral";

export interface CreationData {
  age: CreationFieldBounds;
  height: CreationFieldBounds;
  name: { allow_custom: boolean; generate_when_blank: boolean };
  sexes: CreationSex[];
  pronouns: string[];
  name_rule: Record<string, NamePool | "any">;
  sexualities: CreationSexuality[];
  /** Cosmetic pools (M16.5e). */
  hair_colours: string[];
  eye_colours: string[];
  hair_length: CreationFieldBounds;
}

export interface CreationDraft {
  name: string;
  age: number;
  sex: string;
  pronouns: string;
  height: number;
  weight: number;
  sexuality: string;
  /** Cosmetic parts (M16.5e): hair colour/length (in.) and eye colour. */
  hairColour?: string;
  hairLength?: number;
  eyeColour?: string;
  /** A personality/origin lean carried from a preset; empty = roll. */
  origin: string | null;
}

export function buildCreationData(raw: unknown): CreationData {
  const data = raw as Partial<CreationData> | null;
  if (!data || !Array.isArray(data.sexes) || data.sexes.length === 0) {
    throw new ContentError("creation: sexes are required", "creation.json");
  }
  if (!Array.isArray(data.pronouns) || data.pronouns.length === 0) {
    throw new ContentError("creation: pronouns are required", "creation.json");
  }
  if (!Array.isArray(data.sexualities) || data.sexualities.length === 0) {
    throw new ContentError("creation: sexualities are required", "creation.json");
  }
  if (!data.age || !data.height || !data.name) {
    throw new ContentError("creation: age/height/name blocks are required", "creation.json");
  }
  return {
    age: { ...data.age },
    height: { ...data.height },
    name: { ...data.name },
    sexes: data.sexes.map((s) => ({ ...s })),
    pronouns: [...data.pronouns],
    name_rule: { ...(data.name_rule ?? {}) },
    sexualities: data.sexualities.map((s) => ({ ...s, attracted_to: [...s.attracted_to] })),
    hair_colours: [...(data.hair_colours ?? ["black"])],
    eye_colours: [...(data.eye_colours ?? ["brown"])],
    hair_length: { ...(data.hair_length ?? { min: 2, max: 40, default: 12, unit: "in." }) },
  };
}

function clampWithin(value: number, bounds: CreationFieldBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
}

export function sexById(data: CreationData, id: string): CreationSex | null {
  return data.sexes.find((s) => s.id === id) ?? null;
}

export function sexualityById(data: CreationData, id: string): CreationSexuality | null {
  return data.sexualities.find((s) => s.id === id) ?? null;
}

/**
 * Which name pool a set of pronouns draws from: a gendered pool for binary
 * pronouns, any pool for neutral (D-166). Unknown pronouns fall back to "any".
 */
export function namePoolForPronouns(data: CreationData, pronouns: string): NamePool | "any" {
  return data.name_rule[pronouns] ?? "any";
}

/** Pick a first name from the pool the pronouns imply. */
export function rollName(rng: ReturnType<typeof createRng>, data: CreationData, pronouns: string, nameData: NameData): string {
  const pool = namePoolForPronouns(data, pronouns);
  const first = pickFirstName(rng, pool, nameData);
  return `${first} ${rng.pick("world", nameData.last)}`;
}

function pickFirstName(rng: ReturnType<typeof createRng>, pool: NamePool | "any", nameData: NameData): string {
  const pools = nameData.first;
  if (Array.isArray(pools)) return rng.pick("world", pools);
  if (pool === "any") {
    const all = [...pools.feminine, ...pools.masculine, ...pools.neutral];
    return rng.pick("world", all);
  }
  const base = pools[pool];
  // a neutral pool is shared across everyone; blend it in for binary names too
  const blend = [...base, ...pools.neutral];
  return rng.pick("world", blend);
}

/**
 * A deterministic quick-start draft: pronouns first, then a name that follows
 * them, a random valid sex/sexuality, mid-range age/height jittered by the seed.
 */
export function rollDraft(data: CreationData, seed: number, nameData: NameData, archetypeIds: string[] = []): CreationDraft {
  const rng = createRng(seed);
  const sex = rng.pick("world", data.sexes);
  const pronouns = sex.default_pronouns;
  const sexuality = rng.pick("world", data.sexualities);
  const age = clampWithin(data.age.default + rng.int("world", -6, 6), data.age);
  // height + weight are age-driven (D-212): derive from the rolled age, jittered
  const phys = physiologyFor(age, sex.id);
  return {
    name: rollName(rng, data, pronouns, nameData),
    age,
    sex: sex.id,
    pronouns,
    height: clampWithin(phys.height + rng.int("world", -6, 6), data.height),
    weight: Math.max(40, phys.weight + rng.int("world", -5, 5)),
    sexuality: sexuality.id,
    hairColour: rng.pick("world", data.hair_colours),
    hairLength: clampWithin(data.hair_length.default + rng.int("world", -6, 6), data.hair_length),
    eyeColour: rng.pick("world", data.eye_colours),
    origin: archetypeIds.length > 0 ? rng.pick("world", archetypeIds) : null,
  };
}

/** The fields a per-field dice reroll may target (D-200). */
export type RerollField = "name" | "age" | "height" | "weight" | "sex" | "pronouns" | "sexuality" | "origin" | "hairColour" | "hairLength" | "eyeColour";

/**
 * Reroll **one** field of a draft (D-200): a per-field dice so a player can keep
 * the parts they like. Sex carries its pronoun default; other fields roll fresh.
 */
export function rerollField(draft: CreationDraft, field: RerollField, data: CreationData, seed: number, nameData: NameData, archetypeIds: string[] = []): CreationDraft {
  const rng = createRng(seed);
  const next = { ...draft };
  switch (field) {
    case "name":
      next.name = rollName(rng, data, next.pronouns, nameData);
      break;
    case "age": {
      next.age = clampWithin(data.age.default + rng.int("world", -6, 6), data.age);
      // an age change recomputes the age-driven physiology (D-212)
      const phys = physiologyFor(next.age, next.sex);
      next.height = clampWithin(phys.height + rng.int("world", -6, 6), data.height);
      next.weight = Math.max(40, phys.weight + rng.int("world", -5, 5));
      break;
    }
    case "height":
      next.height = clampWithin(data.height.default + rng.int("world", -8, 8), data.height);
      break;
    case "weight": {
      const phys = physiologyFor(next.age, next.sex);
      next.weight = Math.max(40, phys.weight + rng.int("world", -5, 5));
      break;
    }
    case "sex": {
      const sex = rng.pick("world", data.sexes);
      next.sex = sex.id;
      next.pronouns = sex.default_pronouns;
      break;
    }
    case "pronouns":
      next.pronouns = rng.pick("world", data.pronouns);
      break;
    case "sexuality":
      next.sexuality = rng.pick("world", data.sexualities).id;
      break;
    case "origin":
      next.origin = archetypeIds.length > 0 ? rng.pick("world", archetypeIds) : null;
      break;
    case "hairColour":
      next.hairColour = rng.pick("world", data.hair_colours);
      break;
    case "hairLength":
      next.hairLength = clampWithin(data.hair_length.default + rng.int("world", -8, 8), data.hair_length);
      break;
    case "eyeColour":
      next.eyeColour = rng.pick("world", data.eye_colours);
      break;
  }
  return next;
}

export interface DraftProblem {
  field: keyof CreationDraft;
  message: string;
}

/** Validate a draft against the content. Returns every problem, never throws. */
export function validateDraft(draft: CreationDraft, data: CreationData): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.name !== undefined && draft.name === null) problems.push({ field: "name", message: "a name or blank (generate) is required" });
  if (!sexById(data, draft.sex)) problems.push({ field: "sex", message: `unknown sex "${draft.sex}"` });
  if (!data.pronouns.includes(draft.pronouns)) problems.push({ field: "pronouns", message: `unknown pronouns "${draft.pronouns}"` });
  if (!sexualityById(data, draft.sexuality)) problems.push({ field: "sexuality", message: `unknown sexuality "${draft.sexuality}"` });
  if (!Number.isFinite(draft.age) || draft.age < data.age.min || draft.age > data.age.max) {
    problems.push({ field: "age", message: `age must be ${data.age.min}..${data.age.max}` });
  }
  if (!Number.isFinite(draft.height) || draft.height < data.height.min || draft.height > data.height.max) {
    problems.push({ field: "height", message: `height must be ${data.height.min}..${data.height.max}` });
  }
  return problems;
}

export function isDraftValid(draft: CreationDraft, data: CreationData): boolean {
  return validateDraft(draft, data).length === 0;
}

/** Clamp a draft's numbers into range; fill blank sex/pronouns/sexuality from the sex. */
export function normaliseDraft(draft: CreationDraft, data: CreationData): CreationDraft {
  const sex = sexById(data, draft.sex) ?? data.sexes[0]!;
  const pronouns = data.pronouns.includes(draft.pronouns) ? draft.pronouns : sex.default_pronouns;
  const sexuality = sexualityById(data, draft.sexuality) ? draft.sexuality : data.sexualities[0]!.id;
  return {
    ...draft,
    name: draft.name ?? "",
    sex: sex.id,
    pronouns,
    sexuality,
    age: clampWithin(draft.age, data.age),
    height: clampWithin(draft.height, data.height),
    weight: Math.max(30, Math.round(draft.weight ?? 60)),
  };
}

export function sexPronounDefaults(sexId: string): string {
  return pronounDefaults(sexId);
}
