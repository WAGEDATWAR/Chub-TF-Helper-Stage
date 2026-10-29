/**
 * H10 mind wiring. Gives each character a real interior: a daily notice + awareness
 * step (reusing the parent's perception/mind modules) so a character can *realize*
 * what is happening to them. This is what `voluntary` gating and mind-honest prose
 * hang off — the sim, not the LLM, decides realization.
 *
 * Deterministic and pure over the sim. The parent's own functions are used so there
 * is one source of truth (zero drift).
 */
import { buildPerceptionKit, runNotice, runSelfRead } from "@core/perception_wiring";
import { runSelfChangeNotice, runAwareness, runMindStep } from "@core/mind_wiring";
import type { NoticableRegistry } from "@core/perception";
import type { Sim } from "./subject";
import type { Registries } from "./registries";

/** Build (once) the notice registry for a sim's attribute set. */
export function perceptionFor(regs: Registries): NoticableRegistry {
  return buildPerceptionKit(regs.attributes);
}

const kitCache = new WeakMap<Registries, NoticableRegistry>();

function kitFor(regs: Registries): NoticableRegistry {
  let kit = kitCache.get(regs);
  if (!kit) { kit = perceptionFor(regs); kitCache.set(regs, kit); }
  return kit;
}

/**
 * Run the daily identity step for one character: notice her own changes, then raise
 * awareness and drift her mind. Fires the realization moment in the core when
 * awareness crosses the threshold. Called once per simulated day from `advance`.
 */
export function runDailyMind(sim: Sim): void {
  if (!sim.subject.mind) return;
  const kit = kitFor(sim.regs);
  // a mirror-ish self-inspection most days, plus felt/self notices, then awareness
  runNotice(sim.session, kit, { observable: true });
  runSelfRead(sim.session, kit);
  const selfNotices = runSelfChangeNotice(sim.session);
  runAwareness(sim.session, kit, selfNotices);
  runMindStep(sim.session, kit, null, selfNotices);
}

/** Has this character realized what is happening to them? */
export function isRealized(sim: Sim): boolean {
  return sim.subject.mind?.realized ?? false;
}

/** Awareness 0..100 (0 when no mind). */
export function awareness(sim: Sim): number {
  return Math.round(sim.subject.mind?.awareness ?? 0);
}

/** The awareness tier label ("blind" | "dim" | "aware" | "lucid"), or "blind". */
export function awarenessTier(sim: Sim): string {
  return sim.subject.mind?.tier() ?? "blind";
}
