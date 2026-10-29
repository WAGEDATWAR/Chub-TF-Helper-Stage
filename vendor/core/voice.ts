import { DialogueRegistry, type SelectionResult } from "./dialogue";
import { bandForValue, type ToneBand } from "./composer";
import { buildBundle, narrate, type LlmMode, type Provider, type NarrateResult } from "./llm";
import type { LinePool } from "./pool";
import type { Session } from "./session";

/**
 * Voice (blueprint §36; M14.10). Turns the subject's live state into the dialogue
 * axes, then selects a floor-or-specific line. Premise framing (D-152): she is not
 * in a lab talking to the player; she **speaks aloud and the unseen Observer
 * overhears**. So a line renders as speech in the scene/story, never as address to
 * "you" unless the Observer is perceived (`perceived` axis).
 */
export const VOICE_VERSION = 1;

/** Axis band tables: state value -> band name, per axis. */
const AXIS_BANDS: Record<string, { key: string; bands: Array<[number, string]> }> = {
  pain: { key: "pain", bands: [[0, "none"], [25, "low"], [60, "high"]] },
  arousal: { key: "arousal", bands: [[0, "low"], [40, "mid"], [70, "high"]] },
  resonance: { key: "resonance", bands: [[0, "low"], [45, "mid"], [70, "high"]] },
  drive_band: { key: "drive", bands: [[0, "sated"], [40, "warm"], [65, "eager"], [85, "ravenous"]] },
  frustration_band: { key: "frustration", bands: [[0, "calm"], [7, "strained"], [12, "breaking"]] },
  stability_min: { key: "stability", bands: [[0, "low"], [60, "stable"]] },
};

function bandFor(bands: Array<[number, string]>, value: number): string {
  let chosen = bands[0]![1];
  for (const [min, name] of bands) if (value >= min) chosen = name;
  return chosen;
}

/** Derive the axis table from live state (threshold-first selection, §36). */
export function axesFor(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  const s = session.subject;
  const stats = s.stats;
  const axes: Record<string, string> = {
    transform_state: (s.derived.transformState ?? "baseline"),
    pain: bandFor(AXIS_BANDS.pain!.bands, stats.pain ?? 0),
    arousal: bandFor(AXIS_BANDS.arousal!.bands, stats.arousal ?? 0),
    resonance: bandFor(AXIS_BANDS.resonance!.bands, stats.resonance ?? 0),
    drive_band: bandFor(AXIS_BANDS.drive_band!.bands, stats.drive ?? 0),
    stability_min: bandFor(AXIS_BANDS.stability_min!.bands, stats.stability ?? 100),
  };
  const composure = stats.composure ?? 50;
  axes.composure_band = composure >= 75 ? "poised" : composure >= 50 ? "steady" : composure >= 30 ? "wary" : "rattled";
  axes.frustration_band = bandFor(AXIS_BANDS.frustration_band!.bands, session.training.frustration ?? 0);
  // mind + mood axes (Wave 3): her voice reflects who she is becoming
  const mind = s.mind;
  if (mind) {
    axes.mood_band = s.mood?.band() ?? "neutral-temperate";
    axes.mood_valence = (s.mood?.point().valence ?? 50) >= 58 ? "up" : (s.mood?.point().valence ?? 50) <= 42 ? "down" : "even";
    axes.awareness_tier = mind.tier();
    axes.confidence_band = bandFor([[0, "low"], [40, "steady"], [70, "high"]], mind.read("confident"));
    axes.nervous_band = bandFor([[0, "even"], [45, "tight"], [70, "fraught"]], mind.read("nervous"));
    axes.aggression_band = bandFor([[0, "mild"], [45, "sharp"], [70, "hot"]], mind.read("aggressive"));
    axes.dominance_band = bandFor([[0, "submissive"], [45, "even"], [65, "dominant"]], mind.read("dominant"));
    axes.libido_band = bandFor([[0, "cool"], [45, "warm"], [70, "burning"]], mind.read("libidinous"));
  }
  // a strong preference colours what she says about it
  axes.preference = session.subject.preferences.all().length > 0 ? "invested" : "open";
  // a changed body shapes her voice (B1): a beak slurs, a muzzle muffles
  const talking = s.derived.capacities?.talking ?? 1000;
  axes.capability = talking >= 900 ? "clear" : talking >= 600 ? "muffled" : "strained";
  // a feral-leaning body speaks less (S47/D-163): exposure drives an axis the
  // dialogue selector reads, so idle lines thin toward wordless.
  const speech = s.derived.speechMultiplier ?? 1;
  axes.speaks_less = speech <= 0.2 ? "little" : speech <= 0.6 ? "some" : "much";
  // Perception is a Story arc (P7/D-071); sandbox is unaware unless toggled.
  axes.perceived = s.flaggedPerceived ? "noticed" : "hidden";
  return { ...axes, ...extra };
}

