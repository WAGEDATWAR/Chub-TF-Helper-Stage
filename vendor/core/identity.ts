import { clampStat } from "./stats";
import type { FormedReaction } from "./reactions";
import type { Subject } from "./subject";
import type { Rng, Stream } from "./rng";
import type { ReactionCatalog } from "./registries";
import { resonanceArc, prideSuppresses, dysmorphiaRaises, type SelfPerception } from "./self_perception";
import { orientationAlignment } from "./sexuality";

/**
 * Identity (blueprint §22.5, §24; D-134; S31). The resonance arc and the parts
 * of her inner life that act: a nightly self-read, reaction discovery through
 * ordinary life, rebellion pressure, and what she *wants* to become.
 *
 * This is where the psychology actually drives her (S45): what she practises,
 * how hard, and whether she seeks change out are read from drive + self-image,
 * not from a fixed script.
 */
export const IDENTITY_VERSION = 1;
export const DISCOVERY_CHANCE = 0.06;

/** A nightly self-read: resonance drifts toward coherence, dysmorphia pressures it. */
export function selfRead(subject: Subject, self: SelfPerception, rng: Rng): { resonanceDelta: number; arc: string } {
  const arc = resonanceArc(self);
  const drive = subject.stats.drive ?? 0;
  let delta = 0;
  switch (arc) {
    case "acceptance":
      delta = rng.chance("drift" as Stream, 0.6) ? 1 : 0;
      break;
    case "settling":
      delta = self.coherence >= 55 ? 1 : 0;
      break;
    case "denial":
      delta = -1;
      break;
    case "estrangement":
      delta = -2;
      break;
    default:
      break;
  }
  if (prideSuppresses(self)) delta += 1;
  if (dysmorphiaRaises(self) && drive < 40) delta -= 1;
  // mean-revert toward a band so resonance settles instead of pegging (D-197):
  // an acceptance arc drifts toward ~80, estrangement toward ~25. When the value
  // is well above the band the revert outweighs the additive bonuses.
  const resonanceNow = subject.stats.resonance ?? 50;
  const settleTo = arc === "acceptance" ? 80 : arc === "settling" ? 62 : arc === "denial" ? 40 : 25;
  const overBand = resonanceNow - settleTo;
  if (overBand > 12) delta -= 1;
  else if (overBand < -12) delta += 1;
  else if (delta === 0 && overBand > 6) delta = -1;
  else if (delta === 0 && overBand < -6) delta = 1;
  // a body drifting toward what she is drawn to settles her; away frays her (S68)
  const align = orientationAlignment(subject);
  if (align > 0.2) delta += rng.chance("drift" as Stream, 0.4) ? 1 : 0;
  else if (align < -0.2) delta -= rng.chance("drift" as Stream, 0.4) ? 1 : 0;
  return { resonanceDelta: delta, arc };
}

/** What she wants to become: the families she is drawn toward, weighted by drive. */
export function desires(subject: Subject, catalog: ReactionCatalog): string[] {
  const wanted: string[] = [];
  for (const reaction of subject.reactions) {
    if (reaction.type === "fetish") {
      const entry = catalog.get(reaction.id);
      for (const tag of entry?.match.tags ?? []) wanted.push(tag);
    }
  }
  if ((subject.stats.drive ?? 0) >= 70) wanted.push("novelty");
  return wanted;
}

/**
 * Reaction discovery through ordinary life (§22.5): a bare-tag match can surface
 * without the Observer's hand when she is stretched by a day.
 */
export function discoverReaction(subject: Subject, catalog: ReactionCatalog, rng: Rng, tick: number, tags: string[]): FormedReaction | null {
  if (subject.reactions.length >= 8) return null;
  const known = new Set(subject.reactions.map((r) => r.id));
  const matching = catalog.matching(tags).filter((r) => !known.has(r.id));
  if (matching.length === 0) return null;
  if (!rng.chance("reaction" as Stream, DISCOVERY_CHANCE * (1 + (subject.stats.exposure ?? 0) / 200))) return null;
  const chosen = matching[0]!;
  const formed: FormedReaction = {
    id: chosen.id,
    type: chosen.type,
    strength: 0.4,
    awakenedAtTick: tick,
    context: "daily life",
    source: "bare",
  };
  subject.reactions.push(formed);
  return formed;
}

/** Sustained pressure against a formed reaction feeds rebellion (§22.7). */
export function rebellionPressure(subject: Subject, catalog: ReactionCatalog): number {
  let pressure = 0;
  for (const reaction of subject.reactions) {
    if (reaction.type !== "phobia" && reaction.type !== "hard") continue;
    const entry = catalog.get(reaction.id);
    pressure += (entry?.composure_to_push as number | undefined) ?? 20;
  }
  return pressure;
}

/** A self-image read for the snapshot: truth and belief, side by side. */
export interface IdentityRead {
  arc: string;
  coherence: number;
  dysmorphia: number;
  pride: number;
  acceptance: number;
  noticed: number;
  unnoticed: number;
}

export function identityRead(subject: Subject, self: SelfPerception, noticeableIds: string[]): IdentityRead {
  const noticed = noticeableIds.filter((id) => (subject.know[id]?.belief ?? 0) !== 0).length;
  return {
    arc: resonanceArc(self),
    coherence: self.coherence,
    dysmorphia: self.dysmorphia,
    pride: self.pride,
    acceptance: self.acceptance,
    noticed,
    unnoticed: Math.max(0, noticeableIds.length - noticed),
  };
}

export { clampStat };
