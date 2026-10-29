import { ContentError } from "./loader";
import type { Body } from "./body";
import type { PartLibrary } from "./parts";

export const GENITAL_POLICIES = Object.freeze(["preserve", "replace", "additive", "swap"] as const);
export type GenitalPolicy = (typeof GENITAL_POLICIES)[number];

export const PRIMARY_SOCKET = "genital_primary";
export const SECONDARY_SOCKET = "genital_secondary";

export const PRIMARY_PARTS = Object.freeze(["part.penis", "part.sheath_penis", "part.hemipenes"]);
export const SECONDARY_PARTS = Object.freeze(["part.vulva", "part.scrotum", "part.cloaca"]);

export function socketFor(partId: string): string | null {
  if ((PRIMARY_PARTS as readonly string[]).includes(partId)) return PRIMARY_SOCKET;
  if ((SECONDARY_PARTS as readonly string[]).includes(partId)) return SECONDARY_SOCKET;
  return null;
}

export interface GenitalChange {
  socket: string;
  action: "attached" | "detached" | "cleared";
  part: string;
}

export interface GenitalPolicyResult {
  changes: GenitalChange[];
  policy: GenitalPolicy;
  note?: string;
}

export function hasRealPart(body: Body, socket: string): boolean {
  if (!body.isOccupied(socket)) return false;
  const id = body.get(socket)?.id ?? "";
  return !/_absent$/.test(id);
}

export function applyGenitalPolicy(
  body: Body,
  library: PartLibrary,
  partId: string,
  policy: GenitalPolicy,
): GenitalPolicyResult {
  if (!(GENITAL_POLICIES as readonly string[]).includes(policy)) {
    throw new ContentError(`genital: unknown policy "${policy}"`, "injectors.json");
  }
  const template = library.get(partId);
  if (!template) {
    throw new ContentError(`genital: unknown part "${partId}"`, "parts.json");
  }
  const targetSocket = template.occupies_role;
  if (targetSocket !== PRIMARY_SOCKET && targetSocket !== SECONDARY_SOCKET) {
    throw new ContentError(`genital: part "${partId}" does not occupy a genital socket`, "parts.json");
  }
  const otherSocket = targetSocket === PRIMARY_SOCKET ? SECONDARY_SOCKET : PRIMARY_SOCKET;
  const changes: GenitalChange[] = [];

  if (policy === "preserve") {
    return { changes, policy };
  }

  for (const socket of [targetSocket, otherSocket]) {
    if (body.isOccupied(socket) && !hasRealPart(body, socket)) body.detach(socket);
  }

  if (policy === "replace" || policy === "additive") {
    const existing = body.get(targetSocket);
    if (policy === "replace" && existing) {
      body.detach(targetSocket);
      changes.push({ socket: targetSocket, action: "detached", part: existing.id });
    }
    if (policy === "additive" && existing && existing.id !== partId) {
      return { changes, policy, note: "socket occupied; additive never clears" };
    }
    if (!body.isOccupied(targetSocket)) {
      body.attach(partId, targetSocket);
      changes.push({ socket: targetSocket, action: "attached", part: partId });
    }
    return { changes, policy };
  }

  if (policy === "swap") {
    if (body.isOccupied(otherSocket)) {
      const cleared = body.detach(otherSocket);
      changes.push({ socket: otherSocket, action: "cleared", part: cleared!.id });
    }
    if (body.isOccupied(targetSocket)) {
      body.detach(targetSocket);
    }
    body.attach(partId, targetSocket);
    changes.push({ socket: targetSocket, action: "attached", part: partId });
  }

  return { changes, policy };
}

export function hormoneBalance(body: Body): number {
  let balance = 0;
  for (const instance of body.allInstances()) {
    for (const attr of instance.attributes) {
      if (attr.id === "attr.gynomorphic") {
        balance -= (attr.progress / 1000) * 0.3;
      } else if (attr.id === "attr.andromorphic") {
        balance += (attr.progress / 1000) * 0.3;
      }
    }
  }
  return Math.max(-1, Math.min(1, balance));
}

export function toFixedHormone(balance: number): number {
  return Math.round(balance * 1000);
}

export function fromFixedHormone(value: number): number {
  return value / 1000;
}

export interface SexDefaultsRow {
  genital_primary: string | null;
  genital_secondary: string | null;
  overrides?: Record<string, string>;
}

export const BUILTIN_SEX_DEFAULTS: Record<string, SexDefaultsRow> = Object.freeze({
  female: { genital_primary: null, genital_secondary: "part.vulva", overrides: { "breasts.L": "part.full_breasts", "breasts.R": "part.full_breasts" } },
  male: { genital_primary: "part.penis", genital_secondary: null, overrides: {} },
});

export function sexDefaults(baseGender: string, data: { sexes?: Record<string, SexDefaultsRow> } | null = null): SexDefaultsRow {
  const table = data?.sexes ?? BUILTIN_SEX_DEFAULTS;
  return table[baseGender === "male" ? "male" : "female"] ?? { genital_primary: null, genital_secondary: null, overrides: {} };
}

export function applySexDefaults(
  body: Body,
  baseGender: string,
  data: { sexes?: Record<string, SexDefaultsRow> } | null = null,
): string {
  const wanted = sexDefaults(baseGender, data);
  const sockets: Array<[string, string | null]> = [
    [PRIMARY_SOCKET, wanted.genital_primary],
    [SECONDARY_SOCKET, wanted.genital_secondary],
  ];
  for (const [socket, partId] of sockets) {
    if (!partId || hasRealPart(body, socket)) continue;
    if (body.isOccupied(socket)) body.detach(socket);
    body.attach(partId, socket);
  }
  for (const [slot, partId] of Object.entries(wanted.overrides ?? {})) {
    const existing = body.get(slot);
    if (!body.library.get(partId) || !existing || existing.id === partId) continue;
    body.detach(slot);
    body.attach(partId, slot);
  }
  return genitalProfile(body);
}

export function genitalProfile(body: Body): string {
  const hasPrimary = hasRealPart(body, PRIMARY_SOCKET);
  const hasSecondary = hasRealPart(body, SECONDARY_SOCKET);
  if (hasPrimary && hasSecondary) return "intersex";
  if (hasPrimary) return "male";
  if (hasSecondary) return "female";
  return "none";
}

export function isFunctional(config: { hasPrimary: boolean; hasSecondary: boolean }): boolean {
  return config.hasPrimary !== config.hasSecondary || config.hasPrimary || config.hasSecondary;
}
