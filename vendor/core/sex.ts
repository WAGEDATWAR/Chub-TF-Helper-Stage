import { clampStat } from "./stats";
import { ContentError } from "./loader";
import type { Session } from "./session";
import type { Rng } from "./rng";

/**
 * Sex (blueprint §24, §48.5; D-187–D-193; M15.5f). Arousal alone is a stat spike;
 * **sexual frustration** is what builds when high arousal is held a long time —
 * a derived, slippery pressure that drives arousal and scrambles judgement over
 * time. It can be released by **masturbation** (an autonomous session she chooses
 * when private), by sex, or *managed* by **sexual training**.
 *
 * Also the frustration-release valve (masturbation) and the action/selection model
 * (§sex_actions). Deterministic; the sim picks, never the player.
 */
export const SEX_VERSION = 1;

/** Arousal at/above which held arousal starts building frustration. */
export const FRUSTRATION_AROUSAL_FLOOR = 55;
export const FRUSTRATION_MAX = 100;

/** Derived: frustration from a long, slick arousal. Read, never stored on the bar. */
export function sexualFrustration(session: Session): number {
  const arousal = session.subject.stats.arousal ?? 0;
  const held = session.sex.heldArousalTicks;
  const floor = Math.max(0, arousal - FRUSTRATION_AROUSAL_FLOOR);
  return clampStat((floor / (100 - FRUSTRATION_AROUSAL_FLOOR)) * 60 + Math.min(40, held * 0.6));
}

export interface SexState {
  /** Ticks arousal has stayed above the floor. */
  heldArousalTicks: number;
  /** Ticks until she may choose to masturbate again. */
  refractoryTicks: number;
  /** Sessions since the last release, keyed by act. */
  sessionCount: Record<string, number>;
}

export function createSexState(): SexState {
  return { heldArousalTicks: 0, refractoryTicks: 0, sessionCount: {} };
}

/**
 * Arousal contributed by attributes whose effects declare `arousal` (D-202): a
 * genitals morph produces far more arousal than pain while it is still shifting.
 * Only counts while the attribute is mid-growth (not settled).
 */
function arousalFromAttributes(session: Session): number {
  const registry = session.subject.attributeRegistry;
  if (!registry) return 0;
  let sum = 0;
  for (const inst of session.subject.body.allInstances()) {
    for (const entry of inst.attributes) {
      const eff = registry.get(entry.id)?.effects?.arousal;
      if (typeof eff !== "number") continue;
      const p = entry.progress / 1000;
      if (p <= 0 || p >= 1) continue; // settled attributes stop stoking
      sum += eff * p;
    }
  }
  return Math.round(sum);
}

/** The daily arousal-care step: track held arousal, decay it, tick refractory. */export function runSexDay(session: Session): void {
  const s = session.subject;
  const floor = s.derived.arousalFloor ?? 0;
  // a new, opposite-hormone body (a penis on a female, a vulva on a male) is
  // hypersensitive and a constant source of arousal until adapted to (D-202);
  // sexual control is what adapts her to it.
  const profile = s.derived.genitalProfile ?? "";
  const profileMale = /male|penis|sheath|hemipenes/i.test(profile) && !/female/i.test(profile);
  const profileFemale = /female|vulva|cloaca/i.test(profile);
  const mismatched = (s.baseGender === "male" && profileFemale) || (s.baseGender === "female" && profileMale);
  const adapt = s.abilities["ability.sexual_control"]?.mastery ?? 0;
  const mismatchArousal = mismatched ? Math.round(22 * (1 - adapt / 120)) : 0;
  if (mismatchArousal > 0) s.stats.arousal = clampStat((s.stats.arousal ?? 0) + mismatchArousal);
  // per-stage arousal from the attributes themselves (a shifting genital is arousing)
  const attrArousal = arousalFromAttributes(session);
  if (attrArousal > 0) s.stats.arousal = clampStat((s.stats.arousal ?? 0) + attrArousal);
  // the transformation itself is a driver (M16.5d #28, D-233): a body actively
  // changing runs hot, so arousal climbs with progress, not only from a floor.
  const exposure = s.derived.exposure ?? 0;
  if (exposure > 5) s.stats.arousal = clampStat((s.stats.arousal ?? 0) + Math.round(exposure / 8));
  // a body with a floor drifts up toward it (the transformed body's own appetite)
  if (floor > 0 && (s.stats.arousal ?? 0) < floor) s.stats.arousal = clampStat((s.stats.arousal ?? 0) + Math.max(1, Math.round(floor / 12)));
  const arousal = s.stats.arousal ?? 0;
  if (arousal >= FRUSTRATION_AROUSAL_FLOOR) session.sex.heldArousalTicks += 1;
  else session.sex.heldArousalTicks = Math.max(0, session.sex.heldArousalTicks - 1);

  // frustration feeds arousal back (the slippery loop) and scrambles composure
  const frustration = sexualFrustration(session);
  if (frustration >= 60) {
    const refeed = Math.min(12, Math.round((frustration - 60) / 6));
    s.stats.arousal = clampStat(arousal + refeed);
    s.stats.composure = clampStat((s.stats.composure ?? 50) - (frustration >= 80 ? 2 : 1));
    if (s.mood) s.mood.impulse("desire", frustration >= 80 ? 6 : 3);
  }
  // arousal naturally decays each day, faster the higher it is, but not below the
  // floor — so a transformed body rides high without pegging (D-197).
  // arousal decays proportionally (self-limiting), so it settles against the
  // day's inflow instead of pegging (D-197). Faster when held high.
  const a0 = s.stats.arousal ?? 0;
  const drainRate = a0 >= 80 ? 0.22 : a0 >= 55 ? 0.14 : 0.08;
  s.stats.arousal = clampStat(Math.max(floor, a0 - Math.max(1, Math.round(a0 * drainRate))));
  if (session.sex.refractoryTicks > 0) session.sex.refractoryTicks -= 1;

  // at overload she may entice or take — leaving unwanted reactions to discover
  if (frustration >= 85 && session.sex.refractoryTicks <= 0) {
    session.bus.emit("sex.overload", { frustration }, { final: true });
    if (s.mood) s.mood.impulse("desire", 8);
    session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: "The wanting stops being background; it starts making her decisions." });
  }
  session.markDirty();
}

