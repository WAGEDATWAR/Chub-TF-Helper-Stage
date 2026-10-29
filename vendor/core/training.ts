import { ContentError } from "./loader";
import { clampStat } from "./stats";
import { abilityStates, applyMastery, masteryOf, ensureAbility, type AbilityRegistry } from "./abilities";
import { rollFaults, applyFaultEffect, type FaultRegistry, type FiredFault } from "./faults";
import { AWARENESS_TIERS } from "./mind";
import type { Subject } from "./subject";
import type { Rng } from "./rng";

/**
 * Training (blueprint §15, §48.5; D-114, D-180). The Observer is unseen, so
 * training is reframed as *situations she is in*: she trains herself as part of
 * her life. As of M15.5d, training is **gated by awareness** (D-180): blind = no
 * training; dim = available but risky; aware = normal; lucid = diminishing returns
 * but safer. And she **decides** to train from her mind + emotions, not a script.
 */
export const MASTERY_MAX = 100;
export const TRAINING_PHASES = Object.freeze(["setup", "warmup", "work", "resolve", "reward"] as const);

/** Awareness-tier training profile (D-180): gate, gain mult, risk, fault mult. */
export interface TrainingTierProfile {
  id: string;
  min: number;
  gainMult: number;
  failMult: number;
  faultMult: number;
  available: boolean;
}

export const TRAINING_TIERS: Readonly<Record<string, TrainingTierProfile>> = Object.freeze({
  blind: { id: "blind", min: 0, gainMult: 0, failMult: 1, faultMult: 1, available: false },
  dim: { id: "dim", min: 15, gainMult: 0.7, failMult: 1.2, faultMult: 1.25, available: true },
  aware: { id: "aware", min: 35, gainMult: 1, failMult: 1, faultMult: 1, available: true },
  lucid: { id: "lucid", min: 75, gainMult: 0.75, failMult: 0.7, faultMult: 0.6, available: true },
});

