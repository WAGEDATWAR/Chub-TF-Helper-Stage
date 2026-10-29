import { buildSkeleton, expandWildcard, type Skeleton } from "./skeleton";
import { buildPartLibrary, MERGE_POLICIES, type PartLibrary } from "./parts";
import { buildAttributeRegistry } from "./attributes";
import { buildTraitRegistry } from "./traits";
import { buildGenomeRegistry, stackStatModifiers, SOFT_CAP_CEILING } from "./genomes";
import { validateGenitalPlan } from "./genital_plan";
import { checkModifier } from "./modifiers";
import { validateCriteriaKeys, buildCriteria } from "./criteria";
import {
  buildFeralRegistry,
  buildExposureBandRegistry,
  buildFlagRegistry,
  buildTokenRegistry,
  buildAxisRegistry,
  buildReactionCatalog,
} from "./registries";
import { buildMorphTrackRegistry } from "./morph";
import { buildInjectorRegistry } from "./injectors";
import { buildPowerRegistry } from "./powers";
import { buildEventRegistry } from "./events";
import { buildAbilityRegistry } from "./abilities";
import { buildFaultRegistry } from "./faults";
import { buildTrainingConfig, buildStances } from "./training";
import { buildPhaseSequencer } from "./phases";
import { buildPlayConfig } from "./play";
import { buildDistribution } from "./distribution";
import { buildFragmentLibrary, buildToneLibrary } from "./composer";
import { buildLocationGraph, buildObjectLibrary, buildSpatialRegistry, buildSceneRegistry } from "./scene";
import { buildSceneGraph, validateConditionKeys } from "./scene_graph";
import { buildInterruptSystem } from "./interrupts";
import { buildDialogueRegistry, countWords, MAX_FLOOR_WORDS, type DialogueRegistry } from "./dialogue";
import { buildConsequenceEngine } from "./consequence";
import { buildSocialCatalog } from "./social";
import { buildConsequenceRegistry } from "./consequences";
import { buildMemoryStore } from "./memory";
import { buildCapacityRegistry } from "./capacity";
import { buildPresentationData } from "./presentation";
import { buildHookRegistry } from "./hooks";

export interface ValidationIssue {
  rule: string;
  message: string;
  path: string | null;
}

export class ValidationResult {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];

  error(rule: string, message: string, path?: string): void {
    this.errors.push({ rule, message, path: path ?? null });
  }

  warn(rule: string, message: string, path?: string): void {
    this.warnings.push({ rule, message, path: path ?? null });
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }

  toJSON(): { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] } {
    return { ok: this.ok, errors: this.errors, warnings: this.warnings };
  }
}

export type ValidationReport = ReturnType<ValidationResult["toJSON"]>;

const REQUIRED_CONTENT_KEYS = ["skeleton", "parts", "attributes", "traits", "genomes", "morph_tracks", "phases", "locations", "needs", "agents"] as const;

export const ASPECT_FAMILIES = Object.freeze([
  "claws",
  "coat",
  "structure",
  "gait",
  "skin",
  "muscle",
  "bone",
  "ears",
  "eyes",
  "horns",
  "wings",
  "tail",
  "genital",
  "voice",
  "size",
] as const);

function tryBuild<T>(
  result: ValidationResult,
  rule: string,
  path: string,
  fn: () => T,
): T | null {
  try {
    return fn();
  } catch (err) {
    result.error(rule, (err as Error).message, path);
    return null;
  }
}

interface ContentSet {
  skeleton?: unknown;
  parts?: unknown;
  attributes?: unknown;
  traits?: unknown;
  genomes?: unknown;
  feral?: unknown;
  creation?: unknown;
  mind?: unknown;
  mood?: unknown;
  topics?: unknown;
  criteria?: unknown;
  sex_actions?: unknown;
  archetypes?: unknown;
  exposure_bands?: unknown;
  flags?: unknown;
  tokens?: unknown;
  axes?: unknown;
  reactions?: unknown;
  dispositions?: unknown;
  morph_tracks?: unknown;
  injectors?: unknown;
  powers?: unknown;
  events?: unknown;
  abilities?: unknown;
  faults?: unknown;
  training?: unknown;
  stances?: unknown;
  play_options?: unknown;
  phases?: unknown;
  distribution?: unknown;
  names?: unknown;
  subject_presets?: unknown;
  fragments?: unknown;
  tone?: unknown;
  locations?: unknown;
  needs?: unknown;
  agents?: unknown;
  obligations?: unknown;
  objects?: unknown;
  spatial_relations?: unknown;
  scenes?: unknown;
  scene_graph?: unknown;
  dialogue?: unknown;
  prose?: unknown;
  consequence?: unknown;
  social?: unknown;
  town_events?: unknown;
  consequences?: unknown;
  memory?: unknown;
  capacities?: unknown;
  presentation?: unknown;
  hooks?: unknown;
  derived_fields?: unknown;
}

export function validateContentSet(contentSet: unknown): ValidationReport {
  const result = new ValidationResult();
  if (!contentSet || typeof contentSet !== "object") {
    result.error("content_set", "a content set object is required");
    return result.toJSON();
  }

  const set = contentSet as ContentSet;

  for (const key of REQUIRED_CONTENT_KEYS) {
    if ((set as Record<string, unknown>)[key] === undefined) {
      result.error("required_file", `missing required content file "${key}"`);
    }
  }

  validateRawHygiene(set, result);

  const skeleton =
    set.skeleton !== undefined
      ? tryBuild(result, "skeleton_load", "skeleton.json", () => buildSkeleton(set.skeleton))
      : null;
  const library =
    set.parts !== undefined
      ? tryBuild(result, "parts_load", "parts.json", () => buildPartLibrary(set.parts))
      : null;

  if (skeleton && library) {
    validateReferential(skeleton, library, result);
    validateStructural(skeleton, library, result);
    validateHygiene(skeleton, library, result);
  }

  validateAttributesAndTraits(set, skeleton, library, result);
  validateGenomes(set, result);
  validateRegistries(set, result);
  validateMorphTracks(set, library, result);
  validateInjectors(set, result);
  validatePowers(set, result);
  validateEvents(set, result);
  validatePathConvention(set, result);
  validateAbilities(set, result);
  validatePhases(set, result);
  validateDistribution(set, skeleton, result);
  validateNames(set, result);
  validateCreation(set, result);
  validateMind(set, result);
  validatePreferences(set, result);
  validateSex(set, result);
  validatePresets(set, result);
  validateArchetypes(set, result);
  validateReactions(set, result);
  validateSceneContent(set, result);
  validateDialogue(set, result);
  validateTown(set, result);
  validateConsequence(set, result);
  validateSocial(set, result);

  return result.toJSON();
}

function validateConsequence(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.consequence !== undefined) {
    tryBuild(result, "consequence_load", "consequence.json", () => buildConsequenceEngine(contentSet.consequence));
  }
  const data = contentSet.derived_fields as { fields?: unknown } | undefined;
  if (data !== undefined) {
    if (!Array.isArray(data.fields) || data.fields.length === 0) {
      result.error("structural_derived_fields", 'derived_fields.json must declare a non-empty "fields" array', "derived_fields.json");
      return;
    }
    const seen = new Set<string>();
    for (const field of data.fields) {
      const f = field as { id?: string; formula?: string };
      if (typeof f.id !== "string" || typeof f.formula !== "string") {
        result.error("structural_derived_field", "every derived field needs a string id and formula", "derived_fields.json");
        continue;
      }
      if (seen.has(f.id)) result.error("hygiene_derived_field_id", `duplicate derived field "${f.id}"`, "derived_fields.json");
      seen.add(f.id);
    }
    for (const required of ["exposure", "pain_tolerance", "pain_pressure", "overload_stop_point", "genital_profile", "transform_state"]) {
      if (!seen.has(required)) result.error("referential_derived_field", `derived field "${required}" is missing`, "derived_fields.json");
    }
    // I4: a bounded value declares bounds on its path
    for (const field of data.fields) {
      const f = field as { id?: string; bounds?: unknown };
      if (f.bounds === undefined) continue;
      const b = f.bounds as Array<unknown>;
      if (!Array.isArray(f.bounds) || f.bounds.length !== 2 || typeof b[0] !== "number" || typeof b[1] !== "number" || b[0] > b[1]) {
        result.error("structural_derived_bounds", `derived field "${f.id}" bounds must be an ascending [min, max]`, "derived_fields.json");
      }
    }
  }
}

