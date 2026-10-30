/**
 * A localStorage mirror for the durable pane controls (H25).
 *
 * The framework persists chat state only when a message is *sent*, and Chub can
 * revert or re-init that state when a generation fails (a common provider hiccup,
 * e.g. Venice "received empty response from API"). Because the snapshots live only
 * in chat state, such a failure wipes them. This mirror keeps a per-chat copy in the
 * browser, written on every control change and merged back on load, so a revert — or
 * a reload — never loses a snapshot or an override.
 *
 * Browser-safe (no-ops when `localStorage` is unavailable, e.g. headless tests).
 */

const KEY = "chrysalis.control";

/** A stable key for this chat from its character/user ids (chat-wide, not per-branch). */
export function chatKey(characterIds: string[], userIds: string[]): string {
  const all = [...characterIds, ...userIds].map((s) => s.toLowerCase()).sort();
  let h = 0x811c9dc5;
  for (const s of all.join("|")) { h ^= s.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  // include a length so two chats with the same names still differ in the tail
  return `${(h >>> 0).toString(36)}-${all.length}`;
}

export interface MirroredControl {
  snapshots?: Array<{ id: string; label: string; atTick: number; payload: unknown; roster: Array<{ id: string; name: string }> }>;
  overrides?: Array<[string, string | null]>;
  seq?: number;
}

function store(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function readAll(): Record<string, MirroredControl> {
  const ls = store();
  if (!ls) return {};
  try { return JSON.parse(ls.getItem(KEY) ?? "{}") as Record<string, MirroredControl>; } catch { return {}; }
}

function writeAll(all: Record<string, MirroredControl>): void {
  const ls = store();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(all)); } catch { /* quota: keep the in-memory copy */ }
}

/** Read this chat's mirrored control, if any. */
export function readMirror(chat: string): MirroredControl | null {
  return readAll()[chat] ?? null;
}

/**
 * Merge a partial control into this chat's mirror. Snapshots are unioned by id
 * EXCEPT `authoritative` ones, which replace the stored set — so a delete is not
 * resurrected by the union. `persist` passes the current in-memory set (authoritative);
 * a partial restore passes a union only.
 */
export function writeMirror(chat: string, patch: MirroredControl, authoritative = true): void {
  const all = readAll();
  const cur = all[chat] ?? {};
  let snapshots: MirroredControl["snapshots"];
  if (authoritative && patch.snapshots) {
    snapshots = [...patch.snapshots].sort((a, b) => a.atTick - b.atTick);
  } else {
    const byId = new Map((cur.snapshots ?? []).map((s) => [s.id, s]));
    for (const s of patch.snapshots ?? []) byId.set(s.id, s);
    snapshots = [...byId.values()].sort((a, b) => a.atTick - b.atTick);
  }
  all[chat] = {
    snapshots,
    overrides: patch.overrides ?? cur.overrides,
    seq: Math.max(cur.seq ?? 0, patch.seq ?? 0),
  };
  writeAll(all);
}

/** Drop a snapshot from the mirror (the pane's × button). */
export function forgetSnapshot(chat: string, id: string): void {
  const all = readAll();
  const cur = all[chat];
  if (!cur?.snapshots) return;
  cur.snapshots = cur.snapshots.filter((s) => s.id !== id);
  writeAll(all);
}

/** Cap the mirror so localStorage never balloons: keep the newest `max` snapshots. */
export function capMirror(chat: string, max = 12): void {
  const all = readAll();
  const cur = all[chat];
  if (!cur?.snapshots || cur.snapshots.length <= max) return;
  cur.snapshots = cur.snapshots.slice(cur.snapshots.length - max);
  writeAll(all);
}
