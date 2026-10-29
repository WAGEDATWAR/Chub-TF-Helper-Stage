import { buildNoticableRegistry, mark, unseen, ageMemory, isObservable, type NoticableRegistry, type TruthFrame, type NoticePath } from "./perception";
import { readSelf, stepSelf, resonanceArc, createSelfPerception, type SelfPerception } from "./self_perception";
import { selfRead, discoverReaction, identityRead, rebellionPressure } from "./identity";
import { driftChance } from "./psychology";
import { sexualityDriftStep } from "./sexuality";
import { matrixSign } from "./reactions";
import type { DispositionTable } from "./reactions";
import { runMindStep, accrueFatigue, buildDriftInputs, runCriteriaOn, runSelfChangeNotice } from "./mind_wiring";
import { runSexDay, canMasturbate } from "./sex";
import { runInspectDay } from "./inspect";
import { pickSexAction, performSex } from "./sex_actions";
import type { AttributeRegistry } from "./attributes";
import type { Session } from "./session";

/**
 * Perception wiring (blueprint §17.5; D-134). Binds the belief/notice model and
 * the self-read to a session: truth is built from the body, belief lives on the
 * subject, and the daily loop closes the gap along `felt`/`seen`/`told`.
 *
 * Offered families are `seen` (a coat, ears, a tail — you notice them in a
 * mirror); the rest are `felt`. A hidden attribute is not notice-eligible — the
 * resolver has already fused it into a visible sibling — unless it opts in with an
 * explicit `notice` (D-213), which `morph.leg_fusion`'s driver does.
 */
const SEEN_FAMILIES = new Set(["coat", "ears", "eyes", "horns", "wings", "tail", "skin", "voice"]);

/** A family's default awareness weight: structural changes read more than a subtle
 *  surface tweak, so a full run averages toward the ~80 target across all of them. */
export function noticeWeightFor(family: string, id: string): number {
  if (/structure|digitigrade|muzzle|beak|horn|wing|leg|serpent|tail/.test(family) || /digitigrade|fusion|membrane|hollow/.test(id)) return 1.6;
  if (/gait|muscle|size|bone|claws/.test(family)) return 1.2;
  if (/coat|skin|scale|feather|fur|heat|resist|scent|wet|chitin|biolum/.test(family)) return 0.9;
  return 1.1;
}

export function buildPerceptionKit(attributes: AttributeRegistry): NoticableRegistry {
  const traits = attributes.all()
    .map((a) => {
      // an explicit `notice` wins; a hidden attr is off unless it opts in
      const notice = a.notice ?? (a.hidden === true ? "none" : SEEN_FAMILIES.has(a.family) ? "seen" : "felt");
      return {
        id: a.id,
        family: a.family,
        ...(notice === "none" ? {} : { notice: notice as NoticePath }),
        notice_threshold: (a as { notice_threshold?: number }).notice_threshold ?? (a.family === "structure" ? 0.2 : 0.12),
      };
    });
  return buildNoticableRegistry(traits);
}

/** The truth frame: every noticeable trait's real value, from the body. */
export function truthFrame(session: Session, registry: NoticableRegistry): TruthFrame {
  const truth: TruthFrame = {};
  for (const inst of session.subject.body.allInstances()) {
    for (const entry of inst.attributes) {
      if (!registry.get(entry.id)) continue;
      truth[entry.id] = Math.max(truth[entry.id] ?? 0, entry.progress / 1000);
    }
  }
  return truth;
}

/** How much of the noticeable change she has not perceived (0..1). */
export function unnoticedShare(session: Session, registry: NoticableRegistry): number {
  const truth = truthFrame(session, registry);
  const ids = registry.all().map((t) => t.id).filter((id) => (truth[id] ?? 0) > 0);
  if (ids.length === 0) return 0;
  const gap = unseen(truth, session.subject.know, registry).filter((id) => ids.includes(id)).length;
  return gap / ids.length;
}

export interface NoticeResult {
  path: NoticePath;
  traits: string[];
  line: string | null;
}

/**
 * Attempt a notice (the daily `notice()` step). Self-notice fires for `felt`
 * traits always and `seen` traits only in an observable place; a companion can
 * force a `told` look. Writes belief, ages memory, emits `notice`.
 */
