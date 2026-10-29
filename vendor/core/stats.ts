export const STAT_MIN = 0;
export const STAT_MAX = 100;

/**
 * Subject stats (§17.1). Divergence D-094: the reference's `love`/`trust` pair
 * becomes `resonance`/`composure` — there is no relationship *with the player*
 * here, so the two mind axes read as identification (resonance) and coping
 * (composure).
 */
export interface StatDef {
  id: string;
  range: readonly [number, number];
  source: string;
}

export const SUBJECT_STATS: readonly StatDef[] = Object.freeze([
  { id: "intelligence", range: [0, 100] as const, source: "base, debt, genome" },
  { id: "strength", range: [0, 100] as const, source: "base, genome" },
  { id: "agility", range: [0, 100] as const, source: "base, genome" },
  { id: "endurance", range: [0, 100] as const, source: "base, genome" },
  { id: "perception", range: [0, 100] as const, source: "base, genome" },
  { id: "pain", range: [0, 100] as const, source: "derived from events" },
  { id: "arousal", range: [0, 100] as const, source: "events, floor from attributes" },
  { id: "drive", range: [0, 100] as const, source: "novelty, success, observation" },
  { id: "composure", range: [0, 100] as const, source: "stress, support, coping" },
  { id: "resonance", range: [0, 100] as const, source: "witness, integration, identity" },
  { id: "stability", range: [0, 100] as const, source: "drain and rest" },
  { id: "fatigue", range: [0, 100] as const, source: "exertion and rest" },
  { id: "intelligence_debt", range: [0, 100] as const, source: "feral lock; recovers by training/time" },
  { id: "exposure", range: [0, 100] as const, source: "derived from parts" },
  { id: "overload", range: [0, 100] as const, source: "change absorbed" },
]);

export type SubjectStatId = (typeof SUBJECT_STATS)[number]["id"];

export const SUBJECT_STAT_IDS = Object.freeze(SUBJECT_STATS.map((s) => s.id));

export function clampStat(value: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(value)));
}

export function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export const FIXED_POINT_SCALE = 10;

export function toFixedPoint(value: number): number {
  return Math.round(value * FIXED_POINT_SCALE);
}

export function fromFixedPoint(value: number): number {
  return value / FIXED_POINT_SCALE;
}

export type StatBlock = Record<string, number>;

export function createStatBlock(
  defs: ReadonlyArray<{ id: string; range: readonly [number, number] }>,
  overrides: Record<string, number> = {},
): StatBlock {
  const block: StatBlock = {};
  for (const def of defs) {
    block[def.id] = clampRange(overrides[def.id] ?? 0, def.range[0], def.range[1]);
  }
  return block;
}

export function applyStatDelta(block: StatBlock, statId: string, delta: number): number {
  if (!(statId in block)) {
    throw new Error(`stats: unknown stat "${statId}"`);
  }
  block[statId] = clampStat(block[statId]! + delta);
  return block[statId]!;
}

export function isSubjectStat(statId: string): boolean {
  return (SUBJECT_STAT_IDS as readonly string[]).includes(statId);
}
