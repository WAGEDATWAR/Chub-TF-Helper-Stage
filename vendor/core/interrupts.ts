import { ContentError, indexById } from "./loader";
import { evaluateCondition, type ConditionContext } from "./scene_graph";

export const INTERRUPT_PRIORITY: Record<string, number> = Object.freeze({
  feral_lock: 130,
  blackout: 120,
  resistance_panic: 110,
  resistance: 100,
  breakthrough: 60,
  town_event: 40,
  stage_crossing: 20,
  ambient: 10,
});

export const RETURN_TO = Object.freeze(["push_frame", "pop_frame", "hub"] as const);
export type ReturnTo = (typeof RETURN_TO)[number];

export interface Interrupt {
  id: string;
  kind: keyof typeof INTERRUPT_PRIORITY | string;
  return_to: ReturnTo;
  cooldown_slots: number;
  order?: number;
  condition?: Record<string, unknown>;
  [k: string]: unknown;
}

export class InterruptSystem {
  private readonly byId: Map<string, Interrupt>;
  private readonly cooldowns: Map<string, number>;
  private readonly beatsSinceFire: Map<string, number>;

  constructor(interrupts: Interrupt[] = []) {
    this.byId = indexById(interrupts, "interrupts");
    for (const interrupt of interrupts) {
      if (!(interrupt.kind in INTERRUPT_PRIORITY)) {
        throw new ContentError(`interrupt "${interrupt.id}" has unknown kind "${interrupt.kind}"`, "scene_graph.json");
      }
      if (!(RETURN_TO as readonly string[]).includes(interrupt.return_to)) {
        throw new ContentError(`interrupt "${interrupt.id}" has invalid return_to "${interrupt.return_to}"`, "scene_graph.json");
      }
      if (typeof interrupt.cooldown_slots !== "number") {
        throw new ContentError(`interrupt "${interrupt.id}" needs a numeric cooldown_slots`, "scene_graph.json");
      }
    }
    this.cooldowns = new Map();
    this.beatsSinceFire = new Map();
  }

  priorityOf(kind: string): number {
    return INTERRUPT_PRIORITY[kind] ?? 0;
  }

  noteBeat(): void {
    for (const [id, count] of this.beatsSinceFire) this.beatsSinceFire.set(id, count + 1);
  }

  onCooldown(id: string): boolean {
    return (this.cooldowns.get(id) ?? 0) > 0;
  }

  tickCooldowns(): void {
    for (const [id, count] of this.cooldowns) {
      const next = count - 1;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }
  }

  pick(ctx: ConditionContext): Interrupt | null {
    const eligible = this.all()
      .filter((i) => !this.onCooldown(i.id))
      .filter((i) => evaluateCondition(i.condition as never, ctx))
      .map((i) => ({ interrupt: i, priority: this.priorityOf(i.kind) }))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.interrupt.order ?? 0) - (b.interrupt.order ?? 0) ||
          a.interrupt.id.localeCompare(b.interrupt.id),
      );
    return eligible[0]?.interrupt ?? null;
  }

  fire(id: string): Interrupt | null {
    const interrupt = this.byId.get(id);
    if (!interrupt) return null;
    this.cooldowns.set(id, interrupt.cooldown_slots);
    this.beatsSinceFire.set(id, 0);
    return interrupt;
  }

  all(): Interrupt[] {
    return [...this.byId.values()];
  }
}

export function buildInterruptSystem(interrupts: Interrupt[] | unknown): InterruptSystem {
  const list = interrupts as Interrupt[];
  return new InterruptSystem(Array.isArray(list) ? list : []);
}
