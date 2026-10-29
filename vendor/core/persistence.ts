export const SAVE_VERSION = 1;
export const AUTOSAVE_SLOTS = 3;
export const CHECKSUM_ALGORITHM = "fnv1a32";

/** Authoritative blocks that are serialized. Everything else is derived. */
export const AUTHORITATIVE_BLOCKS = Object.freeze([
  "version",
  "saveSeed",
  "rng",
  "clock",
  "flags",
  "subject",
  "observer",
  "journal",
  "research",
  "progression",
  "settings",
  "world",
  "cooldowns",
  "growthHoldUntil",
  "reveal",
  "currentLocation",
  "story",
  "training",
  "play",
  "practising",
  "nudge",
  "temporal",
  "beatIndex",
  "recentLines",
  "linePool",
  "timeline",
  "sex",
  "town",
  "townEvents",
  "consequencesFired",
  "dev",
]);

/** Derived fields that are recomputed on load, never persisted. */
export const DERIVED_FIELDS = Object.freeze([
  "exposure",
  "band",
  "transform_state",
  "genital_profile",
  "hormone_balance",
  "global_health",
  "pain_tolerance",
  "pain_pressure",
  "resistance_ceiling",
  "description_strings",
  "tier",
  "health_summary",
  "estimate_band",
]);

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function checksum(payload: unknown): string {
  const text = typeof payload === "string" ? payload : canonicalJson(payload);
  return fnv1a32(text).toString(16).padStart(8, "0");
}

export function stripDerived(save: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...save };
  for (const field of DERIVED_FIELDS) delete out[field];
  if (out.subject && typeof out.subject === "object") {
    out.subject = { ...(out.subject as Record<string, unknown>) };
    delete (out.subject as Record<string, unknown>).derived;
  }
  return out;
}

export function serialize(save: Record<string, unknown>): string {
  if (!save || typeof save !== "object") {
    throw new Error("persistence: a save object is required");
  }
  const authoritative = stripDerived({ version: SAVE_VERSION, ...save });
  const body = canonicalJson(authoritative);
  return canonicalJson({ ...authoritative, checksum: checksum(body) });
}

export function deserialize(text: string): Record<string, unknown> {
  if (typeof text !== "string") {
    throw new Error("persistence: serialized save text is required");
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return { ...parsed, version: (parsed.version as number | undefined) ?? 0 };
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  save?: Record<string, unknown>;
  expected?: string;
  actual?: string;
  detail?: string;
}

export function verify(text: string): VerifyResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = deserialize(text);
  } catch (err) {
    return { ok: false, reason: "invalid json", detail: (err as Error).message };
  }
  const claimed = parsed.checksum as string | undefined;
  const { checksum: _drop, ...rest } = parsed;
  const actual = checksum(canonicalJson(rest));
  if (claimed !== undefined && claimed !== actual) {
    return { ok: false, reason: "checksum mismatch", expected: claimed, actual };
  }
  return { ok: true, save: parsed };
}

export function assertNoDerived(save: Record<string, unknown>): { ok: boolean; present: string[] } {
  const present = DERIVED_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(save, f));
  if (save?.subject && (save.subject as Record<string, unknown>).derived !== undefined) {
    present.push("subject.derived");
  }
  return { ok: present.length === 0, present };
}

export interface SaveHeader {
  version: number;
  day: number;
  name: string;
  exposure: number;
  seed: number | null;
  devTouched: boolean;
}

export function saveHeader(save: Record<string, unknown>): SaveHeader {
  const subject = (save.subject as { displayName?: string; stats?: { exposure?: number } } | undefined) ?? {};
  return {
    version: (save.version as number) ?? 0,
    day: (save.clock as { day?: number } | undefined)?.day ?? 1,
    name: subject.displayName ?? "Unknown",
    exposure: subject.stats?.exposure ?? 0,
    seed: (save.saveSeed as number) ?? null,
    devTouched: (save.dev as { touched?: boolean } | undefined)?.touched === true,
  };
}
