/**
 * Detection cue tables (H2). Parsed from `data/detect.json`. Pure data → typed
 * lookups, so the detector is deterministic and the tables are editable without
 * code.
 */
export interface SpeciesCue {
  genome: string;
  family: string;
  tokens: string[];
}

/** An implication rule: `any` and `support` cues together imply a genome. */
export interface Implication {
  genome: string;
  family: string;
  any: string[];
  support: string[];
  /** How many DISTINCT `any` cues must be present (default 1). May be 0. */
  minAny: number;
  /** How many DISTINCT `support` cues must be present (default 1). May be 0. */
  minSupport: number;
  confidence: number;
}

export interface DetectTables {
  /** Every species token → the genome it proposes, longest token first. */
  species: Array<{ token: string; genome: string; family: string }>;
  /** A family token → the family (weaker fallback when no species is named). */
  families: Array<{ token: string; family: string }>;
  changeCues: Set<string>;
  anatomy: Record<string, string[]>;
  /** Tokens that are also common English words ("ass", "cat") — lower priority. */
  weakTokens: Set<string>;
  /** A family's representative genome, so a family-only hit can still propose. */
  familyRep: Record<string, string>;
  /** Cue-combination rules for implied species (a bite + a growl). */
  implications: Implication[];
  /**
   * Anatomy-signature rules: N distinct anatomy families (from `anatomy_cues`) imply
   * a family/genome. Catches anatomy-only prose ("fur, ears, muzzle") with no
   * species word. `need` = the anatomy family names that must co-occur.
   */
  anatomyRules: Array<{ genome: string; family: string; need: string[]; confidence: number }>;
  settings: {
    minTokenLength: number;
    attributeWindow: number;
    autoBindFromCard: boolean;
    autoBindFromChat: boolean;
  };
}

export function buildDetectTables(data: unknown): DetectTables {
  const d = (data ?? {}) as {
    species?: SpeciesCue[];
    family_tokens?: Record<string, string[]>;
    change_cues?: string[];
    anatomy_cues?: Record<string, string[]>;
    weak_tokens?: string[];
    implications?: Array<{ genome: string; family: string; any: string[]; support: string[]; min_any?: number; min_support?: number; confidence?: number }>;
    anatomy_rules?: Array<{ genome: string; family: string; need: string[]; confidence?: number }>;
    settings?: Partial<DetectTables["settings"]>;
  };
  const species: DetectTables["species"] = [];
  const familyRep: Record<string, string> = {};
  for (const s of d.species ?? []) {
    for (const token of s.tokens ?? []) species.push({ token: token.toLowerCase(), genome: s.genome, family: s.family });
    if (!(s.family in familyRep)) familyRep[s.family] = s.genome;
  }
  // longest tokens first so "werewolf" wins over "wolf", "jackrabbit" over "rabbit"
  species.sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token));

  const families: DetectTables["families"] = [];
  for (const [family, tokens] of Object.entries(d.family_tokens ?? {})) {
    for (const token of tokens) families.push({ token: token.toLowerCase(), family });
  }
  families.sort((a, b) => b.token.length - a.token.length || a.token.localeCompare(b.token));

  return {
    species,
    families,
    changeCues: new Set((d.change_cues ?? []).map((c) => c.toLowerCase())),
    anatomy: d.anatomy_cues ?? {},
    weakTokens: new Set((d.weak_tokens ?? []).map((c) => c.toLowerCase())),
    familyRep,
    implications: (d.implications ?? []).map((i) => ({
      genome: i.genome,
      family: i.family,
      any: (i.any ?? []).map((t) => t.toLowerCase()),
      support: (i.support ?? []).map((t) => t.toLowerCase()),
      minAny: i.min_any ?? 1,
      minSupport: i.min_support ?? 1,
      confidence: i.confidence ?? 0.5,
    })),
    anatomyRules: (d.anatomy_rules ?? []).map((a) => ({
      genome: a.genome,
      family: a.family,
      need: (a.need ?? []).map((n) => n.toLowerCase()),
      confidence: a.confidence ?? 0.4,
    })),
    settings: {
      minTokenLength: d.settings?.minTokenLength ?? 3,
      attributeWindow: d.settings?.attributeWindow ?? 2,
      autoBindFromCard: d.settings?.autoBindFromCard ?? true,
      autoBindFromChat: d.settings?.autoBindFromChat ?? true,
    },
  };
}