export function runNotice(session: Session, registry: NoticableRegistry, { observable = false, told = false } = {}): NoticeResult[] {
  const results: NoticeResult[] = [];
  const truth = truthFrame(session, registry);
  // a hook (S78) may sharpen or dull notice: a keen nose catches more, so its
  // threshold is lower (a scale < 1 crosses sooner).
  const noticeHook = session.hookValue("perception.notice_modifier");
  const scale = noticeHook ? 1000 / Math.max(1, noticeHook.value) : 1;

  // felt: always available for a `felt` trait
  const feltIds = unseen(truth, session.subject.know, registry).filter((id) => registry.get(id)?.notice === "felt");
  for (const id of mark(session.subject, truth, registry, session.clock.tick, { path: "felt", ids: feltIds, thresholdScale: scale })) {
    results.push({ path: "felt", traits: [id], line: null });
  }

  // seen: only where a mirror exists
  if (observable) {
    const seenIds = unseen(truth, session.subject.know, registry).filter((id) => registry.get(id)?.notice === "seen");
    for (const id of mark(session.subject, truth, registry, session.clock.tick, { path: "seen", ids: seenIds, thresholdScale: scale })) {
      results.push({ path: "seen", traits: [id], line: null });
    }
  }

  // told: a companion makes her look again (closes a gap she could not close alone)
  if (told) {
    const anyIds = unseen(truth, session.subject.know, registry, { anywhere: true });
    for (const id of mark(session.subject, truth, registry, session.clock.tick, { path: "told", ids: anyIds })) {
      results.push({ path: "told", traits: [id], line: null });
    }
  }

  ageMemory(session.subject, session.clock.tick);
  for (const r of results) {
    const name = (r.traits[0] ?? "").replace(/^attr\./, "").replace(/_/g, " ");
    // a notice is a readable beat: she becomes aware of a change (D-134, §17.5)
    session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `She notices ${name} — ${r.path}.` });
    session.bus.emit("notice", { trait: name || r.traits[0], path: r.path }, { final: true });
    // a fresh notice stops her still a moment (S47, Vivarium D-026): the beat is
    // staged and the flag lets later steps read the pause.
    session.bus.emit("beat.advanced", { scene: session.currentLocation ?? "somewhere", beat: "notice", type: "notice" }, { final: false });
    session.setFlag("still");
  }
  return results;
}

export { isObservable };

/** The nightly self-read: step self-perception and drift resonance (§24). */
export function runSelfRead(session: Session, registry: NoticableRegistry): void {
  const subject = session.subject;
  const share = unnoticedShare(session, registry);
  const derived = readSelf(subject, { unnoticedShare: share });
  const self = stepSelf(subject, derived);
  const { resonanceDelta } = selfRead(subject, self, session.rng);
  // a self-read is a readable beat (R10): emit it so consumers/inner-voice see it
  session.bus.emit("self.read", { tone: self.coherence >= 60 ? "settled" : self.dysmorphia >= 40 ? "estranged" : "uneasy" }, { final: false });
  if (resonanceDelta !== 0) {
    subject.stats.resonance = Math.max(0, Math.min(100, (subject.stats.resonance ?? 50) + resonanceDelta));
    session.markDirty();
  }
}

/** An unstable body drifts: a random active attribute loses or gains a little. */
export function runDrift(session: Session): boolean {
  const chance = driftChance(session.subject.stats.stability ?? 100);
  if (chance <= 0 || !session.rng.chance("drift" as never, chance)) return false;
  const active = session.subject.body.allInstances().flatMap((i) => i.attributes.map((a) => ({ slot: i.slot, a }))).filter((x) => x.a.progress > 0);
  if (active.length === 0) return false;
  const target = active[Math.floor(session.rng.next("drift" as never) * active.length)]!;
  const direction = session.rng.chance("drift" as never, 0.5) ? 1 : -1;
  target.a.progress = Math.max(0, Math.min(1000, target.a.progress + direction * 25));
  session.bus.emit("attribute.progressed", { slot: target.slot, attribute: target.a.id, pct: Math.round((target.a.progress / 1000) * 100) }, { path: `${target.slot}:${target.a.id}`, final: false });
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `The change drifts ${direction > 0 ? "further" : "back"} in her ${target.a.id.replace(/^attr\./, "").replace(/_/g, " ")}.` });
  // a drift leaves a small named residue (S56): a flinch she can feel, so a
  // drifting body reads alive rather than merely noisy.
  const slot = target.slot.replace(/\.(L|R)$/, "");
  session.setFlag(`flinch_${slot}`);
  // sustained pressure against a formed reaction can tip into rebellion (R2, §22.7):
  // a hard/phobia subject whose composure has been ground down pushes back.
  if (session.reactionCatalog) {
    // sustained pressure (R2, §22.7): a formed phobia/hard reaction is the strongest
    // driver, but a ground-down composure under any formed reaction can also rebel.
    const pressure = rebellionPressure(session.subject, session.reactionCatalog);
    const aversionPush = session.subject.preferences.all().reduce((s, p) => s + ((p.kind === "phobia" || p.kind === "limit") ? 25 : 0), 0);
    const formed = session.subject.reactions.length > 0 ? 20 : 0;
    const total = pressure + aversionPush + formed;
    const composure = session.subject.stats.composure ?? 50;
    const tipping = total > 0 && composure < 30 && total > composure;
    if (tipping && session.rng.chance("outcome" as never, 0.4)) {
      session.subject.stats.composure = 0;
      session.subject.mood?.impulse("anger", 30);
      session.bus.emit("resistance.raised", { type: "rebellion", reason: `pressure ${Math.round(total)}` }, { final: true });
      session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `She stops cooperating with the change - a rebellion (pressure ${Math.round(total)}, composure ${Math.round(composure)}).` });
      session.setFlag("rebelled");
    }
  }
  session.markDirty();
  return true;
}

