/**
 * The library-free stage core. Holds all loop logic so it can be tested headlessly
 * (node) and keeps the React/`@chub-ai` boundary thin.
 *
 * H2 scope: a **cast** of up to MAX_CAST characters on a shared clock, plus
 * narrative **detection** — cards and chat propose who changes and into what, a
 * manual override always wins. Ambient/lunar coupling (H3) and prompt driving (H4)
 * extend this.
 */
import { buildRegistries, type Registries } from "./sim/registries";
import { Cast, type CastFrame } from "./sim/cast";
import { contentBundle } from "./sim/bundle";
import { Detector, type JournalEntry, type Proposal } from "./detect/engine";
import { buildClassifierPrompt, parseClassifierReply, tokenLookup } from "./detect/classifier";
import { createLunar } from "./sim/lunar";
import { createTriggerEngine, type TriggerEvent } from "./sim/triggers";
import { feel, DEFAULT_DOSE } from "./sim/subject";
import { applyPace, currentPace, PACES, type PaceId } from "./sim/pace";

export type { CastFrame } from "./sim/cast";
export type { JournalEntry, Proposal } from "./detect/engine";
export { MAX_CAST } from "./sim/cast";

export interface CastView {
  frames: CastFrame[];
  day: number;
  worldTick: number;
  proposals: Proposal[];
  journal: JournalEntry[];
  moon: { phase: string; intensity: number; daysToFull: number };
  coupling: Array<{ characterId: string; genome: string; kind: string; pressure: number; breakdown: Array<{ source: string; value: number }>; cues: string[]; shifted: boolean; playstyle: string; playstyles: Array<{ id: string; note: string }>; canCall: boolean }>;
  triggers: TriggerEvent[];
}

export interface CardInput {
  id: string;
  /** Display name + aliases. */
  names: string[];
  text: string;
  baseGender?: string;
}

export interface SavePayload {
  worldTick: number;
  chars: Record<string, string>;
  detect: ReturnType<Detector["toJSON"]>;
  coupling: ReturnType<TriggerEngine["toJSON"]>;
}

type TriggerEngine = ReturnType<typeof createTriggerEngine>;

/** The cast, its shared world, and the narrative detector (H2). */
export class HelperGame {
  readonly data: Record<string, unknown>;
  readonly regs: Registries;
  readonly cast: Cast;
  readonly detector: Detector;
  readonly lunar: ReturnType<typeof createLunar>;
  readonly triggers: ReturnType<typeof createTriggerEngine>;
  readonly seed: number;
  private triggerLog: TriggerEvent[] = [];
  private active: string | null = null;

  constructor(seed = 20261028, lunarConfig?: { cycleDays?: number }) {
    this.seed = seed;
    this.data = contentBundle();
    this.regs = buildRegistries(this.data);
    this.cast = new Cast(this.regs, this.data, seed);
    this.detector = new Detector(this.data.detect ?? {});
    this.lunar = createLunar(lunarConfig);
    this.triggers = createTriggerEngine(this.data.coupling ?? {}, this.lunar);
  }

  /** The subject's current named emotions (0..100), for coupling pressure. */
  private emotionsOf(sim: { subject: { mood: ReturnType<typeof feel> | unknown } }): Record<string, number> {
    const mood = sim.subject.mood as { ids?: () => string[]; get?: (id: string) => number } | null;
    if (!mood?.ids) return {};
    const out: Record<string, number> = {};
    for (const id of mood.ids()) out[id] = mood.get!(id);
    return out;
  }

  /** Feel an emotion on a character (a manual nudge that can force a coupled shift). */
  feel(characterId: string, emotion: string, amount: number): boolean {
    const char = this.cast.get(characterId);
    if (!char) return false;
    feel(char.sim, emotion, amount);
    return true;
  }

  /** Set a character's werewolf/vampire playstyle (which triggers are live). */
  setPlaystyle(characterId: string, genomeId: string, playstyle: string): void {
    this.triggers.setPlaystyle(characterId, genomeId, playstyle);
  }

  /** Set the transformation pace for the whole cast (a persistent growth scale). */
  setPace(id: PaceId): void {
    this.pace = id;
    for (const char of this.cast.entries()) applyPace(char.sim, id);
  }