export interface SpokenLine {
  key: string;
  speaker: string;
  line: string;
  /** rendered for the scene: quoted speech, or a narrated player/observer line. */
  render: string;
  generic: boolean;
}

/** Select a line for a key and render it (overheard speech). */
export function speak(session: Session, registry: DialogueRegistry, key: string, extraAxes: Record<string, string> = {}, pool: LinePool | null = null): SpokenLine | null {
  const base = registry.get(key);
  if (!base) return null;
  // a near-feral body goes quiet (S47): past a threshold, an idle line is simply
  // not spoken this time, so silence becomes part of the read.
  const speech = session.subject.derived.speechMultiplier ?? 1;
  if (key.startsWith("hub.idle") && speech < 1) {
    const skip = Math.min(0.8, (1 - speech) * 0.7);
    if (session.rng.chance("dialogue" as never, skip)) {
      session.bus.emit("dialogue.spoken", { key: `${key}~quiet`, speaker: "subject" }, { final: false });
      return null;
    }
  }
  // pool variety: prefer a genuinely fresh pooled line, else the selector (which
  // keeps its own per-key ring against immediate repeats).
  const recent = session.recentLines ?? [];
  const pooledEntry = pool?.take(key, recent) ?? null;
  const pooled = pooledEntry && !recent.includes(pooledEntry.line) ? pooledEntry.line : null;
  const selection: SelectionResult | null = pooled ? null : registry.select(key, axesFor(session, extraAxes), { rng: session.rng });
  const line = pooled ?? selection?.line;
  if (line === null || line === undefined) return null;
  const speaker = base.speaker ?? "subject";
  const render = renderLine({ key, line, specificity: 0, matchedAxes: {}, generic: false, speaker }, session);
  if (pool) pool.add(key, line, { tick: session.clock.tick });
  session.recentLines = [...(session.recentLines ?? []), line].slice(-12);
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: render, dedupe: key.startsWith("hub.idle") });
  session.bus.emit("dialogue.spoken", { key, speaker }, { final: true });
  return { key, speaker, line, render, generic: false };
}

/** Render an authored reaction line for the log (quote + attribute if needed). */
export function renderSpeech(line: string, session: Session): string {
  return renderLine({ key: "", line, specificity: 0, matchedAxes: {}, generic: false, speaker: "subject" }, session);
}

/** In narrative, her speech is quoted and attributed; a narrated line (starting
 *  with "She…") stands as-is; the Observer voice reads plainly. */
function renderLine(selection: SelectionResult, session: Session): string {
  if (selection.speaker === "player") return selection.line;
  const name = session.subject.displayName;
  const line = selection.line;
  // already quoted speech → attribute it
  if (/^["“]/.test(line)) return `${name}: ${line}`;
  // a narrated line (third person) stays as narration
  if (/^(She|Her|He|His|They|Their)\b/.test(line)) return line;
  // an unattributed spoken line → quote and attribute
  return `${name}: "${line}"`;
}

export function buildVoiceAxes(session: Session): Record<string, string> {
  return axesFor(session);
}

/** Voice profile per speaker (§37): register, shape, avoid. Data-light, extensible. */
export interface VoiceProfile {
  register: string;
  tics: string[];
  avoid: string[];
}
export const SUBJECT_VOICE: VoiceProfile = Object.freeze({
  register: "warm, guarded, dry",
  tics: ["trails off when strained"],
  avoid: ["the player", "the observer", "the lab"],
});

/**
 * Narrate a line for a key: pool first (variety), else authored, then an optional
 * LLM render guarded against the facts (§38). Always ends in a line.
 */
export async function narrateKey(
  session: Session,
  registry: DialogueRegistry,
  pool: LinePool | null,
  key: string,
  scene: { location: string | null; ambient: string; objects: string[]; body: string },
  opts: { mode: LlmMode; provider?: Provider | null },
): Promise<NarrateResult> {
  const entry = registry.get(key);
  const authored = entry ? registry.select(key, axesFor(session))?.line ?? null : null;
  const bundle = buildBundle(session, { key, intent: entry?.intent ?? key, authored, body: scene.body, scene: { location: scene.location, ambient: scene.ambient, objects: scene.objects } });
  const recent = session.recentLines ?? [];
  const pooledEntry = pool?.take(key, recent) ?? null;
  const pooled = pooledEntry && !recent.includes(pooledEntry.line) ? pooledEntry.line : null;
  const floor = pooled ?? authored;
  const result = await narrate(bundle, { mode: opts.mode, provider: opts.provider ?? null, authored: floor });
  if (result.line && pool) pool.add(key, result.line, { authored: result.source === "authored" || result.source === "off", tick: session.clock.tick });
  // remember the last few lines for a variety ring
  session.recentLines = [...(session.recentLines ?? []), result.line].slice(-12);
  session.bus.emit("dialogue.spoken", { key, speaker: entry?.speaker ?? "subject" }, { final: true });
  return result;
}

export { bandForValue };
export type { ToneBand };
