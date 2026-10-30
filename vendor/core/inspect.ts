import { clampStat } from "./stats";
import { unseen, mark, type NoticableRegistry } from "./perception";
import { truthFrame } from "./perception_wiring";
import type { Session } from "./session";
import type { Rng } from "./rng";

/**
 * Inspect (D-199). Her body and mind are *inspectable*: at a mind/personality
 * chance she attends to a part or a change and, if it differs from what she
 * believed, notices it. This is the fourth notice path — an active look, distinct
 * from a passive `felt`/`seen`/`told`.
 *
 * The loop is **pain → concern → inspect → confirm**: unexplained pain is a major
 * driver, so a high unexplained pain makes her attend and turns concern into
 * emotion. Inspecting also closes belief on truth for a *mental* change (she got
 * angrier, sharper, hornier) — notices are not only parts.
 *
 * She chooses, not the player: the chance comes from her curiosity, confidence,
 * composure and dysmorphia, and from how much is unexplained.
 */
export const INSPECT_VERSION = 1;

/** Attention paths an inspect may take. */
export type InspectFocus = "part" | "mental" | "stat";

export interface InspectResult {
  focus: InspectFocus;
  /** The trait / stat / mind value attended to. */
  subject: string;
  /** Whether it closed a real belief gap. */
  confirmed: boolean;
  line: string;
}

export interface InspectState {
  /** Ticks until she may inspect again. */
  cooldown: number;
  /** Inspects since the last notable confirmation (for the log variety). */
  count: number;
  /** The last thing she attended to, for the surface read. */
  last: { focus: InspectFocus; subject: string; line: string } | null;
}

export function createInspectState(): InspectState {
  return { cooldown: 0, count: 0, last: null };
}

/** Cooldown in *days* (it ticks down once per daily boundary). */
const COOLDOWN_TICKS = 2;

/**
 * The chance she inspects today. Curiosity and confidence drive it; a rattled,
 * dysmorphic subject looks more (seeking reassurance); unexplained pain forces
 * it. Bounded so she neither never nor always looks.
 */
export function inspectChance(session: Session): number {
  const s = session.subject;
  const mind = s.mind;
  const curious = (mind?.read("curious") ?? 50) / 100;
  const confident = (mind?.read("confident") ?? 50) / 100;
  const dysmorphia = (s.self?.dysmorphia ?? 0) / 100;
  const composure = (s.stats.composure ?? 50) / 100;
  // unexplained pain is a major driver (D-199)
  const pain = s.stats.pain ?? 0;
  const painPush = pain >= 55 ? 0.35 : pain >= 30 ? 0.18 : 0;
  const base = 0.12 + 0.25 * curious + 0.12 * confident + 0.2 * dysmorphia + 0.1 * (1 - composure);
  return Math.min(0.9, base + painPush);
}

/** Is there anything at all for her to find? */
export function hasAnythingToInspect(session: Session, registry: NoticableRegistry | null): boolean {
  const s = session.subject;
  if (registry && unseen(truthFrame(session, registry), s.know, registry, { anywhere: true }).length > 0) return true;
  return mentalGaps(s).length > 0 || statGaps(s).length > 0;
}

/** A mental value she has drifted well from (needs a baseline + threshold). */
function mentalGaps(s: Session["subject"]): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  const mind = s.mind;
  if (!mind) return out;
  for (const id of mind.ids()) {
    const key = `mind.${id}`;
    if (s.know[key]) continue;
    const state = mind.get(id)!;
    if (Math.abs(state.value - state.baseline) >= 15) out.push({ key, value: state.value });
  }
  return out;
}

/** A stat she has drifted well from a neutral baseline. */
function statGaps(s: Session["subject"]): Array<{ key: string; value: number; stat: string }> {
  const out: Array<{ key: string; value: number; stat: string }> = [];
  for (const [id, base] of [["strength", 50], ["intelligence", 50], ["agility", 50], ["endurance", 50], ["perception", 50]] as const) {
    const key = `stat.${id}`;
    if (s.know[key]) continue;
    const cur = s.stats[id] ?? base;
    if (Math.abs(cur - base) >= 15) out.push({ key, value: cur, stat: id });
  }
  return out;
}

/**
 * She attends to the most salient thing and, if it differs, notices it. Prefers a
 * felt body change, then unexplained pain's neighbourhood, then a mental shift.
 * Returns the result, or null when she looks and finds nothing new.
 */
