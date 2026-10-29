import { ContentError } from "./loader";

/**
 * Obligations (M16a, §46; S33). An obligation is a schedule entry with a
 * **consequence** when missed: a shift, a class, an errand. A body change can
 * **gate** it (a changed part makes the task impossible — hands that cannot type),
 * so a transformation creates a real problem, not a text aside.
 *
 * Obligations are data; the failure is reachable and measurable.
 */
export const OBLIGATION_VERSION = 1;

export interface Obligation {
  id: string;
  /** Which agent holds it (or "subject"). */
  agent: string;
  activity: string;
  /** Blocks the obligation expects presence. */
  window: string[];
  /** Blocks of grace before a miss. */
  lateness_window: number;
  /** What a miss costs: a need id and amount, and duty damage. */
  consequence: { need?: string; amount?: number; bond?: number; note?: string };
  /** Part tags that, when the agent gains them, make the task impossible (a gate). */
  gated_by_tags?: string[];
  /** Attribute ids that gate the task (a body can no longer do it). */
  gated_by_attrs?: string[];
  /** A capacity (S76) that, when impaired, gates the task (typing needs hands). */
  gated_by_capacity?: { key: import("./capacity").CapacityKey; below: number };
}

export interface ObligationRuntime {
  id: string;
  blocked: boolean;
  latenessTicks: number;
  missed: number;
}

export interface GateCheck {
  tags: string[];
  attrs: string[];
  /** Derived capacities (S76); an impaired capacity can gate the task. */
  capacities?: Partial<Record<import("./capacity").CapacityKey, number>> | undefined;
}

export class ObligationRegistry {
  private readonly byId: Map<string, Obligation>;

  constructor(list: Obligation[]) {
    this.byId = new Map();
    for (const o of list) {
      if (typeof o.id !== "string" || typeof o.agent !== "string" || typeof o.activity !== "string") {
        throw new ContentError(`obligation "${o.id ?? "?"}" needs id/agent/activity`, "obligations.json");
      }
      this.byId.set(o.id, o);
    }
  }

  get(id: string): Obligation | null {
    return this.byId.get(id) ?? null;
  }
  all(): Obligation[] {
    return [...this.byId.values()];
  }
  forAgent(agent: string): Obligation[] {
    return this.all().filter((o) => o.agent === agent);
  }

  /** Is this obligation currently impossible for a body with these tags/attrs? */
  blocked(o: Obligation, gate: GateCheck): boolean {
    if (o.gated_by_tags?.some((t) => gate.tags.includes(t))) return true;
    if (o.gated_by_attrs?.some((a) => gate.attrs.includes(a))) return true;
    if (o.gated_by_capacity && gate.capacities) {
      const v = gate.capacities[o.gated_by_capacity.key] ?? 1000;
      if (v < o.gated_by_capacity.below) return true;
    }
    return false;
  }
}

export function buildObligationRegistry(data: unknown): ObligationRegistry {
  const list = (data as { obligations?: unknown } | null | undefined)?.obligations;
  if (!Array.isArray(list)) throw new ContentError('obligations.json must declare an "obligations" array', "obligations.json");
  return new ObligationRegistry(list as Obligation[]);
}
