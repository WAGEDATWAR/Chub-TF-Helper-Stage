import { ContentError, indexById } from "./loader";
import { clampStat } from "./stats";
import type { Subject } from "./subject";
import type { AbilityRegistry, Ability } from "./abilities";

/**
 * Faults (blueprint §16; D-114). Misfires that are interesting, not punishing:
 * a fault modifies an outcome, never fails it outright. Fault rate scales
 * inversely with mastery; a fault never costs more than 2 Composure. At least one
 * fault per category is net-positive for her. Tier-3 abilities carry none.
 */
export const FAULT_TRIGGERS = Object.freeze(["on_use", "arousal_above"] as const);

export interface Fault {
  id: string;
  display_name: string;
  trigger: { on_use?: boolean; arousal_above?: number };
  chance: number;
  effect: Record<string, number>;
  text: string;
  net_positive: boolean;
}

export class FaultRegistry {
  private readonly byId: Map<string, Fault>;

  constructor(faults: Fault[]) {
    this.byId = indexById(faults, "faults.json");
    for (const fault of faults) {
      if (typeof fault.chance !== "number" || fault.chance < 0 || fault.chance > 1) {
        throw new ContentError(`fault "${fault.id}" chance must be 0..1`, "faults.json");
      }
      if (!fault.trigger || typeof fault.trigger !== "object") {
        throw new ContentError(`fault "${fault.id}" needs a trigger`, "faults.json");
      }
      for (const key of Object.keys(fault.trigger)) {
        if (!(FAULT_TRIGGERS as readonly string[]).includes(key)) {
          throw new ContentError(`fault "${fault.id}" has unknown trigger "${key}"`, "faults.json");
        }
      }
    }
  }

  get(id: string): Fault | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Fault[] {
    return [...this.byId.values()];
  }

  netPositive(): Fault[] {
    return this.all().filter((f) => f.net_positive === true);
  }

  /** A fault's chance falls as mastery rises. */
  rateFor(faultId: string, mastery: number): number {
    const fault = this.get(faultId);
    if (!fault) return 0;
    return fault.chance * (1 - Math.min(0.9, (mastery ?? 0) / 100));
  }
}

export function buildFaultRegistry(data: unknown): FaultRegistry {
  const faults = (data as { faults?: unknown } | null | undefined)?.faults;
  if (!Array.isArray(faults)) throw new ContentError('faults.json must declare a "faults" array');
  return new FaultRegistry(faults as Fault[]);
}

export function faultsFor(ability: Ability, mastery: number, abilities: AbilityRegistry): string[] {
  return [...(abilities.tierFor(ability.id, mastery)?.faults ?? [])];
}

export interface FiredFault {
  id: string;
  name: string;
  text: string;
  netPositive: boolean;
  applied: Record<string, number>;
}

/** Roll the faults a tier exposes; a fault only fires if its trigger holds. */
export function rollFaults({
  ability,
  mastery,
  abilities,
  faults,
  subject,
  rng,
  trigger = "on_use",
  chanceMult = 1,
}: {
  ability: Ability;
  mastery: number;
  abilities: AbilityRegistry;
  faults: FaultRegistry;
  subject: Subject;
  rng: { next(stream: never): number };
  trigger?: string;
  chanceMult?: number;
}): Fault[] {
  const fired: Fault[] = [];
  for (const faultId of faultsFor(ability, mastery, abilities)) {
    const fault = faults.get(faultId);
    if (!fault) continue;
    const t = fault.trigger ?? {};
    if (t.arousal_above !== undefined && (subject.stats.arousal ?? 0) <= t.arousal_above) continue;
    if (t.on_use && trigger !== "on_use") continue;
    const roll = (rng.next as (s: string) => number)("outcome");
    if (roll < Math.min(0.95, faults.rateFor(faultId, mastery) * chanceMult)) fired.push(fault);
  }
  return fired;
}

/** Apply a fault's effect: frustration + composure are the special-cased axes. */
export function applyFaultEffect(training: { frustration: number }, cap: number, subject: Subject, fault: Fault): Record<string, number> {
  const stats = subject.stats;
  const applied: Record<string, number> = {};
  for (const [key, value] of Object.entries(fault.effect ?? {})) {
    if (key === "frustration") {
      training.frustration = Math.max(0, Math.min(cap, training.frustration + value));
      applied.frustration = value;
    } else if (key === "composure") {
      const v = Math.max(-2, value);
      stats.composure = clampStat((stats.composure ?? 0) + v);
      applied.composure = v;
    } else if (key === "integrity") {
      const instances = [...subject.body.allInstances()];
      const worst = instances.sort((a, b) => b.attributes.length - a.attributes.length)[0];
      if (worst) {
        worst.setIntegrity(Math.max(0, worst.integrity + value));
        applied.integrity = value;
      }
    } else if (key in stats) {
      stats[key] = clampStat((stats[key] ?? 0) + value);
      applied[key] = value;
    }
  }
  return applied;
}
