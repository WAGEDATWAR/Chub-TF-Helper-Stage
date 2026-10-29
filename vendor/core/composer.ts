import { ContentError } from "./loader";
import type { AttributeRegistry } from "./attributes";
import type { PartInstance } from "./parts";
import type { Subject } from "./subject";

export const TONE_KEYS = Object.freeze(["pain", "arousal", "exposure"]);

export function interpolateTokens(text: string, tokens: Record<string, string | number | undefined> | null): string {
  if (typeof text !== "string") return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (tokens && Object.prototype.hasOwnProperty.call(tokens, name)) {
      const value = tokens[name];
      return value === undefined || value === null ? "" : String(value);
    }
    return match;
  });
}

export interface ToneBand {
  min: number;
  max: number;
  modifier: string;
}

export function bandForValue(bands: ToneBand[] | undefined, value: number): ToneBand | null {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  let chosen: ToneBand | null = null;
  for (const band of bands) {
    if (value >= band.min) chosen = band;
    else break;
  }
  return chosen;
}

export interface AttributeFragment {
  short?: string;
  stages?: string[];
}

export interface PartFragment {
  base?: string;
  short?: string;
}

export interface AbilityFragment {
  tier1?: string;
  tier2?: string;
  tier3?: string;
  tier4?: string;
  forced?: string;
}

export class FragmentLibrary {
  readonly attribute: Record<string, AttributeFragment>;
  readonly part: Record<string, PartFragment>;
  readonly stage: Record<string, string>;
  readonly ability: Record<string, AbilityFragment>;

  constructor(fragments: unknown) {
    if (!fragments || typeof fragments !== "object") {
      throw new ContentError("fragments.json must be an object", "fragments.json");
    }
    const f = fragments as Record<string, unknown>;
    this.attribute = (f.attribute as Record<string, AttributeFragment>) ?? {};
    this.part = (f.part as Record<string, PartFragment>) ?? {};
    this.stage = (f.stage as Record<string, string>) ?? {};
    this.ability = (f.ability as Record<string, AbilityFragment>) ?? {};
  }

  abilityFragment(abilityId: string): AbilityFragment | null {
    const key = abilityId.startsWith("ability.") ? abilityId : `ability.${abilityId}`;
    return this.ability[key] ?? null;
  }

  attributeFragment(attrId: string): AttributeFragment | null {
    return this.attribute[attrId] ?? null;
  }

  partFragment(partId: string): PartFragment | null {
    return this.part[partId] ?? null;
  }

  stageFragment(descKey: string): string | null {
    return this.stage[descKey] ?? null;
  }
}

export function buildFragmentLibrary(data: unknown): FragmentLibrary {
  return new FragmentLibrary(data);
}

export class ToneLibrary {
  private readonly tone: Record<string, ToneBand[]>;

  constructor(tone: unknown) {
    if (!tone || typeof tone !== "object") {
      throw new ContentError("tone.json must be an object", "tone.json");
    }
    this.tone = tone as Record<string, ToneBand[]>;
  }

  modifierFor(key: string, value: number): string {
    const bands = this.tone[key];
    if (!Array.isArray(bands)) return "";
    const band = bandForValue(bands, value);
    return band?.modifier ?? "";
  }
}

export function buildToneLibrary(data: unknown): ToneLibrary {
  return new ToneLibrary(data);
}

export interface ComposerOptions {
  attributes: AttributeRegistry;
  fragments: FragmentLibrary;
  tone: ToneLibrary;
}

interface SubjectLike {
  body: { get(slot: string): PartInstance | null; allInstances(): PartInstance[] };
  stats?: Record<string, number>;
  derived?: { exposure?: number; transformState?: string; speechMultiplier?: number };
}

export class Composer {
  readonly attributes: AttributeRegistry;
  readonly fragments: FragmentLibrary;
  readonly tone: ToneLibrary;

  constructor(opts: ComposerOptions) {
    this.attributes = opts.attributes;
    this.fragments = opts.fragments;
    this.tone = opts.tone;
  }