function validateDialogue(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.dialogue === undefined && contentSet.prose === undefined) return;
  const weights: Record<string, number> = {};
  const knownAxes = new Map<string, string[]>();
  for (const axis of ((contentSet.axes as { axes?: Array<{ id: string; weight: number; bands: string[] }> } | undefined)?.axes ?? [])) {
    weights[axis.id] = axis.weight;
    knownAxes.set(axis.id, axis.bands);
  }
  // prose.json shares the dialogue shape, so validate both (D-218)
  const targets: Array<[string, unknown]> = [
    ["dialogue", contentSet.dialogue],
    ["prose.json", contentSet.prose],
  ];
  let dialogueRegistry: DialogueRegistry | null = null;
  for (const [name, data] of targets) {
    if (data === undefined) continue;
    const registry = tryBuild(result, name === "dialogue" ? "dialogue_load" : "prose_load", name, () =>
      buildDialogueRegistry(data, { weights }),
    );
    if (!registry) continue;
    if (name === "dialogue") dialogueRegistry = registry;
    validateDialogueKeys(registry, name, knownAxes, result);
  }

  // scene-graph prefetch targets must resolve
  if (contentSet.scene_graph !== undefined) {
    const graph = tryBuild(result, "scene_graph_load", "scene_graph.json", () => buildSceneGraph(contentSet.scene_graph));
    if (graph && dialogueRegistry) {
      for (const node of graph.all()) {
        for (const key of (node.prefetch as string[] | undefined) ?? []) {
          if (!dialogueRegistry.has(key)) {
            result.error("referential_prefetch", `scene "${node.id}" prefetch target "${key}" has no dialogue key`, "scene_graph.json");
        }
      }
    }
  }
}

function validateDialogueKeys(registry: DialogueRegistry, src: string, knownAxes: Map<string, string[]>, result: ValidationResult): void {
  for (const entry of registry.all()) {
    let hasFloor = false;
    for (const variant of entry.variants) {
      if (!variant.axes || Object.keys(variant.axes).length === 0) hasFloor = true;
      for (const [axis, band] of Object.entries(variant.axes ?? {})) {
        if (knownAxes.size > 0 && !knownAxes.has(axis)) {
          result.error("referential_dialogue_axis", `key "${entry.key}" uses unknown axis "${axis}"`, src);
        } else if (knownAxes.get(axis) && !knownAxes.get(axis)!.includes(band)) {
          result.error("referential_dialogue_band", `key "${entry.key}" uses unknown band "${band}" for axis "${axis}"`, src);
        }
      }
      for (const line of variant.lines ?? []) {
        if (countWords(line) > MAX_FLOOR_WORDS) {
          result.error("structural_floor_words", `key "${entry.key}" has a line over ${MAX_FLOOR_WORDS} words`, src);
        }
      }
    }
    if (!hasFloor) {
      result.error("structural_no_floor", `key "${entry.key}" has no zero-axis floor`, src);
    }
  }
}

}

function validateTown(contentSet: ContentSet, result: ValidationResult): void {
  const needs = contentSet.needs as { needs?: Array<{ id: string }>; activities?: Array<{ id: string }> } | undefined;
  const agents = (contentSet.agents as { agents?: Array<{ id: string; home: string; schedule?: Array<{ activity: string; where?: string }> }> } | undefined)?.agents;
  const obligations = (contentSet.obligations as { obligations?: Array<{ id: string; agent: string; activity: string }> } | undefined)?.obligations;
  if (!Array.isArray(agents) || !needs) return;
  const locations = (contentSet.locations as { locations?: Array<{ id: string }> } | undefined)?.locations ?? [];
  const locIds = new Set(locations.map((l) => l.id));
  const activityIds = new Set((needs.activities ?? []).map((a) => a.id));
  const agentIds = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    if (locIds.size > 0 && !locIds.has(a.home)) result.error("referential_agent_home", `agent \"${a.id}\" home \"${a.home}\" is unknown`, "agents.json");
    for (const s of a.schedule ?? []) {
      if (!activityIds.has(s.activity)) result.error("referential_agent_activity", `agent \"${a.id}\" schedules unknown activity \"${s.activity}\"`, "agents.json");
      if (s.where && locIds.size > 0 && !locIds.has(s.where)) result.error("referential_agent_where", `agent \"${a.id}\" schedules at unknown place \"${s.where}\"`, "agents.json");
    }
  }
  for (const o of obligations ?? []) {
    if (o.agent !== "subject" && !agentIds.has(o.agent)) result.error("referential_obligation_agent", `obligation \"${o.id}\" names unknown agent \"${o.agent}\"`, "obligations.json");
    if (!activityIds.has(o.activity)) result.error("referential_obligation_activity", `obligation \"${o.id}\" names unknown activity \"${o.activity}\"`, "obligations.json");
  }
  // household coherence (M16.5a, §45): members of a household share one home;
  // a lone-agent household is fine, but a shared household must agree.
  const byHousehold = new Map<string, Array<{ id: string; home: string }>>();
  for (const a of agents) {
    const hh = (a as { household?: string }).household;
    if (!hh) continue;
    byHousehold.set(hh, [...(byHousehold.get(hh) ?? []), { id: a.id, home: a.home }]);
  }
  for (const [hh, members] of byHousehold) {
    const homes = new Set(members.map((m) => m.home));
    if (homes.size > 1) result.error("coherence_household_home", `household "${hh}" members live in different homes: ${[...homes].join(", ")}`, "agents.json");
  }
  // every agent needs a sleep block (dawn or night) so nobody is active at hour 0
  for (const a of agents) {
    if (!(a.schedule ?? []).some((s) => s.activity === "act.sleep")) {
      result.error("coherence_agent_sleep", `agent "${a.id}" has no sleep block`, "agents.json");
    }
  }
}

