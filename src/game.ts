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
import { createLunar, offsetForPhase } from "./sim/lunar";
import { days as daysToTicks, TICKS_PER_DAY } from "./sim/time";
import { createTriggerEngine, type TriggerEvent } from "./sim/triggers";
import { feel, DEFAULT_DOSE } from "./sim/subject";
import { GENITAL_OPTIONS, isGenitalPolicy, profileOf, applyNow as applyGenitalNow, type GenitalPolicy } from "./sim/genital";
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
  /** Suggested NPCs (named beside a species, not yet tracked). */
  candidates: Array<{ name: string; genome: string; family: string }>;
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
  /** Minutes banked toward the next whole hour (H17 groundwork). */
  pendingMinutes?: number;
  /** The lunar tick offset, so a reset moon survives a reload. */
  moonOffset?: number;
  /** Per-character superseded-species history (H14), so a revert survives a reload. */
  history?: Record<string, Array<{ genome: string; save: string; atTick: number }>>;
}

type TriggerEngine = ReturnType<typeof createTriggerEngine>;

/** Durable, chat-wide pane controls (H24) — persist via `messenger.updateChatState`. */
export interface ControlState {
  overrides: Array<[string, string | null]>;
  genital: Array<[string, GenitalPolicy]>;
  defaultGenital: GenitalPolicy;
  pace: PaceId;
  moonOffset: number;
  snapshots: Array<{ id: string; label: string; atTick: number; payload: SavePayload; roster: Array<{ id: string; name: string }> }>;
  seq: number;
}

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
    this.cast = new Cast(this.regs, this.data, seed, lunarConfig);
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

  /**
   * Set the moon to a named phase or an arbitrary 0..1 phase without moving the
   * day clock, by re-basing every Lunar's tick offset so all phase gates agree.
   */
  setMoon(target: "new" | "first_quarter" | "full" | "last_quarter" | number): void {
    const want = typeof target === "number" ? target
      : target === "new" ? 0
        : target === "first_quarter" ? 0.25
          : target === "full" ? 0.5
            : 0.75;
    const off = offsetForPhase(want, this.cast.worldTick, this.lunar.config.cycleDays);
    this.applyLunarOffset(off);
  }

  /** Nudge the moon by whole days (positive = later phase, wraps). */
  nudgeMoonDays(days: number): void {
    this.applyLunarOffset(this.lunar.offsetTicks + daysToTicks(days));
  }

  /** Apply a tick offset to every Lunar so game, triggers and sims stay in lockstep. */
  private applyLunarOffset(off: number): void {
    const cycleTicks = this.lunar.config.cycleDays * TICKS_PER_DAY;
    const normalized = ((off % cycleTicks) + cycleTicks) % cycleTicks;
    this.lunar.offsetTicks = normalized;
    this.triggers.setLunarOffset(normalized);
    for (const char of this.cast.entries()) char.sim.lunar.offsetTicks = normalized;
  }

  /** The moon's tick offset (persisted with the save). */
  moonOffset(): number {
    return this.lunar.offsetTicks;
  }

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
    if (char) { applyPace(char.sim, this.pace); char.sim.lunar.offsetTicks = this.lunar.offsetTicks; }
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

  /**
   * Force a genome on a tracked character (override; wins over detection). This is
   * a **replace**, not a stack: the body and genome list reset to baseline first, so
   * "human" truly clears a lycan and "werewolf" replaces an auto-bound "wolf". The
   * character keeps their identity, clock and mind.
   */
  override(id: string, genomeId: string | null, policy?: GenitalPolicy): boolean {
    if (genomeId !== null && !this.regs.genomes.get(genomeId)) return false;
    const char = this.cast.get(id);
    if (!char) return false;
    const use = policy ?? this.policyFor(id);
    const realized = char.sim.subject.mind?.realized ?? false;
    const awareness = char.sim.subject.mind?.awareness ?? 0;
    this.cast.reset(id);
    const fresh = this.cast.get(id);
    if (fresh) {
      // carry the interior read across the reset so a re-override does not erase
      // what she already knows about herself
      if (fresh.sim.subject.mind) { fresh.sim.subject.mind.realized = realized; fresh.sim.subject.mind.awareness = awareness; }
      applyPace(fresh.sim, this.pace);
      fresh.sim.lunar.offsetTicks = this.lunar.offsetTicks;
    }
    this.detector.setOverride(id, genomeId);
    // the coupling engine keys off subject.genomes; drop any state for genomes no
    // longer carried so a stale coupling cannot keep drawing a removed lycan
    this.triggers.prune(id, fresh ? fresh.sim.subject.genomes : []);
    if (genomeId) this.cast.bind(id, genomeId, 1.0, use);
    return true;
  }

  /** A character's chosen genital policy (preserve | replace | additive | swap). */
  policyFor(id: string): GenitalPolicy {
    return this.genitalPolicies.get(id) ?? this.defaultPolicy;  }

  /** Set a character's genital policy; applies to the live body at once. */
  setGenitalPolicy(id: string, policy: GenitalPolicy): void {
    if (!isGenitalPolicy(policy)) return;
    this.genitalPolicies.set(id, policy);
    const char = this.cast.get(id);
    const genome = char?.sim.subject.genomes[char.sim.subject.genomes.length - 1];
    if (char && genome) applyGenitalNow(char.sim.subject, this.regs.genomes.get(genome)!, this.regs.library, policy);
  }

  /** The default policy applied to a character with no explicit choice. */
  get defaultPolicy(): GenitalPolicy {
    return this.defaultGenitalPolicy;
  }

  /** Set the chat-wide default genital policy (from config). */
  setDefaultGenitalPolicy(policy: string): void {
    if (isGenitalPolicy(policy)) this.defaultGenitalPolicy = policy;
  }

  private genitalPolicies = new Map<string, GenitalPolicy>();
  private defaultGenitalPolicy: GenitalPolicy = "preserve";

  /** The offered genital policies, for the pane. */
  genitalOptions(): Array<{ id: GenitalPolicy; label: string; note: string }> {
    return GENITAL_OPTIONS;
  }

  /** A character's current genital profile (male | female | intersex | none). */
  genitalProfileOf(id: string): string {
    const char = this.cast.get(id);
    return char ? profileOf(char.sim.subject) : "none";
  }

  /** The species carried before the current one (for the pane), newest last. */
  speciesHistory(id: string): string[] {
    return this.cast.historyOf(id).map((h) => h.genome);
  }

  /**
   * Step back one species in the history (H14). A revert is manual, so it takes the
   * override so detection cannot immediately re-apply the new species.
   */
  revertSpecies(id: string): boolean {
    const prev = this.cast.revertSpecies(id);
    if (!prev) return false;
    this.detector.setOverride(id, prev);
    this.triggers.prune(id, [prev]);
    this.detector.push("apply", id, `reverted to ${prev.replace(/^genome\./, "")}`);
    return true;
  }

  /**
   * Apply the strongest pending proposal for a character (or a specific one). A
   * manual apply always supersedes — the player chose it, and the previous body is
   * kept in history so a revert is one click away.
   */
  applyProposal(proposalId: string, dose = DEFAULT_DOSE, supersede = true): boolean {
    const p = this.detector.proposals.find((q) => q.id === proposalId && q.status === "pending");
    if (!p) return false;
    if (!this.cast.bind(p.characterId, p.genome, dose, this.policyFor(p.characterId), supersede)) return false;
    this.detector.mark(p.id, "applied");
    this.applyRelated(p.characterId, p.genome, supersede);
    return true;
  }

  dismissProposal(proposalId: string): void {
    this.detector.mark(proposalId, "dismissed");
  }

  /** How sure an auto-applied proposal must be to supersede an in-progress body. */
  static readonly SUPERSEDE_CONFIDENCE = 0.65;

  /**
   * Bind any pending **evidenced** proposal for a character with no genome yet. If
   * the character is already changing, only a **sure** proposal supersedes it
   * automatically (a stray weak bind must not reset a cultivated change); anything
   * weaker waits for the player. The previous body is saved, so a supersede is
   * revertable either way.
   */
  autoApplyPending(dose = DEFAULT_DOSE): string[] {
    const applied: string[] = [];
    for (const p of [...this.detector.proposals]) {
      if (p.status !== "pending") continue;
      if (!p.evidence) continue;
      const char = this.cast.get(p.characterId);
      if (!char) continue;
      const changing = char.sim.subject.genomes.length > 0;
      if (changing && p.confidence < HelperGame.SUPERSEDE_CONFIDENCE) continue;
      if (this.applyProposal(p.id, dose)) applied.push(p.characterId);
    }
    return applied;
  }

  /** Observe a chat message (the bot's prose) for species + change signals. */
  observe(speakerId: string | null, text: string): void {
    this.detector.observe(speakerId, text, this.cast.worldTick);
  }

  /** Toggle chat evidence-gating for detection (config knob, H12). */
  setEvidenceOnly(on: boolean): void {
    this.detector.setEvidenceOnly(on);
  }

  /** Candidate NPCs the prose named beside a species, for the pane to offer. */
  candidates(): Array<{ name: string; genome: string; family: string }> {
    return this.detector.candidates.map((c) => ({ name: c.name, genome: c.genome, family: c.family }));
  }

  /**
   * Track a suggested NPC and bind the genome the prose implied. The id is derived
   * from the name, so it round-trips with the roster.
   */
  trackCandidate(name: string): string | null {
    const cand = this.detector.candidates.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cand) return null;
    const id = name.toLowerCase().replace(/\s+/g, "_");
    const tracked = this.track(id, name);
    if (tracked && cand.genome) this.cast.bind(id, cand.genome, DEFAULT_DOSE, this.policyFor(id));
    this.detector.forgetCandidate(name);
    return tracked;
  }

  /** Dismiss a suggested NPC without tracking. */
  dismissCandidate(name: string): void {
    this.detector.forgetCandidate(name);
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
  bestow(id: string, genomeId: string, dose = DEFAULT_DOSE, policy?: GenitalPolicy): boolean {
    return this.cast.bind(id, genomeId, dose, policy ?? this.policyFor(id));
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

  /**
   * Advance by **minutes** (D-292): the sim tick is one minute, so this is now the
   * native unit — `advance(1)` is a minute. Kept as a named seam so time-parse and
   * the 5-minute control read clearly. `advanceMinutes` and `advance` are the same
   * operation now; the minute bank only exists for display of sub-hour granularity.
   */
  advanceMinutes(minutes: number): void {
    if (minutes <= 0) return;
    const m = Math.round(minutes);
    this.pendingMinutes += m;
    this.advance(m);
  }

  /** Minutes elapsed since load, for the pane's running total (0..). */
  get partialMinutes(): number {
    return this.pendingMinutes;
  }
  private pendingMinutes = 0;

  // --- snapshots (manual save + rewind) ------------------------------------

  private snapshots: Array<{ id: string; label: string; atTick: number; payload: SavePayload; roster: Array<{ id: string; name: string }> }> = [];
  private snapshotSeq = 0;

  /** Record the full cast + world state as a named snapshot (manual save). */
  snapshot(label?: string): string {
    const payload = this.save();
    if (!payload) return "";
    const at = this.cast.worldTick;
    const id = `snap${++this.snapshotSeq}`;
    const name = label?.trim() || `day ${Math.floor(at / TICKS_PER_DAY) + 1}`;
    const roster = this.cast.list().map((c) => ({ id: c.id, name: c.name }));
    this.snapshots.push({ id, label: name, atTick: at, payload: JSON.parse(JSON.stringify(payload)), roster });
    return id;
  }

  /** The recorded snapshots, newest first (for the pane). */
  listSnapshots(): Array<{ id: string; label: string; atTick: number; day: number }> {
    return [...this.snapshots].reverse().map((s) => ({ id: s.id, label: s.label, atTick: s.atTick, day: Math.floor(s.atTick / TICKS_PER_DAY) + 1 }));
  }

  /** Rewind the live cast to a snapshot (keeps the snapshot list itself). */
  rewind(snapshotId: string): boolean {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return false;
    // clear the live cast, then restore the snapshot's state onto fresh entries
    for (const c of this.cast.list()) this.cast.remove(c.id);
    this.cast.worldTick = 0;
    this.restore(snap.payload, snap.roster);
    return true;
  }

  deleteSnapshot(snapshotId: string): void {
    this.snapshots = this.snapshots.filter((s) => s.id !== snapshotId);
  }

  snapshotCount(): number {
    return this.snapshots.length;
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
      candidates: this.candidates(),
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

  /**
   * Post-apply hook (H14). A genome applied to someone already carrying a different
   * species **supersedes** it (the body was saved to history in `cast.bind`); log
   * the swap so the journal shows the history, not a silent overwrite. A non-supersede
   * bind (weak evidence) is logged as an add.
   */
  private applyRelated(characterId: string, genome: string, superseded = true): void {
    const history = this.cast.historyOf(characterId);
    const prev = history[history.length - 1]?.genome;
    const label = genome.replace(/^genome\./, "");
    if (superseded && prev) this.detector.push("apply", characterId, `${prev.replace(/^genome\./, "")} → ${label} (superseded)`);
    else this.detector.push("apply", characterId, `bound ${label}`);
  }

  /** Serialize the whole cast + detection + coupling state to checksummed saves. */
  save(): SavePayload | null {
    if (this.cast.size === 0) return null;
    const history: SavePayload["history"] = {};
    for (const c of this.cast.list()) {
      const h = this.cast.historyOf(c.id);
      if (h.length > 0) history[c.id] = h;
    }
    return { worldTick: this.cast.worldTick, chars: this.cast.saveAll(), detect: this.detector.toJSON(), coupling: this.triggers.toJSON(), pendingMinutes: this.pendingMinutes, moonOffset: this.lunar.offsetTicks, history };
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
    this.pendingMinutes = Math.max(0, payload.pendingMinutes ?? 0);
    if (typeof payload.moonOffset === "number") this.applyLunarOffset(payload.moonOffset);
    if (payload.detect) {
      this.detector.loadJSON(payload.detect);
      // re-register names only (cards are re-scanned on load) so attribution works
      for (const c of this.cast.list()) this.detector.rename(c.id, [c.name]);
    }
    if (payload.coupling) this.triggers.loadJSON(payload.coupling, this.cast.entries());
    // superseded-species history, so a revert survives a reload
    for (const [id, entries] of Object.entries(payload.history ?? {})) this.cast.setHistory(id, entries);
    return any;
  }

  // --- durable control state (H24) -----------------------------------------
  //
  // The framework only persists on a message send; a pane action (override,
  // snapshot, moon, pace, genital policy) mutates memory and would be lost on a
  // reload. These controls are chat-wide and persist immediately via the Stage's
  // `messenger.updateChatState`, then re-applied here on load — BEFORE the card
  // scan, so a manual override beats an auto-bind ("busy as a bee" → wasp).

  /** The durable pane controls, for chat-wide persistence. */
  controlState(): ControlState {
    return {
      overrides: this.detector.allOverrides(),
      genital: [...this.genitalPolicies.entries()],
      defaultGenital: this.defaultGenitalPolicy,
      pace: this.pace,
      moonOffset: this.lunar.offsetTicks,
      snapshots: this.snapshots.map((s) => ({ id: s.id, label: s.label, atTick: s.atTick, payload: s.payload, roster: s.roster })),
      seq: this.snapshotSeq,
    };
  }

  /** Re-apply durable controls on load (overrides win over a later card scan). */
  applyControlState(state: ControlState | null | undefined): void {
    if (!state) return;
    if (state.pace) this.setPace(state.pace);
    if (typeof state.moonOffset === "number") this.applyLunarOffset(state.moonOffset);
    if (state.defaultGenital) this.defaultGenitalPolicy = state.defaultGenital;
    for (const [id, p] of state.genital ?? []) if (isGenitalPolicy(p)) this.genitalPolicies.set(id, p);
    // restore snapshots (their rosters may differ; names resolve against the live
    // cast). Union by id so a chat-state copy and a local mirror never duplicate.
    for (const s of state.snapshots ?? []) {
      if (this.snapshots.some((e) => e.id === s.id)) continue;
      this.snapshots.push({ id: s.id, label: s.label, atTick: s.atTick, payload: s.payload, roster: s.roster });
    }
    // overrides: record the flag, and re-bind only when the body does not already
    // match — so a reload that already restored the saved body keeps its progress,
    // and a second applyControlState (chat state then mirror) is a no-op.
    for (const [id, genome] of state.overrides ?? []) {
      const char = this.cast.get(id);
      if (!char) continue;
      this.detector.setOverrideSilent(id, genome);
      const current = char.sim.subject.genomes[char.sim.subject.genomes.length - 1] ?? null;
      const want = genome ?? null;
      if (current === want) continue;
      this.cast.reset(id);
      if (genome) this.cast.bind(id, genome, 1.0, this.policyFor(id));
    }
    this.snapshotSeq = Math.max(this.snapshotSeq, state.seq ?? 0);
  }
}

/** Derive a stable seed from a chat id when the config has none (no wall clock). */
export function seedFrom(id: number, override?: number): number {
  if (override && override > 0) return override;
  return (((id * 2654435761) ^ 0x9e3779b9) >>> 0) || 20261028;
}