  composeTokens(subject: SubjectLike, instance: PartInstance): Record<string, string> {
    const tokens: Record<string, string> = {};
    const attrs = this._sortedAttributes(instance);
    const primary = attrs[0]?.attr ?? null;
    if (primary && primary.stages) {
      const stage = primary.stages[instance.attributes.find((a) => a.id === primary.id)?.stage_index ?? 0];
      tokens.stage = stage?.name ?? primary.display_name ?? "";
    }
    tokens.claws = this.describeAspect(instance, "claws") ?? "nails";
    tokens.coat = this.describeAspect(instance, "coat") ?? "skin";
    tokens.scent = this.describeAspect(instance, "skin") ?? "her usual scent";
    tokens.tail = instance.role === "tail" ? this.fragments.partFragment(instance.id)?.short ?? "tail" : "no tail";
    tokens.ears = instance.role === "ears" ? this.fragments.partFragment(instance.id)?.short ?? "ears" : "ears";
    tokens.eyes = instance.role === "eyes" ? this.fragments.partFragment(instance.id)?.short ?? "eyes" : "eyes";
    tokens.voice = "her voice";
    tokens.exposure_band = subject?.derived?.transformState ?? "baseline";
    return tokens;
  }

  describeAspect(instance: PartInstance, family: string): string | null {
    const attrs = this._sortedAttributes(instance).filter((a) => a.attr.family === family);
    if (attrs.length === 0) return null;
    const first = attrs[0]!;
    const frag = this.fragments.attributeFragment(first.attr.id);
    if (!frag) return first.attr.display_name ?? null;
    const stageIndex = instance.attributes.find((a) => a.id === first.attr.id)?.stage_index ?? 0;
    return frag.stages?.[stageIndex] ?? frag.short ?? first.attr.display_name ?? null;
  }

  describeInstance(
    subject: SubjectLike,
    instance: PartInstance,
    { tokens = null }: { tokens?: Record<string, string> | null } = {},
  ): string {
    const visible = this._sortedAttributes(instance).filter((a) => a.attr.hidden !== true);
    const tokenTable = tokens ?? this.composeTokens(subject, instance);

    if (visible.length === 0) {
      const partFrag = this.fragments.partFragment(instance.id);
      const fallback = partFrag?.base ?? instance.template.display_name ?? instance.id;
      return interpolateTokens(fallback, tokenTable);
    }

    const parts: string[] = [];
    for (const { attr, entry } of visible) {
      const frag = this.fragments.attributeFragment(attr.id);
      if (!frag) {
        parts.push(attr.display_name ?? attr.id);
        continue;
      }
      const stageText = frag.stages?.[entry.stage_index];
      parts.push(interpolateTokens(stageText ?? frag.short ?? attr.display_name ?? attr.id, tokenTable));
    }

    const tonePrefix = this._tonePrefix(subject);
    const joined = joinNatural(parts);
    const partName = instance.displayName(this.fragments.partFragment(instance.id)?.short ?? instance.template.display_name ?? instance.id);
    return `${tonePrefix}${partName}: ${joined}`;
  }

  describeSubject(subject: SubjectLike, { slots = null, group = true }: { slots?: string[] | null; group?: boolean } = {}): string[] {
    const targetSlots = slots ?? subject.body.allInstances().map((i) => i.slot).sort();
    const groups = new Map<string, { line: string; slots: string[] }>();
    for (const slot of targetSlots) {
      const instance = subject.body.get(slot);
      if (!instance) continue;
      const line = this.describeInstance(subject, instance);
      const key = group
        ? `${instance.role}|${instance.id}|${line.replace(/^(.*—\s*)?[^:]*:\s*/, "$1")}`
        : line;
      if (!groups.has(key)) groups.set(key, { line, slots: [] });
      groups.get(key)!.slots.push(slot);
    }
    const out: string[] = [];
    for (const { line, slots: slotsInGroup } of groups.values()) {
      if (group && slotsInGroup.length > 1) {
        out.push(`${this._pluralLabel(slotsInGroup)}: ${line}`);
      } else {
        out.push(line);
      }
    }
    return out;
  }

