/**
 * Prompt driving + guard (H4). The chat LLM is a **renderer**: `directions()` hands
 * it a per-character facts floor it must not contradict, and `guardMessage()`
 * checks the bot's prose against those facts, replacing a hard-drifted message
 * with the composed floor.
 *
 * Multi-character: one combined facts haystack covers the whole cast, so the guard
 * and any repair reason about every tracked person at once.
 */
import { guard, type FactsBlock, type GuardResult, type GuardConfig } from "@core/llm";
import type { CastFrame } from "../sim/cast";

export interface CouplingRow {
  characterId: string;
  kind: string;
  pressure: number;
  cues: string[];
  shifted: boolean;
}

export interface DriveInput {
  frames: CastFrame[];
  coupling: CouplingRow[];
  moon: { phase: string; intensity: number; daysToFull: number };
  /** Present-scene props, so the guard knows what objects may be named. */
  objects?: string[];
  ambient?: string;
}

const RULES = [
  "Render the bodies below in third-person present.",
  "Do NOT invent objects, change numbers, move people, or let them know an observer exists.",
  "A character may only show what their band and cues allow — nothing further along the change.",
];

/** The composed floor for one character: what prose must agree with. */
export function floorFor(frame: CastFrame, coupling?: CouplingRow): string {
  const band = frame.band.replace(/^band\./, "").replace(/_/g, " ");
  const cues = coupling?.cues.length ? ` (moon-stirred: ${coupling.cues.join(", ")})` : "";
  return `${frame.name} — exposure ${frame.exposure}%, ${band}${cues}. ${frame.describe}${interiorLine(frame)}`;
}

/**
 * The interior line (H11): what the character *registers* of her own state — mood,
 * feelings, and whether she has realized. Kept from her POV, so prose never lets her
 * know the Observer exists. Omitted entirely before any awareness (a blind subject
 * has nothing to report).
 */
export function interiorLine(frame: CastFrame): string {
  const it = frame.interior;
  // nothing to report until she registers anything (a blind subject is all surface)
  if (!it || (frame.awareness <= 0 && it.feelings.length === 0)) return "";
  const bits: string[] = [];
  if (frame.awareness >= 15) bits.push(it.feelings.length ? `feeling ${it.feelings.map((f) => f.emotion).join(" and ")}` : `mood ${it.mood?.band ?? "steady"}`);
  if (frame.realized) bits.push("she has realized what is happening to her");
  else if (frame.awareness >= 35) bits.push("she half-suspects it");
  if (it.traits.length > 0) bits.push(`(temperament: ${it.traits.map((t) => `${t.label.toLowerCase()} ${t.value}`).join(", ")})`);
  return bits.length ? ` [${bits.join("; ")}]` : "";
}

/** The whole-cast floor, used as the guard's fallback and the directions body. */
export function floorText(input: DriveInput): string {
  return input.frames.map((f) => floorFor(f, input.coupling.find((c) => c.characterId === f.id))).join("\n\n");
}

/** One rule block, then a hard fact block per character (the floor). */
export function directions(input: DriveInput): string {
  if (input.frames.length === 0) return "";
  const lines = ["[CHRYSALIS — render each body below; do not invent past it]"];
  for (const r of RULES) lines.push(`- ${r}`);
  if (input.moon.intensity > 0.2) {
    lines.push(`Moon: ${input.moon.phase} (${Math.round(input.moon.intensity * 100)}% bright, full in ${input.moon.daysToFull}d) — it draws certain changes nearer.`);
  }
  lines.push("");
  for (const f of input.frames) {
    lines.push(floorFor(f, input.coupling.find((c) => c.characterId === f.id)));
  }
  return lines.join("\n");
}

/** A single FactsBlock over the whole cast, for the parent guard to check against. */
export function castBundle(input: DriveInput): FactsBlock {
  const body = input.frames.map((f) => `${f.name} ${f.describe} ${f.changing.join(" ")}`).join(" ");
  const names = input.frames.map((f) => f.name);
  return {
    key: "cast.scene",
    intent: "render the cast's bodies",
    facts: {
      subject: { name: names.join(", "), band: input.frames[0]?.band ?? "band.baseline", transformState: "cast", pronouns: "they" },
      stats: Object.fromEntries(input.frames.map((f) => [f.name, f.exposure])),
      body,
      scene: { location: null, ambient: input.ambient ?? "", objects: [...(input.objects ?? []), ...names] },
      world: { day: input.frames[0]?.day ?? 1, block: "" },
    },
    constraints: { max_words: 160, pov: "third", tense: "present" },
    forbidden: ["inventing objects", "changing numbers", "moving participants", "knowing the Observer"],
    style_anchors: [],
  };
}

/**
 * Failures that mean the prose genuinely contradicts the facts and must be
 * replaced by the floor. `new_object` is deliberately **soft**: in free chat
 * prose the guard's crude proper-noun scan trivially flags any ordinary word
 * ("You", "Morning", "Auburn"), so replacing on it would nuke good messages.
 */
const HARD_FAILURES = new Set(["fact_drift", "observer_awareness", "empty"]);

/** Guard the bot's prose against the whole-cast facts; only a real drift replaces it. */
export function guardMessage(text: string, input: DriveInput, config?: Partial<GuardConfig>): GuardResult {
  const bundle = castBundle(input);
  if (config?.max_words) bundle.constraints.max_words = config.max_words;
  // no authored fallback here: we apply our own policy over the reported failures
  const res = guard(text, bundle, null);
  const hard = res.failures.filter((f) => HARD_FAILURES.has(f));
  if (hard.length === 0) return { ok: true, line: res.line, failures: res.failures, repairs: res.repairs };
  return { ok: false, line: floorText(input), failures: res.failures, repairs: res.repairs };
}

/** A compact human-only instrument read for the system message (appended, never replacing). */
export function instrumentRead(input: DriveInput): string {
  const lines: string[] = [];
  for (const f of input.frames) {
    lines.push(`day ${f.day} · ${f.name}: exposure ${f.exposure}% · ${f.band.replace(/^band\./, "").replace(/_/g, " ")}`);
  }
  if (input.moon.intensity > 0.2) lines.push(`moon ${input.moon.phase} · full in ${input.moon.daysToFull}d`);
  for (const c of input.coupling) if (c.shifted) lines.push(`${c.characterId} is SHIFTED`);
  return lines.join("\n");
}
