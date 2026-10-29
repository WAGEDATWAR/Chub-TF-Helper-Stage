import { blockOf } from "./time_engine";
import type { Session } from "./session";

/**
 * LLM narration framework (blueprint §38; M15). The LLM is a **renderer**, not an
 * author of facts: it receives a facts block built from real state and writes prose
 * that must not contradict it. Generation never blocks — the authored line is the
 * floor and the guaranteed fallback.
 *
 * This module owns the *bundle* and the *guard*; a `Provider` (below) owns the
 * actual model call, so a fully-offline provider is possible.
 */
export const LLM_VERSION = 1;
export const PROMPT_VERSION = 1;
export const VOICE_VERSION = 1;

export type LlmMode = "off" | "fill_holes" | "priority";

export interface GuardConfig {
  max_words: number;
  timeout_ms: number;
  max_repairs: number;
}

export const DEFAULT_GUARD: GuardConfig = Object.freeze({ max_words: 60, timeout_ms: 3000, max_repairs: 1 });

/** The facts the narration must not contradict. */
export interface FactsBlock {
  key: string;
  intent: string;
  facts: {
    subject: { name: string; band: string; transformState: string; pronouns: string };
    stats: Record<string, number>;
    body: string;
    scene: { location: string | null; ambient: string; objects: string[] };
    world: { day: number; block: string };
  };
  constraints: { max_words: number; pov: "third"; tense: "present" };
  forbidden: string[];
  style_anchors: string[];
}

export interface BundleInput {
  key: string;
  intent: string;
  authored?: string | null;
  scene: { location: string | null; ambient: string; objects: string[] };
  body: string;
}

const FORBIDDEN = Object.freeze([
  "inventing objects",
  "changing numbers",
  "moving participants",
  "knowing the Observer",
]);

/** Build the facts block for a line (§38.3). Deterministic for a given state. */
export function buildBundle(session: Session, input: BundleInput): FactsBlock {
  const s = session.subject;
  return {
    key: input.key,
    intent: input.intent,
    facts: {
      subject: { name: s.displayName, band: s.derived.band ?? "band.baseline", transformState: s.derived.transformState ?? "baseline", pronouns: s.pronouns ?? "she" },
      stats: { ...s.stats },
      body: input.body,
      scene: input.scene,
      world: { day: session.clock.day, block: blockOf(session.clock.tick) },
    },
    constraints: { max_words: DEFAULT_GUARD.max_words, pov: "third", tense: "present" },
    forbidden: [...FORBIDDEN],
    style_anchors: input.authored ? [input.authored] : [],
  };
}

export interface GuardResult {
  ok: boolean;
  line: string;
  failures: string[];
  repairs: number;
}

/**
 * The guard (§38.4). Checks a generated line against the facts; on failure it
 * attempts a bounded repair (trim), then falls back to the authored line.
 */
export function guard(line: string, bundle: FactsBlock, authored: string | null): GuardResult {
  const failures: string[] = [];
  let text = String(line ?? "").trim();
  if (text.length === 0) failures.push("empty");
  // word count
  if (countWords(text) > bundle.constraints.max_words) {
    text = trimToWords(text, bundle.constraints.max_words);
    failures.push("word_count");
  }
  // no observer awareness (P7): she may not say "you"/"the player" unless revealed
  if (!bundle.facts.subject.transformState.includes("revealed") && /\byou\b|\bthe player\b|\bthe observer\b/i.test(text) && bundle.key !== "global.observe") {
    // "you" is acceptable for a narrated observer; flag only a hard awareness
    if (/\bthe (player|observer)\b/i.test(text)) failures.push("observer_awareness");
  }
  // no new objects: every capitalised proper noun-ish token should appear in facts
  const invented = inventedObject(text, bundle);
  if (invented) failures.push("new_object");
  // no fact drift: numbers in the line must appear somewhere in the facts
  if (hasUnknownNumber(text, bundle)) failures.push("fact_drift");

  const hardFail = failures.some((f) => f !== "word_count");
  if (!hardFail && text.length > 0) return { ok: true, line: text, failures, repairs: failures.length };
  // fallback: the authored line always wins if the guard fails
  if (authored) return { ok: false, line: authored, failures, repairs: failures.length };
  return { ok: false, line: text || authored || "", failures, repairs: failures.length };
}

