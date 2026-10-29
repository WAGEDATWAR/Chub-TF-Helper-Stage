import { variantSpecificity, SPECIFICITY_THRESHOLD, type DialogueRegistry, type DialogueKey } from "./dialogue";

export interface CoverageAxis {
  id: string;
  weight: number;
  bands: string[];
}

export function enumerateAxisCombos(axes: CoverageAxis[]): Array<Record<string, string>> {
  const ids = axes.map((a) => a.id);
  const bands = axes.map((a) => a.bands);
  const combos: Array<Record<string, string>> = [];
  const walk = (index: number, acc: Record<string, string>): void => {
    if (index === ids.length) {
      combos.push({ ...acc });
      return;
    }
    for (const band of bands[index]!) {
      acc[ids[index]!] = band;
      walk(index + 1, acc);
    }
  };
  walk(0, {});
  return combos;
}

export function combosFor(axes: CoverageAxis[], { onlyAxes = null, maxDepth = null }: { onlyAxes?: string[] | null; maxDepth?: number | null } = {}): Array<Record<string, string>> {
  const selected = onlyAxes ? axes.filter((a) => onlyAxes.includes(a.id)) : axes;
  if (maxDepth === null) return enumerateAxisCombos(selected);
  const out: Array<Record<string, string>> = [];
  for (let depth = 1; depth <= Math.min(maxDepth, selected.length); depth++) {
    for (const subset of subsetsOf(selected, depth)) {
      out.push(...enumerateAxisCombos(subset));
    }
  }
  return out;
}

function subsetsOf(items: CoverageAxis[], size: number): CoverageAxis[][] {
  const out: CoverageAxis[][] = [];
  const walk = (start: number, acc: CoverageAxis[]): void => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

export function scoreCombo(combo: Record<string, string>, weights: Record<string, number>): number {
  let score = 0;
  for (const axis of Object.keys(combo)) score += weights[axis] ?? 0;
  return score;
}

export const DEFAULT_COVERAGE_AXES = Object.freeze(["stance", "frustration_band", "drive_band", "transform_state"]);
export const DEFAULT_COVERAGE_DEPTH = 2;

export interface MissingCombo {
  axes: Record<string, string>;
  priority: "high" | "medium";
}

export function coverageForKey(
  entry: DialogueKey,
  axes: CoverageAxis[],
  weights: Record<string, number>,
  { axes: axisIds = DEFAULT_COVERAGE_AXES, maxDepth = DEFAULT_COVERAGE_DEPTH }: { axes?: readonly string[]; maxDepth?: number } = {},
): MissingCombo[] {
  const scoped = axes.filter((a) => axisIds.includes(a.id));
  const combos = combosFor(scoped, { maxDepth });
  const covered = new Set<string>();
  for (const variant of entry.variants) {
    if (!variant.axes) continue;
    covered.add(JSON.stringify(Object.entries(variant.axes).sort()));
  }
  const missing: MissingCombo[] = [];
  for (const combo of combos) {
    const key = JSON.stringify(Object.entries(combo).sort());
    if (covered.has(key)) continue;
    const priority = scoreCombo(combo, weights) >= SPECIFICITY_THRESHOLD ? "high" : "medium";
    missing.push({ axes: combo, priority });
  }
  return missing;
}

export interface CoverageEntry {
  key: string;
  missing: MissingCombo[];
}

export function buildCoverageReport(registry: DialogueRegistry, axes: CoverageAxis[], options = {}): CoverageEntry[] {
  const weights = registry.weights ?? {};
  const report: CoverageEntry[] = [];
  for (const entry of registry.all()) {
    const missing = coverageForKey(entry, axes, weights, options);
    if (missing.length > 0) report.push({ key: entry.key, missing });
  }
  return report;
}

export function coverageSummary(report: CoverageEntry[]): { keys: number; high: number; medium: number; total: number } {
  const high = report.reduce((sum, r) => sum + r.missing.filter((m) => m.priority === "high").length, 0);
  const medium = report.reduce((sum, r) => sum + r.missing.filter((m) => m.priority === "medium").length, 0);
  return { keys: report.length, high, medium, total: high + medium };
}

export function stableReportJson(report: CoverageEntry[]): string {
  const sorted = [...report]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => ({
      key: entry.key,
      missing: [...entry.missing].sort((a, b) => JSON.stringify(a.axes).localeCompare(JSON.stringify(b.axes))),
    }));
  return JSON.stringify(sorted, null, 2);
}

export const _variantSpecificity = variantSpecificity;