  /**
   * The body as **one paragraph** (M14.6, S48): the overall state is hoisted out
   * of every part line and stated once; an attribute shared across many parts is
   * hoisted too ("a full coat carpets her arms and back, not repeated per part");
   * the rest become clauses grouped by part. This is the readable read the
   * character sheet and the LLM context bundle draw from.
   */
  describeBody(subject: SubjectLike, { slots = null }: { slots?: string[] | null } = {}): string {
    const possessive = this._possessive(subject);
    const targetSlots = (slots ?? subject.body.allInstances().map((i) => i.slot)).slice().sort(canonicalSlot);

    // gather (attrId -> stage text) per part, then hoist phrases that dominate.
    const perPart = new Map<string, { instance: PartInstance; phrases: Array<{ id: string; text: string }> }>();
    const freq = new Map<string, { text: string; parts: string[] }>();
    for (const slot of targetSlots) {
      const instance = subject.body.get(slot);
      if (!instance) continue;
      const phrases = this._attributePhrases(instance);
      if (phrases.length === 0) continue;
      perPart.set(slot, { instance, phrases });
      for (const p of phrases) {
        const bucket = freq.get(p.id) ?? { text: p.text, parts: [] };
        bucket.parts.push(slot);
        freq.set(p.id, bucket);
      }
    }
    const hoistThreshold = Math.max(3, Math.ceil(perPart.size / 3));
    const hoistedIds = new Set<string>();
    const hoisted: string[] = [];
    for (const [id, bucket] of freq) {
      if (bucket.parts.length < hoistThreshold) continue;
      hoistedIds.add(id);
      hoisted.push(`${bucket.text} across ${this._regionsOf(bucket.parts, possessive)}`);
    }

    const clauses: string[] = [];
    const groups = new Map<string, { phrases: string[]; slots: string[] }>();
    for (const [slot, { instance, phrases }] of perPart) {
      const kept = phrases.filter((p) => !hoistedIds.has(p.id)).map((p) => p.text);
      if (kept.length === 0) continue;
      const key = `${instance.role}|${instance.id}|${kept.join("|")}`;
      if (!groups.has(key)) groups.set(key, { phrases: kept, slots: [] });
      groups.get(key)!.slots.push(slot);
    }
    for (const { phrases, slots: slotsInGroup } of groups.values()) {
      const instance = subject.body.get(slotsInGroup[0]!)!;
      const noun = this._partNoun(instance, slotsInGroup, possessive);
      // if the phrase already names the part ("human ears") or is a noun phrase
      // ("a keen animal nose"), lead with the possessive and drop a bare article;
      // otherwise prefix the part noun ("her nose, keen and reading the air").
      const rendered = phrases.map((p) => {
        if (phraseNamesPart(p, noun)) return { kind: "named" as const, text: stripArticle(p) };
        if (startsWithArticle(p)) return { kind: "article" as const, text: p };
        return { kind: "adj" as const, text: p };
      });
      if (rendered.every((r) => r.kind === "named")) {
        // every phrase already carries the part: "her human ears"
        clauses.push(`${possessive} ${joinNatural(rendered.map((r) => r.text))}`);
      } else if (rendered.some((r) => r.kind === "article")) {
        // a noun-phrase attribute — appositive, the rest attach after a comma:
        // "her head, a flat human face and fully pack-minded, uneasy alone"
        clauses.push(`${noun}, ${joinNatural(rendered.map((r) => r.text))}`);
      } else {
        clauses.push(`${noun} ${joinNatural(rendered.map((r) => r.text))}`);
      }
    }

    const tone = this._tonePrefix(subject).replace(/\s*—\s*$/, ".");
    const parts: string[] = [];
    if (tone) parts.push(tone);
    if (hoisted.length > 0) parts.push(`${capitalise(hoisted.join("; "))}.`);
    if (clauses.length > 0) parts.push(`${capitalise(joinNatural(clauses))}.`);
    return parts.length > 0 ? parts.join(" ") : "She reads as she is.";
  }

