import { createRng, type Rng } from "./rng";
import { TICKS_PER_HOUR } from "./time";
import { ask } from "./hooks";
import { TraceRing } from "./trace";
import { Journal } from "./journal";
import { IncubationScheduler } from "./incubation";
import { ResearchLog } from "./research";
import { WorldState } from "./world";
import { EventBus, type EventRegistry } from "./events";
import { emptyTrainingBlock, type TrainingBlock } from "./training";
import { emptyPlayBlock, type PlayBlock } from "./play";
import { createTemporalState, type GrowthModifier } from "./temporal";
import { LinePool } from "./pool";
import { Timeline } from "./timeline";
import type { MindRegistry } from "./mind";
import { createSexState, type SexState } from "./sex";
import { createInspectState, type InspectState } from "./inspect";
import type { Resolver } from "./resolver";
import type { Subject } from "./subject";
import type { Observer } from "./observer";

/**
 * The Session (blueprint §3.5). Divergence D-106: the reference's `player` +
 * `day`/`slotsRemaining` become `observer` + a **clock**. Session owns the live
 * game state and the event bus so no caller forgets to recompute or advance.
 */

export const EVENT_CAPACITY = 500;

/** Event types that invalidate derived state (blueprint §3.5). */
export const EVENT_DIRTY_TYPES = Object.freeze([  "attribute.applied",
  "attribute.progressed",
  "stage.crossed",
  "attribute.reverted",
  "attribute.settled",
  "power.resolved",
  "genital.changed",
  "reaction.awakened",
  "preference.changed",
  "body.modified",
]);

/** Events that may draw an authored thought or spoken reaction (Wave 3, D-198). */
export const INNER_TRIGGERS = Object.freeze([
  "stage.crossed", "power.applied", "realization", "sex.overload",
  "preference.changed", "resistance.raised", "ability.granted", "mood.shift", "inspect",
]);

export type { EventRecord as SessionEvent } from "./events";
export { EventBus } from "./events";

export interface Clock {
  tick: number;
  day: number;
  speed: number | "pause";
}

export interface SessionOptions {
  subject: Subject;
  observer: Observer;
  saveSeed?: number;
  registries?: Record<string, unknown>;
  events?: EventRegistry | null;
  journalCapacity?: number;
  traceCapacity?: number;
}

export interface FlagRegistryLike {
  get(id: string): { lifetime?: string } | null;
}

export class Session {
  readonly subject: Subject;
  readonly observer: Observer;
  rng: Rng;
  readonly registries: Record<string, unknown>;
  readonly trace: TraceRing;
  readonly incubation: IncubationScheduler;
  readonly journal: Journal;
  research: ResearchLog;
  readonly bus: EventBus;
  readonly clock: Clock;
  /** The growth resolver, set once the session has content registries. Powers
   *  *schedule* growth; the clock *lands* it (D-123). */
  resolver: Resolver | null = null;
  /** World overlay for `sway` (D-130): content is immutable, powers write here. */
  readonly world: WorldState = new WorldState();
  /** Tick until which growth is frozen (a `hold` power). */
  growthHoldUntil = 0;
  /** Reveal state set by `reveal` powers, cleared on the next power. */
  reveal: { mode: string; part: string | null } | null = null;
  /** The location of the scene the Observer is currently watching (for `sway`). */
  currentLocation: string | null = null;
  /** Per-power cooldown expiry, keyed by power id. */
  readonly cooldowns: Map<string, number> = new Map();
  /** Unlocked power ids; empty means "the tier-1 default set". */
  readonly unlockedPowers: Set<string> = new Set();
  /** The current training block (§15) and play scene (§48.5). */
  training: TrainingBlock = emptyTrainingBlock();
  play: PlayBlock = emptyPlayBlock();
  /** The ability she is currently practising, if any (self-driven, §48.5). */
  practising: string | null = null;
  /** The Observer's standing nudge (S44): steer what she practises and how hard. */
  nudge: { abilityId?: string | null; stanceId?: string | null; untilTick?: number } | null = null;
  /** Temporal power state (§27): growth-rate modifiers, phase shifts. */
  readonly temporal: { growth: number; modifiers: GrowthModifier[] } = createTemporalState();
  /** Per-scene beat cursor (M14.10): how far into the current scene's arc we are. */
  readonly beatIndex: Map<string, number> = new Map();
  /** Recent spoken lines, for a variety ring (M15). */
  recentLines: string[] = [];
  /** The narration line pool (M15, §37); survives a version bump. */
  readonly pool: LinePool = new LinePool();
  /** The canonical timeline (S67, D-170): the one ordered walk the surface reads. */
  readonly timeline: Timeline = new Timeline();
  /** The mind modifier registry (M15.5a): every input that may move the mind registers here. */
  mindRegistry: MindRegistry | null = null;
  /** The inner-life reactor (Wave 3): called on a trigger event to emit a thought/speech. */
  reactor: ((session: Session, trigger: string) => void) | null = null;
  /** The composer's prose pools (D-218), set by the bridge. */
  prose: import("./prose").ProseLibrary | null = null;
  /** The town (M16a), set by the bridge; the subject is a full agent. */
  town: import("./town").Town | null = null;
  /** Follow mode (M16c): the townsperson whose day the surface is watching, if any. */
  follow: string | null = null;
  /** Last location the subject was seen at, so a move can emit `town.moved` (R10). */
  lastSubjectAt: string | null = null;
  /** The obligations registry (M16a), set by the bridge. */
  obligations: import("./obligations").ObligationRegistry | null = null;
  /** Social reactions to visible change (M16b), set by the bridge. */
  social: import("./social").SocialCatalog | null = null;
  /** Town events (M16b), set by the bridge; resolves even when the subject is absent. */
  townEvents: import("./town_events").TownEvents | null = null;
  /** Second-order consequences (M16b, S11), set by the bridge. */
  consequences: import("./consequences").ConsequenceRegistry | null = null;
  /** Consequence ids already fired (single-fire). */
  readonly consequencesFired: Set<string> = new Set();
  /** Location id -> display name, for the town map (M16a). */
  locationNames: Map<string, string> = new Map();
  /** Sex state (M15.5f): held-arousal tracking, refractory, session counts. */
  sex: SexState = createSexState();
  /** Inspect state (D-199): cooldown + a count for the log. */
  inspectState: InspectState = createInspectState();
  /** The sex action catalog (M15.5f), set by the bridge. */
  sexCatalog: import("./sex_actions").SexCatalog | null = null;
  /** Presentation data (S77): tone likelihood + filter detail. */
  presentation: import("./presentation").PresentationData | null = null;
  /** The reaction definition catalog (R3/R4), set by the bridge. */
  reactionCatalog: import("./registries").ReactionCatalog | null = null;
  /** Hook registry (S78): bounded value points. */
  hooks: import("./hooks").HookRegistry | null = null;

