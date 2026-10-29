/**
 * Text matching for detection (H2). Pure and deterministic: tokenise text, then
 * look up species/family/change cues. The detector uses these to *propose*; it
 * never mutates the sim.
 */
import type { DetectTables } from "./tables";

// letters only: "wolf-girl" → wolf, girl; "Mira's" → mira, s (so a possessive still
// matches the name). Cue tokens are split the same way and matched by sequence.
const WORD = /[a-z]+/gi;

export interface Token {
  text: string;
  index: number;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  if (!text) return out;
  for (const m of text.matchAll(WORD)) {
    const raw = m[0]!;
    if (raw.length < 2) continue;
    out.push({ text: raw.toLowerCase(), index: m.index ?? 0 });
  }
  return out;
}

/**
 * A cue word matches a token if they are equal or the token is a common inflection
 * of the cue ("howl" matches "howled"/"howling"; "lunge" matches "lunging"). Kept
 * strict enough not to collide ("ear" does not match "earth").
 */
export function cueMatches(cue: string, token: string): boolean {
  if (cue === token) return true;
  const stems = new Set<string>();
  stems.add(cue + "s"); stems.add(cue + "es"); stems.add(cue + "ed"); stems.add(cue + "d"); stems.add(cue + "ing"); stems.add(cue + "n");
  if (/e$/.test(cue)) { const b = cue.slice(0, -1); stems.add(b + "ing"); stems.add(b + "ed"); }
  if (/y$/.test(cue)) { const b = cue.slice(0, -1); stems.add(b + "ies"); stems.add(b + "ied"); }
  return stems.has(token);
}

/** True if any text token is (an inflection of) the cue. */
export function textHas(tokens: Token[], cue: string): boolean {
  return tokens.some((t) => cueMatches(cue, t.text));
}

/** True if the cue appears and is NOT negated ("a wolf" vs "not a wolf"). */
export function textHasPositive(tokens: Token[], cue: string): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (cueMatches(cue, tokens[i]!.text) && !isNegated(tokens, i)) return true;
  }
  return false;
}

/** Negation words that, immediately before a cue, flip its meaning ("not a wolf"). */
const NEGATORS = new Set(["not", "no", "never", "nor", "isn", "wasn", "aren", "weren", "ain", "without", "unlike", "hardly", "barely"]);

/**
 * True if the cue at token index `at` is negated by a nearby negator ("not a wolf",
 * "no fur", "wasn't a fox but"). Scans the two tokens to the left.
 */
export function isNegated(tokens: Token[], at: number): boolean {
  for (let i = at - 1; i >= Math.max(0, at - 3); i--) {
    const w = tokens[i]!.text;
    if (NEGATORS.has(w)) return true;
    // stop at a strong boundary/other cue
    if (/^(a|an|the)$/.test(w)) continue;
    if (NEGATORS.has(w + "t")) return true;
  }
  return false;
}

/** Split a cue token the same way the text is tokenised, for sequence matching. */
function cueWords(cue: string): string[] {
  return (cue.toLowerCase().match(WORD) ?? []);
}

export interface SpeciesHit {
  genome: string;
  family: string;
  token: string;
  /** Where the token sat in the token list (for attribution distance). */
  at: number;
  /** True for a common English word (e.g. "ass", "cat") unlikely to be the species. */
  weak: boolean;
  /** True when a negator sits just before the cue ("not a wolf"). */
  negated: boolean;
}

/** Every species token present in the text, in token order, longest cue first. */
export function findSpecies(tokens: Token[], tables: DetectTables): SpeciesHit[] {
  const found: SpeciesHit[] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (claimed.has(i)) continue;
    for (const cue of tables.species) {
      const words = cueWords(cue.token);
      if (words.join("").length < tables.settings.minTokenLength) continue;
      let ok = true;
      for (let w = 0; w < words.length; w++) {
        const tok = tokens[i + w]?.text;
        if (tok === undefined || !cueMatches(words[w]!, tok)) { ok = false; break; }
      }
      if (!ok) continue;
      for (let w = 0; w < words.length; w++) claimed.add(i + w);
      found.push({ genome: cue.genome, family: cue.family, token: cue.token, at: i, weak: tables.weakTokens.has(cue.token), negated: isNegated(tokens, i) });
      break;
    }
  }
  return found;
}

