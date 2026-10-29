import type { Session } from "./session";
import type { TimelineEntry } from "./timeline";
import { humanize } from "./events";
import { axesFor } from "./voice";
import { createRng, type Rng } from "./rng";

/**
 * Composer V2 — moment prose blocks (D-215, D-218). A **moment** is everything the
 * canonical timeline recorded at one tick; it becomes one expandable **block** of
 * priority-ordered **paragraphs** (status, scene, action, speech, thought, sex,
 * training, summary). One block per hour.
 *
 * Each paragraph is composed **hybrid-style**: the authored `prose` pool is asked
 * for a context-conditioned, seeded line (so similar moments vary), with the
 * templated floor below as the guaranteed fallback. Nothing is invented.
 */
export const ENTRY_PROSE_VERSION = 2;

export type ParagraphKind = "status" | "scene" | "action" | "speech" | "thought" | "sex" | "training" | "awakening" | "summary";

export interface Paragraph {
  kind: ParagraphKind;
  /** Lower renders first. */
  priority: number;
  text: string;
}

export interface EntryProse {
  entryId: number;
  paragraphs: Paragraph[];
}

const PRIORITY: Record<ParagraphKind, number> = {
  status: 1, scene: 2, action: 3, speech: 4, thought: 5, sex: 6, training: 6, awakening: 5, summary: 7,
};

/** De-dupe a paragraph against text already used in the block. */
function fresh(text: string, used: Set<string>): boolean {
  const key = text.trim().toLowerCase();
  if (used.has(key)) return false;
  used.add(key);
  return true;
}

/** Ask the pool for a varied line; fall back to `floor`. */
function compose(session: Session, key: string, tokens: Record<string, string | number | undefined>, floor: string, rng: Rng | null): string {
  if (session.prose?.has(key)) {
    const line = session.prose.pick(key, axesFor(session), tokens, rng);
    if (line) return line;
  }
  return floor;
}

/** A per-entry seeded RNG (stable across re-renders, varies between entries). */
function entryRng(seed: number): Rng {
  return createRng(seed);
}

/** The scene/status paragraph: one line, always present, at a glance. */
function statusParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph {
  const s = session.subject;
  const where = session.currentLocation ? (session.locationNames.get(session.currentLocation) ?? session.currentLocation.replace(/^loc\./, "").replace(/_/g, " ")) : "somewhere";
  const state = (s.derived.transformState ?? "baseline").replace(/_/g, " ");
  const exposure = Math.round(s.derived.exposure ?? 0);
  const mood = s.mood ? s.mood.label() : "still";
  void moment;
  const floor = `${where} — ${state}, exposure ${exposure}%, ${mood}.`;
  return { kind: "status", priority: PRIORITY.status, text: compose(session, "prose.status", { where, state, exposure, mood }, floor, rng) };
}

/** The scene paragraph: the composed scene prose for this moment, if any. */
function sceneParagraph(moment: TimelineEntry[]): Paragraph | null {
  const scene = moment.find((e) => e.kind === "scene");
  return scene ? { kind: "scene", priority: PRIORITY.scene, text: scene.text } : null;
}

/** Her action/reaction paragraph: how she feels and what she is doing. */
function actionParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph | null {
  const s = session.subject;
  const hour = (moment[0]?.tick ?? 0) % 24;
  const mood = s.mood ? s.mood.label() : "even";
  const arousal = Math.round(s.stats.arousal ?? 0);
  const arousalNote = arousal >= 70 ? "flushed and restless" : arousal >= 40 ? "warm" : "collected";
  const inScene = moment.some((e) => e.kind === "scene");
  const doing = inScene
    ? ["she moves through the room", "she keeps her hands busy", "she lets the moment pass", "she watches the light shift"][hour % 4]!
    : "she holds still a moment";
  const floor = `She is ${mood}, ${arousalNote}; ${doing}.`;
  return { kind: "action", priority: PRIORITY.action, text: compose(session, "prose.action", { mood, arousalNote, doing }, floor, rng) };
}

/** Her spoken line for this moment, if she spoke. */
function speechParagraph(moment: TimelineEntry[]): Paragraph | null {
  const speech = moment.find((e) => e.kind === "speech");
  return speech ? { kind: "speech", priority: PRIORITY.speech, text: speech.text } : null;
}

/** Her unspoken thought for this moment, if any. */
function thoughtParagraph(moment: TimelineEntry[]): Paragraph | null {
  const thought = moment.find((e) => e.kind === "thought");
  return thought ? { kind: "thought", priority: PRIORITY.thought, text: `(${thought.text})` } : null;
}

