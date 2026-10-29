/**
 * Overlay merge (no fs, no DOM) — the one rule that lets local `*.extra.json`
 * patch or extend parent content without editing the parent.
 *
 * Semantics:
 *  - arrays of `{ id }` objects: patched **by id** (a matching entry deep-merges;
 *    an unmatched one appends), so a patch touches only the fields it names.
 *  - every other array **replaces** (a `tags` patch replaces, never concats).
 *  - objects deep-merge.
 *
 * If the parent later makes the same fix upstream, the local patch becomes an
 * equal no-op — no conflict.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIdArray(a: unknown[]): boolean {
  return a.length > 0 && a.every((e) => isRecord(e) && typeof e.id === "string");
}

export function mergeOverlay(base: unknown, extra: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(extra)) {
    if (isIdArray(base) && isIdArray(extra)) {
      const out = [...base];
      const index = new Map<string, number>();
      out.forEach((e, i) => index.set((e as { id: string }).id, i));
      for (const e of extra) {
        const id = (e as { id: string }).id;
        const at = index.get(id);
        if (at === undefined) {
          index.set(id, out.length);
          out.push(e);
        } else {
          out[at] = mergeOverlay(out[at], e);
        }
      }
      return out;
    }
    return extra;
  }
  if (isRecord(base) && isRecord(extra)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(extra)) out[k] = k in out ? mergeOverlay(out[k], v) : v;
    return out;
  }
  return extra;
}

/** Merge a set of overlays onto a base content set, keyed by file stem. */
export function applyOverlays(
  base: Record<string, unknown>,
  overlays: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlays)) {
    out[key] = key in out ? mergeOverlay(out[key], value) : value;
  }
  return out;
}
