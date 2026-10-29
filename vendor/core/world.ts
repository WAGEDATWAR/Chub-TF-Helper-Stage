import type { Ambient } from "./scene";

/**
 * World overlay (blueprint §11.2 `sway`). Content (`locations.json`,
 * `objects.json`, `scenes.json`) is immutable; `sway` powers write *overrides*
 * here and the composer reads them on the next render, so observation always
 * reflects the current world without mutating shared content.
 */
export const WORLD_VERSION = 1;

export interface WorldStateJSON {
  version: number;
  objectStates: Record<string, string>;
  ambient: Record<string, Partial<Ambient>>;
  openDoors: string[];
}

export class WorldState {
  version = WORLD_VERSION;
  readonly objectStates: Record<string, string> = {};
  readonly ambient: Record<string, Partial<Ambient>> = {};
  readonly openDoors: Set<string> = new Set();

  objectState(objectId: string): string | null {
    return this.objectStates[objectId] ?? null;
  }

  setObjectState(objectId: string, state: string): void {
    this.objectStates[objectId] = state;
  }

  ambientFor(locationId: string): Partial<Ambient> {
    return this.ambient[locationId] ?? {};
  }

  setAmbient(locationId: string, patch: Partial<Ambient>): void {
    this.ambient[locationId] = { ...this.ambient[locationId], ...patch };
  }

  open(locationId: string): void {
    this.openDoors.add(locationId);
  }

  isOpen(locationId: string): boolean {
    return this.openDoors.has(locationId);
  }

  toJSON(): WorldStateJSON {
    return {
      version: this.version,
      objectStates: { ...this.objectStates },
      ambient: JSON.parse(JSON.stringify(this.ambient)) as Record<string, Partial<Ambient>>,
      openDoors: [...this.openDoors],
    };
  }

  static fromJSON(json: WorldStateJSON | undefined | null): WorldState {
    const world = new WorldState();
    if (!json) return world;
    for (const [id, state] of Object.entries(json.objectStates ?? {})) world.objectStates[id] = state;
    for (const [id, patch] of Object.entries(json.ambient ?? {})) world.ambient[id] = patch;
    for (const id of json.openDoors ?? []) world.openDoors.add(id);
    return world;
  }
}

export function createWorld(): WorldState {
  return new WorldState();
}
