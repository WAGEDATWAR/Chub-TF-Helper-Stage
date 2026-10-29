import { StageBase, type InitialData, type Message, type StageResponse } from "@chub-ai/stages-ts";
import type { ReactElement } from "react";
import { HelperGame, seedFrom } from "../game";
import type { ChatStateType, ConfigType, InitStateType, MessageStateType } from "./types";
import { Pane, type VisualState } from "./Pane";
import { directions as buildDirections, guardMessage, instrumentRead, type DriveInput } from "../drive/drive";
import { visualBundle } from "../view/visualize";
import { inferPace, type PaceId } from "../sim/pace";

/**
 * The thin framework adapter. All loop logic lives in the library-free
 * `HelperGame`. H4: `beforePrompt` injects a per-character facts floor; the bot's
 * prose is guarded against it and a hard drift falls back to the composed floor.
 */
export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  readonly game: HelperGame;
  private ticksPerMessage: number;
  private statusMessage: boolean;
  private guardProse: boolean;
  private direction = "";
  private cards = new Map<string, { names: string[]; text: string; baseGender?: string }>();
  /** Objects/ambient present in the current scene, for the guard's haystack. */
  private sceneObjects: string[] = [];
  private sceneAmbient = "";

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.game = new HelperGame(seedFrom((data as { id?: number }).id ?? 0, data.config?.seed), { cycleDays: data.config?.lunarCycleDays });
    this.ticksPerMessage = data.config?.ticksPerMessage && data.config.ticksPerMessage > 0 ? data.config.ticksPerMessage : 4;
    this.statusMessage = data.config?.statusMessage !== false;
    this.guardProse = data.config?.guardProse !== false;

    // the roster is chat-wide; restore branch saves against it. If the chat state
    // is missing (a reload where it did not persist), fall back to names from the
    // cards/users by id, so a restore never shows a raw id in place of a name.
    const roster = data.chatState?.cast ?? [];
    const knownNames = new Map<string, string>();
    for (const [id, ch] of Object.entries(data.characters ?? {})) if (ch.name?.trim()) knownNames.set(id, ch.name.trim());
    for (const [id, u] of Object.entries(data.users ?? {})) if (u.name?.trim()) knownNames.set(id, u.name.trim());
    const namedRoster = roster.length > 0
      ? roster
      : [...knownNames].map(([id, name]) => ({ id, name }));
    const save = (data.messageState as MessageStateType | null)?.save;
    if (save) this.game.restore(save, namedRoster);
    else for (const r of namedRoster) this.game.track(r.id, r.name);
    // re-apply chat-wide playstyle choices (a swipe keeps them)
    for (const [id, byGenome] of Object.entries(data.chatState?.playstyles ?? {})) {
      for (const [genome, style] of Object.entries(byGenome)) this.game.setPlaystyle(id, genome, style);
    }

    // scan every character card for a species (attributed to that character)
    const seen = new Set<string>();
    for (const [id, ch] of Object.entries(data.characters ?? {})) {
      const name = ch.name?.trim();
      const key = name?.toLowerCase();
      if (key && seen.has(key)) continue; // a user persona with the same name
      if (key) seen.add(key);
      const text = [ch.name, ch.description, ch.personality, ch.scenario].filter(Boolean).join("\n");
      const names = [ch.name].filter(Boolean);
      this.cards.set(id, { names, text });
      const gender = guessGender(ch.description, ch.personality);
      // a restored entry can carry the raw id as its name when the chat roster did
      // not persist; the card is the source of truth, so fix the display name too
      if (key && this.game.cast.get(id)) this.game.cast.rename(id, ch.name.trim());
      this.game.knowCard({ id, names, text, baseGender: gender });
    }
    // the player is trackable too, from the first user's persona (skip duplicates)
    for (const [id, u] of Object.entries(data.users ?? {})) {
      const name = u.name?.trim();
      const key = name?.toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const names = [u.name].filter(Boolean);
      this.cards.set(id, { names, text: u.chatProfile ?? "" });
      if (names.length > 0) this.game.knowCard({ id, names, text: u.chatProfile ?? "", baseGender: guessGender(u.chatProfile) });
    }
    // only a placeholder when the chat gave us nothing to name
    if (this.game.tracked === 0) this.game.track("subject", "Subject");

    // pace: config wins; else infer from the cards' own pacing instructions
    const configPace = data.config?.transformationPace as PaceId | undefined;
    if (configPace) this.game.setPace(configPace);
    else {
      const inferred = inferPace(...[...this.cards.values()].map((c) => c.text));
      if (inferred !== "normal") this.game.setPace(inferred);
    }
  }

  async load(): Promise<Partial<{ success: boolean; error: string | null; initState: InitStateType | null }>> {
    return { success: true, error: null, initState: { seed: this.game.seed } };
  }

  async setState(state: MessageStateType): Promise<void> {
    if (state.save) this.game.restore(state.save, this.roster());
  }

  async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    // observe whatever the player just said (attributed to their persona if known)
    this.game.observe(userMessage.anonymizedId ?? null, userMessage.content ?? "");
    // bind anyone whose card clearly named a species and who has no genome yet
    this.game.autoApplyPending(1.0);
    this.game.advance(this.ticksPerMessage);
    this.direction = buildDirections(this.driveInput());
    return { stageDirections: this.direction, messageState: this.branchState(), chatState: this.chatState() };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const text = botMessage.content ?? "";
    // observe the bot's prose for species naming and change signals
    this.game.observe(null, text);
    // the classifier is an optional second opinion: only when the heuristic is
    // ambiguous (new prose, no proposal yet) and never blocking the response
    if (this.canClassify && text.length > 40 && this.game.view().proposals.length === 0) {
      this.classifyInBackground(text);
    }
    // The status is a system message: Chub appends it after the bot's message, so
    // the prose is never touched. The guard only replaces the prose on a real
    // contradiction (and only when enabled).
    let modified: string | null = null;
    if (this.guardProse) {
      const guarded = guardMessage(text, this.driveInput(), { max_words: 200 });
      this.lastGuard = guarded.failures;
      if (!guarded.ok && guarded.line.trim() !== text.trim()) modified = guarded.line;
    } else {
      this.lastGuard = [];
    }
    return {
      modifiedMessage: modified,
      systemMessage: this.statusMessage ? instrumentRead(this.driveInput()) : null,
      messageState: this.branchState(),
      chatState: this.chatState(),
    };
  }

  /** Failures from the last guard pass (dev readout). */
  lastGuard: string[] = [];

  /** The current facts for the driving layer. */
  private driveInput(): DriveInput {
    const view = this.game.view();
    return {
      frames: view.frames,
      coupling: view.coupling.map((c) => ({ characterId: c.characterId, kind: c.kind, pressure: c.pressure, cues: c.cues, shifted: c.shifted })),
      moon: view.moon,
      objects: this.sceneObjects,
      ambient: this.sceneAmbient,
    };
  }

  private canClassify = true;

  /** Fire the classifier without awaiting; a reply only adds proposals. */
  private classifyInBackground(text: string): void {
    try {
      const prompt = this.game.classifyPrompt(text);
      void Promise.resolve(this.generator.textGen({ prompt, max_tokens: 80, stop: ["---"], include_history: false }))
        .then((res) => {
          if (res?.result) this.game.applyClassifierReply(res.result);
        })
        .catch(() => { this.canClassify = false; });
    } catch {
      this.canClassify = false;
    }
  }

  private roster(): Array<{ id: string; name: string }> {
    return this.game.cast.list().map((c) => ({ id: c.id, name: c.name }));
  }

  private chatState(): ChatStateType {
    const playstyles: Record<string, Record<string, string>> = {};
    for (const c of this.game.cast.list()) {
      const style = this.game.triggers.playstyleFor(c.id);
      if (style) playstyles[c.id] = { [this.couplingGenome(c.id) ?? ""]: style };
    }
    return { cast: this.roster(), playstyles };
  }

  private couplingGenome(characterId: string): string | null {
    const char = this.game.cast.get(characterId);
    if (!char) return null;
    for (const g of char.sim.subject.genomes) if (this.game.triggers.profileFor(g)) return g;
    return null;
  }

  /** The last serialized branch-save size in bytes (dev budget readout). */
  lastSaveBytes = 0;

  /** H8: rendered images per character, keyed by id (never authoritative). */
  private visuals = new Map<string, VisualState>();

  /** The current visual state for a character (for the pane). */
  visualFor(id: string): VisualState | undefined {
    return this.visuals.get(id);
  }

  /** Drop a character's rendered image (the pane's remove button). */
  clearVisual(id: string): void {
    this.visuals.delete(id);
  }

  /**
   * Render a character's current body as an image (H8). Non-blocking: sets a
   * pending state, fires `makeImage`, and swaps in the result or an error. A
   * `seed` re-rolls; otherwise the frame's own key dedupes repeated requests.
   */
  async visualize(id: string, seed?: number): Promise<void> {
    const frame = this.game.view().frames.find((f) => f.id === id);
    if (!frame) return;
    const bundle = visualBundle(frame, this.game.view().moon, { ambient: this.sceneAmbient, objects: this.sceneObjects }, { seed });
    const prev = this.visuals.get(id);
    // already pending for the same key with no reroll → no-op
    if (prev?.pending && prev.key === bundle.key && seed === undefined) return;
    this.visuals.set(id, { url: prev?.key === bundle.key ? prev.url : "", prompt: bundle.prompt, pending: true, error: null, key: bundle.key });
    try {
      const res = await this.generator.makeImage({ prompt: bundle.prompt, negative_prompt: bundle.negative, item_id: bundle.key, seed: seed ?? null });
      this.visuals.set(id, res?.url
        ? { url: res.url, prompt: bundle.prompt, pending: false, error: null, key: bundle.key }
        : { url: "", prompt: bundle.prompt, pending: false, error: "no image returned", key: bundle.key });
    } catch (err) {
      this.visuals.set(id, { url: "", prompt: bundle.prompt, pending: false, error: (err as Error).message, key: bundle.key });
    }
  }

  private branchState(): MessageStateType {
    const save = this.game.save();
    this.lastSaveBytes = save ? JSON.stringify(save).length : 0;
    return { save, day: this.game.view().day };
  }

  render(): ReactElement {
    return (
      <Pane
        game={this.game}
        getGuard={() => this.lastGuard}
        getSaveKb={() => Math.round(this.lastSaveBytes / 1024)}
        getVisual={(id) => this.visuals.get(id)}
        onVisualize={(id, seed) => { void this.visualize(id, seed); }}
        onClearVisual={(id) => this.clearVisual(id)}
      />
    );
  }
}

/** A weak gender guess from card prose (the card has no gender field). */
function guessGender(...texts: Array<string | undefined>): string {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\b(she|her|hers|woman|female|girl)\b/.test(text) && !/\b(he|him|his|man|male|boy)\b/.test(text)) return "female";
  if (/\b(he|him|his|man|male|boy)\b/.test(text) && !/\b(she|her|hers|woman|female|girl)\b/.test(text)) return "male";
  return "female";
}
