import { ContentError, indexById } from "./loader";

export const SIDE_WILDCARD = "*";
export const SIDES = Object.freeze(["L", "R"] as const);

export interface Slot {
  id: string;
  role: string;
  parent?: string;
  children?: string[];
}

export function expandWildcard(id: string): string[] {
  if (!id.includes(SIDE_WILDCARD)) {
    return [id];
  }
  const at = id.lastIndexOf(SIDE_WILDCARD);
  const prefix = id.slice(0, at);
  const suffix = id.slice(at + 1);
  return SIDES.map((side) => `${prefix}${side}${suffix}`);
}

function expandRefs(refs: string[] | undefined): string[] {
  const out: string[] = [];
  for (const ref of refs ?? []) {
    out.push(...expandWildcard(ref));
  }
  return out;
}

export class Skeleton {
  readonly slots: readonly Slot[];
  private readonly byId: Map<string, Slot>;
  private readonly roles: Set<string>;
  private readonly children: Map<string, string[]>;

  constructor(slots: Slot[]) {
    this.slots = slots;
    this.byId = indexById(slots, "skeleton.json");
    this.roles = new Set();
    for (const slot of slots) {
      this.roles.add(slot.role);
    }
    this.children = new Map();
    for (const slot of slots) {
      const kids: string[] = [];
      for (const childId of expandRefs(slot.children)) {
        if (!this.byId.has(childId)) {
          throw new ContentError(
            `slot "${slot.id}" declares unknown child "${childId}"`,
            "skeleton.json",
          );
        }
        kids.push(childId);
      }
      this.children.set(slot.id, kids);
    }
    this._assertAcyclic();
    this._assertParentConsistency();
  }

  hasRole(role: string): boolean {
    return this.roles.has(role);
  }

  get(id: string): Slot | null {
    return this.byId.get(id) ?? null;
  }

  childIds(id: string): readonly string[] {
    return this.children.get(id) ?? [];
  }

  rolesFor(role: string): string[] {
    return this.slots.filter((s) => s.role === role).map((s) => s.id);
  }

  allRoles(): string[] {
    return [...this.roles].sort();
  }

  private _assertAcyclic(): void {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string, trail: string[]): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        throw new ContentError(`cycle detected: ${[...trail, id].join(" -> ")}`, "skeleton.json");
      }
      visiting.add(id);
      for (const child of this.childIds(id)) {
        visit(child, [...trail, id]);
      }
      visiting.delete(id);
      done.add(id);
    };
    for (const slot of this.slots) {
      visit(slot.id, []);
    }
  }

  private _assertParentConsistency(): void {
    for (const slot of this.slots) {
      for (const childId of this.childIds(slot.id)) {
        const child = this.get(childId);
        if (child && child.parent !== undefined && child.parent !== slot.id) {
          throw new ContentError(
            `slot "${childId}" declares parent "${child.parent}" but is a child of "${slot.id}"`,
            "skeleton.json",
          );
        }
      }
    }
  }
}

export function buildSkeleton(skeletonData: unknown): Skeleton {
  const slots = (skeletonData as { slots?: unknown } | null | undefined)?.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ContentError('skeleton.json must declare a non-empty "slots" array');
  }
  for (const slot of slots) {
    if (typeof slot?.id !== "string" || typeof slot?.role !== "string") {
      throw new ContentError('every slot needs a string "id" and "role"', "skeleton.json");
    }
  }
  return new Skeleton(slots as Slot[]);
}