function validateSocial(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.social !== undefined) {
    const catalog = tryBuild(result, "social_load", "social.json", () => buildSocialCatalog(contentSet.social));
    if (catalog) {
      const raw = contentSet.social as { reactions?: Array<{ id?: string; lines?: unknown[]; when_tags?: unknown[] }> };
      for (const r of raw.reactions ?? []) {
        if (typeof r.id !== "string" || r.id.length === 0) result.error("structural_social_id", "every social reaction needs an id", "social.json");
        if (!Array.isArray(r.lines) || r.lines.length === 0) result.error("structural_social_lines", `social reaction \"${r.id}\" needs at least one line`, "social.json");
        if (!Array.isArray(r.when_tags) || r.when_tags.length === 0) result.error("structural_social_tags", `social reaction \"${r.id}\" needs when_tags`, "social.json");
      }
    }
  }
  for (const e of (contentSet.town_events as { events?: Array<{ id?: string; where?: string[] }> } | undefined)?.events ?? []) {
    const locIds = new Set(((contentSet.locations as { locations?: Array<{ id: string }> })?.locations ?? []).map((l) => l.id));
    for (const w of e.where ?? []) {
      if (locIds.size > 0 && !locIds.has(w)) result.error("referential_town_event_where", `town event \"${e.id}\" happens at unknown place \"${w}\"`, "town_events.json");
    }
  }
  if (contentSet.consequences !== undefined) {
    tryBuild(result, "consequences_load", "consequences.json", () => buildConsequenceRegistry(contentSet.consequences));
  }
  if (contentSet.memory !== undefined) {
    tryBuild(result, "memory_load", "memory.json", () => buildMemoryStore(contentSet.memory));
  }
  if (contentSet.capacities !== undefined) {
    tryBuild(result, "capacities_load", "capacities.json", () => buildCapacityRegistry(contentSet.capacities));
  }
  if (contentSet.presentation !== undefined) {
    tryBuild(result, "presentation_load", "presentation.json", () => buildPresentationData(contentSet.presentation));
  }
  if (contentSet.hooks !== undefined) {
    const reg = tryBuild(result, "hooks_load", "hooks.json", () => buildHookRegistry(contentSet.hooks));
    // every attribute hook must name a real point
    if (reg) {
      const hooks = (contentSet.attributes as { attributes?: Array<{ id: string; hook?: { point?: string } }> } | undefined)?.attributes ?? [];
      for (const a of hooks) {
        if (a.hook && typeof a.hook.point === "string" && !reg.point(a.hook.point)) {
          result.error("referential_hook_point", `attribute "${a.id}" hooks unknown point "${a.hook.point}"`, "attributes.json");
        }
      }
    }
  }
}

function validateSceneContent(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.fragments !== undefined) {
    tryBuild(result, "fragments_load", "fragments.json", () => buildFragmentLibrary(contentSet.fragments));
  }
  if (contentSet.tone !== undefined) {
    tryBuild(result, "tone_load", "tone.json", () => buildToneLibrary(contentSet.tone));
  }

  const locations = contentSet.locations !== undefined
    ? tryBuild(result, "locations_load", "locations.json", () => buildLocationGraph(contentSet.locations))
    : null;
  const objects = contentSet.objects !== undefined
    ? tryBuild(result, "objects_load", "objects.json", () => buildObjectLibrary(contentSet.objects))
    : null;
  const spatial = contentSet.spatial_relations !== undefined
    ? tryBuild(result, "spatial_load", "spatial_relations.json", () => buildSpatialRegistry(contentSet.spatial_relations))
    : null;

  // object default_location must resolve
  if (objects && locations) {
    for (const obj of objects.all()) {
      if (obj.default_location && !locations.has(obj.default_location)) {
        result.error("referential_object_location", `object "${obj.id}" default_location "${obj.default_location}" is unknown`, "objects.json");
      }
    }
  }

  // fragments must reference real attributes / parts
  if (contentSet.fragments !== undefined && (contentSet.attributes !== undefined || contentSet.parts !== undefined)) {
    const fragments = contentSet.fragments as {
      attribute?: Record<string, { stages?: unknown[] }>;
      part?: Record<string, unknown>;
    };
    const attributes = (contentSet.attributes as { attributes?: Array<{ id: string; stages?: unknown[]; hidden?: boolean }> } | undefined)?.attributes;
    const parts = (contentSet.parts as { parts?: Array<{ id: string }> } | undefined)?.parts;
    if (Array.isArray(attributes)) {
      const ids = new Set(attributes.map((a) => a.id));
      for (const key of Object.keys(fragments.attribute ?? {})) {
        if (!ids.has(key)) {
          result.error("referential_fragment_attribute", `fragment "${key}" has no attribute`, "fragments.json");
        }
      }
      // a fragment with N stage lines needs the attribute to declare N stages, or
      // only the first line ever renders and the rest is dead (D-202).
      for (const attr of attributes) {
        const frag = fragments.attribute?.[attr.id];
        const fragStages = Array.isArray(frag?.stages) ? frag!.stages!.length : 0;
        if (fragStages <= 1) continue;
        const attrStages = Array.isArray(attr.stages) ? attr.stages!.length : 0;
        if (attrStages !== fragStages) {
          result.error(
            "referential_stage_fragment_mismatch",
            `attribute "${attr.id}" has ${attrStages} stages but its fragment has ${fragStages} (unreachable prose)`,
            "fragments.json",
          );
        }
      }
    }
    if (Array.isArray(parts)) {
      const ids = new Set(parts.map((p) => p.id));
      for (const key of Object.keys(fragments.part ?? {})) {
        if (!ids.has(key)) {
          result.error("referential_fragment_part", `fragment "${key}" has no part`, "fragments.json");
        }
      }
    }
  }

  if (contentSet.scenes !== undefined && locations && objects && spatial) {
    tryBuild(result, "scenes_load", "scenes.json", () =>
      buildSceneRegistry(contentSet.scenes, { locations, objects, spatial }),
    );
  }

  if (contentSet.scene_graph !== undefined) {
    const graph = tryBuild(result, "scene_graph_load", "scene_graph.json", () => buildSceneGraph(contentSet.scene_graph));
    if (graph) {
      for (const node of graph.all()) {
        if (node.condition !== undefined) {
          for (const e of validateConditionKeys(node.condition, `node "${node.id}"`)) result.error("condition_key", e, "scene_graph.json");
        }
      }
      for (const edge of graph.edges) {
        if (edge.condition !== undefined) {
          for (const e of validateConditionKeys(edge.condition, `edge ${edge.from}->${edge.to}`)) result.error("condition_key", e, "scene_graph.json");
        }
      }
      for (const id of graph.unreachableNodes()) {
        result.error("scene_graph_unreachable", `scene node "${id}" is unreachable`, "scene_graph.json");
      }
      const interrupts = graph.all().filter((n) => n.type === "interrupt");
      tryBuild(result, "interrupts_load", "scene_graph.json", () => buildInterruptSystem(interrupts));
    }
  }
}

function validateNames(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet.names as { first?: unknown; last?: unknown } | undefined;
  if (data === undefined) return;
  const firstOk = Array.isArray(data.first) && data.first.length > 0;
  const poolsOk =
    !!data.first &&
    !Array.isArray(data.first) &&
    ["feminine", "masculine", "neutral"].every((pool) => {
      const list = (data.first as Record<string, unknown>)[pool];
      return Array.isArray(list) && list.length > 0;
    });
  if (!firstOk && !poolsOk) {
    result.error("structural_names", 'names.json must declare a non-empty "first" array or gendered pools', "names.json");
  }
  if (!Array.isArray(data.last) || data.last.length === 0) {
    result.error("structural_names", 'names.json must declare a non-empty "last" array', "names.json");
  }
}