  /** The current pace id. */
  paceId(): PaceId {
    return this.pace;
  }

  /** The offered paces, for the pane. */
  paces(): typeof PACES {
    return PACES;
  }
  private pace: PaceId = "normal";

  /** H10: a realized character on a voluntary playstyle calls the shift on purpose. */
  callShift(characterId: string): boolean {
    const char = this.cast.get(characterId);
    if (!char) return false;
    const called = this.triggers.callShift(characterId, char.sim);
    if (called) this.advance(1);
    return called;
  }

  /** Track a character by chat id. Returns the id, or null if the cast is full. */
  track(id: string, name: string, baseGender = "female"): string | null {
    if (!this.cast.add(id, name, baseGender)) return null;
    // register the name with the detector too, so a plain `track` is attributable
    this.detector.rename(id, [name], baseGender);
    const char = this.cast.get(id);
    if (char) applyPace(char.sim, this.pace);
    return id;
  }

  /** Stop tracking a character. */
  untrack(id: string): boolean {
    this.detector.forget(id);
    return this.cast.remove(id);
  }

  get tracked(): number {
    return this.cast.size;
  }

  get full(): boolean {
    return this.cast.full;
  }

  /**
   * Register a character card and scan it for a species. Tracking is implicit: a
   * card that names a species is tracked and proposed. Returns the character id.
   */
  knowCard(card: CardInput): string | null {
    const existing = this.cast.get(card.id);
    if (!existing && this.cast.full) return null;
    if (!existing) this.track(card.id, card.names[0] ?? card.id, card.baseGender ?? "female");
    this.detector.know(card.id, card.names, card.text, this.cast.worldTick, card.baseGender);
    return card.id;
  }

  /** Force a genome on a tracked character (override; wins over detection). */
  override(id: string, genomeId: string | null): boolean {
    if (genomeId !== null && !this.regs.genomes.get(genomeId)) return false;
    this.detector.setOverride(id, genomeId);
    if (genomeId) this.cast.bind(id, genomeId, 1.0);
    return true;
  }

  /** Apply the strongest pending proposal for a character (or a specific one). */
  applyProposal(proposalId: string, dose = DEFAULT_DOSE): boolean {
    const p = this.detector.proposals.find((q) => q.id === proposalId && q.status === "pending");
    if (!p) return false;
    if (!this.cast.bind(p.characterId, p.genome, dose)) return false;
    this.detector.mark(p.id, "applied");
    this.applyRelated(p.characterId, p.genome);
    return true;
  }

  dismissProposal(proposalId: string): void {
    this.detector.mark(proposalId, "dismissed");
  }

  /** Bind any pending proposal for a character that has no genome yet. */
  autoApplyPending(dose = DEFAULT_DOSE): string[] {
    const applied: string[] = [];
    for (const p of [...this.detector.proposals]) {
      if (p.status !== "pending") continue;
      const char = this.cast.get(p.characterId);
      if (!char || char.sim.subject.genomes.length > 0) continue;
      if (this.applyProposal(p.id, dose)) applied.push(p.characterId);
    }
    return applied;
  }

  /** Observe a chat message (the bot's prose) for species + change signals. */
  observe(speakerId: string | null, text: string): void {
    this.detector.observe(speakerId, text, this.cast.worldTick);
  }

  /** A classifier prompt for the current prose (optional second-opinion layer). */
  classifyPrompt(text: string): string {
    return buildClassifierPrompt({
      text,
      characters: this.cast.list().map((c) => ({ id: c.id, name: c.name })),
      genomes: this.genomes().map((id) => ({ id, token: id.replace(/^genome\./, "") })),
    });
  }

  /** Feed a classifier reply back in as extra (lower-confidence) proposals. */
  applyClassifierReply(reply: string): number {
    const found = parseClassifierReply(reply, this.cast.list().map((c) => ({ id: c.id, name: c.name })), tokenLookup(this.detector.tables));
    for (const p of found) this.detector.proposeExternal(p, this.cast.worldTick);
    return found.length;
  }

  /** Bind a genome to a tracked character directly (forced). */
  bestow(id: string, genomeId: string, dose = DEFAULT_DOSE): boolean {
    return this.cast.bind(id, genomeId, dose);
  }

