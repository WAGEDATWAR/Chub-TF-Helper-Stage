/**
 * Genital policy (H23). The parent's engine supports four policies — `preserve`,
 * `replace`, `additive` (→ **intersex**), `swap` — but the helper hardcoded
 * `preserve`, so a change never touched the genitals. This exposes the switch and a
 * per-character profile read so a body can become intersex (both forms).
 *
 * Pure over the sim; the policy only rides the bestow/override call.
 */
import { genitalProfile as coreProfile, applyGenitalPolicy, hasRealPart, PRIMARY_SOCKET, SECONDARY_SOCKET, type GenitalPolicy } from "@core/genital";
import type { Subject } from "@core/subject";
import type { PartLibrary } from "@core/parts";
import type { Genome } from "@core/genomes";

export type { GenitalPolicy };

export interface GenitalOption {
  id: GenitalPolicy;
  label: string;
  note: string;
}

/** The offered policies, in order. `preserve` is the settle-safe default (DOSE-adjacent). */
export const GENITAL_OPTIONS: GenitalOption[] = [
  { id: "preserve", label: "preserve", note: "leave her genitals as they are (default)" },
  { id: "replace", label: "replace", note: "swap in the genome's own genitals" },
  { id: "additive", label: "additive (intersex)", note: "keep both — she ends up intersex" },
  { id: "swap", label: "swap", note: "exchange primary for secondary" },
];

export function genitalOption(id: string): GenitalOption {
  return GENITAL_OPTIONS.find((o) => o.id === id) ?? GENITAL_OPTIONS[0]!;
}

export function isGenitalPolicy(id: string): id is GenitalPolicy {
  return GENITAL_OPTIONS.some((o) => o.id === id);
}

/** The subject's current genital profile: "male" | "female" | "intersex" | "none". */
export function profileOf(subject: Subject): string {
  return coreProfile(subject.body);
}

/** The genome's declared primary / secondary genital part, if any. */
function primaryPart(genome: Genome, library: PartLibrary): string | null {
  for (const k of ["penis", "hemipenes"] as const) {
    const to = genome.genital?.[k]?.to;
    if (to && library.get(to)) return to;
  }
  return null;
}
function secondaryPart(genome: Genome, library: PartLibrary): string | null {
  for (const k of ["vulva", "scrotum", "cloaca"] as const) {
    const to = genome.genital?.[k]?.to;
    if (to && library.get(to)) return to;
  }
  return null;
}

/**
 * Apply a policy to a subject *now*, for a live genome. `preserve` is a no-op;
 * `replace`/`swap` land the genome's own form (primary-first, matching the engine);
 * `additive` fills whichever socket is *empty* so a single-sex body gains the missing
 * form (→ intersex). Returns the resulting profile.
 */
export function applyNow(subject: Subject, genome: Genome, library: PartLibrary, policy: GenitalPolicy): string {
  if (policy === "preserve") return profileOf(subject);
  const primary = primaryPart(genome, library);
  const secondary = secondaryPart(genome, library);
  const hasP = hasRealPart(subject.body, PRIMARY_SOCKET);
  const hasS = hasRealPart(subject.body, SECONDARY_SOCKET);
  let partId: string | null;
  if (policy === "additive") {
    // fill the empty form: a male gains the female part, a female gains the male part
    partId = hasP && !hasS ? (secondary ?? primary) : (primary ?? secondary);
  } else if (policy === "replace") {
    // land the genome's own form on the body's *current* socket (keeps the profile)
    partId = hasS && !hasP ? (secondary ?? primary) : (primary ?? secondary);
  } else {
    // swap: full sex change — always drive the primary
    partId = primary ?? secondary;
  }
  if (partId) applyGenitalPolicy(subject.body, library, partId, policy);
  subject.recomputeDerived();
  return profileOf(subject);
}