function validateCreation(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet.creation as
    | { age?: { min?: number }; sexes?: Array<{ id?: string; default_pronouns?: string }>; pronouns?: unknown; sexualities?: unknown; name_rule?: Record<string, string> }
    | undefined;
  if (data === undefined) return;
  if (!Array.isArray(data.sexes) || data.sexes.length === 0) {
    result.error("structural_creation", 'creation.json must declare a non-empty "sexes" array', "creation.json");
  }
  if (!Array.isArray(data.pronouns) || data.pronouns.length === 0) {
    result.error("structural_creation", 'creation.json must declare a non-empty "pronouns" array', "creation.json");
  }
  if (!Array.isArray(data.sexualities) || data.sexualities.length === 0) {
    result.error("structural_creation", 'creation.json must declare a non-empty "sexualities" array', "creation.json");
  }
  const pronounIds = Array.isArray(data.pronouns) ? new Set(data.pronouns as string[]) : new Set<string>();
  for (const sex of data.sexes ?? []) {
    if (sex.default_pronouns && !pronounIds.has(sex.default_pronouns)) {
      result.error("referential_creation", `sex "${sex.id}" has default_pronouns "${sex.default_pronouns}" not in pronouns`, "creation.json");
    }
    if (data.name_rule && sex.default_pronouns && !data.name_rule[sex.default_pronouns]) {
      result.error("referential_creation", `no name_rule for pronouns "${sex.default_pronouns}" (sex "${sex.id}")`, "creation.json");
    }
  }
  if (typeof data.age?.min === "number" && data.age.min > 15) {
    result.warn("tuning_creation", "creation age min > 15 may exclude school-age subjects (M16)", "creation.json");
  }
}

function validateMind(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet.mind as { values?: Array<{ id?: string; kind?: string; baseline?: number }>; inputs?: Array<{ id?: string; kind?: string; owner?: string }> } | undefined;
  if (data === undefined) return;
  if (!Array.isArray(data.values) || data.values.length === 0) {
    result.error("structural_mind", 'mind.json must declare a non-empty "values" array', "mind.json");
  }
  const seen = new Set<string>();
  for (const v of data.values ?? []) {
    if (typeof v.id !== "string") { result.error("structural_mind_value", "every mind value needs a string id", "mind.json"); continue; }
    if (seen.has(v.id)) result.error("hygiene_mind_id", `duplicate mind value "${v.id}"`, "mind.json");
    seen.add(v.id);
    if (typeof v.baseline !== "number" || v.baseline < 0 || v.baseline > 100) {
      result.error("structural_mind_baseline", `mind value "${v.id}" baseline must be 0..100`, "mind.json");
    }
    if (v.kind === "core" && !(data.values ?? []).find((x) => x === v && (x as { axis?: unknown }).axis)) {
      result.warn("tuning_mind_axis", `core mind value "${v.id}" has no axis`, "mind.json");
    }
  }
  // every registered input must name an owner and a known kind
  const kinds = new Set(["rate", "resistance", "agency", "target"]);
  for (const inp of data.inputs ?? []) {
    if (!inp.id || !inp.owner) result.error("structural_mind_input", "every mind input needs an id and owner", "mind.json");
    if (inp.kind && !kinds.has(inp.kind)) result.error("structural_mind_input_kind", `mind input "${inp.id}" has unknown kind "${inp.kind}"`, "mind.json");
  }
  const mood = contentSet.mood as { emotions?: Array<{ id?: string; valence?: number; arousal?: number; dominance?: number }>; label_threshold?: number } | undefined;
  if (mood !== undefined) {
    if (!Array.isArray(mood.emotions) || mood.emotions.length === 0) {
      result.error("structural_mood", 'mood.json must declare a non-empty "emotions" array', "mood.json");
    }
    const mseen = new Set<string>();
    for (const e of mood.emotions ?? []) {
      if (typeof e.id !== "string") { result.error("structural_mood_emotion", "every emotion needs a string id", "mood.json"); continue; }
      if (mseen.has(e.id)) result.error("hygiene_mood_id", `duplicate emotion "${e.id}"`, "mood.json");
      mseen.add(e.id);
      for (const axis of ["valence", "arousal", "dominance"] as const) {
        const val = (e as Record<string, unknown>)[axis];
        if (typeof val !== "number" || val < 0 || val > 100) result.error("structural_mood_axis", `emotion "${e.id}" ${axis} must be 0..100`, "mood.json");
      }
    }
  }
}

function validatePreferences(contentSet: ContentSet, result: ValidationResult): void {
  const topics = contentSet.topics as { topics?: Array<{ id?: string; parent?: string; parentKind?: string }> } | undefined;
  const topicIds = new Set<string>();
  if (topics !== undefined) {
    if (!Array.isArray(topics.topics) || topics.topics.length === 0) {
      result.error("structural_topics", 'topics.json must declare a non-empty "topics" array', "topics.json");
    }
    for (const t of topics.topics ?? []) {
      if (typeof t.id !== "string") { result.error("structural_topic", "every topic needs a string id", "topics.json"); continue; }
      if (topicIds.has(t.id)) result.error("hygiene_topic_id", `duplicate topic "${t.id}"`, "topics.json");
      topicIds.add(t.id);
      if (!t.parent || !t.parentKind) result.error("structural_topic", `topic "${t.id}" needs a parent and parentKind`, "topics.json");
    }
  }
  const criteria = contentSet.criteria as { groups?: Array<{ id?: string; topic?: string; kind?: string; when?: unknown }> } | undefined;
  if (criteria !== undefined) {
    const seen = new Set<string>();
    for (const g of criteria.groups ?? []) {
      if (typeof g.id !== "string" || typeof g.topic !== "string") { result.error("structural_criteria", "every criteria group needs an id and topic", "criteria.json"); continue; }
      if (seen.has(g.id)) result.error("hygiene_criteria_id", `duplicate criteria group "${g.id}"`, "criteria.json");
      seen.add(g.id);
      if (g.kind !== "awakening" && g.kind !== "trauma") result.error("structural_criteria_kind", `criteria group "${g.id}" kind must be awakening|trauma`, "criteria.json");
      if (topicIds.size > 0 && !topicIds.has(g.topic)) result.error("referential_criteria_topic", `criteria group "${g.id}" references unknown topic "${g.topic}"`, "criteria.json");
      for (const e of validateCriteriaKeys(g.when, `criteria group "${g.id}"`)) result.error("condition_key", e, "criteria.json");
    }
  }
}

function validateSex(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet.sex_actions as { actions?: Array<{ id?: string; category?: string; targets?: string[]; plays_to?: string[]; requires?: { reaction?: string } }> } | undefined;
  if (data === undefined) return;
  if (!Array.isArray(data.actions) || data.actions.length === 0) {
    result.error("structural_sex", 'sex_actions.json must declare a non-empty "actions" array', "sex_actions.json");
  }
  const seen = new Set<string>();
  const topics = new Set(((contentSet.topics as { topics?: Array<{ id?: string }> } | undefined)?.topics ?? []).map((t) => t.id).filter(Boolean) as string[]);
  const reactions = new Set(((contentSet.reactions as { reactions?: Array<{ id?: string }> } | undefined)?.reactions ?? []).map((r) => r.id).filter(Boolean) as string[]);
  for (const a of data.actions ?? []) {
    if (typeof a.id !== "string") { result.error("structural_sex_action", "every sex action needs a string id", "sex_actions.json"); continue; }
    if (seen.has(a.id)) result.error("hygiene_sex_id", `duplicate sex action "${a.id}"`, "sex_actions.json");
    seen.add(a.id);
    for (const topic of a.plays_to ?? []) {
      if (topics.size > 0 && !topics.has(topic) && !topics.has(`topic.${topic}`)) result.error("referential_sex_topic", `action "${a.id}" references unknown topic "${topic}"`, "sex_actions.json");
    }
    if (a.requires?.reaction && reactions.size > 0 && !reactions.has(a.requires.reaction)) {
      result.error("referential_sex_reaction", `action "${a.id}" requires unknown reaction "${a.requires.reaction}"`, "sex_actions.json");
    }
  }
}