  /** "her arms, back and torso" — region words for a set of hoisted slots. */
  private _regionsOf(slots: string[], possessive: string): string {
    const words = [...new Set(slots.map((s) => regionWord(s)))];
    return `${possessive} ${joinNatural(words)}`;
  }

  /** Attribute phrases for a part: stage descriptions, no part-name lead. */
  private _attributePhrases(instance: PartInstance): Array<{ id: string; text: string }> {
    const visible = this._sortedAttributes(instance).filter((a) => a.attr.hidden !== true);
    const tokens = this.composeTokens(null as never, instance);
    const phrases: Array<{ id: string; text: string }> = [];
    for (const { attr, entry } of visible) {
      const frag = this.fragments.attributeFragment(attr.id);
      const text = frag
        ? interpolateTokens(frag.stages?.[entry.stage_index] ?? frag.short ?? attr.display_name ?? attr.id, tokens)
        : attr.display_name ?? attr.id;
      phrases.push({ id: attr.id, text: humanizePhrase(text) });
    }
    return phrases;
  }

  /** The noun for a part: "her", "both her hands". */
  private _partNoun(instance: PartInstance, slots: string[], possessive: string): string {
    const frag = this.fragments.partFragment(instance.id);
    const raw = frag?.short ?? instance.template.display_name ?? instance.id;
    const name = humanizeName(instance.displayName(raw));
    const sides = slots.filter((s) => /\.(L|R)$/.test(s));
    if (sides.length === slots.length && sides.length === 2) return `both ${possessive} ${plural(name)}`;
    return `${possessive} ${name}`;
  }

  private _possessive(subject: SubjectLike): string {
    return (subject as { possessives?: string }).possessives ?? "her";
  }

  private _pluralLabel(slots: string[]): string {
    const sides = slots.filter((s) => /\.(L|R)$/.test(s)).length;
    if (sides === slots.length && sides === 2) {
      return `both ${slots[0]!.replace(/\.(L|R)$/, "")}`;
    }
    return `${slots.length}× ${slots[0]!.replace(/\.(L|R)$/, "")}`;
  }

  abilityLine(abilityId: string, masteryTier: number, forced = false): string {
    const entry = this.fragments.abilityFragment(abilityId);
    if (forced) return entry?.forced ?? "they are out, and staying out";
    const tiers = ["tier1", "tier2", "tier3", "tier4"] as const;
    const idx = Math.max(1, Math.min(4, masteryTier ?? 1)) - 1;
    return entry?.[tiers[idx]] ?? entry?.tier1 ?? "they answer to her, mostly";
  }

  private _tonePrefix(subject: SubjectLike | null): string {
    if (!subject) return "";
    const parts: string[] = [];
    const pain = subject.stats?.pain ?? 0;
    const arousal = subject.stats?.arousal ?? 0;
    const exposure = subject.derived?.exposure ?? 0;
    const painMod = this.tone.modifierFor("pain", pain);
    const arousalMod = this.tone.modifierFor("arousal", arousal);
    const exposureMod = this.tone.modifierFor("exposure", exposure);
    if (painMod) parts.push(painMod);
    if (arousalMod) parts.push(arousalMod);
    if (exposureMod) parts.push(exposureMod);
    return parts.length > 0 ? `${parts.join(", ")} — ` : "";
  }

  private _sortedAttributes(instance: PartInstance): Array<{ entry: (typeof instance.attributes)[number]; attr: NonNullable<ReturnType<AttributeRegistry["get"]>> }> {
    return instance.attributes
      .map((entry) => ({ entry, attr: this.attributes.get(entry.id) }))
      .filter((x): x is { entry: (typeof instance.attributes)[number]; attr: NonNullable<ReturnType<AttributeRegistry["get"]>> } => x.attr !== null)
      .sort((a, b) => (b.attr.priority ?? 0) - (a.attr.priority ?? 0) || a.attr.id.localeCompare(b.attr.id));
  }
}

