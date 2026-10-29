import { ContentError } from "./loader";

export const DEFAULT_START_SD = 0.35;
export const CONFIDENCE_Z = 1.5;

export interface Estimate {
  mean: number;
  sd: number;
  n: number;
  trials: Array<{ dose: number; observedCoverage: number; gain: number }>;
}

export function priorEstimate({ startSd = DEFAULT_START_SD } = {}): Estimate {
  return { mean: 0, sd: startSd, n: 0, trials: [] };
}

export function informationGain({ dose, estimate, safeCeiling }: { dose: number; estimate: Estimate; safeCeiling: number }): number {
  const edge = Math.max(estimate.mean, safeCeiling * 0.5);
  const distance = Math.abs(dose - edge);
  const reference = Math.max(edge, safeCeiling, 0.5);
  const proximity = 1 - Math.min(1, distance / reference);
  const unknownBonus = dose > safeCeiling ? 0.6 : 0;
  const gain = 0.25 + 0.75 * proximity + unknownBonus;
  return Math.max(0.2, Math.min(2.0, gain));
}

export function updateEstimate(estimate: Estimate, { dose, observedCoverage, safeCeiling }: { dose: number; observedCoverage: number; safeCeiling: number }): Estimate {
  const gain = informationGain({ dose, estimate, safeCeiling });
  const weight = gain / (estimate.n + gain);
  const mean = estimate.n === 0 ? observedCoverage : estimate.mean + weight * (observedCoverage - estimate.mean);
  const sd = Math.max(0.05, estimate.sd * (1 - weight * 0.9));
  return { mean, sd, n: estimate.n + 1, trials: [...estimate.trials, { dose, observedCoverage, gain }] };
}

export function confidenceBand(estimate: Estimate, z = CONFIDENCE_Z): { low: number; high: number; z: number } | null {
  if (estimate.n === 0) return null;
  return { low: Math.max(0, estimate.mean - z * estimate.sd), high: estimate.mean + z * estimate.sd, z };
}

export function estimateLabel(estimate: Estimate): string {
  return estimate.n === 0 ? "unknown" : `${estimate.mean.toFixed(2)} ± ${(CONFIDENCE_Z * estimate.sd).toFixed(2)} (n=${estimate.n})`;
}

export class ResearchLog {
  readonly startSd: number;
  readonly estimates: Map<string, Estimate>;

  constructor({ startSd = DEFAULT_START_SD } = {}) {
    this.startSd = startSd;
    this.estimates = new Map();
  }

  for(genomeId: string): Estimate {
    let estimate = this.estimates.get(genomeId);
    if (!estimate) {
      estimate = priorEstimate({ startSd: this.startSd });
      this.estimates.set(genomeId, estimate);
    }
    return estimate;
  }

  has(genomeId: string): boolean {
    return this.estimates.has(genomeId) && (this.estimates.get(genomeId)?.n ?? 0) > 0;
  }

  recordTrial(genomeId: string, { dose, observedCoverage, safeCeiling = 1.0 }: { dose: number; observedCoverage: number; safeCeiling?: number }): Estimate {
    if (typeof genomeId !== "string") {
      throw new ContentError("research: a genome id is required");
    }
    const updated = updateEstimate(this.for(genomeId), { dose, observedCoverage, safeCeiling });
    this.estimates.set(genomeId, updated);
    return updated;
  }

  band(genomeId: string) {
    return confidenceBand(this.for(genomeId));
  }

  label(genomeId: string): string {
    return estimateLabel(this.for(genomeId));
  }

  toJSON(): Record<string, Estimate> {
    const out: Record<string, Estimate> = {};
    for (const [id, estimate] of this.estimates) out[id] = { mean: estimate.mean, sd: estimate.sd, n: estimate.n, trials: estimate.trials };
    return out;
  }
}

export function researchFromJSON(json: Record<string, Partial<Estimate>> | null | undefined, { startSd = DEFAULT_START_SD } = {}): ResearchLog {
  const log = new ResearchLog({ startSd });
  for (const [id, entry] of Object.entries(json ?? {})) {
    log.estimates.set(id, { mean: entry.mean ?? 0, sd: entry.sd ?? startSd, n: entry.n ?? 0, trials: entry.trials ?? [] });
  }
  return log;
}

export function buildResearchLog(options?: { startSd?: number }): ResearchLog {
  return new ResearchLog(options);
}
