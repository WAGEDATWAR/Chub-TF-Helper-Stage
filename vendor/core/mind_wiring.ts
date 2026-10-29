import { awarenessTier } from "./mind";
import { driftStep, agencyStep, REVEAL_THRESHOLD, type DriftInputs } from "./mind_drift";
import { ageMindInfluence } from "./physiology";
import { matrixSign, type DispositionTable } from "./reactions";
import { mentalityFor } from "./genomes";
import { applyCriteria, type CriterionGroup, type CriteriaContext } from "./criteria";
import type { Session } from "./session";
import type { NoticableRegistry } from "./perception";
import { knowledgeAwareness } from "./perception";
import { noticeWeightFor } from "./perception_wiring";

/**
 * Mind wiring (M15.5b). Connects the pure drift engine to a live session: builds
 * the input context from real state (awareness, resistance, agency, stability,
 * fatigue, self-read), raises **awareness** from notices, fires the **realization**
 * event on the reveal threshold, and runs the daily step.
 *
 * Nothing here invents numbers: resistance/agency are read from the mind and the
 * modifier registry; the pull comes from carried genomes' `mentality`.
 */
export function buildDriftInputs(session: Session, table: DispositionTable | null): DriftInputs {
  const subject = session.subject;
  const mind = subject.mind!;
  const self = subject.self;
  const registry = session.mindRegistry;
  const ctx = {
    awareness: mind.awareness,
    tier: mind.tier(),
    resistance: mind.resistance,
    agency: mind.agency,
    value: (id: string) => mind.read(id),
  };
  // registered inputs feed resistance / agency / rate / target (R9): every
  // registered input kind now reaches the drift, not only resistance/agency.
  const registryResistance = registry ? registry.total("resistance", ctx) : 0;
  const registryAgency = registry ? registry.total("agency", ctx) : 0;
  const registryRate = registry ? registry.total("rate", ctx) : 0;
  const registryTarget = registry ? registry.total("target", ctx) : 0;
  const sign = table ? matrixSign(subject.personalitySeed, table) : 0;
  const mentality = subject.genomesRegistry ? mentalityFor(subject.genomes, subject.genomesRegistry) : {};
  // age pulls the mind toward age-typical values (D-212): a real age dimension
  const agePull = subject.age !== null && subject.age !== undefined ? ageMindInfluence(subject.age).pull : {};
  // her fight rises with her *negative* preferences and falls with positive ones;
  // awareness is what lets her actually push back (D-177, D-178).
  const aversion = subject.preferences.all().reduce((s, p) => s + (p.kind === "fetish" ? -1 : 1) * (Math.abs(p.opinion) / 100), 0);
  const awarenessLever = mind.awareness / 100;

  const resistance = clamp((registryResistance + (1 - (subject.stats.resonance ?? 50) / 100) * 20 + aversion * 40 - sign * 10) * (0.4 + 0.6 * awarenessLever));
  // store resistance on the mind (R8): a live reader (mind_wiring/powers) had a
  // value that was never written, so it always read 0. Now it reflects reality.
  mind.resistance = resistance;

  return {
    awareness: mind.awareness,
    resistance,
    agency: clamp(mind.agency + registryAgency + (subject.stats.composure ?? 50) / 5 + registryRate),
    stability: subject.stats.stability ?? 100,
    fatigue: subject.stats.fatigue ?? 0,
    realized: mind.realized,
    selfCoherence: self?.coherence ?? 60,
    // registry rate/target inputs shape the pull toward each value (R9)
    pull: (valueId: string) => (mentality[valueId] ?? 0) + (agePull[valueId] ?? 0) + registryTarget * 0.05,
  };
}

/** Raise awareness from what she noticed today; more notice = faster realization. */
export function runAwareness(session: Session, registry: NoticableRegistry, _noticedNow: number): number {
  const subject = session.subject;
  const mind = subject.mind!;
  const before = mind.awareness;
  // awareness is the **sum of her knowledge** (D-213): recomputed from belief, so a
  // re-notice replaces its prior contribution rather than adding on top. Unexplained
  // pain is a direct extra driver (D-199); subtle families weigh less.
  const sum = knowledgeAwareness(subject.know, (id) => noticeWeight(id, subject.attributeRegistry ?? null));
  const pain = subject.stats.pain ?? 0;
  const painPush = pain >= 55 ? 6 : pain >= 30 ? 2.5 : 0;
  const arousalPull = (subject.stats.arousal ?? 0) >= 50 ? 1.5 : 0;
  mind.awareness = Math.max(0, Math.min(100, sum + painPush + arousalPull));
  if (painPush > 0 && pain >= 55) subject.mood?.impulse("fear", 3);
  if (before < REVEAL_THRESHOLD && mind.awareness >= REVEAL_THRESHOLD && !mind.realized) realize(session, registry);
  return mind.awareness;
}

/** How much a noticed trait weighs toward awareness (D-213): an authored
 *  `notice_weight` wins; else the family default, so a structural change reads
 *  more than a subtle surface tweak. */
