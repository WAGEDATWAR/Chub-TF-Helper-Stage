import type { Session } from "./session";

/**
 * Transformation coupling (M15.5e, D-172). Her mind has a hand on the wheel: how
 * she reads the change (accept vs resist, awareness, control) scales how fast it
 * lands, and what she is drawn toward biases *which* parts land sooner.
 *
 * Pure reads; the resolver/distribution honour the outputs. Deterministic.
 */
export const COUPLING_VERSION = 1;

/** How much faster/slower the change lands from her stance (0.6..1.5). */
export function mindGrowthFactor(session: Session): number {
  const mind = session.subject.mind;
  if (!mind) return 1;
  // acceptance pulls change forward; resistance holds it back. Resistance only
  // *can* hold it once she is aware enough to fight (D-177). Fear and instability
  // resist even before she can name why; a fetish pulls it forward.
  const aversion = session.subject.preferences.all().reduce((s, p) => s + (p.kind === "fetish" ? -1 : 1) * (Math.abs(p.opinion) / 100), 0);
  const fear = (session.subject.mood?.get("fear") ?? 0) / 100;
  const shaky = (100 - (session.subject.stats.stability ?? 100)) / 100;
  const aware = 0.4 + 0.6 * (mind.awareness / 100);
  const fight = clampSigned((aversion * 0.7 + fear * 0.5 + shaky * 0.4) * aware); // -1..1
  const composureHelp = ((session.subject.stats.composure ?? 50) - 50) / 200; // small
  const factor = 1 - 0.35 * fight + composureHelp;
  return Math.max(0.6, Math.min(1.5, factor));
}

/** Whether a stance reading is strong enough to count as a story beat. */
export function couplingIsNotable(factor: number): boolean {
  return Math.abs(factor - 1) >= 0.05;
}

/**
 * A per-slot desirability weight (0.6..1.6) from what she is drawn toward: a part
 * whose tags match a fetish topic lands a touch sooner; an aversion, later.
 */
export function slotDesire(session: Session, partTags: readonly string[]): number {
  const prefs = session.subject.preferences.all();
  let bias = 0;
  for (const pref of prefs) {
    const topicKey = pref.topic.replace(/^topic\./, "");
    if (!partTags.some((t) => t.includes(topicKey) || topicKey.includes(t.split("_")[0]!))) continue;
    bias += (pref.kind === "fetish" ? 1 : -1) * (Math.abs(pref.opinion) / 100);
  }
  return Math.max(0.6, Math.min(1.6, 1 + bias * 0.3));
}

/** The effective growth multiplier: temporal powers × mind stance (D-172). */
export function coupledGrowth(session: Session, temporalRate: number): number {
  const mind = mindGrowthFactor(session);
  if (couplingIsNotable(mind) && session.clock.tick % 12 === 0) {
    session.bus.emit("growth.coupled", { factor: Number(mind.toFixed(2)), direction: mind > 1 ? "fast" : "slow" }, { final: false });
  }
  return temporalRate * mind;
}

function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
