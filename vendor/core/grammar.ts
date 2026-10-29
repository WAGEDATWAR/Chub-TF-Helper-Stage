import { joinNatural } from "./composer";

/**
 * Composition grammar (blueprint §32/§38; S67). The composer does not emit a flat
 * list of strings — it emits **items** carrying priority, style and behaviour
 * tags, and this module resolves them into paragraphs. It is the same coverage
 * grammar whether the text is authored fragments or LLM output, so an uncomposed
 * item is a hard failure (spec-first, D-170):
 *
 *   - **priority** (1..5) places an item in a tier; 1 is the very top, 5 the very
 *     bottom. Same-priority items form one block. The number of blocks equals the
 *     number of distinct priorities present.
 *   - **style tags** (align, bold, italic) are carried for the surface.
 *   - **behaviour tags**: `merge` (may this join same-type items; each type has a
 *     default, so the tag only overrides it) and `append` (resolve in this tier
 *     vs. append to the very bottom).
 *
 * Nothing here reads the DOM or mints state; it is pure.
 */
export const GRAMMAR_VERSION = 1;

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 5;

export type StyleTag = "align-left" | "align-center" | "align-right" | "bold" | "italic" | "dim" | "chip";

export interface ProseBehaviour {
  /** Join with same-type items in the tier. Absent = per-type default. */
  merge?: boolean;
  /** Resolve in the tier, or append to the very bottom of the read. */
  append?: boolean;
}

export interface ProseItem {
  /** Stable id (usually the source ref), for grouping + reporting. */
  id: string;
  /** The item's own type; items of the same type may merge. Also its emit kind. */
  type: string;
  text: string;
  /** 1 (top) .. 5 (bottom); defaults to 3. */
  priority?: number;
  style?: StyleTag[];
  behaviour?: ProseBehaviour;
  /** A connector used when this item leads a merged clause chain (optional). */
  lead?: string;
}

export interface ComposeOptions {
  /** Per-type default for `merge`; the item's own tag overrides it. */
  mergeDefaults?: Record<string, boolean>;
  /** Per-type conjunction word ("and", "with"); defaults to a natural join. */
  conjunctions?: Record<string, string>;
  /** Separator between blocks (blank line by default). */
  blockSeparator?: string;
}

export interface ProseBlock {
  priority: number;
  /** Item ids in this block, in resolved order. */
  itemIds: string[];
  /** The composed text of the block. */
  text: string;
}

export interface ComposeResult {
  text: string;
  blocks: ProseBlock[];
  /** Non-fatal notes (e.g. an item appended out of its tier). */
  notes: string[];
}

export class CompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionError";
  }
}

function priorityOf(item: ProseItem): number {
  const p = item.priority ?? 3;
  if (p < PRIORITY_MIN || p > PRIORITY_MAX) {
    throw new CompositionError(`item "${item.id}": priority ${p} out of ${PRIORITY_MIN}..${PRIORITY_MAX}`);
  }
  return p;
}

function shouldMerge(item: ProseItem, opts: ComposeOptions): boolean {
  if (item.behaviour?.merge !== undefined) return item.behaviour.merge;
  return opts.mergeDefaults?.[item.type] ?? true;
}

/**
 * Resolve items into ordered blocks. Hard-fails on an empty item (coverage
 * guarantee). Never silently drops text.
 */
export function compose(items: readonly ProseItem[], opts: ComposeOptions = {}): ComposeResult {
  const notes: string[] = [];
  for (const item of items) {
    if (typeof item.text !== "string" || item.text.trim().length === 0) {
      throw new CompositionError(`item "${item.id}" (${item.type}) has no text`);
    }
  }

  const tiers = new Map<number, ProseItem[]>();
  const appended: ProseItem[] = [];
  for (const item of items) {
    if (item.behaviour?.append) {
      appended.push(item);
      notes.push(`item "${item.id}" appended to the bottom`);
      continue;
    }
    const p = priorityOf(item);
    const list = tiers.get(p) ?? [];
    list.push(item);
    tiers.set(p, list);
  }

  const blocks: ProseBlock[] = [];
  for (const priority of [...tiers.keys()].sort((a, b) => a - b)) {
    const tier = tiers.get(priority)!;
    blocks.push(resolveTier(priority, tier, opts));
  }
  if (appended.length > 0) {
    blocks.push(resolveTier(PRIORITY_MAX + 1, appended, opts));
  }

  const sep = opts.blockSeparator ?? "\n\n";
  return { text: blocks.map((b) => b.text).filter(Boolean).join(sep), blocks, notes };
}

/** One tier: merge same-type items whose merge flag is on, else keep separate. */
function resolveTier(priority: number, tier: ProseItem[], opts: ComposeOptions): ProseBlock {
  const byType = new Map<string, ProseItem[]>();
  const standalone: ProseItem[] = [];
  for (const item of tier) {
    if (shouldMerge(item, opts)) {
      const list = byType.get(item.type) ?? [];
      list.push(item);
      byType.set(item.type, list);
    } else {
      standalone.push(item);
    }
  }

  const clauses: Array<{ order: number; text: string; ids: string[] }> = [];
  let order = 0;
  for (const [type, list] of byType) {
    const conjunction = opts.conjunctions?.[type];
    const text = conjunction
      ? list.map((i) => i.text).join(` ${conjunction} `)
      : joinNatural(list.map((i) => i.text));
    clauses.push({ order: order++, text: capitalise(text), ids: list.map((i) => i.id) });
  }
  for (const item of standalone) {
    clauses.push({ order: order++, text: capitalise(item.text), ids: [item.id] });
  }

  return { priority, itemIds: clauses.flatMap((c) => c.ids), text: clauses.map((c) => c.text).join(" ") };
}

function capitalise(text: string): string {
  const trimmed = text.trim();
  return trimmed.length === 0 ? trimmed : trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

/** The distinct-priority block count an item set will resolve to (for tests/inspection). */
export function blockCount(items: readonly ProseItem[]): number {
  const set = new Set<number>();
  let appended = false;
  for (const item of items) {
    if (item.behaviour?.append) { appended = true; continue; }
    set.add(item.priority ?? 3);
  }
  return set.size + (appended ? 1 : 0);
}

export function item(id: string, type: string, text: string, opts: Partial<ProseItem> = {}): ProseItem {
  return { id, type, text, ...opts };
}