const STOP_CAPS = new Set(["She", "Her", "He", "His", "They", "Their", "The", "A", "An", "It", "In", "Under", "Smelling", "At", "On", "And", "But", "Now", "Then", "Morning", "Day"]);
function inventedObject(text: string, bundle: FactsBlock): string | null {
  const haystack = `${bundle.facts.body} ${bundle.facts.scene.ambient} ${bundle.facts.scene.objects.join(" ")} ${bundle.facts.subject.name}`.toLowerCase();
  for (const word of text.split(/\s+/)) {
    const clean = word.replace(/[^A-Za-z]/g, "");
    if (!clean || clean.length < 3) continue;
    if (!/^[A-Z]/.test(word)) continue;
    if (STOP_CAPS.has(clean)) continue;
    if (!haystack.includes(clean.toLowerCase())) return clean;
  }
  return null;
}

function hasUnknownNumber(text: string, bundle: FactsBlock): boolean {
  const nums = (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number);
  if (nums.length === 0) return false;
  const known = new Set<number>([...Object.values(bundle.facts.stats), 100, bundle.facts.world.day]);
  return nums.some((n) => !known.has(n));
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
function trimToWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text;
  return words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

/** A provider is any async function that turns a prompt into a completion. */
export interface Provider {
  id: string;
  /** true when it needs no network. */
  offline: boolean;
  complete(prompt: string, bundle: FactsBlock): Promise<string>;
}

export interface NarrateOptions {
  mode: LlmMode;
  provider?: Provider | null;
  authored: string | null;
  guard?: GuardConfig;
}

export interface NarrateResult {
  line: string;
  source: "authored" | "generated" | "fallback" | "off";
  failures: string[];
}

/** Render a line from the bundle, guarded, with an authored floor (§38.2). */
export async function narrate(bundle: FactsBlock, opts: NarrateOptions): Promise<NarrateResult> {
  if (opts.mode === "off" || !opts.provider) {
    return { line: opts.authored ?? "", source: "off", failures: [] };
  }
  if (opts.mode === "fill_holes" && opts.authored) {
    return { line: opts.authored, source: "authored", failures: [] };
  }
  let generated = "";
  try {
    generated = await withTimeout(opts.provider.complete(renderPrompt(bundle), bundle), opts.guard?.timeout_ms ?? DEFAULT_GUARD.timeout_ms);
  } catch (err) {
    void err;
    return { line: opts.authored ?? "", source: "fallback", failures: ["timeout"] };
  }
  const g = guard(generated, bundle, opts.authored);
  return { line: g.line, source: g.ok ? "generated" : "fallback", failures: g.failures };
}

/** The prompt text a provider receives (deterministic; facts + constraints). */
export function renderPrompt(bundle: FactsBlock): string {
  const f = bundle.facts;
  const lines = [
    `Write one line of third-person present narration.`,
    `Intent: ${bundle.intent}.`,
    `Subject: ${f.subject.name}, ${f.subject.transformState.replace(/_/g, " ")}.`,
    `Body: ${f.body || "unchanged"}.`,
    `Scene: ${f.scene.location ?? "somewhere"} — ${f.scene.ambient}. Present: ${f.scene.objects.join("; ")}.`,
    `Do not: ${bundle.forbidden.join("; ")}.`,
    `Max ${bundle.constraints.max_words} words.`,
  ];
  if (bundle.style_anchors.length > 0) lines.push(`Style anchor: "${bundle.style_anchors[0]}"`);
  return lines.join("\n");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("timeout")); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } }).catch((e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

/** An offline provider that composes a line from the facts without a model. */
export function templateProvider(): Provider {
  return {
    id: "template",
    offline: true,
    async complete(_prompt: string, bundle: FactsBlock): Promise<string> {
      const f = bundle.facts;
      const who = f.subject.name;
      return `${who} ${f.body || "goes on"}, ${f.scene.ambient ? `in the ${f.scene.location ?? "room"}, ` : ""}present.`;
    },
  };
}

export interface BundleContent {
  /** key -> intent + authored floor, from dialogue keys. */
  entries?: Record<string, { intent: string; authored: string }>;
}