function validateArchetypes(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet.archetypes as { archetypes?: Array<{ id?: string; label?: string; values?: Record<string, { min?: number; max?: number }>; states?: Record<string, { min?: number; max?: number }> }> } | undefined;
  if (data === undefined) return;
  if (!Array.isArray(data.archetypes) || data.archetypes.length === 0) {
    result.error("structural_archetypes", 'archetypes.json must declare a non-empty "archetypes" array', "archetypes.json");
  }
  const mindValues = new Set(((contentSet.mind as { values?: Array<{ id?: string }> } | undefined)?.values ?? []).map((v) => v.id).filter(Boolean) as string[]);
  const seen = new Set<string>();
  for (const a of data.archetypes ?? []) {
    if (typeof a.id !== "string" || typeof a.label !== "string") { result.error("structural_archetype", "every archetype needs an id and label", "archetypes.json"); continue; }
    if (seen.has(a.id)) result.error("hygiene_archetype_id", `duplicate archetype "${a.id}"`, "archetypes.json");
    seen.add(a.id);
    for (const [key, range] of Object.entries({ ...(a.values ?? {}), ...(a.states ?? {}) })) {
      for (const bound of ["min", "max"] as const) {
        const v = (range as Record<string, unknown>)[bound];
        if (typeof v !== "number" || v < 0 || v > 100) result.error("structural_archetype_range", `archetype "${a.id}" ${key}.${bound} must be 0..100`, "archetypes.json");
      }
      if (typeof range.min === "number" && typeof range.max === "number" && range.min > range.max) result.error("structural_archetype_range", `archetype "${a.id}" ${key} range must ascend`, "archetypes.json");
      if (mindValues.size > 0 && !mindValues.has(key)) result.error("referential_archetype_value", `archetype "${a.id}" names unknown mind value "${key}"`, "archetypes.json");
    }
  }
  // every preset id must mirror an archetype id
  const presetIds = ((contentSet.subject_presets as { presets?: Array<{ id?: string }> } | undefined)?.presets ?? []).map((p) => p.id);
  for (const pid of presetIds) if (pid && seen.size > 0 && !seen.has(pid)) result.warn("referential_preset_archetype", `preset "${pid}" has no matching archetype`, "subject_presets.json");
}

function validatePresets(contentSet: ContentSet, result: ValidationResult): void {
  const presets = (contentSet.subject_presets as { presets?: unknown } | undefined)?.presets;
  if (!Array.isArray(presets)) return;
  const reactions = (contentSet.reactions as { reactions?: Array<{ id: string }> } | undefined)?.reactions;
  const reactionIds = Array.isArray(reactions) ? new Set(reactions.map((r) => r.id)) : null;
  const baseGenders = new Set(["female", "male"]);
  for (const preset of presets) {
    const p = preset as { id?: string; base_gender?: string; dispositions?: string[] };
    if (p.base_gender !== undefined && !baseGenders.has(p.base_gender)) {
      result.error("referential_preset_gender", `preset "${p.id}" has unknown base_gender "${p.base_gender}"`, "subject_presets.json");
    }
    if (reactionIds) {
      for (const reactionId of p.dispositions ?? []) {
        if (!reactionIds.has(reactionId)) {
          result.error("referential_preset_disposition", `preset "${p.id}" references unknown reaction "${reactionId}"`, "subject_presets.json");
        }
      }
    }
  }
}

function validateReactions(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.reactions !== undefined) {
    tryBuild(result, "reactions_load", "reactions.json", () => buildReactionCatalog(contentSet.reactions));
  }
  if (contentSet.dispositions !== undefined) {
    const d = contentSet.dispositions as { personalities?: Record<string, { weights?: Record<string, number> }>; default?: { weights?: Record<string, number> } };
    const reactions = (contentSet.reactions as { reactions?: Array<{ id: string }> } | undefined)?.reactions;
    const ids = Array.isArray(reactions) ? new Set(reactions.map((r) => r.id)) : null;
    const groups = [...Object.values(d.personalities ?? {}), d.default].filter(Boolean) as Array<{ weights?: Record<string, number> }>;
    for (const group of groups) {
      for (const reactionId of Object.keys(group.weights ?? {})) {
        if (ids && !ids.has(reactionId)) {
          result.error("referential_disposition_reaction", `dispositions.json references unknown reaction "${reactionId}"`, "dispositions.json");
        }
      }
    }
  }
}

function validateMorphTracks(
  contentSet: ContentSet,
  library: PartLibrary | null,
  result: ValidationResult,
): void {
  if (contentSet.morph_tracks === undefined) return;
  tryBuild(result, "morph_tracks_load", "morph_tracks.json", () =>
    buildMorphTrackRegistry(contentSet.morph_tracks, library),
  );
}

function validateInjectors(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.injectors === undefined) return;
  tryBuild(result, "injectors_load", "injectors.json", () =>
    buildInjectorRegistry(contentSet.injectors),
  );
  const injectors = (contentSet.injectors as { injectors?: Array<{ id: string; type?: string; genome_reference?: string | null }> }).injectors;
  const genomes = (contentSet.genomes as { genomes?: Array<{ id: string }> } | undefined)?.genomes;
  if (Array.isArray(injectors) && Array.isArray(genomes)) {
    const ids = new Set(genomes.map((g) => g.id));
    for (const injector of injectors) {
      if (injector.type === "mutagenic" && injector.genome_reference && !ids.has(injector.genome_reference)) {
        result.error(
          "referential_injector_genome",
          `injector "${injector.id}" references unknown genome "${injector.genome_reference}"`,
          "injectors.json",
        );
      }
    }
  }
}

const POWER_EFFECT_STATS = ["pain", "arousal", "drive", "composure", "resonance", "stability", "fatigue", "overload", "intelligence_debt"];

function validatePowers(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.powers === undefined) return;
  const registry = tryBuild(result, "powers_load", "powers.json", () => buildPowerRegistry(contentSet.powers));
  if (!registry) return;
  const genomes = (contentSet.genomes as { genomes?: Array<{ id: string }> } | undefined)?.genomes;
  const genomeIds = Array.isArray(genomes) ? new Set(genomes.map((g) => g.id)) : null;
  const locations = (contentSet.locations as { locations?: Array<{ id: string }> } | undefined)?.locations;
  const locationIds = Array.isArray(locations) ? new Set(locations.map((l) => l.id)) : null;
  const parts = (contentSet.parts as { parts?: Array<{ occupies_role?: string }> } | undefined)?.parts;
  const roles = Array.isArray(parts) ? new Set(parts.map((p) => p.occupies_role).filter(Boolean) as string[]) : null;
  for (const power of registry.all()) {
    if (power.genome && genomeIds && !genomeIds.has(power.genome)) {
      result.error("referential_power_genome", `power "${power.id}" references unknown genome "${power.genome}"`, "powers.json");
    }
    const scope = power.target.scope;
    if (power.category === "sway" && scope && scope.startsWith("loc.") && locationIds && !locationIds.has(scope)) {
      result.error("referential_power_location", `power "${power.id}" targets unknown location "${scope}"`, "powers.json");
    }
    if (power.reveal?.mode === "magnify" && power.reveal.part && roles && !roles.has(power.reveal.part) && !power.reveal.part.includes(".")) {
      result.error("referential_power_part", `power "${power.id}" magnifies unknown role "${power.reveal.part}"`, "powers.json");
    }
    for (const effect of power.effects) {
      if (!POWER_EFFECT_STATS.includes(effect.stat)) {
        result.error("referential_power_effect_stat", `power "${power.id}" targets unknown stat "${effect.stat}"`, "powers.json");
      }
    }
  }
}

