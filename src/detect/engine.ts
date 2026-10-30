/**
 * The detection engine (H2): holds cue tables, known characters, pending
 * proposals and a journal. Pure of the sim — the game reads proposals and decides.
 *
 * Sources of text: a character's card (name/description/personality/scenario) and
 * each chat message. A card hit is attributed to that character outright; a chat
 * hit is attributed to the nearest named character. A manual override is recorded
 * and always wins.
 */
import { buildDetectTables, type DetectTables } from "./tables";
import { detectInText, npcCandidates, type DetectResult, type KnownCharacter, type SpeciesProposal } from "./detect";

export interface Proposal {
  id: string;
  characterId: string;
  characterName: string;
  genome: string;
  family: string;
  confidence: number;
  source: "card" | "chat";
  token: string;
  atTick: number;
  status: "pending" | "applied" | "dismissed";
  /** True when the prose evidences this (a name/cue tie); auto-apply needs it. */
  evidence: boolean;
}

export interface JournalEntry {
  atTick: number;
  kind: "species" | "change" | "override" | "unattributed" | "apply";
  characterId: string | null;
  text: string;
}

/** A named-but-untracked figure the prose tied to a species — a possible NPC. */
export interface NpcCandidate {
  name: string;
  genome: string;
  family: string;
  atTick: number;
}

export const JOURNAL_CAP = 120;
export const NPC_CAP = 12;

export class Detector {
  readonly tables: DetectTables;
  private chars = new Map<string, KnownCharacter>();
  /** Manual overrides: characterId → genome (null = explicitly human). */
  private overrides = new Map<string, string | null>();
  readonly proposals: Proposal[] = [];
  readonly journal: JournalEntry[] = [];
  private seq = 0;
  /** The character the prose currently centers on (set from named text). */
  private focus: string | null = null;
  /** Species mentions tied to an unknown name, offered as trackable NPCs. */
  private npcs = new Map<string, NpcCandidate>();

  constructor(cueData: unknown) {
    this.tables = buildDetectTables(cueData);
  }

  /** Register (or update) a known character and its card text. */
  know(id: string, names: string[], cardText: string, tick: number, gender?: string): DetectResult {
    this.chars.set(id, { id, names, gender });
    if (!this.tables.settings.autoBindFromCard) return { species: [], changes: [], unattributed: [], named: [], unresolved: [] };
    const res = detectInText(cardText, [...this.chars.values()], this.tables, "card", this.attrOpts(id));
    this.record(res, tick, id);
    return res;
  }

  /** Register or rename a known character (keeps it attributable). */
  rename(id: string, names: string[], gender?: string): void {
    const c = this.chars.get(id);
    if (c) { c.names = names; if (gender) c.gender = gender; }
    else this.chars.set(id, { id, names, gender });
  }

  forget(id: string): void {
    this.chars.delete(id);
    this.overrides.delete(id);
  }

  /** Forget a candidate NPC by its display name (after tracking or dismissing it). */
  forgetCandidate(name: string): void {
    this.npcs.delete(name.toLowerCase());
  }

  get known(): KnownCharacter[] {
    return [...this.chars.values()];
  }

  /** The character last named in the prose, if any (attribution fallback). */
  get focusId(): string | null {
    return this.focus;
  }

  /** Attribution context: current focus, per-character gender, a lone character. */
  private attrOpts(soleId: string | null, requireEvidence = false): { fallbackId: string | null; genders: Record<string, string>; soleId: string | null; requireEvidence: boolean } {
    const genders: Record<string, string> = {};
    for (const c of this.chars.values()) if (c.gender) genders[c.id] = c.gender;
    return { fallbackId: this.focus, genders, soleId, requireEvidence };
  }

  /** A manual, human/forced genome for a character (wins over detection). */
  setOverride(id: string, genome: string | null): void {
    this.overrides.set(id, genome);
    this.push("override", id, genome ? `set to ${genome}` : "set to human");
  }

  overrideFor(id: string): string | null | undefined {
    return this.overrides.get(id);
  }

  /** Scan a chat message and propose, per character, genomes and change signals. */
  observe(id: string | null, text: string, tick: number): DetectResult {
    if (!this.tables.settings.autoBindFromChat) return { species: [], changes: [], unattributed: [], named: [], unresolved: [] };
    // a speaker is a strong attribution prior; to a named card, to their own text
    const speaker = id && this.chars.has(id) ? [{ id, names: this.chars.get(id)!.names, gender: this.chars.get(id)!.gender }] : [...this.chars.values()];
    const res = detectInText(text, speaker, this.tables, "chat", this.attrOpts(null, true));
    // the writer naming someone makes them the focus for the next bare sentences
    if (res.named.length > 0) this.focus = res.named[res.named.length - 1]!;
    this.captureNpcs(text, res, tick);
    this.record(res, tick, res.named.length ? res.named[res.named.length - 1]! : this.focus);
    return res;
  }

