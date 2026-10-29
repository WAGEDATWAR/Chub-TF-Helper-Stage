import type { Attribute } from "./attributes";
import type { PartInstance } from "./parts";

export const CONDITION_FLAGS = Object.freeze(["inflamed", "torn", "engorged", "numb"] as const);
export type ConditionFlag = (typeof CONDITION_FLAGS)[number];

export const FLAG_SCHEDULE: Record<ConditionFlag, number> = Object.freeze({
  inflamed: 3,
  torn: 6,
  engorged: 2,
  numb: 4,
});

export const PAIN_STAT_GATE = 70;

export function strain(_inst: PartInstance, attr: Attribute, magnitude: number, stability: number): number {
  const base = (attr.effects?.integrity_cost as number | undefined) ?? (attr.effects?.pain_on_growth as number | undefined) ?? 0;
  const speedPenalty = 1 + Math.max(0, magnitude - 1) * 0.6;
  const stabilityPenalty = 1 + (100 - stability) / 100;
  return Math.round(base * speedPenalty * stabilityPenalty);
}

export function painGatesStatGains(pain: number): boolean {
  return pain > PAIN_STAT_GATE;
}

export function repairIntegrity(inst: PartInstance, amount: number): number {
  const base = inst.template.integrity ?? 100;
  inst.integrity = Math.max(0, Math.min(base, inst.integrity + amount));
  return inst.integrity;
}

export function applyFlagWithSchedule(inst: PartInstance, flag: string): string[] {
  if (!(CONDITION_FLAGS as readonly string[]).includes(flag)) {
    throw new Error(`health: unknown condition flag "${flag}"`);
  }
  if (!inst.flags.includes(flag)) {
    inst.flags.push(flag);
  }
  inst.flag_schedules = inst.flag_schedules ?? {};
  inst.flag_schedules[flag] = FLAG_SCHEDULE[flag as ConditionFlag] ?? 1;
  return inst.flags;
}

export function tickConditionFlags(inst: PartInstance, ticks = 1): string[] {
  if (!inst.flag_schedules) return inst.flags;
  for (const flag of [...inst.flags]) {
    inst.flag_schedules[flag] = (inst.flag_schedules[flag] ?? 0) - ticks;
    if (inst.flag_schedules[flag]! <= 0) {
      const idx = inst.flags.indexOf(flag);
      if (idx >= 0) inst.flags.splice(idx, 1);
      delete inst.flag_schedules[flag];
    }
  }
  return inst.flags;
}

export function weightedHealth(instances: Iterable<PartInstance>): number {
  const weights: Record<string, number> = { vital: 3, major: 2, minor: 1 };
  let weighted = 0;
  let total = 0;
  for (const instance of instances) {
    const base = instance.template?.integrity ?? 100;
    const weight = weights[instance.template?.criticality ?? "minor"] ?? 1;
    const ratio = base === 0 ? 1 : Math.max(0, Math.min(1, instance.integrity / base));
    weighted += ratio * weight;
    total += weight;
  }
  if (total === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((weighted / total) * 100)));
}

export function applyCondition(inst: PartInstance, flag: string): string[] {
  if (!(CONDITION_FLAGS as readonly string[]).includes(flag)) {
    throw new Error(`health: unknown condition flag "${flag}"`);
  }
  if (!inst.flags.includes(flag)) {
    inst.flags.push(flag);
  }
  return inst.flags;
}

export function clearCondition(inst: PartInstance, flag: string): string[] {
  const idx = inst.flags.indexOf(flag);
  if (idx >= 0) inst.flags.splice(idx, 1);
  return inst.flags;
}