export interface MasturbationResult {
  ok: boolean;
  reason?: string | undefined;
  released: number;
  durationTicks: number;
  climax: boolean;
  topics: string[];
}

/** Can she take a private moment right now? An exhibitionist need not be private. */
export function canMasturbate(session: Session): { ok: boolean; reason?: string | undefined } {
  if (session.sex.refractoryTicks > 0) return { ok: false, reason: "not yet" };
  const frustration = sexualFrustration(session);
  const arousal = session.subject.stats.arousal ?? 0;
  const floor = session.subject.mind?.read("libidinous") ?? 50;
  if (arousal < 30 && frustration < 35 && floor < 60) return { ok: false, reason: "not in the mood" };
  return { ok: true };
}

/**
 * One masturbation session: a self-regulation act the sim chooses. Releases a
 * chunk of arousal/frustration; touches topics (an awakening candidate); can fire
 * faults (a cramping claw, a muffled voice).
 */
export function masturbate(session: Session, rng: Rng, topics: string[] = []): MasturbationResult {
  const gate = canMasturbate(session);
  if (!gate.ok) return { ok: false, reason: gate.reason, released: 0, durationTicks: 0, climax: false, topics };
  const s = session.subject;
  const before = (s.stats.arousal ?? 0) + sexualFrustration(session) / 2;
  const durationTicks = 1 + Math.round(((s.stats.endurance ?? 50) / 100) * 2);
  const climax = rng.chance("outcome", 0.7) || (s.stats.arousal ?? 0) >= 70;
  s.stats.arousal = clampStat(climax ? Math.round((s.stats.arousal ?? 0) * 0.25) : (s.stats.arousal ?? 0) - 30);
  session.sex.heldArousalTicks = Math.max(0, session.sex.heldArousalTicks - (climax ? 4 : 2));
  session.sex.refractoryTicks = 1;
  session.sex.sessionCount["masturbation"] = (session.sex.sessionCount["masturbation"] ?? 0) + 1;
  s.stats.drive = clampStat((s.stats.drive ?? 0) + 2);
  if (s.mood) s.mood.impulse(climax ? "joy" : "desire", climax ? 8 : 4);

  session.flags.add("masturbated");
  session.bus.emit("sex.session", { act: "masturbation", climax, durationTicks }, { final: true });
  session.journal.recordObservation({
    tick: session.clock.tick,
    day: session.clock.day,
    note: climax ? "She steals a private moment and takes the edge off." : "A private moment; the edge only half-blunts.",
  });
  session.markDirty();
  return { ok: true, released: Math.max(0, Math.round(before - ((s.stats.arousal ?? 0) + sexualFrustration(session) / 2))), durationTicks, climax, topics };
}

/** Sexual training lowers the arousal/frustration gain rate (a control target). */
export function frustrationGainMult(session: Session): number {
  const mastery = session.subject.abilities["ability.sexual_control"]?.mastery ?? 0;
  return Math.max(0.5, 1 - mastery / 200);
}

export function buildSexState(raw: unknown): SexState {
  const data = raw as Partial<SexState> | null | undefined;
  if (!data || typeof data !== "object") throw new ContentError("sex: bad state");
  return { heldArousalTicks: data.heldArousalTicks ?? 0, refractoryTicks: data.refractoryTicks ?? 0, sessionCount: { ...(data.sessionCount ?? {}) } };
}