/** A session readout for a sex event in this moment, if any. */
function sexParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph | null {
  const ev = moment.find((c) => c.type === "sex.session" || c.type === "sex.overload");
  if (!ev) return null;
  const act = humanize(ev.pay?.act ?? "a session");
  const climax = ev.pay?.climax === true ? "to its end" : ev.pay?.climax === false ? "without finishing" : "gently";
  const arousal = Math.round(session.subject.stats.arousal ?? 0);
  const after = arousal > 40 ? "The wanting eases, but does not leave." : "It takes the edge off, for now.";
  const floor = `She takes herself in hand — ${act}, ${climax}. ${after}`;
  return { kind: "sex", priority: PRIORITY.sex, text: compose(session, "prose.sex", { act, climax, after }, floor, rng) };
}

/** A session readout for a practice event in this moment, if any. */
function trainingParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph | null {
  const ev = moment.find((c) => c.type === "practice.done");
  if (!ev) return null;
  const name = humanize(ev.pay?.name ?? ev.pay?.ability ?? "a skill");
  const kind = humanize(ev.pay?.kind ?? "practice");
  const mastery = Math.round(Number(ev.pay?.mastery ?? 0));
  const composure = Math.round(session.subject.stats.composure ?? 50);
  const feel = mastery >= 60 ? "It is starting to feel like hers." : composure < 40 ? "She grits through it." : "Slow, uneven, but forward.";
  const floor = `She practises ${name} (${kind}) to ${mastery}%. ${feel}`;
  return { kind: "training", priority: PRIORITY.training, text: compose(session, "prose.training", { skill: name, kind, mastery }, floor, rng) };
}

/** The change summary: what shifted this hour, from its event chips. */
function summaryParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph | null {
  const changey = moment.filter((c) => c.kind === "event" && /attribute|stage|notice|power|reaction|preference|genital|realization|ability|stance|stop/.test(c.type));
  if (changey.length === 0) return null;
  const lines = changey.slice(0, 3).map((c) => c.text.replace(/\.$/, ""));
  const changes = lines.join("; ");
  const floor = `The change: ${changes}.`;
  return { kind: "summary", priority: PRIORITY.summary, text: compose(session, "prose.summary.change", { changes }, floor, rng) };
}

/** The awakening/trauma paragraph: a reaction or realization lands (M16.5d #25). */
function awakeningParagraph(session: Session, moment: TimelineEntry[], rng: Rng): Paragraph | null {
  const ev = moment.find((c) => c.type === "reaction.awakened" || c.type === "preference.changed" || c.type === "realization");
  if (!ev) return null;
  const realization = ev.type === "realization";
  const reaction = humanize(ev.pay?.reaction ?? ev.pay?.topic ?? "the change");
  const kind = humanize(ev.pay?.kind ?? ev.pay?.type ?? "reaction");
  const isAwakening = ev.type === "reaction.awakened" ? ev.pay?.type !== "phobia" && ev.pay?.type !== "hard" : ev.pay?.kind === "awakening";
  const feel = isAwakening ? "It catches, and warms." : "It catches, and stings.";
  const floor = realization
    ? `It lands all at once: she is ${kind}. Something in her settles into a new shape.`
    : `Something turns over in her about ${reaction} — ${kind}, and it sticks. ${feel}`;
  return { kind: "awakening", priority: PRIORITY.awakening, text: compose(session, isAwakening ? "prose.awakening" : "prose.trauma", { reaction, kind }, floor, rng) };
}

/**
 * Build the prose block for one moment (an hour): status + scene, then her action,
 * speech and thought, any session readouts, then the change summary — ordered by
 * priority and de-duplicated so no line repeats.
 */
export function buildEntryProse(session: Session, moment: TimelineEntry[], entryId = moment[0]?.id ?? 0): EntryProse {
  const used = new Set<string>();
  // a per-entry seeded rng: stable across re-renders, but varies between entries
  // so similar moments read differently (D-218)
  const rng = entryRng(entryId * 2654435761);
  const candidates = [
    statusParagraph(session, moment, rng),
    sceneParagraph(moment),
    actionParagraph(session, moment, rng),
    speechParagraph(moment),
    thoughtParagraph(moment),
    sexParagraph(session, moment, rng),
    trainingParagraph(session, moment, rng),
    awakeningParagraph(session, moment, rng),
    summaryParagraph(session, moment, rng),
  ].filter((p): p is Paragraph => p !== null);
  const paragraphs = candidates.filter((p) => fresh(p.text, used)).sort((a, b) => a.priority - b.priority);
  return { entryId, paragraphs };
}

/** The joined prose of a block (paragraphs in priority order). */
export function proseText(block: EntryProse): string {
  return block.paragraphs.map((p) => p.text).join(" ");
}
