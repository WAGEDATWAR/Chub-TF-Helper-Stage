/**
 * H10b pace control. The base genomes settle in ~22–41 simulated days (median 30),
 * which is right for some chats and far too slow for others. This lets the player
 * pick a target feel — and, later, infer a rate from a card's own instructions.
 *
 * A pace is applied as a **persistent temporal growth modifier** (the parent's own
 * `session.temporal` mechanism, saved with the cache), so it scales growth without
 * touching any genome. `untilTick: 0` means "until changed". One modifier per pace
 * is kept, so re-setting a pace replaces rather than stacks.
 *
 * Deterministic; the sim stays authoritative (a pace only scales its rate).
 */

export type PaceId = "slow" | "normal" | "fast" | "quick" | "instant";

export interface Pace {
  id: PaceId;
  label: string;
  /** Growth-rate multiplier applied to every character. */
  rate: number;
  /** Rough target days to settle, for the label. */
  approxDays: number;
  note: string;
}

/** The offered paces. `normal` is the authored 30-day baseline. */
export const PACES: Pace[] = [
  { id: "slow", label: "Slow burn", rate: 0.5, approxDays: 60, note: "weeks pass between changes" },
  { id: "normal", label: "Normal", rate: 1, approxDays: 30, note: "the authored pacing" },
  { id: "fast", label: "Fast", rate: 2, approxDays: 15, note: "days, not weeks" },
  { id: "quick", label: "Quick", rate: 4, approxDays: 8, note: "a change over a long scene or two" },
  { id: "instant", label: "Instant", rate: 80, approxDays: 2, note: "the beat of a single scene" },
];

export function paceById(id: PaceId): Pace {
  return PACES.find((p) => p.id === id) ?? PACES[1]!;
}

/** The base settle days across the authored set (median), for the approximate map. */
export const BASE_SETTLE_DAYS = 30;

/** The id of the persistent pace modifier (one at a time). */
const PACE_MOD_ID = "pace.transformation";

/** A minimal view of the session bits this module needs (avoids a core import). */
interface TemporalHost {
  session: {
    temporal: { modifiers: Array<{ id: string; rate: number; untilTick: number }> };
    clock: { tick: number };
    markDirty?: () => void;
  };
}

/**
 * Apply a pace to a sim: push (or replace) the single persistent pace modifier.
 * Idempotent — setting the same pace twice is a no-op rewrite.
 */
export function applyPace(host: TemporalHost, id: PaceId): void {
  const rate = paceById(id).rate;
  const mods = host.session.temporal.modifiers;
  const existing = mods.find((m) => m.id === PACE_MOD_ID);
  if (existing) { existing.rate = rate; existing.untilTick = 0; }
  else mods.push({ id: PACE_MOD_ID, rate, untilTick: 0 });
  host.session.markDirty?.();
}

/** The pace currently applied, if any (defaults to normal when unset). */
export function currentPace(host: TemporalHost): PaceId {
  const mod = host.session.temporal.modifiers.find((m) => m.id === PACE_MOD_ID);
  if (!mod) return "normal";
  return PACES.find((p) => p.rate === mod.rate)?.id ?? "normal";
}

/**
 * Infer a starting pace from a card's own text (H10b, best-effort). A card that
 * says "over months", "slowly", "instant", "within days", etc. biases the pace; no
 * signal means `normal`. Deterministic; a coarse read, not a parser.
 */
export function inferPace(...texts: Array<string | undefined>): PaceId {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (!t) return "normal";
  if (/\b(instant|instantly|at once|all at once|immediate|snap|in moments|seconds)\b/.test(t)) return "instant";
  if (/\b(in (a|one|two|three) (hours?|days?)|quickly|rapid|fast|within a day|over a day|overnight)\b/.test(t)) return "quick";
  if (/\b(in (four|five|six|a week|a few days|several days|days)|over days|by the week)\b/.test(t)) return "fast";
  if (/\b(gradual|slowly|slow|over (weeks|months|years)|takes (weeks|months|years)|by degrees)\b/.test(t)) return "slow";
  return "normal";
}