function validateEvents(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.events === undefined) return;
  const registry = tryBuild(result, "events_load", "events.json", () => buildEventRegistry(contentSet.events));
  if (!registry) return;
  const raw = contentSet.events as { events?: Array<{ type?: string; base?: number; mods?: Array<{ when?: unknown }> }> };
  const seen = new Set<string>();
  for (const e of raw.events ?? []) {
    if (typeof e.type !== "string" || e.type.length === 0) {
      result.error("structural_event_type", "every event needs a non-empty type", "events.json");
      continue;
    }
    if (seen.has(e.type)) result.error("hygiene_event_type", `duplicate event type "${e.type}"`, "events.json");
    seen.add(e.type);
    if (typeof e.base !== "number" || e.base < 0 || e.base > 1) {
      result.error("structural_event_salience", `event "${e.type}" base must be 0..1`, "events.json");
    }
    const cat = (e as { category?: unknown }).category;
    if (typeof cat !== "string" || cat.length === 0) result.error("structural_event_category", `event "${e.type}" needs a category`, "events.json");
    const fields = (e as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) result.error("structural_event_fields", `event "${e.type}" needs a fields array (S75)`, "events.json");
    for (const mod of e.mods ?? []) {
      for (const err of validateConditionKeys(mod.when, `event "${e.type}" mod`)) {
        result.error("condition_key", err, "events.json");
      }
    }
  }
  for (const required of ["world.tick", "power.applied", "stage.crossed", "reaction.awakened"]) {
    if (!seen.has(required)) result.error("referential_event_required", `events.json is missing required type "${required}"`, "events.json");
  }
}

/**
 * Path convention (§3.0 I7): a dotted id is *nested*, so an object key must be a
 * bare id segment, never a dotted id spelled flat. Catches the class of bug
 * where `traits["trait.height"]` coexists with `traits.trait.height`.
 */
function validatePathConvention(contentSet: ContentSet, result: ValidationResult): void {
  const tables: Array<[string, string]> = [
    ["genomes", "id"],
    ["traits", "id"],
    ["attributes", "id"],
    ["parts", "id"],
  ];
  for (const [file, key] of tables) {
    const data = contentSet[file as keyof ContentSet] as { [k: string]: Array<Record<string, string>> } | undefined;
    if (!data) continue;
    const list = data[file];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = item[key];
      if (typeof id !== "string") continue;
      // a flat key that repeats its own namespace is a convention violation
      if (/^[a-z]+_[a-z]+\.[a-z]/.test(id)) {
        result.warn("path_flat_namespace", `"${id}" in ${file}.json repeats its namespace as a flat key`, `${file}.json`);
      }
    }
  }
}

function validateAbilities(contentSet: ContentSet, result: ValidationResult): void {
  const data = contentSet as { abilities?: unknown; faults?: unknown; stances?: unknown; training?: unknown; play_options?: unknown };
  const abilities = data.abilities !== undefined
    ? tryBuild(result, "abilities_load", "abilities.json", () => buildAbilityRegistry(data.abilities))
    : null;
  const faults = data.faults !== undefined
    ? tryBuild(result, "faults_load", "faults.json", () => buildFaultRegistry(data.faults))
    : null;
  if (data.training !== undefined) tryBuild(result, "training_load", "training.json", () => buildTrainingConfig(data.training));
  if (data.stances !== undefined) tryBuild(result, "stances_load", "stances.json", () => buildStances(data.stances));
  if (data.play_options !== undefined) {
    const play = tryBuild(result, "play_load", "play_options.json", () => buildPlayConfig(data.play_options));
    if (play) {
      const attrIds = new Set(((contentSet.attributes as { attributes?: Array<{ id: string }> } | undefined)?.attributes ?? []).map((a) => a.id));
      const reactionIds = new Set(((contentSet.reactions as { reactions?: Array<{ id: string }> } | undefined)?.reactions ?? []).map((r) => r.id));
      for (const option of play.options) {
        const req = option.requires;
        if (!req) continue;
        if ("reaction" in req && !reactionIds.has(req.reaction)) {
          result.error("referential_play_reaction", `play option "${option.id}" requires unknown reaction "${req.reaction}"`, "play_options.json");
        }
      }
      void attrIds;
    }
  }
  if (!abilities) return;
  const genotypes = (contentSet.genomes as { genomes?: Array<{ id: string }> } | undefined)?.genomes;
  void genotypes;
  const attrIds = new Set(((contentSet.attributes as { attributes?: Array<{ id: string }> } | undefined)?.attributes ?? []).map((a) => a.id));
  const partTags = new Set(((contentSet.parts as { parts?: Array<{ tags?: string[] }> } | undefined)?.parts ?? []).flatMap((p) => p.tags ?? []));
  const abilityIds = new Set(abilities.all().map((a) => a.id));
  const faultIds = new Set((faults?.all() ?? []).map((f) => f.id));
  const STATS = ["agility", "composure", "perception", "intelligence", "strength", "endurance"];
  for (const ability of abilities.all()) {
    // an ability must not appear at a bare stub: it needs the anatomy to have grown.
    if ((ability.acquire_at ?? 0) < 0.2 && !ability.always_held) {
      result.error("referential_ability_early", `ability "${ability.id}" acquires at ${ability.acquire_at ?? 0} — its anatomy is still a stub`, "abilities.json");
    }
    for (const grant of ability.granted_by ?? []) {
      if (!attrIds.has(grant)) result.error("referential_ability_grant", `ability "${ability.id}" is granted by unknown attribute "${grant}"`, "abilities.json");
    }
    for (const tag of ability.requires_part_tags ?? []) {
      if (!partTags.has(tag)) result.error("referential_ability_tag", `ability "${ability.id}" requires unknown part tag "${tag}"`, "abilities.json");
    }
    for (const syn of ability.synergies ?? []) {
      if (!abilityIds.has(syn.with)) result.error("referential_ability_synergy", `ability "${ability.id}" synergises with unknown "${syn.with}"`, "abilities.json");
    }
    for (const conflict of ability.conflicts_with ?? []) {
      if (!abilityIds.has(conflict)) result.error("referential_ability_conflict", `ability "${ability.id}" conflicts with unknown "${conflict}"`, "abilities.json");
    }
    if (!STATS.includes(ability.test_stat)) result.error("referential_ability_stat", `ability "${ability.id}" has unknown test_stat "${ability.test_stat}"`, "abilities.json");
    for (const tier of ability.mastery_tiers ?? []) {
      for (const faultId of tier.faults ?? []) {
        if (faults && !faultIds.has(faultId)) result.error("referential_ability_fault", `ability "${ability.id}" tier ${tier.tier} references unknown fault "${faultId}"`, "abilities.json");
      }
    }
  }
}

function validatePhases(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.phases === undefined) return;
  const seq = tryBuild(result, "phases_load", "phases.json", () => buildPhaseSequencer(contentSet.phases));
  if (!seq) return;
  const skeleton = contentSet.skeleton !== undefined
    ? tryBuild(result, "skeleton_load", "skeleton.json", () => buildSkeleton(contentSet.skeleton))
    : null;
  const families = (contentSet.attributes as { attributes?: Array<{ family?: string }> } | undefined)?.attributes ?? [];
  const familySet = new Set(families.map((a) => a.family).filter(Boolean) as string[]);
  const genomes = (contentSet.genomes as { genomes?: Array<{ id: string }> } | undefined)?.genomes;
  for (const planId of ["default", ...(genomes ?? []).map((g) => g.id)]) {
    const plan = seq.planFor(planId);
    for (const phase of plan.phases) {
      for (const role of phase.roles ?? []) {
        if (skeleton && !skeleton.hasRole(role) && role !== "default") {
          result.error("referential_phase_role", `phase "${phase.id}" targets unknown role "${role}"`, "phases.json");
        }
      }
      for (const family of phase.families ?? []) {
        if (familySet.size > 0 && !familySet.has(family)) {
          result.error("referential_phase_family", `phase "${phase.id}" targets unknown family "${family}"`, "phases.json");
        }
      }
      if (phase.when) {
        for (const e of validateCriteriaKeys(phase.when, `phase "${phase.id}" gate`)) result.error("condition_key", e, "phases.json");
      }
    }
  }
}

