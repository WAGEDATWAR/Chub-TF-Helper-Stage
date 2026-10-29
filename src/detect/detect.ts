/**
 * The detector (H2). Reads a character card and each chat message and proposes,
 * per character, a genome to bind and/or a "change underway" signal. Pure: it
 * returns proposals and never touches the sim — the game decides what to apply and
 * a manual override always wins.
 *
 * Attribution is **clause-aware**: text is split into clauses (on punctuation and
 * connectives), and a species/anatomy cue is credited to the character named in
 * its own clause — falling back to the nearest preceding clause that names someone,
 * then the nearest following one. So "Mira's skin prickles… like a fox, while Tomas
 * grows eagle wings" credits fox→Mira and eagle→Tomas.
 */
import { tokenize, findSpecies, findFamilies, findImplied, findAnatomySignatures, hasChangeCue, anatomyMentions, type Token } from "./match";
import type { DetectTables } from "./tables";

export interface KnownCharacter {
  id: string;
  names: string[];
  /** "male" | "female" | undefined, for pronoun attribution. */
  gender?: string;
}

export interface SpeciesProposal {
  characterId: string;
  genome: string;
  family: string;
  confidence: number;
  source: "card" | "chat";
  token: string;
}

export interface ChangeSignal {
  characterId: string;
  cues: string[];
  anatomy: string[];
  confidence: number;
}

export interface DetectResult {
  species: SpeciesProposal[];
  changes: ChangeSignal[];
  unattributed: string[];
  /** Characters whose names appear in this text (for focus tracking). */
  named: string[];
}

/** Extra attribution context: a fallback focus, genders for pronouns, sole char. */
export interface AttributeOpts {
  fallbackId?: string | null;
  genders?: Record<string, string>;
  soleId?: string | null;
}

/** Names lowercased + first-name tokens, so "Mira Vance" also matches "Mira". */
function nameTokens(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const lower = n.toLowerCase().trim();
    if (lower) {
      out.add(lower);
      for (const part of lower.split(/\s+/)) if (part.length >= 3) out.add(part);
    }
  }
  return [...out];
}

// clause boundaries: punctuation and connective words
const SEG = /[,;:.!?]|\b(?:while|as|but|and|then|when|whereas|yet|though)\b/gi;

interface Segment {
  start: number;
  end: number;
  name: string | null;
}

/** Split tokens into clauses and note which clause (if any) names a character. */
function segment(tokens: Token[], named: Array<{ id: string; toks: string[] }>): Segment[] {
  const segs: Segment[] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    const isConnect = SEG.test(tokens[i]!.text);
    SEG.lastIndex = 0;
    const next = tokens[i + 1];
    const gap = next ? next.index - (tokens[i]!.index + tokens[i]!.text.length) : 0;
    const endsClause = isConnect || gap > 1;
    if (endsClause || i === tokens.length - 1) {
      segs.push({ start, end: i, name: clauseName(start, i, tokens, named) });
      start = i + 1;
    }
  }
  return segs;
}

function clauseName(start: number, end: number, tokens: Token[], named: Array<{ id: string; toks: string[] }>): string | null {
  for (let i = start; i <= end; i++) {
    for (const c of named) if (c.toks.includes(tokens[i]!.text)) return c.id;
  }
  return null;
}

const PRONOUNS: Record<string, string> = {
  she: "female", her: "female", hers: "female", herself: "female",
  he: "male", him: "male", his: "male", himself: "male",
};

/** The dominant pronoun within `radius` tokens of a hit ("her" → female). */
function pronounNear(tokens: Token[], at: number, radius = 8): string | null {
  let f = 0;
  let m = 0;
  for (let i = Math.max(0, at - radius); i <= Math.min(tokens.length - 1, at + radius); i++) {
    const g = PRONOUNS[tokens[i]!.text];
    if (g === "female") f++;
    else if (g === "male") m++;
  }
  if (f > m) return "female";
  if (m > f) return "male";
  return null;
}

/**
 * The character a hit belongs to. Ladder: same clause → nearest named clause →
 * nearest name anywhere → a pronoun's single gendered match → the focus → the
 * sole character. This is deliberately forgiving: roleplay prose often says
 * "a wolf bit her" with no name in the sentence.
 */
function attribute(segs: Segment[], at: number, tokens: Token[], named: Array<{ id: string; toks: string[] }>, opts: AttributeOpts): string | null {
  const own = segs.findIndex((s) => at >= s.start && at <= s.end);
  if (own >= 0 && segs[own]!.name) return segs[own]!.name;
  if (own >= 0) {
    for (let i = own - 1; i >= 0; i--) if (segs[i]!.name) return segs[i]!.name;
    for (let i = own + 1; i < segs.length; i++) if (segs[i]!.name) return segs[i]!.name;
  }
  // a name anywhere in the message, nearest by token distance
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of named) {
    for (let i = 0; i < tokens.length; i++) {
      if (c.toks.includes(tokens[i]!.text)) {
        const d = Math.abs(i - at);
        if (d < bestDist) { bestDist = d; best = c.id; }
      }
    }
  }
  if (best) return best;
  // a pronoun → the focus if it matches, else a lone candidate, else the first of
  // that gender. Ambiguous pronominal prose ("a wolf bit her") should still propose.
  const g = pronounNear(tokens, at);
  if (g && opts.genders) {
    const cands = named.filter((c) => opts.genders![c.id] === g);
    if (cands.length === 1) return cands[0]!.id;
    if (opts.fallbackId && cands.some((c) => c.id === opts.fallbackId)) return opts.fallbackId;
    if (cands.length > 1) return cands[0]!.id;
  }
  if (opts.fallbackId) return opts.fallbackId;
  if (opts.soleId) return opts.soleId;
  return named.length === 1 ? named[0]!.id : null;
}

