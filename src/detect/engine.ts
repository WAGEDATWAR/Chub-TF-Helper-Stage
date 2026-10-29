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
import { detectInText, type DetectResult, type KnownCharacter, type SpeciesProposal } from "./detect";

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
}

export interface JournalEntry {
  atTick: number;
  kind: "species" | "change" | "override" | "unattributed" | "apply";
  characterId: string | null;
  text: string;
}

export const JOURNAL_CAP = 120;

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

  constructor(cueData: unknown) {
    this.tables = buildDetectTables(cueData);
  }

  /** Register (or update) a known character and its card text. */
  know(id: string, names: string[], cardText: string, tick: number, gender?: string): DetectResult {
    this.chars.set(id, { id, names, gender });
    if (!this.tables.settings.autoBindFromCard) return { species: [], changes: [], unattributed: [], named: [] };
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

  get known(): KnownCharacter[] {
    return [...this.chars.values()];
  }

  /** The character last named in the prose, if any (attribution fallback). */
  get focusId(): string | null {
    return this.focus;
  }

  /** Attribution context: current focus, per-character gender, a lone character. */
  private attrOpts(soleId: string | null): { fallbackId: string | null; genders: Record<string, string>; soleId: string | null } {
    const genders: Record<string, string> = {};
    for (const c of this.chars.values()) if (c.gender) genders[c.id] = c.gender;
    return { fallbackId: this.focus, genders, soleId };
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
    if (!this.tables.settings.autoBindFromChat) return { species: [], changes: [], unattributed: [], named: [] };
    // a speaker is a strong attribution prior; to a named card, to their own text
    const speaker = id && this.chars.has(id) ? [{ id, names: this.chars.get(id)!.names, gender: this.chars.get(id)!.gender }] : [...this.chars.values()];
    const res = detectInText(text, speaker, this.tables, "chat", this.attrOpts(null));
    // the writer naming someone makes them the focus for the next bare sentences
    if (res.named.length > 0) this.focus = res.named[res.named.length - 1]!;
    this.record(res, tick, res.named.length ? res.named[res.named.length - 1]! : this.focus);
    return res;
  }

  private record(res: DetectResult, tick: number, soleCardId: string | null): void {
    for (const s of res.species) this.addProposal(s, tick, soleCardId);
    for (const c of res.changes) this.push("change", c.characterId, `change underway (${c.anatomy.join(", ")})`);
    for (const t of res.unattributed) this.push("unattributed", null, `“${t}” — no character nearby`);
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

  toJSON(): { overrides: Array<[string, string | null]>; journal: JournalEntry[] } {
    return { overrides: [...this.overrides.entries()], journal: this.journal.slice(-JOURNAL_CAP) };
  }

  loadJSON(data: { overrides?: Array<[string, string | null]>; journal?: JournalEntry[] } | null): void {
    if (!data) return;
    this.overrides = new Map(data.overrides ?? []);
    this.journal.length = 0;
    this.journal.push(...(data.journal ?? []));
  }
}