function validateDistribution(
  contentSet: ContentSet,
  skeleton: Skeleton | null,
  result: ValidationResult,
): void {
  if (contentSet.distribution === undefined) return;
  const dist = tryBuild(result, "distribution_load", "distribution.json", () =>
    buildDistribution(contentSet.distribution),
  );
  if (dist && skeleton) {
    for (const problem of dist.validateAgainst(skeleton)) {
      result.error("referential_distribution_role", problem, "distribution.json");
    }
    const genomes = (contentSet.genomes as { genomes?: Array<{ id: string }> } | undefined)?.genomes;
    if (Array.isArray(genomes)) {
      const ids = new Set(genomes.map((g) => g.id));
      for (const id of Object.keys((contentSet.distribution as { orders?: Record<string, unknown> }).orders ?? {})) {
        if (!ids.has(id)) {
          result.error("referential_distribution_genome", `distribution order for unknown genome "${id}"`, "distribution.json");
        }
      }
    }
  }
}

function validateAttributesAndTraits(
  contentSet: ContentSet,
  skeleton: Skeleton | null,
  library: PartLibrary | null,
  result: ValidationResult,
): void {
  const attributes =
    contentSet.attributes !== undefined
      ? tryBuild(result, "attributes_load", "attributes.json", () =>
          buildAttributeRegistry(contentSet.attributes),
        )
      : null;
  const traits =
    contentSet.traits !== undefined
      ? tryBuild(result, "traits_load", "traits.json", () => buildTraitRegistry(contentSet.traits))
      : null;

  if (attributes) {
    for (const attr of attributes.all()) {
      for (const role of attr.target_roles ?? []) {
        if (skeleton && !roleHasMatch(skeleton, role)) {
          result.error(
            "referential_target_role",
            `attribute "${attr.id}" targets unknown role "${role}"`,
            "attributes.json",
          );
        }
      }
      const mode = attr.stack_mode ?? "replace";
      if (mode === "additive" && !attributes.hasReplaceMember(attr.family)) {
        result.error(
          "structural_family_no_replace",
          `family "${attr.family}" has no "replace" member for additive attribute "${attr.id}"`,
          "attributes.json",
        );
      }
      if (attr.hidden === true && attr.description_key) {
        result.warn(
          "hygiene_hidden_description",
          `hidden attribute "${attr.id}" declares a description_key`,
          "attributes.json",
        );
      }
      if (attr.counts_toward_exposure !== undefined && typeof attr.counts_toward_exposure !== "boolean") {
        result.error(
          "structural_exposure_flag",
          `attribute "${attr.id}" counts_toward_exposure must be a boolean`,
          "attributes.json",
        );
      }
    }
  }

  if (attributes && traits) {
    const granted = new Set<string>();
    const genomeTraitIds = new Set(
      ((contentSet.genomes as { genomes?: Array<{ traits?: string[] }> } | undefined)?.genomes ?? []).flatMap((g) => g.traits ?? []),
    );
    for (const trait of traits.all()) {
      for (const attrId of trait.grants) {
        granted.add(attrId);
        const attr = attributes.get(attrId);
        if (!attr) {
          result.error(
            "referential_grant",
            `trait "${trait.id}" grants unknown attribute "${attrId}"`,
            "traits.json",
          );
          continue;
        }
        if (attr.hidden === true && attr.family === "structure") {
          const allowHiddenGrant = trait.grants.some((g) => {
            const a = attributes.get(g);
            return a && a.hidden !== true;
          });
          if (!allowHiddenGrant) {
            result.error(
              "structural_hidden_direct_grant",
              `trait "${trait.id}" grants hidden structure attribute "${attrId}" with no visible attribute`,
              "traits.json",
            );
          }
        }
      }
      if (trait.family && !attributes.families().includes(trait.family)) {
        result.error(
          "referential_trait_family",
          `trait "${trait.id}" declares unknown family "${trait.family}"`,
          "traits.json",
        );
      }
    }
    for (const attr of attributes.all()) {
      if (!granted.has(attr.id)) {
        result.error(
          "referential_unreachable_attribute",
          `attribute "${attr.id}" is not granted by any trait`,
          "attributes.json",
        );
      }
      if (library && !attributeCanApply(attr, library)) {
        result.error(
          "referential_attribute_never_applies",
          `attribute "${attr.id}" can never apply: no part in its target roles carries family "${attr.family}" and all required tags`,
          "attributes.json",
        );
      }
      // noticing coverage (D-213): a hidden attribute that drives a morph is a real
      // change, so it must opt into a notice path or awareness would have a blind spot.
      const notice = (attr as { notice?: string }).notice;
      if (notice === undefined && attr.hidden === true && (attr as { morph_track?: string }).morph_track) {
        result.error(
          "structural_hidden_no_notice",
          `hidden morphing attribute "${attr.id}" can never be noticed: give it notice "felt"`,
          "attributes.json",
        );
      }
      // an attribute that morphs a part must be granted by a genome, or the part never swaps.
      if ((attr as { morph_track?: string }).morph_track) {
        const grantedByGenome = traits.all().some((t) => t.grants.includes(attr.id) && genomeTraitIds.has(t.id));
        if (!grantedByGenome) {
          result.error(
            "referential_morph_no_genome",
            `attribute "${attr.id}" morphs a part but no genome grants it — the part will never swap`,
            "attributes.json",
          );
        }
      }
    }
  }
}

function attributeCanApply(attr: AttributeShape, library: PartLibrary): boolean {
  const roles = attr.target_roles ?? [];
  const required = attr.requires_part_tags ?? [];
  return library
    .all()
    .some(
      (part) =>
        (roles.length === 0 || roles.includes(part.occupies_role)) &&
        (part.mutable_aspects ?? []).includes(attr.family) &&
        required.every((tag) => (part.tags ?? []).includes(tag)),
    );
}

interface AttributeShape {
  family: string;
  target_roles?: string[];
  requires_part_tags?: string[];
}

function roleHasMatch(skeleton: Skeleton, role: string): boolean {
  if (skeleton.hasRole(role)) return true;
  if (role.includes("*")) {
    return expandWildcard(role).some((id) => skeleton.get(id) !== null);
  }
  return false;
}

