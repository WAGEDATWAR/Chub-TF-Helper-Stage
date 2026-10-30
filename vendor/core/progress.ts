import { DEFAULT_SPEED_BASE, secondsToTicks } from "./time";

export const PROGRESS_MIN = 0;
export const PROGRESS_MAX = 1000;

export interface ProgressStage {
  at: number;
  name: string;
  pain_on_stage?: number;
  desc_key?: string;
}

export interface ProgressBlock {
  speed_base: number;
  curve: string;
  reverse_mult: number;
  stall_below_stability: number;
  stages?: ProgressStage[];
  morph_track?: string;
}

/**
 * Retuned for the hour-tick / days-per-transformation default (D-091):
 * `speed_base` is derived from `DEFAULT_ATTRIBUTE_TICKS`, so a dose-1.0
 * attribute fills its range in ~3 days. The reference used 0.05 (short turns).
 */
export const DEFAULT_PROGRESS_BLOCK: Readonly<ProgressBlock> = Object.freeze({
  speed_base: DEFAULT_SPEED_BASE,
  curve: "slow_start",
  reverse_mult: 1.8,
  stall_below_stability: 20,
});

export function progressBlockFor(attribute: { progress?: ProgressBlock } | null | undefined): ProgressBlock {
  return attribute?.progress ?? (DEFAULT_PROGRESS_BLOCK as ProgressBlock);
}

/**
 * Clamp progress into range. **Not rounded** (D-292): at a one-minute tick a single
 * step is well under 1, so rounding every write would leave a slow change pinned at
 * 0. Callers round at the edges (snapshot/ledger) where a whole number is wanted.
 */
export function clampProgress(value: number): number {
  return Math.max(PROGRESS_MIN, Math.min(PROGRESS_MAX, value));
}

/**
 * The stage index for a progress value. Accepts a 0..1 fraction *or* a 0..1000
 * raw value — `progress > 1` is treated as raw. (A raw value of exactly 0 or 1
 * is ambiguous; pass a fraction when the value can be that small.)
 */
export function stageIndexFor(stages: ProgressStage[] | undefined, progress: number): number {
  if (!Array.isArray(stages) || stages.length === 0) {
    return 0;
  }
  const p = progress > 1 ? progress / PROGRESS_MAX : progress;
  let index = 0;
  for (let i = 0; i < stages.length; i++) {
    if (p >= stages[i]!.at) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function advanceProgress(progress: number, delta: number): number {
  return clampProgress(progress + delta);
}

export function curveValue(curve: string, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (curve) {
    case "ease_in":
      return x * x;
    case "ease_in_out":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "slow_start":
      // a very low initial rate (covers onset with no hard delay), a decisive
      // middle, then a plateau — the whole arc from rate alone (D-202)
      return Math.pow(x, 2.2);
    case "linear":
    default:
      return x;
  }
}

export function stabilityFactor(stability: number, stallBelow: number | undefined): number {
  if (stallBelow === undefined || stallBelow === null) return 1;
  return stability < stallBelow ? 0 : 1;
}

export function growthDelta(
  progressBlock: ProgressBlock | undefined,
  currentProgress: number,
  doseMult: number,
  stability: number,
  ticks = 1,
  jitter = 1,
): number {
  const speedBase = progressBlock?.speed_base ?? DEFAULT_PROGRESS_BLOCK.speed_base;
  const curve = progressBlock?.curve ?? "linear";
  const stallBelow = progressBlock?.stall_below_stability ?? 0;
  const factor = stabilityFactor(stability, stallBelow);
  const p = clampUnit(currentProgress / PROGRESS_MAX);
  // never zero, so a part at 0 still starts moving; slow curves stay slow early
  const shaped = curve === "linear" ? 1 : Math.max(0.06, curveValue(curve, p));
  // jitter makes per-tick movement uneven without breaking ordering (D-202)
  const delta = speedBase * doseMult * shaped * factor * ticks * jitter;
  return delta * PROGRESS_MAX;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function reversionDelta(
  progressBlock: ProgressBlock | undefined,
  currentProgress: number,
  doseMult: number,
  stability: number,
  ticks = 1,
): number {
  const forward = growthDelta(progressBlock, currentProgress, doseMult, stability, ticks);
  const reverseMult = progressBlock?.reverse_mult ?? 1.8;
  return forward * reverseMult;
}

export interface CrossedStage extends ProgressStage {
  direction: "forward" | "reverse";
  index: number;
}

export function crossedStages(
  stages: ProgressStage[] | undefined,
  fromIndex: number,
  toIndex: number,
): CrossedStage[] {
  if (!Array.isArray(stages) || fromIndex === toIndex) return [];
  const out: CrossedStage[] = [];
  if (toIndex > fromIndex) {
    for (let i = fromIndex + 1; i <= toIndex; i++) {
      out.push({ direction: "forward", index: i, ...stages[i]! });
    }
  } else {
    for (let i = fromIndex; i > toIndex; i--) {
      out.push({ direction: "reverse", index: i - 1, ...stages[i - 1]! });
    }
  }
  return out;
}

export function painFromCrossings(crossings: readonly ProgressStage[]): number {
  let pain = 0;
  for (const crossing of crossings) {
    pain += crossing.pain_on_stage ?? 0;
  }
  return pain;
}

export class ProgressState {
  readonly progressBlock: ProgressBlock;
  progress: number;

  constructor(progressBlock: ProgressBlock | undefined, initial = 0) {
    this.progressBlock = progressBlock ?? { ...DEFAULT_PROGRESS_BLOCK };
    this.progress = clampProgress(initial);
  }

  get stageIndex(): number {
    return stageIndexFor(this.progressBlock.stages, this.progress / PROGRESS_MAX);
  }

  get fraction(): number {
    return this.progress / PROGRESS_MAX;
  }

  advance(doseMult: number, stability: number, ticks = 1): ReturnType<ProgressState["setProgress"]> {
    const delta = growthDelta(this.progressBlock, this.progress, doseMult, stability, ticks);
    return this.setProgress(this.progress + delta);
  }

  revert(doseMult: number, stability: number, ticks = 1): ReturnType<ProgressState["setProgress"]> {
    const delta = reversionDelta(this.progressBlock, this.progress, doseMult, stability, ticks);
    return this.setProgress(this.progress - delta);
  }

  setProgress(value: number): { before: number; after: number; crossed: CrossedStage[] } {
    const before = this.stageIndex;
    this.progress = clampProgress(value);
    const after = this.stageIndex;
    return { before, after, crossed: crossedStages(this.progressBlock.stages, before, after) };
  }
}

export { secondsToTicks };
