import { computeExposure, bandFor, transformState, speechMultiplier, instinctOverrideActive, applyExposureBand } from "./exposure";
import { hormoneBalance, genitalProfile } from "./genital";
import { weightedHealth } from "./health";
import { deriveCapacities, capacitiesFromBody, type CapacityRegistry } from "./capacity";
import { canonicalJson } from "./persistence";
import type { Subject, SubjectDerived } from "./subject";

export function computeDerived(subject: Subject, capacities?: CapacityRegistry | null): SubjectDerived {
  const { exposure, perSlot } = computeExposure(subject.body, subject.genomes, subject.attributeRegistry);
  const hormone = hormoneBalance(subject.body);
  const band = subject.exposureBands ? bandFor(subject.exposureBands, exposure) : null;
  const caps = capacitiesFromBody(subject.body);
  return {
    exposure,
    perSlot,
    hormoneBalance: hormone,
    band: band ? band.id : null,
    transformState: band ? transformState(band) : "baseline",
    genitalProfile: genitalProfile(subject.body),
    globalHealth: weightedHealth(subject.body.allInstances()),
    speechMultiplier: speechMultiplier(band),
    instinctOverride: instinctOverrideActive(band),
    hormoneBalanceFixed: Math.round(hormone * 1000),
    arousalFloor: subject.attributeArousalFloor ? Math.round(subject.attributeArousalFloor() * 100) : 0,
    capacities: deriveCapacities({ stats: subject.stats, tags: caps.tags, attrs: caps.attrs }, capacities ?? subject.capacityRegistry ?? null),
    bandStats: applyExposureBand(subject.stats, band),
  };
}

export interface AssertResult {
  ok: boolean;
  mismatches: Array<{ key: string; expected: unknown; actual: unknown }>;
}

export function assertDerived(subject: Subject, { tolerance = 1e-9 } = {}): AssertResult {
  const fresh = computeDerived(subject, subject.capacityRegistry) as unknown as Record<string, unknown>;
  const mismatches: AssertResult["mismatches"] = [];
  const cached = (subject.derived ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(fresh)) {
    if (key === "perSlot") continue;
    const expected = fresh[key];
    const actual = cached[key];
    if (typeof expected === "number" && typeof actual === "number") {
      if (Math.abs(expected - actual) > tolerance) {
        mismatches.push({ key, expected, actual });
      }
    } else if (expected && actual && typeof expected === "object" && typeof actual === "object") {
      if (canonicalJson(expected as never) !== canonicalJson(actual as never)) mismatches.push({ key, expected, actual });
    } else if (expected !== actual) {
      mismatches.push({ key, expected, actual });
    }
  }

  return mismatches.length > 0 ? { ok: false, mismatches } : { ok: true, mismatches: [] };
}

export function recomputeAndAssert(subject: Subject): AssertResult {
  subject.recomputeDerived();
  return assertDerived(subject);
}

export function injectDrift(subject: Subject, key: string, value: unknown): Partial<SubjectDerived> {
  (subject.derived as Record<string, unknown>)[key] = value;
  return subject.derived;
}