function validateGenomes(contentSet: ContentSet, result: ValidationResult): void {
  const genomes =
    contentSet.genomes !== undefined
      ? tryBuild(result, "genomes_load", "genomes.json", () => buildGenomeRegistry(contentSet.genomes))
      : null;
  const traits =
    contentSet.traits !== undefined
      ? tryBuild(result, "traits_load", "traits.json", () => buildTraitRegistry(contentSet.traits))
      : null;
  const feral =
    contentSet.feral !== undefined
      ? tryBuild(result, "feral_load", "feral.json", () => buildFeralRegistry(contentSet.feral))
      : null;

  if (!genomes) return;

  for (const genome of genomes.all()) {
    for (const traitId of genome.traits) {
      if (traits && !traits.has(traitId)) {
        result.error(
          "referential_genome_trait",
          `genome "${genome.id}" references unknown trait "${traitId}"`,
          "genomes.json",
        );
      }
    }
    if (genome.feral_profile !== null && genome.feral_profile !== undefined) {
      if (feral && !feral.get(genome.feral_profile)) {
        result.error(
          "referential_feral_profile",
          `genome "${genome.id}" references unknown feral_profile "${genome.feral_profile}"`,
          "genomes.json",
        );
      }
    }
  }

  // species genitals: a genome's genital block must point at real genital parts
  const genLib = contentSet.parts !== undefined
    ? tryBuild(result, "parts_load_genital", "parts.json", () => buildPartLibrary(contentSet.parts))
    : null;
  if (genLib) {
    for (const genome of genomes.all()) {
      try {
        validateGenitalPlan(genome, genLib);
      } catch (err) {
        result.error("referential_genital_plan", (err as Error).message, "genomes.json");
      }
    }
  }

  const allMods = genomes.all().map((g) => g.stat_modifiers ?? {});
  const stacked = stackStatModifiers(allMods);
  for (const [stat, value] of Object.entries(stacked)) {
    if (Math.abs(value) > SOFT_CAP_CEILING + 1e-9) {
      result.error(
        "structural_stat_soft_cap",
        `stacked stat modifier for "${stat}" exceeds the soft cap (${value.toFixed(2)})`,
        "genomes.json",
      );
    }
  }
  // gated modifier shape + gate-key validity (D-194)
  for (const g of genomes.all()) {
    for (const [stat, mod] of Object.entries(g.stat_modifiers ?? {})) {
      const problem = checkModifier(mod);
      if (problem) result.error("structural_modifier", `genome "${g.id}" stat_modifier "${stat}": ${problem}`, "genomes.json");
      if (typeof mod === "object" && mod.when) for (const e of validateCriteriaKeys(mod.when, `genome "${g.id}" ${stat} gate`)) result.error("condition_key", e, "genomes.json");
    }
    for (const [value, mod] of Object.entries(g.mentality ?? {})) {
      const problem = checkModifier(mod);
      if (problem) result.error("structural_modifier", `genome "${g.id}" mentality "${value}": ${problem}`, "genomes.json");
      if (typeof mod === "object" && mod.when) for (const e of validateCriteriaKeys(mod.when, `genome "${g.id}" ${value} gate`)) result.error("condition_key", e, "genomes.json");
    }
  }
  void buildCriteria;
}

function validateRegistries(contentSet: ContentSet, result: ValidationResult): void {
  if (contentSet.exposure_bands !== undefined) {
    tryBuild(result, "exposure_bands_load", "exposure_bands.json", () =>
      buildExposureBandRegistry(contentSet.exposure_bands),
    );
  }
  if (contentSet.flags !== undefined) {
    tryBuild(result, "flags_load", "flags.json", () => buildFlagRegistry(contentSet.flags));
  }
  if (contentSet.tokens !== undefined) {
    tryBuild(result, "tokens_load", "tokens.json", () => buildTokenRegistry(contentSet.tokens));
  }
  if (contentSet.axes !== undefined) {
    tryBuild(result, "axes_load", "axes.json", () => buildAxisRegistry(contentSet.axes));
  }
}

function validateRawHygiene(contentSet: ContentSet, result: ValidationResult): void {
  const slots = (contentSet.skeleton as { slots?: unknown[] } | undefined)?.slots;
  if (Array.isArray(slots)) {
    const seen = new Set<string>();
    for (const slot of slots) {
      const id = (slot as { id?: unknown })?.id;
      if (typeof id === "string") {
        if (seen.has(id)) {
          result.error("hygiene_slot_id", `duplicate slot id "${id}"`, "skeleton.json");
        }
        seen.add(id);
      }
    }
  }

  const parts = (contentSet.parts as { parts?: unknown[] } | undefined)?.parts;
  if (Array.isArray(parts)) {
    const seen = new Set<string>();
    for (const part of parts) {
      const id = (part as { id?: unknown })?.id;
      if (typeof id === "string") {
        if (seen.has(id)) {
          result.error("hygiene_part_id", `duplicate part id "${id}"`, "parts.json");
        }
        seen.add(id);
        if (id.includes("*")) {
          result.error(
            "hygiene_part_wildcard",
            `part id "${id}" must not contain a side wildcard`,
            "parts.json",
          );
        }
      }
    }
  }
}

function validateReferential(
  skeleton: Skeleton,
  library: PartLibrary,
  result: ValidationResult,
): void {
  for (const template of library.all()) {
    if (!skeleton.hasRole(template.occupies_role)) {
      result.error(
        "referential_occupies_role",
        `part "${template.id}" occupies unknown role "${template.occupies_role}"`,
        "parts.json",
      );
    }
    for (const provided of template.provides ?? []) {
      if (!skeleton.hasRole(provided.role)) {
        result.error(
          "referential_provides_role",
          `part "${template.id}" provides unknown role "${provided.role}"`,
          "parts.json",
        );
      }
    }
  }

  const knownAspects: ReadonlySet<string> = new Set(ASPECT_FAMILIES);
  for (const template of library.all()) {
    for (const aspect of template.mutable_aspects ?? []) {
      if (!knownAspects.has(aspect)) {
        result.error(
          "referential_mutable_aspect",
          `part "${template.id}" declares unknown mutable_aspect "${aspect}"`,
          "parts.json",
        );
      }
    }
  }
}

function validateStructural(
  skeleton: Skeleton,
  library: PartLibrary,
  result: ValidationResult,
): void {
  const byRole = new Map<string, string[]>();
  for (const template of library.all()) {
    const policy = template.merge_policy ?? "none";
    if (!(MERGE_POLICIES as readonly string[]).includes(policy)) {
      result.error(
        "structural_merge_policy",
        `part "${template.id}" has unknown merge_policy "${policy}"`,
        "parts.json",
      );
    }
    if (template.integrity !== undefined && (template.integrity < 0 || template.integrity > 100)) {
      result.error(
        "structural_integrity",
        `part "${template.id}" integrity must be 0..100`,
        "parts.json",
      );
    }
    const list = byRole.get(template.occupies_role) ?? [];
    list.push(policy);
    byRole.set(template.occupies_role, list);
  }

  for (const role of skeleton.allRoles()) {
    if (role === "root") continue;
    const roleSlots = skeleton.rolesFor(role);
    if (roleSlots.length === 0) {
      result.error("structural_role_unfillable", `role "${role}" has no slots`, "skeleton.json");
    }
    const policies = byRole.get(role);
    if (policies && !policies.includes("none")) {
      result.warn("structural_role_no_default", `role "${role}" has no default part`, "parts.json");
    }
  }
}

function validateHygiene(skeleton: Skeleton, library: PartLibrary, result: ValidationResult): void {
  const ids = new Set<string>();
  for (const slot of skeleton.slots) {
    if (ids.has(slot.id)) {
      result.error("hygiene_slot_id", `duplicate slot id "${slot.id}"`, "skeleton.json");
    }
    ids.add(slot.id);
  }

  const partIds = new Set<string>();
  for (const template of library.all()) {
    if (partIds.has(template.id)) {
      result.error("hygiene_part_id", `duplicate part id "${template.id}"`, "parts.json");
    }
    partIds.add(template.id);
    if (template.id.includes("*")) {
      result.error(
        "hygiene_part_wildcard",
        `part id "${template.id}" must not contain a side wildcard`,
        "parts.json",
      );
    }
  }
}

export function assertValid(contentSet: unknown): ValidationReport {
  const report = validateContentSet(contentSet);
  if (!report.ok) {
    const first = report.errors[0];
    throw new Error(`invalid content set: ${first?.rule} - ${first?.message}`);
  }
  return report;
}
