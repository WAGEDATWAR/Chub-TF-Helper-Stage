import { ContentError } from "./loader";
import type { Genome } from "./genomes";
import type { PartLibrary } from "./parts";
import type { Body } from "./body";

/**
 * Species-native genitalia (D-202). A genome may declare, per **genital kind**,
 * the part its natives carry; a transformation morphs a live body's genitals of
 * that kind toward the target by a **visible, arousing** shift (through an
 * authored intermediate when one exists), using the normal growth machinery so
 * the change lands on the clock rather than snapping. A genome with no `genital`
 * block leaves the body's own genitals alone.
 *
 * Keying by kind (not socket) makes the map sex-correct for free: a body with a
 * vulva shifts its vulva, a body with a scrotum its scrotum, so a male canine
 * ends sheathed-and-scrotumed and a female canine ends with a canid vulva.
 */

/** Kinds in priority order. A hemipenis carries `penis_tag`, so check it first. */
export const GENITAL_KINDS = Object.freeze(["hemipenes", "penis", "scrotum", "vulva", "cloaca"] as const);
export type GenitalKind = (typeof GENITAL_KINDS)[number];

const KIND_TAG: Record<GenitalKind, string> = {
  hemipenes: "hemipenis_tag",
  penis: "penis_tag",
  scrotum: "scrotum_tag",
  vulva: "vulva_tag",
  cloaca: "cloaca_tag",
};

/** The genital kind of a part, or null when it is not a genital. */
export function kindOf(tags: readonly string[]): GenitalKind | null {
  for (const kind of GENITAL_KINDS) {
    if (tags.includes(KIND_TAG[kind])) return kind;
  }
  return null;
}

/**
 * The kind to morph for one instance. A present genital uses its own kind; a
 * **male body's empty secondary socket** (the female-side slot a male carries
 * absent) takes the genome's `scrotum` target, so a male canine grows a scrotum
 * rather than keeping a blank. An empty primary stays empty (females keep a
 * vulva only), and an empty female secondary stays empty.
 */
function targetKindFor(instance: { id: string; tags?: string[]; slot: string }, baseGender: string): GenitalKind | null {
  const tags = instance.tags ?? [];
  const kind = kindOf(tags);
  if (kind) return kind;
  if (tags.includes("absent_tag") && instance.slot === "genital_secondary" && baseGender === "male") {
    return "scrotum";
  }
  return null;
}

export interface GenitalMorph {
  socket: string;
  from: string;
  chain: string[];
  kind: GenitalKind;
}

/** The morph a genome wants on one of a body's genitals, or null if already native. */
export function genitalMorphFor(
  genome: Genome,
  instance: { id: string; tags?: string[]; slot: string },
  library: PartLibrary,
  baseGender = "female",
): GenitalMorph | null {
  const g = genome.genital;
  if (!g || !instance.slot.startsWith("genital_")) return null;
  const kind = targetKindFor(instance, baseGender);
  if (!kind) return null;
  const side = g[kind];
  if (!side?.to || side.to === instance.id) return null;
  if (!library.get(side.to)) return null;
  const chain = [instance.id, ...(side.via && library.get(side.via) ? [side.via] : []), side.to];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of chain) {
    if (seen.has(part) || !library.get(part)) continue;
    seen.add(part);
    unique.push(part);
  }
  return unique.length >= 2 ? { socket: instance.slot, from: instance.id, chain: unique, kind } : null;
}

/** Every genital morph a genome wants on a body that is not yet native. */
export function genitalMorphsFor(genome: Genome, body: Body, library: PartLibrary, baseGender = "female"): GenitalMorph[] {
  const out: GenitalMorph[] = [];
  for (const instance of body.allInstances()) {
    const morph = genitalMorphFor(genome, instance, library, baseGender);
    if (morph) out.push(morph);
  }
  return out;
}

/** Does a genome declare any genital target? */
export function hasGenitalPlan(genome: Genome): boolean {
  return Object.values(genome.genital ?? {}).some((t) => Boolean(t?.to));
}

/** Validate a genome's genital block so a typo cannot silently strand a socket. */
export function validateGenitalPlan(genome: Genome, library: PartLibrary): void {
  const g = genome.genital;
  if (!g) return;
  for (const [kind, side] of Object.entries(g)) {
    if (!(GENITAL_KINDS as readonly string[]).includes(kind)) {
      throw new ContentError(`genome "${genome.id}" genital kind "${kind}" is unknown`, "genomes.json");
    }
    if (!side?.to) continue;
    // the target need not share the kind (a snake's penis becomes a hemipenis, a
    // scrotum a cloaca), but it must be a genital part on a genital socket.
    for (const partId of [side.to, side.via].filter(Boolean) as string[]) {
      const part = library.get(partId);
      if (!part) throw new ContentError(`genome "${genome.id}" genital part "${partId}" is not a part`, "genomes.json");
      if (!(part.tags ?? []).includes("genital_tag")) {
        throw new ContentError(`genome "${genome.id}" genital part "${partId}" is not a genital`, "genomes.json");
      }
    }
  }
}

/** The part a morph chain shows at progress (0..1), evenly spaced along the chain. */
export function chainPart(chain: readonly string[], progress: number): string {
  if (chain.length === 0) return "";
  const p = Math.max(0, Math.min(1, progress));
  const idx = Math.min(chain.length - 1, Math.floor(p * (chain.length - 1) + 1e-9));
  return chain[idx]!;
}