export function trainingTier(tierId: string): TrainingTierProfile {
  return TRAINING_TIERS[tierId] ?? TRAINING_TIERS.aware!;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** The training profile for an awareness value. */
export function profileForAwareness(awareness: number): TrainingTierProfile {
  for (const t of [...AWARENESS_TIERS].reverse()) if (awareness >= t.min) return trainingTier(t.id);
  return trainingTier("blind");
}

const STAT_FOR: Record<string, string> = {
  agility: "agility",
  composure: "composure",
  perception: "perception",
  intelligence: "intelligence",
  strength: "strength",
  endurance: "endurance",
};

export interface TrainingConfig {
  frustration_cap: number;
  breakthrough_window: [number, number];
  reps_per_session: number;
  check: { base: number; min: number; max: number; stat_weight: number; mastery_weight: number; drive_weight: number; composure_weight: number; frustration_weight: number; fatigue_weight: number };
  gains: { success_mastery: number; fail_mastery: number; breakthrough_bonus: number; plateau_mastery: number; fatigue_per_rep: number; taper: number; min_gain: number };
  categories: Array<{ id: string; label: string; slots: number; gain: string; cost: string; stat_gain?: number; fatigue?: number; drive?: number; composure?: number; resonance?: number; drive_on_fail?: number; line: string }>;
  difficulty: { base: number; per_tier: number };
  breakthrough: { in_window: number; out_of_window: number };
}

export interface TrainingBlock {
  frustration: number;
  reps: number;
  phase: string;
  category: string | null;
  ability: string | null;
  stance: string;
  plateaued: boolean;
  breakthroughs: number;
  sessions: Record<string, number>;
}

export interface Stance {
  id: string;
  label: string;
  stance_axis: string;
  diff_mod: number;
  frustration_per_rep: number;
  mastery_mult: number;
  composure_delta: number;
  composure_gate: number;
  desc: string;
}

export function emptyTrainingBlock(): TrainingBlock {
  return { frustration: 0, reps: 0, phase: "setup", category: null, ability: null, stance: "stance.soften", plateaued: false, breakthroughs: 0, sessions: {} };
}

export function buildTrainingConfig(data: unknown): TrainingConfig {
  const d = data as TrainingConfig | null | undefined;
  if (!d?.check || !Array.isArray(d.breakthrough_window)) {
    throw new ContentError('training.json needs "check" and "breakthrough_window"', "training.json");
  }
  const [lo, hi] = d.breakthrough_window;
  if (!(lo < hi) || hi > d.frustration_cap) {
    throw new ContentError("training.json breakthrough_window must satisfy low < high <= frustration_cap", "training.json");
  }
  return d;
}

export function buildStances(data: unknown): Stance[] {
  const s = (data as { stances?: unknown } | null | undefined)?.stances;
  if (!Array.isArray(s)) throw new ContentError('stances.json must declare a "stances" array', "stances.json");
  return s as Stance[];
}

function taperedGain(base: number, mastery: number, gains: TrainingConfig["gains"]): number {
  if (base <= 0) return 0;
  const factor = Math.max(0, 1 - (gains.taper ?? 0) * mastery);
  return Math.max(gains.min_gain ?? 1, Math.round(base * factor));
}

export function statFor(subject: Subject, testStat: string): number {
  return subject.stats[STAT_FOR[testStat] ?? "perception"] ?? 0;
}

export function difficultyFor(mastery: number, config: TrainingConfig, stance: Stance): number {
  const tier = Math.max(1, Math.floor(mastery / 25) + 1);
  return config.difficulty.base + config.difficulty.per_tier * (tier - 1) + (stance.diff_mod ?? 0);
}

/** The success chance of one rep (blueprint §41.3, translated). */
export function checkChance({ stat, mastery, drive, composure, difficulty, frustration, fatigue, config }: {
  stat: number; mastery: number; drive: number; composure: number; difficulty: number; frustration: number; fatigue: number; config: TrainingConfig;
}): number {
  const c = config.check;
  const raw = c.base + (c.stat_weight * stat + c.mastery_weight * mastery + c.drive_weight * drive + c.composure_weight * composure - difficulty - c.frustration_weight * frustration - c.fatigue_weight * (fatigue / 10)) / 100;
  return Math.max(c.min, Math.min(c.max, raw));
}

export function inWindow(frustration: number, config: TrainingConfig): boolean {
  const [lo, hi] = config.breakthrough_window;
  return frustration >= lo && frustration <= hi;
}

export interface RepForecast {
  chance: number;
  difficulty: number; frustration: number; inWindow: boolean; win: [number, number]; cap: number;
  gated: boolean; gateReason: string | null; tier: number; mastery: number;
  awarenessTier: string; gainMult: number;
}

export function forecastRep({ session, abilities, config, stances, abilityId, stanceId }: {
  session: { subject: Subject; training: TrainingBlock }; abilities: AbilityRegistry; config: TrainingConfig; stances: Stance[]; abilityId: string; stanceId: string;
}): RepForecast {
  const subject = session.subject;
  const ability = abilities.get(abilityId);
  if (!ability) throw new ContentError(`training: unknown ability "${abilityId}"`);
  const stance = stances.find((s) => s.id === stanceId) ?? stances[1]!;
  const state = masteryOf(subject, abilityId);
  const difficulty = difficultyFor(state.mastery, config, stance);
  const chance = checkChance({
    stat: statFor(subject, ability.test_stat), mastery: state.mastery, drive: subject.stats.drive ?? 0,
    composure: subject.stats.composure ?? 0, difficulty, frustration: session.training.frustration, fatigue: subject.stats.fatigue ?? 0, config,
  });
  const profile = profileForAwareness(subject.mind?.awareness ?? 100);
  const composureGated = (subject.stats.composure ?? 0) < (stance.composure_gate ?? 0);
  const awarenessGated = !profile.available;
  const gated = composureGated || awarenessGated;
  return {
    chance: Number(Math.min(config.check.max, chance / profile.failMult).toFixed(3)), difficulty, frustration: session.training.frustration,
    inWindow: inWindow(session.training.frustration, config), win: config.breakthrough_window, cap: config.frustration_cap,
    gated, gateReason: awarenessGated ? "she does not yet know what is happening" : composureGated ? `needs Composure ${stance.composure_gate}` : null,
    tier: abilities.tierFor(abilityId, state.mastery)!.tier, mastery: state.mastery, awarenessTier: profile.id, gainMult: profile.gainMult,
  };
}

export interface RepResult {
  ability: string;
  success: boolean;
  chance: number;
  masteryGain: number;
  mastery: number;
  tierUp: boolean;
  frustration: number;
  capped: boolean;
  faults: FiredFault[];
}

/** One rep: failure adds frustration, never removes mastery. */
export function resolveRep({ session, abilities, faults, config, stances, abilityId, stanceId }: {
  session: { subject: Subject; training: TrainingBlock; rng: Rng }; abilities: AbilityRegistry; faults: FaultRegistry; config: TrainingConfig; stances: Stance[]; abilityId: string; stanceId: string;
}): RepResult | { error: string } {
  const subject = session.subject;
  const ability = abilities.get(abilityId);
  if (!ability) return { error: `unknown ability "${abilityId}"` };
  const stance = stances.find((s) => s.id === stanceId) ?? stances[1]!;
  const block = session.training;
  if (block.reps >= config.reps_per_session) return { error: "the session is out of reps" };
  if ((subject.stats.composure ?? 0) < (stance.composure_gate ?? 0)) return { error: `that stance needs Composure ${stance.composure_gate}` };
  if (!profileForAwareness(subject.mind?.awareness ?? 100).available) return { error: "she does not yet know what is happening" };

  const state = ensureAbility(subject, abilityId);
  const forecast = forecastRep({ session, abilities, config, stances, abilityId, stanceId: stance.id });
  const roll = session.rng.next("outcome");
  const success = roll < forecast.chance;
  const profile = profileForAwareness(subject.mind?.awareness ?? 100);

  block.stance = stance.id;
  block.ability = abilityId;
  block.reps += 1;
  block.phase = block.reps >= config.reps_per_session ? "resolve" : "work";

  // a shaky, unaware start (or a lucid bonus) scales fault chance (D-180)
  const fired = rollFaults({ ability, mastery: state.mastery, abilities, faults, subject, rng: session.rng, chanceMult: profile.faultMult })
    .map((f) => ({ id: f.id, name: f.display_name, text: f.text, netPositive: f.net_positive === true, applied: applyFaultEffect(block, config.frustration_cap, subject, f) }));

  subject.stats.fatigue = clampStat((subject.stats.fatigue ?? 0) + config.gains.fatigue_per_rep);
  let masteryGain: number;
  const gainMult = profile.gainMult;
  if (success) {
    block.frustration = Math.min(config.frustration_cap, block.frustration + (stance.frustration_per_rep ?? 0));
    masteryGain = taperedGain(config.gains.success_mastery * (stance.mastery_mult ?? 1) * gainMult, state.mastery, config.gains);
  } else {
    block.frustration = Math.min(config.frustration_cap, block.frustration + (stance.frustration_per_rep ?? 0) + 1);
    masteryGain = taperedGain(config.gains.fail_mastery * gainMult, state.mastery, config.gains);
  }
  const cd = stance.composure_delta ?? 0;
  if (cd !== 0) subject.stats.composure = clampStat((subject.stats.composure ?? 0) + cd);

  const capped = block.frustration >= config.frustration_cap;
  const tierBefore = abilities.tierFor(abilityId, state.mastery)!.tier;
  applyMastery(subject, abilityId, masteryGain);
  if (capped) block.phase = "resolve";
  const tierAfter = abilities.tierFor(abilityId, state.mastery)!.tier;
  return { ability: abilityId, success, chance: forecast.chance, masteryGain, mastery: state.mastery, tierUp: tierAfter > tierBefore, frustration: block.frustration, capped, faults: fired };
}

export interface SessionEnding {
  kind: "breakthrough" | "plateau" | "frustration_cap";
  masteryBonus: number;
  mastery: number;
}

/** Breakthrough or plateau at session end (§41.4): the band is the skill expression. */
export function finishSession(session: { subject: Subject; training: TrainingBlock; rng: Rng }, _abilities: AbilityRegistry, config: TrainingConfig, abilityId: string): SessionEnding {
  const subject = session.subject;
  const block = session.training;
  const win = inWindow(block.frustration, config);
  let kind: SessionEnding["kind"] = "plateau";
  let masteryBonus = config.gains.plateau_mastery;
  const current = masteryOf(subject, abilityId).mastery;
  if (block.frustration >= config.frustration_cap) {
    kind = "frustration_cap";
    masteryBonus = 0;
  } else if (session.rng.next("outcome") < (win ? config.breakthrough.in_window : config.breakthrough.out_of_window)) {
    kind = "breakthrough";
    masteryBonus = taperedGain(config.gains.breakthrough_bonus, current, config.gains);
    block.breakthroughs += 1;
  } else {
    masteryBonus = taperedGain(masteryBonus, current, config.gains);
  }
  if (masteryBonus > 0) applyMastery(subject, abilityId, masteryBonus);
  block.sessions[abilityId] = (block.sessions[abilityId] ?? 0) + 1;
  block.phase = "reward";
  block.plateaued = kind === "plateau";
  return { kind, masteryBonus, mastery: masteryOf(subject, abilityId).mastery };
}

export function resetSession(session: { training: TrainingBlock }): TrainingBlock {
  const keep = session.training;
  session.training = { ...emptyTrainingBlock(), sessions: keep.sessions ?? {}, breakthroughs: keep.breakthroughs ?? 0 };
  return session.training;
}

export interface PracticePick {
  abilityId: string;
  stanceId: string;
  reason: string;
  /** 0..1, how driven this practice is (drive + desire + self-image). */
  urgency: number;
}

/**
 * Self-driven practice (§48.5; S45). No Observer input, but deeply shaped by her
 * psychology: *what* she practises is weighted by drive, by what she desires to
 * become (fetish families / novelty), and by self-image (a high-dysmorphia
 * subject practises whatever anchors her; a proud one pushes toward a desire);
 * *how hard* follows her Composure and a drive-scaled appetite.
 */
export function pickPractice(
  subject: Subject,
  abilities: AbilityRegistry,
  stances: Stance[],
  _rng: Rng,
  opts: { desiredFamilies?: string[] | undefined; dysmorphia?: number | undefined; pride?: number | undefined; nudgeAbility?: string | undefined; nudgeStance?: string | undefined; contextWeight?: ((a: { id: string; category: string; mastery: number }) => number) | undefined } = {},
): PracticePick | null {
  const held = abilityStates(subject, abilities, { exposure: subject.derived.exposure ?? 0 }).filter((a) => a.held);
  if (held.length === 0) return null;

  // awareness gate (D-180): blind = no training. A nervous/overwhelmed subject may
  // decline even when able — she decides from her mind + emotions, not a script.
  const profile = profileForAwareness(subject.mind?.awareness ?? 100);
  if (!profile.available) return null;
  const mind = subject.mind;
  const willingness = clamp01(
    0.4 +
    0.3 * ((mind?.read("confident") ?? 50) / 100) +                  // confidence drives effort
    0.2 * (1 - (mind?.read("nervous") ?? 40) / 100) +                // nerve raises follow-through
    0.2 * (1 - (subject.mood?.get("fear") ?? 0) / 100) -             // fear holds her back
    0.2 * ((subject.mood?.get("shame") ?? 0) / 100),
  );
  // a nudge overrides reluctance
  if (!opts.nudgeAbility && _rng.next("outcome") > willingness + 0.15) return null;

  const drive = subject.stats.drive ?? 0;
  const dysmorphia = opts.dysmorphia ?? subject.self?.dysmorphia ?? 0;
  const desired = new Set(opts.desiredFamilies ?? []);

  // score: an under-mastered ability is a default pull; desire + drive up-weight
  // the abilities that match what she wants to become; dysmorphia up-weights the
  // least-mastered (practising what she knows steadies her).
  const scored = held.map((a) => {
    let score = (100 - a.mastery) / 100;
    const familyTag = `${a.category}_tag`;
    if (desired.size > 0 && (desired.has(familyTag) || desired.has(a.category))) score *= 1 + 0.5 * (drive / 100);
    if (dysmorphia >= 55) score *= 1 + (100 - a.mastery) / 200;
    if (opts.pride !== undefined && opts.pride >= 55 && desired.size > 0) score *= 1 + 0.3 * (drive / 100);
    // her schedule/location biases what she drills (S48.5): at home she anchors
    if (opts.contextWeight) score *= opts.contextWeight({ id: a.id, category: a.category, mastery: a.mastery });
    return { ability: a, score };
  });
  scored.sort((x, y) => y.score - x.score || x.ability.id.localeCompare(y.ability.id));
  const target = opts.nudgeAbility ? held.find((a) => a.id === opts.nudgeAbility) ?? scored[0]!.ability : scored[0]!.ability;

  // stance: how hard. Drive raises the appetite; Composure gates what she affords.
  const composure = subject.stats.composure ?? 0;
  const affordable = stances.filter((s) => composure >= (s.composure_gate ?? 0) && s.id !== "stance.drill" && s.id !== "stance.play");
  const wanted = opts.nudgeStance
    ? affordable.find((s) => s.id === opts.nudgeStance) ?? affordable[affordable.length - 1]!
    : drive >= 70
      ? affordable[affordable.length - 1]!
      : drive >= 45
        ? affordable[Math.min(affordable.length - 1, 1)]!
        : affordable[0]!;

  const urgency = Math.min(1, (drive / 100) * 0.6 + (target ? (100 - target.mastery) / 100 * 0.4 : 0));
  const reason = opts.nudgeAbility
    ? "the nudge points her at it"
    : drive >= 70
      ? "she is driven today"
      : desired.size > 0 && dysmorphia < 40
        ? "she practises toward what she wants to become"
        : dysmorphia >= 55
          ? "practising steadies her"
          : "a steady pace";
  return { abilityId: target!.id, stanceId: wanted.id, reason, urgency };
}

export interface SelfPracticeResult {
  abilityId: string;
  stanceId: string;
  reason: string;
  ending: SessionEnding;
  reps: number;
  faults: number;
}

/**
 * Advance one self-driven practice session from her schedule (§48.5). Called by
 * the clock when she is practising; deterministic from the session RNG.
 */
export function selfPractice({ subject, session, rng, abilities, faults, config, stances, opts }: {
  subject: Subject; session: { training: TrainingBlock }; rng: Rng; abilities: AbilityRegistry; faults: FaultRegistry; config: TrainingConfig; stances: Stance[];
  opts?: { desiredFamilies?: string[] | undefined; nudgeAbility?: string | undefined; nudgeStance?: string | undefined; contextWeight?: ((a: { id: string; category: string; mastery: number }) => number) | undefined };
}): SelfPracticeResult | null {
  session.training = { ...emptyTrainingBlock(), sessions: session.training.sessions ?? {}, breakthroughs: session.training.breakthroughs ?? 0 };
  const training = session.training;
  const pick = pickPractice(subject, abilities, stances, rng, opts);
  if (!pick) return null;
  let faultCount = 0;
  let reps = 0;
  for (let i = 0; i < config.reps_per_session; i++) {
    const r = resolveRep({ session: { subject, training, rng }, abilities, faults, config, stances, abilityId: pick.abilityId, stanceId: pick.stanceId });
    if ("error" in r) break;
    reps += 1;
    faultCount += r.faults.length;
    if (r.capped) break;
  }
  if (reps === 0) return null;
  const ending = finishSession({ subject, training, rng }, abilities, config, pick.abilityId);
  return { abilityId: pick.abilityId, stanceId: pick.stanceId, reason: pick.reason, ending, reps, faults: faultCount };
}