  /**
   * When a species word sits near an unknown Capitalized name, remember it as a
   * candidate NPC ("Marek the werewolf") the pane can offer to track. Only names
   * that co-occur with a species mention qualify, so passing proper nouns (a town,
   * a shop) do not clutter the list.
   */
  private captureNpcs(text: string, res: DetectResult, tick: number): void {
    const hits = [...res.species.map((s) => ({ genome: s.genome, family: s.family })), ...res.unresolved];
    if (hits.length === 0) return;
    const knownToks = new Set<string>();
    for (const c of this.chars.values()) for (const n of c.names) { knownToks.add(n.toLowerCase()); for (const p of n.toLowerCase().split(/\s+/)) knownToks.add(p); }
    const speciesToks = new Set(this.tables.species.map((s) => s.token));
    for (const name of npcCandidates(text, knownToks, speciesToks)) {
      const lower = name.toLowerCase();
      // one entry per name; keep the strongest/last genome seen
      const existing = this.npcs.get(lower);
      const hit = hits[0]!;
      if (existing) { existing.genome = hit.genome; existing.family = hit.family; existing.atTick = tick; }
      else this.npcs.set(lower, { name, genome: hit.genome, family: hit.family, atTick: tick });
    }
    if (this.npcs.size > NPC_CAP) {
      const sorted = [...this.npcs.entries()].sort((a, b) => a[1].atTick - b[1].atTick);
      for (const [k] of sorted.slice(0, this.npcs.size - NPC_CAP)) this.npcs.delete(k);
    }
  }

  /** Candidate NPCs (named, untracked, tied to a species) for the pane. */
  get candidates(): NpcCandidate[] {
    return [...this.npcs.values()].sort((a, b) => b.atTick - a.atTick);
  }

  private record(res: DetectResult, tick: number, soleCardId: string | null): void {
    for (const s of res.species) this.addProposal(s, tick, soleCardId);
    for (const c of res.changes) this.push("change", c.characterId, `change underway (${c.anatomy.join(", ")})`);
    for (const t of res.unattributed) this.push("unattributed", null, `“${t}” — no character nearby`);
    // unknown-name species mentions become candidate NPCs the pane can offer to track
    for (const u of res.unresolved) this.push("unattributed", null, `“${u.token}” — possible NPC (${u.genome.replace(/^genome\./, "")})`);
  }

  private addProposal(s: SpeciesProposal, tick: number, soleCardId: string | null): void {
    const charId = s.characterId || soleCardId || this.focus;
    if (!charId) { this.push("unattributed", null, `“${s.token}” — no character nearby`); return; }
    if (this.overrides.has(charId)) return;
    if (!this.chars.has(charId)) { this.push("unattributed", null, `“${s.token}” — no character nearby`); return; }
    if (!s.genome) {
      // family-only: remember it as a lower-confidence proposal
      this.push("species", charId, `${s.family} (family of a change)`);
      return;
    }
    const name = this.chars.get(charId)?.names[0] ?? charId;
    // de-dup: one pending proposal per character+genome
    if (this.proposals.some((p) => p.characterId === charId && p.genome === s.genome && p.status === "pending")) return;
    this.proposals.push({
      id: `prop${++this.seq}`,
      characterId: charId,
      characterName: name,
      genome: s.genome,
      family: s.family,
      confidence: s.confidence,
      source: s.source,
      token: s.token,
      atTick: tick,
      status: "pending",
      evidence: s.evidence,
    });
    this.push("species", charId, `${name}: looks like ${s.genome.replace(/^genome\./, "")} (${s.source}, “${s.token}”)`);
  }

  /** Add a proposal from an external source (the classifier). */
  proposeExternal(s: SpeciesProposal, tick: number): void {
    const charId = s.characterId;
    if (!this.chars.has(charId)) return;
    if (this.overrides.has(charId)) return;
    if (this.proposals.some((p) => p.characterId === charId && p.genome === s.genome && p.status === "pending")) return;
    const name = this.chars.get(charId)?.names[0] ?? charId;
    this.proposals.push({
      id: `prop${++this.seq}`,
      characterId: charId,
      characterName: name,
      genome: s.genome,
      family: s.family,
      confidence: s.confidence,
      source: "chat",
      token: `${s.token} (llm)`,
      atTick: tick,
      status: "pending",
      evidence: true,
    });
    this.push("species", charId, `${name}: model reads ${s.genome.replace(/^genome\./, "")}`);
  }

  /** The strongest pending proposal for a character, or null. */
  topPending(id: string): Proposal | null {
    return this.proposals.filter((p) => p.characterId === id && p.status === "pending").sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  }

  mark(id: string, status: Proposal["status"]): void {
    const p = this.proposals.find((q) => q.id === id);
    if (p) p.status = status;
  }

  push(kind: JournalEntry["kind"], characterId: string | null, text: string): void {
    this.journal.push({ atTick: this.seq, kind, characterId, text });
    if (this.journal.length > JOURNAL_CAP) this.journal.splice(0, this.journal.length - JOURNAL_CAP);
  }

  // --- persistence (branch-local) ------------------------------------------

  toJSON(): { overrides: Array<[string, string | null]>; journal: JournalEntry[]; npcs: Array<[string, NpcCandidate]> } {
    return { overrides: [...this.overrides.entries()], journal: this.journal.slice(-JOURNAL_CAP), npcs: [...this.npcs.entries()] };
  }

  loadJSON(data: { overrides?: Array<[string, string | null]>; journal?: JournalEntry[]; npcs?: Array<[string, NpcCandidate]> } | null): void {
    if (!data) return;
    this.overrides = new Map(data.overrides ?? []);
    this.npcs = new Map(data.npcs ?? []);
    this.journal.length = 0;
    this.journal.push(...(data.journal ?? []));
  }
}