  /** Advance the whole cast on the shared clock, firing any coupling triggers. */
  advance(ticks: number): void {
    if (ticks <= 0) return;
    const before = this.cast.worldTick;
    // step coupling *before* the world moves, so a shift lands, then grows
    const events = this.triggers.step(this.cast.entries(), ticks, before + ticks, (sim) => this.emotionsOf(sim));
    if (events.length > 0) {
      this.triggerLog.push(...events);
      if (this.triggerLog.length > 60) this.triggerLog.splice(0, this.triggerLog.length - 60);
      for (const e of events) this.detector.push("change", e.characterId, `${e.kind}: ${e.note}`);
    }
    this.cast.advance(ticks);
  }

  /** The current read of the whole cast plus the detection feed and coupling. */
  view(): CastView {
    const tick = this.cast.worldTick;
    const coupling: CastView["coupling"] = [];
    for (const { id, sim } of this.cast.entries()) {
      for (const r of this.triggers.readout(id, sim, tick, (s) => this.emotionsOf(s))) {
        coupling.push({ characterId: id, ...r });
      }
    }
    return {
      frames: this.cast.frames(),
      day: this.cast.list()[0]?.sim.session.clock.day ?? 1,
      worldTick: tick,
      proposals: this.detector.proposals.filter((p) => p.status === "pending"),
      journal: this.detector.journal.slice(-40),
      moon: { phase: this.lunar.phaseName(tick), intensity: Math.round(this.lunar.intensity(tick) * 100) / 100, daysToFull: Math.round(this.lunar.daysToFull(tick) * 10) / 10 },
      coupling,
      triggers: this.triggerLog.slice(-12),
    };
  }

  /** Genome ids available to bind, for the pane/commands. */
  genomes(): string[] {
    return this.regs.genomes.all().map((g) => g.id).filter((id) => id !== "genome.human_baseline");
  }

  /** The character the tools/commands target (null = none tracked). */
  activeId(): string | null {
    if (this.active && this.cast.get(this.active)) return this.active;
    return this.cast.list()[0]?.id ?? null;
  }

  setActive(id: string): void {
    if (this.cast.get(id)) this.active = id;
  }

  /** Apply a genome to every tracked character that has none (a "bind the cast"). */
  private applyRelated(characterId: string, genome: string): void {
    // a second species naming a character already changing is a later proposal;
    // nothing to do here beyond logging
    this.detector.push("apply", characterId, `bound ${genome.replace(/^genome\./, "")}`);
  }

  /** Serialize the whole cast + detection + coupling state to checksummed saves. */
  save(): SavePayload | null {
    if (this.cast.size === 0) return null;
    return { worldTick: this.cast.worldTick, chars: this.cast.saveAll(), detect: this.detector.toJSON(), coupling: this.triggers.toJSON() };
  }

  /** The serialized byte size of the current save (for the budget gate). */
  saveBytes(): number {
    const s = this.save();
    return s ? JSON.stringify(s).length : 0;
  }

  /** Restore a cast from a save payload (branch-local). */
  restore(payload: Partial<SavePayload>, roster: Array<{ id: string; name: string }>): boolean {
    let any = false;
    for (const [id, save] of Object.entries(payload.chars ?? {})) {
      const name = roster.find((r) => r.id === id)?.name ?? id;
      if (this.cast.attach(id, name, save)) any = true;
    }
    // the pace modifier rides the session save; adopt it, else re-apply the default
    for (const char of this.cast.entries()) {
      const found = currentPace(char.sim);
      if (found === "normal") applyPace(char.sim, this.pace);
      else this.pace = found;
    }
    this.cast.worldTick = Math.max(this.cast.worldTick, payload.worldTick ?? 0);
    if (payload.detect) {
      this.detector.loadJSON(payload.detect);
      // re-register names only (cards are re-scanned on load) so attribution works
      for (const c of this.cast.list()) this.detector.rename(c.id, [c.name]);
    }
    if (payload.coupling) this.triggers.loadJSON(payload.coupling, this.cast.entries());
    return any;
  }
}

/** Derive a stable seed from a chat id when the config has none (no wall clock). */
export function seedFrom(id: number, override?: number): number {
  if (override && override > 0) return override;
  return (((id * 2654435761) ^ 0x9e3779b9) >>> 0) || 20261028;
}
