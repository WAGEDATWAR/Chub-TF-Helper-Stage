import type { Session } from "./session";
import type { GenomeRegistry } from "./genomes";
import { statModifiersFor } from "./genomes";

/**
 * Stat breakdown (M14.11, D-200). The UI presses a stat and wants to know what is
 * *affecting* it — the genome pulls currently applied, plus a baseline note — so
 * the number is legible instead of magic. This is a read-model: it derives from
 * the subject's current state and never mutates it.
 */

export interface StatSource {
  label: string;
  detail: string;
  /** The signed contribution, when the source is a modifier. */
  value: number;
}

export interface StatBreakdown {
  stat: string;
  current: number;
  sources: StatSource[];
  /** True when the stat is dominated by live dynamics, not a modifier. */
  dynamic: boolean;
}

/** The live-dynamics note per stat, so a press is never empty. */
const DYNAMIC_NOTE: Record<string, string> = {
  pain: "rises on a stage crossing and eases with stability",
  arousal: "driven by the body's changes, her drive, and held frustration",
  drive: "pulled by familiarity, reactions, and the change itself",
  composure: "strained by frustration and pain, held by mastery",
  resonance: "her lean into or against the change",
  stability: "drains on a dose, recovers with rest",
  fatigue: "accrues with resistance, eases at the day's turn",
  overload: "stacks with each dose against her resistant ceiling",
};

/**
 * The sources affecting a stat. Genome stat modifiers are named individually
 * (the real lever a player can read); intrinsic stats get a dynamic note.
 */
export function buildStatBreakdown(session: Session, stat: string, registry: GenomeRegistry | null): StatBreakdown {
  const current = session.subject.stats[stat] ?? 0;
  const sources: StatSource[] = [];

  const carried = session.subject.genomes;
  if (registry && carried.length > 0) {
    // per-genome contribution, so the breakdown names where a pull comes from
    for (const genomeId of carried) {
      const genome = registry.get(genomeId);
      if (!genome?.stat_modifiers) continue;
      const mod = statModifiersFor([genomeId], registry)[stat] ?? 0;
      if (mod !== 0) sources.push({ label: genome.display_name ?? genomeId.replace(/^genome\./, ""), detail: "carried genome", value: mod });
    }
  }

  // attribute effects that target this stat (a part's effects are the other lever)
  const registryAttrs = session.subject.attributeRegistry;
  if (registryAttrs) {
    const perAttr = new Map<string, number>();
    for (const inst of session.subject.body.allInstances()) {
      for (const entry of inst.attributes) {
        const effects = registryAttrs.get(entry.id)?.effects as Record<string, number> | undefined;
        const raw = effects?.[stat];
        if (typeof raw !== "number") continue;
        perAttr.set(entry.id, Math.max(perAttr.get(entry.id) ?? 0, raw * (entry.progress / 1000)));
      }
    }
    for (const [attrId, value] of perAttr) {
      if (value === 0) continue;
      const name = registryAttrs.get(attrId)?.display_name ?? attrId.replace(/^attr\./, "");
      sources.push({ label: name, detail: "from a body part", value: Math.round(value * 100) / 100 });
    }
  }

  const dynamic = sources.length === 0;
  return { stat, current, sources, dynamic };
}

/** A one-line summary of a stat's sources, for a compact tooltip. */
export function summarizeBreakdown(breakdown: StatBreakdown): string {
  if (breakdown.dynamic) return DYNAMIC_NOTE[breakdown.stat] ?? "driven by live play";
  return breakdown.sources.map((s) => `${s.label} ${s.value > 0 ? "+" : ""}${s.value}`).join(" · ");
}
