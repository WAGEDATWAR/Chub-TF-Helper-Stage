import { clampStat } from "./stats";
import type { Body } from "./body";
import type { AttributeRegistry } from "./attributes";
import type { ExposureBandRegistry, ExposureBand } from "./registries";

export const DEFAULT_EXPOSURE_CAP = 100;

export interface ExposureResult {
  exposure: number;
  perSlot: Record<string, number>;
}

export function computeExposure(
  body: Body,
  _genomes: readonly string[] = [],
  attributeRegistry: AttributeRegistry | null = null,
): ExposureResult {
  let total = 0;
  let count = 0;
  const perSlot: Record<string, number> = {};
  for (const instance of body.allInstances()) {
    let slotMax = 0;
    for (const attr of instance.attributes) {
      const def = attributeRegistry?.get(attr.id) ?? null;
      if (def?.counts_toward_exposure === false) continue;
      slotMax = Math.max(slotMax, attr.progress / 1000);
    }
    const innate = (instance.template.innate_attributes ?? []).length > 0 ? 0.35 : 0;
    perSlot[instance.slot] = Math.max(slotMax, innate);
    total += perSlot[instance.slot]!;
    count++;
  }
  if (count === 0) {
    return { exposure: 0, perSlot };
  }
  const exposure = clampStat((total / count) * 100);
  return { exposure, perSlot };
}

export function bandFor(exposureBands: ExposureBandRegistry, exposure: number): ExposureBand | null {
  return exposureBands.bandFor(exposure);
}

export function feralRamp(exposure: number, overshootActive: boolean): { feral: boolean; reason: string } {
  if (!overshootActive) {
    return { feral: false, reason: "no overshoot active" };
  }
  if (exposure >= 100) {
    return { feral: true, reason: "exposure at lock" };
  }
  return { feral: false, reason: "below lock" };
}

export function applyExposureBand(stats: Record<string, number>, band: ExposureBand | null): Record<string, number> {
  if (!band) return stats;
  const out: Record<string, number> = { ...stats };
  if (typeof band.intelligence_mod === "number") {
    out.intelligence = clampStat((out.intelligence ?? 0) + band.intelligence_mod);
  }
  if (typeof band.strength_mod === "number") {
    out.strength = clampStat((out.strength ?? 0) + band.strength_mod);
  }
  return out;
}

export function speechMultiplier(band: ExposureBand | null): number {
  return (band?.speech_mult as number | undefined) ?? 1.0;
}

export function instinctOverrideActive(band: ExposureBand | null): boolean {
  return band?.instinct_override === true;
}

export function transformState(band: ExposureBand | null): string {
  return band?.id?.replace("band.", "") ?? "baseline";
}