/** Family tokens present (single word). */
export function findFamilies(tokens: Token[], tables: DetectTables): Array<{ family: string; token: string; at: number }> {
  const found: Array<{ family: string; token: string; at: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const cue of tables.families) {
      if (cue.token.length < tables.settings.minTokenLength) continue;
      if (tokens[i]!.text === cue.token) { found.push({ family: cue.family, token: cue.token, at: i }); break; }
    }
  }
  return found;
}

export function hasChangeCue(tokens: Token[], tables: DetectTables): boolean {
  return tokens.some((t) => tables.changeCues.has(t.text));
}

/**
 * Implied species: a rule fires when at least `minAny` distinct `any` cues AND
 * `minSupport` distinct `support` cues are present (a "bite" plus a "growl" implies
 * a werewolf). Returns the anchor token so attribution behaves like a mention.
 */
export function findImplied(tokens: Token[], tables: DetectTables): Array<{ genome: string; family: string; token: string; at: number; confidence: number }> {
  const out: Array<{ genome: string; family: string; token: string; at: number; confidence: number }> = [];
  const count = (words: string[]) => words.reduce((n, w) => n + (textHasPositive(tokens, w) ? 1 : 0), 0);
  for (const rule of tables.implications) {
    if (count(rule.any) < rule.minAny) continue;
    if (count(rule.support) < rule.minSupport) continue;
    const anchor = rule.any.find((t) => textHasPositive(tokens, t)) ?? rule.support.find((t) => textHasPositive(tokens, t)) ?? "";
    const at = tokens.findIndex((t) => cueMatches(anchor, t.text));
    out.push({ genome: rule.genome, family: rule.family, token: anchor, at: at < 0 ? 0 : at, confidence: rule.confidence });
  }
  return out;
}

/** Distinct anatomy families present in the text (e.g. ["fur", "ears", "muzzle"]). */
export function anatomyFamilies(tokens: Token[], tables: DetectTables): string[] {
  return anatomyMentions(tokens, tables);
}

/**
 * Anatomy-signature implications: when every family in a rule's `need` list is
 * present, propose its genome. Catches anatomy-only prose with no species word
 * ("fur rippled, ears slid up, a muzzle pushed out" → canine). Anchored at the first
 * matching anatomy cue.
 */
export function findAnatomySignatures(tokens: Token[], tables: DetectTables): Array<{ genome: string; family: string; token: string; at: number; confidence: number }> {
  const out: Array<{ genome: string; family: string; token: string; at: number; confidence: number }> = [];
  if (tables.anatomyRules.length === 0) return out;
  const presentFamilies = new Set(anatomyMentions(tokens, tables));
  for (const rule of tables.anatomyRules) {
    if (!rule.need.every((n) => presentFamilies.has(n))) continue;
    // anchor at the earliest anatomy cue of the first needed family
    const words = tables.anatomy[rule.need[0]!] ?? [];
    const at = tokens.findIndex((t) => words.some((w) => cueMatches(w, t.text)));
    out.push({ genome: rule.genome, family: rule.family, token: rule.need.join("+"), at: at < 0 ? 0 : at, confidence: rule.confidence });
  }
  return out;
}

/** Distinct anatomy family keys present (raw, for signature matching). */
export function anatomyPresent(tokens: Token[], tables: DetectTables): Set<string> {
  return new Set(anatomyMentions(tokens, tables));
}

export function anatomyMentions(tokens: Token[], tables: DetectTables): string[] {
  const hits = new Set<string>();
  for (const [family, words] of Object.entries(tables.anatomy)) {
    for (const w of words) if (textHasPositive(tokens, w)) { hits.add(family); break; }
  }
  return [...hits];
}
