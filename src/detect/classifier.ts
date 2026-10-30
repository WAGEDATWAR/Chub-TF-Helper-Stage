/**
 * The classifier (H2 backup layer). A thin, optional second opinion: when the
 * heuristic is ambiguous, ask the chat's own model to name a species per character.
 * Non-deterministic and never gating — it only proposes; a manual override still
 * wins and the heuristic is always the baseline.
 */
import type { SpeciesProposal } from "./detect";
import type { DetectTables } from "./tables";

export interface ClassifierRequest {
  /** The prose to classify. */
  text: string;
  /** The roster, so the model attributes to a known id. */
  characters: Array<{ id: string; name: string }>;
  /** The genome ids it may choose from (id + display token). */
  genomes: Array<{ id: string; token: string }>;
}

/** Build the compact prompt. One line per character keeps the reply parseable. */
export function buildClassifierPrompt(req: ClassifierRequest): string {
  const species = req.genomes.map((g) => g.token).join(", ");
  const who = req.characters.map((c) => `${c.id}=${c.name}`).join(", ");
  return [
    "You identify animal/human transformation in prose. Reply ONLY with lines of `id=species`.",
    `Characters: ${who}`,
    `Species choices: ${species}. Use \`human\` for no transformation.`,
    "If the text says nothing about a character's body, omit that character.",
    "---",
    req.text,
  ].join("\n");
}

/**
 * Parse the model's reply ("id=species" lines) into proposals. A species token is
 * mapped back to a genome by the caller's token lookup.
 */
export function parseClassifierReply(
  reply: string,
  characters: Array<{ id: string; name: string }>,
  genomeByToken: (token: string) => { genome: string; family: string } | null,
): SpeciesProposal[] {
  const out: SpeciesProposal[] = [];
  const byName = new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
  const byId = new Map(characters.map((c) => [c.id, c.id]));
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s*/, "");
    const m = /^([\w .'-]+?)\s*[=:]\s*([\w -]+)$/.exec(line);
    if (!m) continue;
    const who = m[1]!.trim().toLowerCase();
    const species = m[2]!.trim().toLowerCase();
    const id = byId.get(who) ?? byName.get(who);
    if (!id) continue;
    if (species === "human" || species === "none") continue;
    const hit = genomeByToken(species);
    if (!hit) continue;
    out.push({ characterId: id, genome: hit.genome, family: hit.family, confidence: 0.6, source: "chat", token: species, evidence: true });
  }
  return out;
}

/** A token→genome lookup over the cue tables (for parsing a classifier reply). */
export function tokenLookup(tables: DetectTables): (token: string) => { genome: string; family: string } | null {
  const map = new Map<string, { genome: string; family: string }>();
  for (const s of tables.species) map.set(s.token, { genome: s.genome, family: s.family });
  return (token) => map.get(token.trim().toLowerCase()) ?? null;
}
