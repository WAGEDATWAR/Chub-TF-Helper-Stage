import { ContentError } from "./loader";
import type { Town } from "./town";

/**
 * Second-order consequences (M16b, S11). The strongest "meaningful, not decorative"
 * lever after D-064: a transformation causes a **durable world change** — a job
 * lost, a friendship formed, a routine broken. This reads the town's own state
 * (missed obligations, shattered bonds, formed friendships) and turns the notable
 * ones into one-time, durable consequences.
 *
 * Rules are data (`consequences.json`); each fires at most once per subject.
 */
export const CONSEQUENCE_VERSION = 1;

export interface ConsequenceRule {
  id: string;
  /** `missing`: obligations missed at or above `threshold`. `bond`: a bond at/below
   *  (or at/above) `threshold`. `household`: a household bond strained. */
  when: "missed" | "bond_low" | "bond_high";
  /** Threshold for the trigger (missed count, or bond value). */
  threshold: number;
  /** Restrict to a relationship type / household, else any. */
  relation?: string;
  note: string;
}

export interface ConsequenceFired {
  id: string;
  note: string;
  /** Whom it happened to, if a person. */
  agent?: string;
}

export class ConsequenceRegistry {
  private readonly rules: ConsequenceRule[];

  constructor(list: ConsequenceRule[]) {
    for (const r of list) {
      if (typeof r.id !== "string" || typeof r.note !== "string") {
        throw new ContentError(`consequence "${r.id ?? "?"}" needs an id and a note`, "consequences.json");
      }
    }
    this.rules = list;
  }
  all(): ConsequenceRule[] {
    return [...this.rules];
  }
}

export function buildConsequenceRegistry(data: unknown): ConsequenceRegistry {
  const list = (data as { rules?: unknown } | null | undefined)?.rules;
  if (!Array.isArray(list)) throw new ContentError('consequences.json must declare a "rules" array', "consequences.json");
  return new ConsequenceRegistry(list as ConsequenceRule[]);
}

const PRIORITY_ORDER: Record<string, string[]> = {};

/**
 * Evaluate consequences against the town; return the newly-fired ones (the caller
 * records `fired` so none repeat). Durable: a missed job is a *state*, not a line.
 */
export function evaluateConsequences(
  town: Town,
  rules: ConsequenceRegistry,
  subjectId: string,
  fired: Set<string>,
): ConsequenceFired[] {
  const subject = town.state(subjectId);
  if (!subject) return [];
  const out: ConsequenceFired[] = [];

  for (const rule of rules.all()) {
    if (fired.has(`${rule.id}:${subjectId}`)) continue;
    if (rule.when === "missed") {
      // the subject's missed obligations, read from the town's own counter
      if (subject.missed >= rule.threshold) {
        out.push({ id: rule.id, note: rule.note });
      }
      continue;
    }
    if (rule.when === "bond_low" || rule.when === "bond_high") {
      for (const rel of subject.relationships) {
        if (rule.relation && rel.type !== rule.relation) continue;
        const hit = rule.when === "bond_low" ? rel.bond <= rule.threshold : rel.bond >= rule.threshold;
        if (hit) {
          out.push({ id: rule.id, note: rule.note, agent: rel.to });
          break;
        }
      }
    }
  }

  for (const c of out) fired.add(`${c.id}:${subjectId}`);
  void PRIORITY_ORDER;
  return out;
}
