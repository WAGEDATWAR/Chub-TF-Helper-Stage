import { ContentError, indexById } from "./loader";

/**
 * Scene model (blueprint §30–§32): locations, objects, and spatial relations.
 * The composer places every participant and object *before* writing, so prose
 * never contradicts the scene. This is the *Chrysalis*-new layer.
 */

export interface Ambient {
  light?: string;
  sound?: string;
  smell?: string;
}

export interface Location {
  id: string;
  name: string;
  kind?: string;
  parent?: string;
  adjacent?: string[];
  ambient?: Ambient;
}

export class LocationGraph {
  private readonly byId: Map<string, Location>;

  constructor(locations: Location[]) {
    this.byId = indexById(locations, "locations.json");
    for (const loc of locations) {
      for (const adj of loc.adjacent ?? []) {
        if (!this.byId.has(adj)) {
          throw new ContentError(`location "${loc.id}" is adjacent to unknown "${adj}"`, "locations.json");
        }
      }
      if (loc.parent && !this.byId.has(loc.parent)) {
        throw new ContentError(`location "${loc.id}" has unknown parent "${loc.parent}"`, "locations.json");
      }
    }
  }

  get(id: string): Location | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): Location[] {
    return [...this.byId.values()];
  }
}

export function buildLocationGraph(data: unknown): LocationGraph {
  const locations = (data as { locations?: unknown } | null | undefined)?.locations;
  if (!Array.isArray(locations)) {
    throw new ContentError('locations.json must declare a "locations" array');
  }
  return new LocationGraph(locations as Location[]);
}

export interface ObjectTemplate {
  id: string;
  name: string;
  tags?: string[];
  default_location?: string;
  placement?: string;
  states?: Record<string, string>;
  compose?: { noun?: string; render?: string };
}

export class ObjectLibrary {
  private readonly byId: Map<string, ObjectTemplate>;

  constructor(objects: ObjectTemplate[]) {
    this.byId = indexById(objects, "objects.json");
    for (const obj of objects) {
      if (obj.states && Object.keys(obj.states).length > 0 && obj.states.default === undefined) {
        throw new ContentError(`object "${obj.id}" declares states but no "default"`, "objects.json");
      }
    }
  }

  get(id: string): ObjectTemplate | null {
    return this.byId.get(id) ?? null;
  }

  all(): ObjectTemplate[] {
    return [...this.byId.values()];
  }
}

export function buildObjectLibrary(data: unknown): ObjectLibrary {
  const objects = (data as { objects?: unknown } | null | undefined)?.objects;
  if (!Array.isArray(objects)) {
    throw new ContentError('objects.json must declare an "objects" array');
  }
  return new ObjectLibrary(objects as ObjectTemplate[]);
}

export interface SpatialRelation {
  id: string;
  render: string;
  order?: "a" | "b" | undefined;
}

export class SpatialRegistry {
  private readonly byId: Map<string, SpatialRelation>;

  constructor(relations: SpatialRelation[]) {
    this.byId = indexById(relations, "spatial_relations.json");
  }

  get(id: string): SpatialRelation | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): SpatialRelation[] {
    return [...this.byId.values()];
  }

  render(relId: string, a: string, b: string): string {
    const rel = this.get(relId);
    if (!rel) return `${a} ${relId.replace(/_/g, " ")} ${b}`;
    return rel.render.replace(/\{a\}/g, a).replace(/\{b\}/g, b);
  }
}

export function buildSpatialRegistry(data: unknown): SpatialRegistry {
  const relations = (data as { relations?: unknown } | null | undefined)?.relations;
  if (!relations || typeof relations !== "object") {
    throw new ContentError('spatial_relations.json must declare a "relations" object');
  }
  const list: SpatialRelation[] = Object.entries(relations as Record<string, { render: string; order?: "a" | "b" }>).map(
    ([id, r]) => ({ id, render: r.render, order: r.order }),
  );
  return new SpatialRegistry(list);
}

export interface SceneObjectRef {
  id: string;
  state?: string;
}

export interface SpatialRef {
  a: string;
  rel: string;
  b: string;
}

/** Read-only overlay the composer consults so `sway` powers show next render. */
export interface WorldOverlay {
  objectState(objectId: string): string | null;
  ambientFor(locationId: string): Partial<Ambient>;
}

export interface Scene {
  id: string;
  location: string;
  block?: string;
  participants?: string[];
  objects?: SceneObjectRef[];
  spatial?: SpatialRef[];
  beats?: unknown[];
}

export interface SceneRegistryOptions {
  locations: LocationGraph;
  objects: ObjectLibrary;
  spatial: SpatialRegistry;
}

export class SceneRegistry {
  readonly locations: LocationGraph;
  readonly objects: ObjectLibrary;
  readonly spatial: SpatialRegistry;
  private readonly scenes: Map<string, Scene>;

  constructor(scenes: Scene[], opts: SceneRegistryOptions) {
    this.locations = opts.locations;
    this.objects = opts.objects;
    this.spatial = opts.spatial;
    this.scenes = indexById(scenes, "scenes.json");
    for (const scene of scenes) {
      if (!this.locations.has(scene.location)) {
        throw new ContentError(`scene "${scene.id}" is set in unknown location "${scene.location}"`, "scenes.json");
      }
      for (const obj of scene.objects ?? []) {
        if (!this.objects.get(obj.id)) {
          throw new ContentError(`scene "${scene.id}" references unknown object "${obj.id}"`, "scenes.json");
        }
      }
      for (const rel of scene.spatial ?? []) {
        if (!this.spatial.has(rel.rel)) {
          throw new ContentError(`scene "${scene.id}" uses unknown relation "${rel.rel}"`, "scenes.json");
        }
      }
    }
  }

  get(id: string): Scene | null {
    return this.scenes.get(id) ?? null;
  }

  locationName(sceneId: string): string | null {
    const scene = this.scenes.get(sceneId);
    return scene ? this.locations.get(scene.location)?.name ?? null : null;
  }

  all(): Scene[] {
    return [...this.scenes.values()];
  }

  /** Place a scene's objects and spatial relations into ordered render lines.
   *  A world overlay (from `sway` powers) overrides ambient and object state. */
  place(scene: Scene, world?: WorldOverlay): { ambient: Ambient; objects: string[]; relations: string[] } {
    const location = this.locations.get(scene.location);
    const ambient: Ambient = { ...(location?.ambient ?? {}), ...(world?.ambientFor(scene.location) ?? {}) };
    const objects = (scene.objects ?? []).map((ref) => {
      const template = this.objects.get(ref.id);
      const overridden = world?.objectState(ref.id) ?? null;
      const state = overridden ?? ref.state ?? (template?.states ? "default" : "");
      const stateText = template?.states?.[state] ?? "";
      return (template?.compose?.render ?? template?.name ?? ref.id).replace(/\{state\}/g, stateText);
    });
    const relations = (scene.spatial ?? []).map((rel) => this.spatial.render(rel.rel, rel.a, rel.b));
    return { ambient, objects, relations };
  }
}

export function buildSceneRegistry(data: unknown, opts: SceneRegistryOptions): SceneRegistry {
  const scenes = (data as { scenes?: unknown } | null | undefined)?.scenes;
  if (!Array.isArray(scenes)) {
    throw new ContentError('scenes.json must declare a "scenes" array');
  }
  return new SceneRegistry(scenes as Scene[], opts);
}