export function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Does a phrase already contain the part's noun ("human ears" vs "her ears")? */
function phraseNamesPart(phrase: string, noun: string): boolean {
  const last = noun.split(" ").pop() ?? noun;
  // a part name may carry regex metacharacters (e.g. "penis (5 in.)"), so escape
  // before building the pattern or an unmatched ")" throws (D-H01).
  const escaped = last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/s$/, "s?");
  return new RegExp(`\\b${escaped}\\b`, "i").test(phrase);
}

/** A phrase led by an article reads as its own noun ("a keen animal nose"). */
function startsWithArticle(phrase: string): boolean {
  return /^(a|an|the)\b/i.test(phrase.trim());
}

function stripArticle(phrase: string): string {
  return phrase.replace(/^(a|an|the)\s+/i, "");
}

/** Lowercase a bare "Human X" phrase so it sits inside a sentence. */
function humanizePhrase(text: string): string {
  return text.replace(/^Human\b/, "human");
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** Drop the "Human " prefix and un-title-case a part name for prose. */
function humanizeName(name: string): string {
  return name
    .replace(/^human\s+/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

const REGION_WORD: Array<[RegExp, string]> = [
  [/^head|^face/, "face"],
  [/^ears/, "ears"],
  [/^eyes/, "eyes"],
  [/^nose/, "nose"],
  [/^mouth|^tongue|^fangs|^teeth/, "mouth"],
  [/^chest|^breasts|^nipples/, "chest"],
  [/^torso|^abdomen/, "torso"],
  [/^back/, "back"],
  [/^arm/, "arms"],
  [/^hand|^fingers|^nails\.hand/, "hands"],
  [/^leg/, "legs"],
  [/^foot|^toes|^nails\.foot/, "feet"],
  [/^tail/, "tail"],
  [/^wings/, "wings"],
  [/^pelvis|^genital/, "groin"],
];
function regionWord(slot: string): string {
  for (const [re, word] of REGION_WORD) if (re.test(slot)) return word;
  return "body";
}

const IRREGULAR_PLURAL: Record<string, string> = {
  foot: "feet",
  tooth: "teeth",
  fang: "fangs",
  hand: "hands",
  ear: "ears",
  eye: "eyes",
  leg: "legs",
  arm: "arms",
  wing: "wings",
  nail: "nails",
  breast: "breasts",
  nipple: "nipples",
};

function plural(noun: string): string {
  if (IRREGULAR_PLURAL[noun]) return IRREGULAR_PLURAL[noun];
  // "canid claws (foot)" — pluralise the head, keep the parenthetical aside
  const m = noun.match(/^(.*?)\s*(\(.*\))$/);
  if (m) return `${plural(m[1]!)} ${m[2]!}`;
  return /s$/.test(noun) ? noun : `${noun}s`;
}

/** Order slots head-down so a body read flows top to bottom. */
const SLOT_ORDER = ["head", "face", "ears", "eyes", "horns", "nose", "mouth", "tongue", "fangs", "teeth", "hair", "chest", "breasts", "nipples", "torso", "abdomen", "back", "arm", "hand", "fingers", "nails.hand", "pelvis", "genital", "leg", "foot", "toes", "nails.foot", "tail", "wings"];
function canonicalSlot(a: string, b: string): number {
  const rank = (s: string) => {
    const base = s.replace(/\.(L|R)$/, "");
    const i = SLOT_ORDER.findIndex((p) => base.startsWith(p));
    const side = /\.L$/.test(s) ? 0 : /\.R$/.test(s) ? 1 : 0;
    return (i < 0 ? 99 : i) * 10 + side;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

export function createComposer(opts: ComposerOptions): Composer {
  return new Composer(opts);
}

export type SubjectForComposer = Subject;
