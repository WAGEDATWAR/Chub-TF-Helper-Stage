import { ContentError, indexById } from "./loader";

export const NODE_TYPES = Object.freeze(["hub", "action", "sequence", "interrupt", "menu", "story", "system"]);
export const EDGE_TYPES = Object.freeze(["select", "auto", "interrupt", "chain"]);

export const CONDITION_KEYS = Object.freeze([
  "all_of",
  "any_of",
  "none_of",
  "not_feral",
  "charge_min",
  "charge_max",
  "stat_min",
  "stat_max",
  "exposure_min",
  "stability_min",
  "has_ability",
  "has_part_tag",
  "reaction_known",
  "genital_profile",
  "flag",
  "day_min",
  "drive_min",
]);

export interface ConditionContext {
  stats?: Record<string, number>;
  charge?: number;
  exposure?: number;
  day?: number;
  flags?: Set<string>;
  abilities?: string[];
  partTags?: string[];
  knownReactions?: string[];
  genitalProfile?: string;
  isFeral?: boolean;
}

export function validateConditionKeys(condition: unknown, path = "condition"): string[] {
  const errors: string[] = [];
  if (condition === null || condition === undefined) return errors;
  if (typeof condition !== "object" || Array.isArray(condition)) {
    errors.push(`${path}: condition must be an object`);
    return errors;
  }
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (!(CONDITION_KEYS as readonly string[]).includes(key)) {
      errors.push(`${path}: unknown condition key "${key}"`);
      continue;
    }
    if (key === "all_of" || key === "any_of" || key === "none_of") {
      if (!Array.isArray(value)) {
        errors.push(`${path}.${key}: must be an array`);
        continue;
      }
      value.forEach((sub, i) => errors.push(...validateConditionKeys(sub, `${path}.${key}[${i}]`)));
    }
  }
  return errors;
}

export function evaluateCondition(condition: unknown, ctx: ConditionContext): boolean {
  if (condition === null || condition === undefined) return true;
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (!evaluateClause(key, value, ctx)) return false;
  }
  return true;
}

function evaluateClause(key: string, value: unknown, ctx: ConditionContext): boolean {
  switch (key) {
    case "all_of":
      return (value as unknown[]).every((sub) => evaluateCondition(sub, ctx));
    case "any_of":
      return (value as unknown[]).some((sub) => evaluateCondition(sub, ctx));
    case "none_of":
      return (value as unknown[]).every((sub) => !evaluateCondition(sub, ctx));
    case "not_feral":
      return ctx.isFeral !== true;
    case "charge_min":
      return (ctx.charge ?? 0) >= (value as number);
    case "charge_max":
      return (ctx.charge ?? 0) <= (value as number);
    case "stat_min":
      return Object.entries(value as Record<string, number>).every(([stat, min]) => (ctx.stats?.[stat] ?? 0) >= min);
    case "stat_max":
      return Object.entries(value as Record<string, number>).every(([stat, max]) => (ctx.stats?.[stat] ?? 0) <= max);
    case "exposure_min":
      return (ctx.exposure ?? 0) >= (value as number);
    case "stability_min":
      return (ctx.stats?.stability ?? 0) >= (value as number);
    case "has_ability":
      return (ctx.abilities ?? []).includes(value as string);
    case "has_part_tag":
      return (ctx.partTags ?? []).includes(value as string);
    case "reaction_known":
      return (ctx.knownReactions ?? []).includes(value as string);
    case "genital_profile":
      return ctx.genitalProfile === value;
    case "flag":
      return ctx.flags?.has(value as string) === true;
    case "day_min":
      return (ctx.day ?? 1) >= (value as number);
    case "drive_min":
      return (ctx.stats?.drive ?? 0) >= (value as number);
    default:
      return false;
  }
}

export interface SceneNode {
  id: string;
  type: string;
  entry?: boolean;
  beats?: unknown[];
  [k: string]: unknown;
}

export interface SceneEdge {
  from: string;
  to: string;
  type: string;
  condition?: Record<string, unknown>;
}

export interface SceneGraphData {
  scene_graph_version?: number;
  nodes?: SceneNode[];
  edges?: SceneEdge[];
  deprecated?: Record<string, string>;
  migrations?: unknown[];
}

export class SceneGraph {
  readonly version: number;
  readonly nodes: SceneNode[];
  readonly edges: SceneEdge[];
  readonly deprecated: Record<string, string>;
  private readonly byId: Map<string, SceneNode>;

  constructor(data: SceneGraphData) {
    this.version = data.scene_graph_version ?? 1;
    this.nodes = data.nodes ?? [];
    this.edges = data.edges ?? [];
    this.deprecated = data.deprecated ?? {};
    this.byId = indexById(this.nodes, "scene_graph.json");
    for (const node of this.nodes) {
      if (!(NODE_TYPES as readonly string[]).includes(node.type)) {
        throw new ContentError(`scene node "${node.id}" has unknown type "${node.type}"`, "scene_graph.json");
      }
    }
    for (const edge of this.edges) {
      if (!(EDGE_TYPES as readonly string[]).includes(edge.type)) {
        throw new ContentError(`scene edge has unknown type "${edge.type}"`, "scene_graph.json");
      }
      if (!this.byId.has(edge.from) || !this.byId.has(edge.to)) {
        throw new ContentError(`scene edge ${edge.from} -> ${edge.to} references an unknown node`, "scene_graph.json");
      }
    }
  }

  get(id: string): SceneNode | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): SceneNode[] {
    return [...this.byId.values()];
  }

  resolve(id: string): string | null {
    const resolved = this.deprecated[id] ?? id;
    return this.byId.has(resolved) ? resolved : null;
  }

  edgesFrom(id: string, type: string | null = null): SceneEdge[] {
    return this.edges.filter((e) => e.from === id && (type === null || e.type === type));
  }

  selectableFrom(hubId: string, ctx: ConditionContext): SceneNode[] {
    return this.edgesFrom(hubId, "select")
      .filter((edge) => evaluateCondition(edge.condition, ctx))
      .map((edge) => this.get(edge.to))
      .filter((node): node is SceneNode => node !== null);
  }

  autoEdges(ctx: ConditionContext): SceneEdge[] {
    return this.edges.filter((e) => e.type === "auto" && evaluateCondition(e.condition, ctx));
  }

  reachableFrom(startId: string): Set<string> {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id) || !this.byId.has(id)) continue;
      seen.add(id);
      for (const edge of this.edgesFrom(id)) {
        if (!["select", "chain", "auto", "interrupt"].includes(edge.type)) continue;
        stack.push(edge.to);
      }
    }
    return seen;
  }

  entryNodes(): string[] {
    return this.nodes.filter((n) => n.entry === true || n.type === "hub").map((n) => n.id);
  }

  unreachableNodes(): string[] {
    const roots = this.entryNodes();
    const reachable = new Set<string>();
    for (const root of roots) {
      for (const id of this.reachableFrom(root)) reachable.add(id);
    }
    return this.nodes.filter((n) => !roots.includes(n.id) && !reachable.has(n.id)).map((n) => n.id);
  }
}

export function buildSceneGraph(data: unknown): SceneGraph {
  const d = data as SceneGraphData | null | undefined;
  if (!d || !Array.isArray(d.nodes)) {
    throw new ContentError('scene_graph.json must declare a "nodes" array', "scene_graph.json");
  }
  return new SceneGraph(d);
}