  /** Ask a hook point (S78) against the subject's present hooks; combined + clamped. */
  hookValue(point: string): import("./hooks").HookResult | null {
    if (!this.hooks) return null;
    const seen = new Set<string>();
    const collected: import("./hooks").Hook[] = [];
    for (const inst of this.subject.body.allInstances()) {
      for (const entry of inst.attributes) {
        const def = this.subject.attributeRegistry?.get(entry.id);
        if (!def?.hook || seen.has(entry.id)) continue;
        seen.add(entry.id);
        collected.push({ ...def.hook, source: `attr:${entry.id}` });
      }
    }
    for (const g of this.subject.genomes) {
      const def = this.subject.genomesRegistry?.get(g);
      for (const h of (def as { hooks?: import("./hooks").Hook[] } | undefined)?.hooks ?? []) collected.push({ ...h, source: `genome:${g}` });
    }
    return ask(this.hooks, point, collected, this.conditionContext() as never);
  }
  /** The criteria groups (M15.5c), set by the bridge. */
  criteria: import("./criteria").CriterionGroup[] = [];
  readonly flags: Set<string>;
  settings: { locale: string; reduceMotion: boolean; textScale: number; colourBlindBands: boolean; touchBoost: boolean; dyslexiaFont: boolean; heightUnit: "metric" | "imperial"; llmMode: "off" | "fill_holes" | "priority"; tone: import("./presentation").TonePreset; filter: import("./presentation").FilterLevel };
  progression: { discoveredGenomes: string[]; essences: string[]; ingredients: string[] };
  derivedDirty: boolean;
  /** Whether narration generation (LLM or template) is enabled this session. */
  narrationProvider: unknown = null;
  /** The story-log floor/throttle config (from `data/events.json`). */
  readonly events: EventRegistry | null;

  constructor(opts: SessionOptions) {
    this.subject = opts.subject;
    this.observer = opts.observer;
    this.rng = createRng(opts.saveSeed ?? 20261024);
    this.registries = opts.registries ?? {};
    this.trace = new TraceRing(opts.traceCapacity);
    this.incubation = new IncubationScheduler();
    this.journal = new Journal();
    this.research = new ResearchLog();
    this.events = opts.events ?? null;
    this.clock = { tick: 0, day: 1, speed: 1 };
    this.bus = new EventBus(this.events, { tick: () => this.clock.tick });
    this.flags = new Set();
    this.settings = { locale: "en", reduceMotion: false, textScale: 100, colourBlindBands: false, touchBoost: false, dyslexiaFont: false, heightUnit: "metric", llmMode: "fill_holes", tone: "standard", filter: "full" };
    this.progression = { discoveredGenomes: [], essences: [], ingredients: [] };
    this.derivedDirty = true;
    this._wireSubscribers();
  }