export function inspect(session: Session, registry: NoticableRegistry | null, rng: Rng): InspectResult | null {
  const s = session.subject;
  const truth = registry ? truthFrame(session, registry) : {};

  // a body change: the largest unseen gap, felt path (her own hands and eyes)
  if (registry) {
    const gaps = unseen(truth, s.know, registry, { anywhere: true });
    if (gaps.length > 0) {
      gaps.sort((a, b) => (truth[b] ?? 0) - (truth[a] ?? 0) || a.localeCompare(b));
      const id = gaps[rng.int("outcome", 0, Math.min(gaps.length - 1, 2))]!;
      const changed = mark(s, truth, registry, session.clock.tick, { path: "felt", ids: [id] });
      const name = id.replace(/^attr\./, "").replace(/_/g, " ");
      return { focus: "part", subject: id, confirmed: changed.length > 0, line: `She attends to it and finds ${name} changed.` };
    }
  }

  // a mental shift: she catches herself feeling different
  const mental = mentalGaps(s);
  if (mental.length > 0) {
    const pick = mental[rng.int("outcome", 0, mental.length - 1)]!;
    s.know[pick.key] = { belief: pick.value, noticedAtTick: session.clock.tick, path: "felt" };
    const name = pick.key.replace(/^mind\./, "").replace(/_/g, " ");
    return { focus: "mental", subject: pick.key, confirmed: true, line: `She catches it in herself: she is ${name} now.` };
  }

  // a stat shift
  const stats = statGaps(s);
  if (stats.length > 0) {
    const pick = stats[rng.int("outcome", 0, stats.length - 1)]!;
    s.know[pick.key] = { belief: pick.value, noticedAtTick: session.clock.tick, path: "felt" };
    return { focus: "stat", subject: pick.stat, confirmed: true, line: `She tests herself and finds she is ${pick.stat} now.` };
  }

  return null;
}

export interface InspectDayResult {
  result: InspectResult | null;
  /** True when pain drove a concern spike this day. */
  concern: boolean;
}

/**
 * The daily inspect step. Rolls her chance; if she looks and finds something,
 * emits + journals it. Unexplained pain above a high line raises concern (fear +
 * awareness), the telegraph before the look.
 */
export function runInspectDay(session: Session, registry: NoticableRegistry | null): InspectDayResult {
  const s = session.subject;
  const pain = s.stats.pain ?? 0;
  let concern = false;
  // unexplained pain: concern rises into emotion before she looks (D-199). This
  // fires independent of the cooldown — pain does not wait its turn.
  if (pain >= 45 && !s.know["stat.pain"]) {
    s.mood?.impulse("fear", pain >= 65 ? 6 : 3);
    s.mind?.gainAwareness(pain >= 65 ? 3 : 1.5);
    concern = true;
    session.bus.emit("inspect.concern", { pain }, { final: false });
  }

  const painForces = pain >= 45 && !s.know["stat.pain"];
  // pain bypasses the cooldown — an urgent ache does not wait its turn
  if (!painForces && session.inspectState.cooldown > 0) {
    session.inspectState.cooldown -= 1;
    return { result: null, concern };
  }

  if (!painForces && session.rng.next("outcome") >= inspectChance(session)) return { result: null, concern };
  const result = painForces
    ? painInspect(session, registry)
    : inspect(session, registry, session.rng);
  if (!result) return { result: null, concern };

  session.inspectState.count += 1;
  session.inspectState.cooldown = COOLDOWN_TICKS;
  session.inspectState.last = { focus: result.focus, subject: result.subject, line: result.line };
  session.bus.emit("inspect", { focus: result.focus, subject: result.subject, confirmed: result.confirmed }, { final: true });
  session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: result.line });
  // a confirmed finding on a painful change steadies her a little (she knows now)
  if (result.confirmed && pain >= 45) s.stats.composure = clampStat((s.stats.composure ?? 50) + 2);
  session.markDirty();
  return { result, concern };
}

/** The pain-driven look: she attends to why it hurts and names it (D-199). */
function painInspect(session: Session, registry: NoticableRegistry | null): InspectResult | null {
  const s = session.subject;
  s.know["stat.pain"] = { belief: s.stats.pain ?? 0, noticedAtTick: session.clock.tick, path: "felt" };
  // confirm a body change nearby if one is unseen, so the pain has an attribution
  if (registry) {
    const truth = truthFrame(session, registry);
    const gaps = unseen(truth, s.know, registry, { anywhere: true });
    if (gaps.length > 0) {
      const id = gaps[0]!;
      mark(s, truth, registry, session.clock.tick, { path: "felt", ids: [id] });
      const name = id.replace(/^attr\./, "").replace(/_/g, " ");
      return { focus: "part", subject: id, confirmed: true, line: `She attends to the ache and finds it: ${name}, still changing.` };
    }
  }
  return { focus: "stat", subject: "pain", confirmed: true, line: "She attends to the ache and names it for what it is: the change, working." };
}