function noticeWeight(attrId: string, registry: { get(id: string): { family: string; notice_weight?: number } | null } | null): number {
  const attr = registry?.get(attrId) ?? null;
  if (attr?.notice_weight !== undefined) return attr.notice_weight;
  const family = attr?.family ?? (attrId.replace(/^attr\./, "").split("_")[0] ?? "");
  return noticeWeightFor(family, attrId);
}

/**
 * Notices of her own *mind and body stats* (D-199): she can feel she got stronger,
 * angrier, hornier. Fires on a relative shift from the value's baseline (15+ for a
 * stat, 15+ for a mind value), and stops once noticed.
 */
export function runSelfChangeNotice(session: Session): number {
  const s = session.subject;
  let fired = 0;
  const statKeys: Array<[string, number]> = [
    ["strength", 50], ["intelligence", 50], ["agility", 50], ["endurance", 50], ["perception", 50],
  ];
  for (const [id, base] of statKeys) {
    const key = `stat.${id}`;
    if (s.know[key]) continue;
    if (Math.abs((s.stats[id] ?? base) - base) >= 15) { s.know[key] = { belief: s.stats[id] ?? base, noticedAtTick: session.clock.tick, path: "felt" }; fired++; }
  }
  // a mind value she has drifted well from its baseline: "she has gotten angry"
  if (s.mind) {
    for (const id of s.mind.ids()) {
      const key = `mind.${id}`;
      if (s.know[key]) continue;
      const state = s.mind.get(id)!;
      if (Math.abs(state.value - state.baseline) >= 15) { s.know[key] = { belief: state.value, noticedAtTick: session.clock.tick, path: "felt" }; fired++; }
    }
  }
  return fired;
}

/**
 * The realization moment (D-182): its own event. Sign/weight come from how much
 * she knows overall and how she reads her body — well-contextualized is calmer.
 */
export function realize(session: Session, _registry: NoticableRegistry): void {
  const subject = session.subject;
  const mind = subject.mind!;
  mind.realized = true;
  const knowledge = Object.keys(subject.know).length;
  const self = subject.self;
  const feel = clamp((knowledge / 8) * 40 + (self?.coherence ?? 60) * 0.4 - (self?.dysmorphia ?? 0) * 0.4);
  const sign = feel >= 50 ? "accepting" : "alarmed";
  mind.adjust("confident", sign === "accepting" ? 4 : -6);
  if (sign === "alarmed") mind.adjust("nervous", 8);
  subject.mood?.impulse(sign === "accepting" ? "surprise" : "fear", sign === "accepting" ? 25 : 45);
  subject.mood?.impulse("trust", sign === "accepting" ? 15 : 0);
  session.bus.emit("realization", { tier: mind.tier(), sign, knowledge }, { final: true });
  session.journal.recordObservation({
    tick: session.clock.tick,
    day: session.clock.day,
    note: sign === "accepting"
      ? "It lands on her, all at once, and it does not frighten her the way she thought it would."
      : "It lands on her, all at once: something is happening to her, and she was not ready.",
  });
  session.markDirty();
}

/** Register the built-in mind inputs (M15.5b) onto a session's registry. */
export function registerCoreMindInputs(session: Session): void {
  const registry = session.mindRegistry;
  if (!registry) return;
  // resistance rises with nervousness and a wary stance; falls with composure
  registry.register({ id: "input.self_perception", kind: "resistance", owner: "identity", weight: (ctx) => (1 - (ctx.value("composed") / 100)) * 12 });
  registry.register({ id: "input.nervousness", kind: "resistance", owner: "mind", weight: (ctx) => ctx.value("nervous") * 0.15 });
  // agency rises with confidence and mastery
  registry.register({ id: "input.mastery", kind: "agency", owner: "abilities", weight: (ctx) => ctx.value("confident") * 0.2 });
  // awareness quietly amplifies her own pull on the target once she is lucid
  registry.register({ id: "input.awareness", kind: "target", owner: "perception", weight: (ctx) => (ctx.tier === "lucid" ? 3 : 0) });
}

/** Normalize accumulated resistance-fatigue to 0..100 at a day boundary (D-178). */
export function accrueFatigue(session: Session, resistance: number): void {
  const subject = session.subject;
  // fatigue rises by resistance above a calm baseline; resistance below it lets rest
  const delta = (resistance - 35) * 0.15;
  subject.stats.fatigue = Math.max(0, Math.min(100, Math.round((subject.stats.fatigue ?? 0) + delta)));
}

// --- realization already fired for this session? helper for tests ------------

/** True when a friend-or-better is at the subject's location (B5). */
function alliesPresent(session: Session): boolean {
  const town = session.town;
  const subject = town?.state("subject");
  if (!town || !subject) return false;
  return town.presentAt(subject.at, "subject").some((a) => (town.bond(a.id, "subject")?.bond ?? 0) >= 60);
}