/** Which known characters are named in this text (for focus tracking). */
function namesPresent(tokens: Token[], named: Array<{ id: string; toks: string[] }>): string[] {
  const out: string[] = [];
  for (const c of named) {
    if (tokens.some((t) => c.toks.includes(t.text))) out.push(c.id);
  }
  return out;
}

export function detectInText(text: string, chars: KnownCharacter[], tables: DetectTables, source: "card" | "chat", opts: AttributeOpts = {}): DetectResult {
  const tokens = tokenize(text);
  const result: DetectResult = { species: [], changes: [], unattributed: [], named: [] };
  if (tokens.length === 0) return result;

  const named = chars.map((c) => ({ id: c.id, toks: nameTokens(c.names) }));
  const segs = segment(tokens, named);
  result.named = namesPresent(tokens, named);
  const sole = opts.soleId ?? (chars.length === 1 ? chars[0]!.id : null);

  // A common-word token ("ass", "kid") is dropped when a stronger species token is
  // also present in the same text — so "a wolf with a nice ass" is wolf, not donkey.
  let speciesHits = findSpecies(tokens, tables);
  // drop a negated species ("not a wolf"), unless the same genome also appears
  // un-negated elsewhere in the text
  const positiveGenomes = new Set(speciesHits.filter((h) => !h.negated).map((h) => h.genome));
  speciesHits = speciesHits.filter((h) => !h.negated || positiveGenomes.has(h.genome));
  if (speciesHits.some((h) => !h.weak)) speciesHits = speciesHits.filter((h) => !h.weak);

  for (const hit of speciesHits) {
    const id = sole ?? attribute(segs, hit.at, tokens, named, opts);
    // push even when unresolved: the engine can still claim it via the focus/sole
    result.species.push({ characterId: id ?? "", genome: hit.genome, family: hit.family, confidence: source === "card" ? 0.85 : 0.7, source, token: hit.token });
  }

  const speciesFamilies = new Set(result.species.filter((s) => s.characterId).map((s) => `${s.characterId}:${s.family}`));
  for (const hit of findFamilies(tokens, tables)) {
    const id = sole ?? attribute(segs, hit.at, tokens, named, opts);
    if (!id) continue;
    if (speciesFamilies.has(`${id}:${hit.family}`)) continue;
    // a family-only hit still proposes the family's representative genome
    const genome = tables.familyRep[hit.family] ?? "";
    result.species.push({ characterId: id, genome, family: hit.family, confidence: source === "card" ? 0.55 : 0.45, source, token: hit.token });
  }

  // implied species: a cue combination with no explicit species word ("a bite and a
  // growl"). Only when no explicit species for that character+family was found.
  for (const hit of findImplied(tokens, tables)) {
    const id = sole ?? attribute(segs, hit.at, tokens, named, opts);
    if (!id) continue;
    if (result.species.some((s) => s.characterId === id && s.family === hit.family)) continue;
    result.species.push({ characterId: id, genome: hit.genome, family: hit.family, confidence: hit.confidence, source, token: `~${hit.token}` });
  }

  // anatomy-only: a signature of co-occurring anatomy cues ("fur + ears + muzzle")
  // with no species word at all. Weakest channel; only when nothing else claimed it.
  for (const hit of findAnatomySignatures(tokens, tables)) {
    const id = sole ?? attribute(segs, hit.at, tokens, named, opts);
    if (!id) continue;
    if (result.species.some((s) => s.characterId === id && s.family === hit.family)) continue;
    result.species.push({ characterId: id, genome: hit.genome, family: hit.family, confidence: hit.confidence, source, token: `#${hit.token}` });
  }

  // One genome per character per family: keep the highest-confidence claim, so a
  // later weak implication ("it bites her arm" → werewolf) does not stack on an
  // already-proposed strong sibling ("wolf"). Different families still both stand.
  result.species = dedupeByFamily(result.species);

  if (hasChangeCue(tokens, tables)) {
    const anatomy = anatomyMentions(tokens, tables);
    if (anatomy.length > 0) {
      // credit to whoever the species/anatomy cues point at; fall back to the focus
      const counts = new Map<string, string[]>();
      for (const hit of [...speciesHits, ...findImplied(tokens, tables)]) {
        const id = sole ?? attribute(segs, hit.at, tokens, named, opts);
        if (id) counts.set(id, [...(counts.get(id) ?? []), hit.token]);
      }
      if (counts.size === 0) {
        const id = opts.fallbackId ?? sole;
        if (id) counts.set(id, []);
      }
      for (const [id, cues] of counts) result.changes.push({ characterId: id, cues, anatomy, confidence: 0.5 });
    }
  }

  return result;
}

export function mergeResults(a: DetectResult, b: DetectResult): DetectResult {
  return { species: [...a.species, ...b.species], changes: [...a.changes, ...b.changes], unattributed: [...a.unattributed, ...b.unattributed], named: [...a.named, ...b.named] };
}

/**
 * Keep only the strongest claim per character+family. A strong explicit "wolf"
 * (0.7) beats a weak implied "werewolf" (0.55) for the same character, so prose
 * does not stack a sibling onto an already-named species. Different families (a
 * canine and a raptor) both survive.
 */
function dedupeByFamily(species: SpeciesProposal[]): SpeciesProposal[] {
  const best = new Map<string, SpeciesProposal>();
  for (const s of species) {
    const key = `${s.characterId || "?"}:${s.family}`;
    const prev = best.get(key);
    if (!prev || s.confidence > prev.confidence) best.set(key, s);
  }
  return [...best.values()];
}
