import { ContentError } from "./loader";
import { instantiate, type PartInstance, type PartTemplate } from "./parts";
import type { PartLibrary } from "./parts";
import type { Skeleton } from "./skeleton";

const CRITICALITY_WEIGHTS: Record<string, number> = { vital: 3, major: 2, minor: 1 };

export class Body {
  readonly skeleton: Skeleton;
  readonly library: PartLibrary;
  private readonly instances: Map<string, PartInstance>;

  constructor(skeleton: Skeleton, library: PartLibrary) {
    this.skeleton = skeleton;
    this.library = library;
    this.instances = new Map();
  }

  occupiedSlots(): string[] {
    return [...this.instances.keys()].sort();
  }

  allInstances(): PartInstance[] {
    return [...this.instances.values()];
  }

  get(slot: string): PartInstance | null {
    return this.instances.get(slot) ?? null;
  }

  isOccupied(slot: string): boolean {
    return this.instances.has(slot);
  }

  attach(partId: string, slot: string): PartInstance {
    const template = this.library.get(partId);
    if (!template) {
      throw new ContentError(`unknown part "${partId}"`, "parts.json");
    }
    const slotData = this.skeleton.get(slot);
    if (!slotData) {
      throw new ContentError(`unknown slot "${slot}"`, "skeleton.json");
    }
    if (slotData.role !== template.occupies_role) {
      throw new ContentError(
        `part "${partId}" occupies role "${template.occupies_role}" but slot "${slot}" is role "${slotData.role}"`,
        "parts.json",
      );
    }
    if (this.instances.has(slot)) {
      throw new ContentError(`slot "${slot}" is already occupied`, "parts.json");
    }
    const instance = instantiate(template, slot);
    this.instances.set(slot, instance);
    return instance;
  }

  attachToRole(partId: string, role: string): PartInstance[] {
    const slots = this.skeleton.rolesFor(role);
    if (slots.length === 0) {
      throw new ContentError(`no slots for role "${role}"`, "skeleton.json");
    }
    const created: PartInstance[] = [];
    for (const slot of slots) {
      created.push(this.attach(partId, slot));
    }
    return created;
  }

  detach(slot: string): PartInstance | null {
    const instance = this.instances.get(slot);
    if (!instance) return null;
    this.instances.delete(slot);
    return instance;
  }

  attachFull(partId: string, slot: string): PartInstance[] {
    const instance = this.attach(partId, slot);
    const created: PartInstance[] = [instance];
    for (const provided of instance.template.provides ?? []) {
      const childSlots = this.skeleton
        .childIds(slot)
        .filter((id) => this.skeleton.get(id)?.role === provided.role);
      for (const childSlot of childSlots) {
        if (this.isOccupied(childSlot)) continue;
        const template = this.defaultTemplateForRole(provided.role);
        if (template) {
          created.push(...this.attachFull(template.id, childSlot));
        }
      }
    }
    return created;
  }

  attachRoleFull(role: string): PartInstance[] {
    const slots = this.skeleton.rolesFor(role);
    const created: PartInstance[] = [];
    for (const slot of slots) {
      if (this.isOccupied(slot)) continue;
      const template = this.defaultTemplateForRole(role);
      if (template) {
        created.push(...this.attachFull(template.id, slot));
      }
    }
    return created;
  }

  defaultTemplateForRole(role: string): PartTemplate | null {
    const candidates = this.library.templatesForRole(role);
    if (candidates.length === 0) return null;
    const isHuman = (t: PartTemplate): boolean => (t.tags ?? []).includes("human_tag");
    const isPlaceholder = (t: PartTemplate): boolean => /_absent$/.test(t.id);
    if (role === "genital_primary" || role === "genital_secondary") {
      return candidates.find((t) => isPlaceholder(t)) ?? null;
    }
    return (
      candidates.find((t) => isHuman(t) && !isPlaceholder(t)) ??
      candidates.find((t) => isHuman(t)) ??
      candidates[0] ??
      null
    );
  }

  fillDefaultBody(): PartInstance[] {
    const created: PartInstance[] = [];
    for (const slot of this.skeleton.slots) {
      if (slot.role === "root" || this.isOccupied(slot.id)) continue;
      const template = this.defaultTemplateForRole(slot.role);
      if (template) {
        created.push(...this.attachFull(template.id, slot.id));
      }
    }
    return created;
  }

  merge(partId: string, anchorSlot?: string): PartInstance[] {
    const template = this.library.get(partId);
    if (!template) {
      throw new ContentError(`unknown part "${partId}"`, "parts.json");
    }
    const policy = template.merge_policy ?? "none";
    const role = template.occupies_role;
    const targets = this.skeleton.rolesFor(role);
    if (targets.length === 0) {
      throw new ContentError(`no slots for role "${role}"`, "skeleton.json");
    }

    if (policy === "none") {
      return [this.attach(partId, anchorSlot ?? targets[0]!)];
    }

    if (policy === "absorb_siblings") {
      for (const slot of targets) {
        if (this.instances.has(slot)) {
          this._pruneSubtree(slot);
        }
      }
    } else if (policy === "collapse_parents") {
      const anchor = anchorSlot ?? targets[0]!;
      for (const ancestor of this._ancestors(anchor)) {
        this._pruneSubtree(ancestor);
      }
    }

    const created: PartInstance[] = [];
    for (const slot of targets) {
      if (this.instances.has(slot)) continue;
      created.push(this.attach(partId, slot));
    }
    if (created.length === 0) {
      throw new ContentError(`merge produced no instances for role "${role}"`, "parts.json");
    }
    return created;
  }

  private _ancestors(slot: string): string[] {
    const out: string[] = [];
    let current = this.skeleton.get(slot);
    while (current && current.parent) {
      out.push(current.parent);
      current = this.skeleton.get(current.parent);
    }
    return out;
  }

  private _pruneSubtree(slot: string): string[] {
    const removed: string[] = [];
    const stack = [slot];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const instance = this.instances.get(current);
      if (instance) {
        this.instances.delete(current);
        removed.push(current);
      }
      for (const child of this.skeleton.childIds(current)) {
        stack.push(child);
      }
    }
    return removed;
  }

  findOrphans(): Array<{ slot: string; reason: string }> {
    const orphans: Array<{ slot: string; reason: string }> = [];
    for (const [slot, instance] of this.instances) {
      const slotData = this.skeleton.get(slot);
      if (!slotData) {
        orphans.push({ slot, reason: "slot does not exist in the skeleton" });
        continue;
      }
      if (slotData.role !== instance.role) {
        orphans.push({ slot, reason: `role mismatch (${instance.role} vs ${slotData.role})` });
      }
    }
    return orphans;
  }

  globalHealth(): number {
    let weighted = 0;
    let total = 0;
    for (const instance of this.instances.values()) {
      const base = instance.template.integrity ?? 100;
      const weight = CRITICALITY_WEIGHTS[instance.template.criticality ?? "minor"] ?? 1;
      weighted += (instance.integrity / base) * weight;
      total += weight;
    }
    return total === 0 ? 100 : Math.round((weighted / total) * 100);
  }
}

export function createBody(skeleton: Skeleton, library: PartLibrary): Body {
  return new Body(skeleton, library);
}