  private _wireSubscribers(): void {
    for (const event of EVENT_DIRTY_TYPES) {
      this.bus.on(event, () => this.markDirty());
    }
    // mirror events into the canonical timeline as chips (S67, D-215). A skip must
    // account for every *meaningful* entry, so below-floor events are kept too — but
    // the firehoses are skipped and repeats within a day are deduped so a re-dose
    // does not flood the day.
    const MIRROR_SKIP = new Set(["world.tick", "observer.skill", "attribute.progressed"]);
    const seenToday = new Set<string>();
    let seenDay = -1;
    this.bus.eventSink = (line) => {
      if (MIRROR_SKIP.has(line.type)) return;
      if (line.day !== seenDay) { seenDay = line.day; seenToday.clear(); }
      const key = `${line.type}:${line.path}`;
      if (seenToday.has(key)) return;
      seenToday.add(key);
      const text = line.text || String(line.pay?.message ?? "");
      if (!text) return;
      this.timeline.event(line.type, text, { tick: line.tick, day: line.day, sal: line.sal, ...(line.pay ? { pay: line.pay } : {}) });
    };
    // her inner life (Wave 3): a trigger may draw a thought or a spoken reaction
    for (const trigger of INNER_TRIGGERS) {
      this.bus.on(trigger, () => this.reactor?.(this, trigger));
    }
  }

  markDirty(): void {
    this.derivedDirty = true;
  }

  get derived(): Subject["derived"] {
    return this.subject.derived;
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  setFlag(flag: string): Set<string> {
    this.flags.add(flag);
    return this.flags;
  }

  clearFlag(flag: string): Set<string> {
    this.flags.delete(flag);
    return this.flags;
  }

  refresh(): Subject["derived"] {
    // always recompute: a raw body mutation (addAttribute) sets no dirty flag, and
    // the single subject's derived is cheap, so staleness is never worth the risk.
    this.subject.recomputeDerived();
    this.derivedDirty = false;
    return this.subject.derived;
  }

  /** A clean boundary where an autosave may fire: block change, hub return, sleep. */
  atBoundary(): boolean {
    // a town block (TICKS_PER_BLOCK hours) is the coarse boundary (D-292)
    return this.clock.tick % (4 * TICKS_PER_HOUR) === 0;
  }

  /** Context for the scene condition DSL. */
  conditionContext(): Record<string, unknown> {
    return {
      stats: this.subject.stats,
      charge: this.observer.charge,
      exposure: this.subject.derived.exposure ?? 0,
      day: this.clock.day,
      flags: this.flags,
      genitalProfile: this.subject.derived.genitalProfile,
      partTags: this.subject.body.allInstances().flatMap((i) => i.tags),
      isFeral: this.subject.derived.band === "band.feral_lock",
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      saveSeed: this.rng.seed,
      rng: this.rng.toJSON(),
      clock: { ...this.clock },
      flags: [...this.flags],
      subject: this.subject.toJSON(),
      observer: this.observer.toJSON(),
      journal: this.journal.toJSON(),
      research: this.research.toJSON(),
      settings: { ...this.settings },
      progression: { ...this.progression },
      world: this.world.toJSON(),
      cooldowns: [...this.cooldowns.entries()],
      growthHoldUntil: this.growthHoldUntil,
      reveal: this.reveal,
      currentLocation: this.currentLocation,
      story: this.bus.toJSON(),
      training: { ...this.training, sessions: { ...this.training.sessions } },
      play: { ...this.play },
      practising: this.practising,
      nudge: this.nudge ? { ...this.nudge } : null,
      temporal: { growth: this.temporal.growth, modifiers: this.temporal.modifiers.map((m) => ({ ...m })) },
      beatIndex: [...this.beatIndex.entries()],
      recentLines: [...this.recentLines],
      linePool: this.pool.toJSON(),
      timeline: this.timeline.toJSON(),
      sex: { ...this.sex, sessionCount: { ...this.sex.sessionCount } },
      inspect: { ...this.inspectState, last: this.inspectState.last ? { ...this.inspectState.last } : null },
      ...(this.town ? { town: this.town.toJSON() } : {}),
      ...(this.townEvents ? { townEvents: this.townEvents.toJSON() } : {}),
      consequencesFired: [...this.consequencesFired],
    };
  }
}

export function createSession(opts: SessionOptions): Session {
  return new Session(opts);
}

export const SAVE_SEED_FALLBACK = 20261024;