/** The subject's peak recent memory importance, normalized 0..1 (R13). */
function peakMemorySignificance(session: Session): number {
  const store = session.town?.state("subject")?.memory;
  if (!store) return 0.5;
  const recent = store.relevant({ tick: session.clock.tick, recentTicks: 48 }, 3);
  if (recent.length === 0) return 0.4;
  const peak = Math.max(...recent.map((r) => r.memory.importance));
  return Math.max(0.3, Math.min(1, peak / 60));
}
/** Build the criteria context (M15.5c) from a live session + a triggering change. */
export function buildCriteriaContext(session: Session, partTags: string[], partRoles: string[], alliesNear = false, memorySignificance = 0.5): CriteriaContext {
  const s = session.subject;
  const mood = s.mood?.point();
  return {
    stats: s.stats,
    mind: s.mind ? Object.fromEntries(s.mind.ids().map((id) => [id, s.mind!.read(id)])) : {},
    awareness: s.mind?.awareness ?? 0,
    awarenessTier: s.mind?.tier() ?? "blind",
    moodValence: mood?.valence ?? 50,
    moodArousal: mood?.arousal ?? 30,
    moodBand: s.mood?.band() ?? "neutral-still",
    partTags,
    partRoles,
    flags: session.flags,
    tick: session.clock.tick,
    day: session.clock.day,
    realized: s.mind?.realized ?? false,
    memorySignificance,
    alliesNear,
  };
}

/** The nightly mind step (M15.5b): awareness, then the drift. */
export function runMindStep(session: Session, registry: NoticableRegistry, table: DispositionTable | null, noticedNow: number): void {
  const mind = session.subject.mind;
  if (!mind) return;
  runAwareness(session, registry, noticedNow);
  const inputs = buildDriftInputs(session, table);
  const moved = driftStep(mind, inputs);
  // her agency over the change grows or is spent (D-172): the other half of steer
  if (agencyStep(mind, inputs) !== 0) session.markDirty();
  if (moved.length > 0) {
    session.bus.emit("mind.drifted", { values: moved.map((m) => m.valueId) }, { final: false });
    session.markDirty();
  }
  // reactions decay (importance-weighted, D-185)
  session.subject.preferences.decay(session.clock.tick);
  // emotions settle toward calm nightly, so mood is a state that passes (B6)
  session.subject.mood?.decay(4);
  // a body-borne mood nudge (S78): a tail that wags lifts her; a hook may push too
  const moodHook = session.hookValue("mood.valence_shift");
  if (moodHook && moodHook.value !== 0) {
    session.subject.mood?.impulse(moodHook.value > 0 ? "joy" : "disgust", Math.abs(moodHook.value));
  }
  // a material mood turn is its own trigger (Wave 3)
  const valence = session.subject.mood?.point().valence ?? 50;
  const prior = moodValenceRef.get(session) ?? 50;
  if (Math.abs(valence - prior) >= 18) session.bus.emit("mood.shift", { valence }, { final: true });
  moodValenceRef.set(session, valence);
}

const moodValenceRef = new WeakMap<Session, number>();

/**
 * Run criteria for a triggering change (M15.5c): matching groups award opinion on
 * their topic; record a reaction; crystallize if strong enough. `kind` biases the
 * base importance (an intense/private moment sticks harder).
 */
export function runCriteriaOn(session: Session, groups: CriterionGroup[], partTags: string[], opts: { opinionScale?: number; importance?: number; alliesNear?: boolean } = {}): void {
  const subject = session.subject;
  const prefs = subject.preferences;
  // allies nearby (B5): a friendly face present in the town raises how a change lands
  const alliesNear = opts.alliesNear ?? alliesPresent(session);
  // memory significance (R13): how much the subject's recent memory weighs, so a
  // criteria rule keyed on memory fires from real events, not a constant.
  const memSignificance = opts.importance ?? peakMemorySignificance(session);
  const ctx = buildCriteriaContext(session, partTags, [], alliesNear, memSignificance);
  const hits = applyCriteria(groups, ctx);
  for (const hit of hits) {
    const opinion = hit.opinion * (opts.opinionScale ?? 1);
    prefs.recordReaction(hit.topic, hit.kind, opinion, opts.importance ?? 0.5, session.clock.tick);
    const before = prefs.get(hit.topic);
    const after = prefs.crystallize(hit.topic, session.clock.tick, hit.ruleName);
    if (after && (!before || before.tier !== after.tier)) {
      subject.syncReactionsFromPreferences();
      subject.mood?.impulse(hit.kind === "awakening" ? "desire" : "disgust", hit.kind === "awakening" ? 12 : 8);
      session.bus.emit("preference.changed", { topic: hit.topic, kind: after.kind, tier: after.tier }, { final: true });
      session.journal.recordObservation({
        tick: session.clock.tick,
        day: session.clock.day,
        note: hit.kind === "awakening"
          ? `Something about the ${hit.topic.replace(/^topic\./, "").replace(/_/g, " ")} takes hold — ${after.tier}.`
          : `The ${hit.topic.replace(/^topic\./, "").replace(/_/g, " ")} wears on her — ${after.tier}.`,
      });
      session.markDirty();
    }
  }
}

export { awarenessTier };

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