/** The nightly notice + self-read + reaction discovery, in order (§5 tick 8). */
export function runDailyIdentity(session: Session, kit: { registry: NoticableRegistry; reactions: Parameters<typeof discoverReaction>[1]; table?: DispositionTable | null }): void {
  runDrift(session);
  // inspect (D-199) runs *first*: her deliberate look leads, then the passive
  // `felt`/`seen` notice closes whatever she did not actively attend to.
  runInspectDay(session, kit.registry);
  const observable = isObservable(session.currentLocation ? { observe: /bathroom|mirror|hall/.test(session.currentLocation) } : null);
  // a social reaction makes her look again (§17.5 told path): if someone told her
  // about the change (a bond moved today), the told notice fires too.
  const told = session.hasFlag("told");
  const notices = runNotice(session, kit.registry, { observable, told });
  session.flags.delete("told");
  runSelfRead(session, kit.registry);
  // the transformation moves her sexuality through the matrix + notice/accept (§D-169)
  runSexualityDrift(session, kit.table ?? null);
  // the mind step (M15.5b): awareness + the drift of mental values
  if (session.subject.mind) {
    const selfNotices = runSelfChangeNotice(session);
    runMindStep(session, kit.registry, kit.table ?? null, notices.length + selfNotices);
    if (session.mindRegistry) accrueFatigue(session, buildDriftInputs(session, kit.table ?? null).resistance);
  }
  // sex: arousal care + an autonomous private moment when she is due (M15.5f)
  runSexDay(session);
  if (session.sexCatalog) {
    const priv = canMasturbate(session);
    if (priv.ok && session.rng.chance("outcome", 0.5)) {
      const pick = pickSexAction(session, session.sexCatalog, { masturbation: true });
      if (pick) {
        const res = performSex(session, pick);
        // the private session also releases held arousal/frustration (M15.5f)
        const mem = session.subject;
        mem.stats.arousal = Math.max(session.subject.derived.arousalFloor ?? 0, Math.round((mem.stats.arousal ?? 0) * 0.3));
        session.sex.heldArousalTicks = Math.max(0, session.sex.heldArousalTicks - 4);
        session.sex.refractoryTicks = 1;
        session.flags.add("masturbated");
        if (mem.mood) mem.mood.impulse("joy", 6);
        // the moment is an awakening candidate on the touched topics (D-184)
        if (session.criteria.length > 0) runCriteriaOn(session, session.criteria, [...res.topics, ...(pick.target ? [`${pick.target}_tag`] : [])], { importance: 0.7 });
      }
    }
  }
  // a reaction keys on parts that exist — an absent placeholder (tail_absent)
  // should not awaken a tail reaction before the tail is growing (D-202)
  const tags = session.subject.body.allInstances()
    .filter((i) => !(i.tags ?? []).includes("absent_tag"))
    .flatMap((i) => i.tags);
  const formed = discoverReaction(session.subject, kit.reactions, session.rng, session.clock.tick, tags);
  if (formed) {
    session.bus.emit("reaction.awakened", { reaction: formed.id, type: formed.type }, { final: true });
    session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `Something about the change settles into a feeling: ${formed.id.replace(/^react\./, "")} [${formed.type}].` });
    session.markDirty();
  }
  // inspect (D-199): she may actively attend to a change and, if it differs, notice
  // it — the fourth notice path, fired on a mind/personality chance.
  runInspectDay(session, kit.registry);
}

/** The nightly sexuality drift: only a noticed, real sex shift, signed by matrix + self. */
export function runSexualityDrift(session: Session, table: DispositionTable | null): number {
  const s = session.subject;
  if (!s.self || !s.sexuality) return 0;
  // share of the sex-relevant change she has noticed (belief vs body lean)
  const share = Math.min(1, Object.keys(s.know).length / 6);
  const sign = table ? matrixSign(s.personalitySeed, table) : 0;
  const before = s.sexualityDrift ?? 0;
  const delta = sexualityDriftStep(s, { noticedShare: share, self: s.self, matrixSign: sign });
  if (delta !== 0) {
    const after = s.sexualityDrift ?? 0;
    session.bus.emit("sexuality.drifted", { drift: Number(after.toFixed(3)) }, { final: true });
    // journal on a milestone crossing (every 0.1), not every quiet step
    if (Math.floor(Math.abs(after) * 10) > Math.floor(Math.abs(before) * 10) && Math.abs(after) >= 0.1) {
      session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: `The change pulls at what she wants: ${after > 0 ? "further toward men" : "further toward women"}.` });
    }
    session.markDirty();
  }
  return delta;
}

export { identityRead, createSelfPerception, resonanceArc };
export type { SelfPerception };
