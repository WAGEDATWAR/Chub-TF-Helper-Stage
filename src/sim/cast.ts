/**
 * The Cast (H1): up to MAX_CAST tracked characters sharing one world clock. Each
 * character is its own `Subject`+`Session` (the parent's subject model is
 * single-instance, so a cast is N of them), but all advance together and a
 * character that joins later is caught up to the world tick — so every clock
 * reads the same time and "simultaneous" is real.
 *
 * The cast owns no rendering; `frames()` returns per-character reads and the pane
 * renders them.
 */
import { startSubject, bestow, buildComposer, saveSim, DEFAULT_DOSE, type Sim } from "./subject";
import { runDailyMind } from "./mind";
import type { Registries } from "./registries";
import { TimeEngine } from "@core/time_engine";
import { loadSession } from "@core/savegame";
import { createLunar } from "./lunar";
import type { Subject } from "@core/subject";

export const MAX_CAST = 6;

export interface TrackedCharacter {
  id: string;
  name: string;
  baseGender: string;
  sim: Sim;
}

export interface CastFrame {
  id: string;
  name: string;
  genome: string | null;
  exposure: number;
  band: string;
  statusLine: string;
  describe: string;
  day: number;
  /** Changing part labels, most-progressed first (a compact read). */
  changing: string[];
  /** Every affected part, grouped by attribute, with its progression toward target (0..100). */
  parts: Array<{ label: string; pct: number; count: number }>;
  /** H10: awareness 0..100 toward realizing the change. */
  awareness: number;
  /** H10: true once the character has realized what is happening to them. */
  realized: boolean;
  /** H11: the interior read — awareness tier, mood, and her strongest mind values. */
  interior: InteriorRead;
}

export interface InteriorRead {
  /** Awareness tier id ("blind" | "dim" | "aware" | "lucid"). */
  tier: string;
  /** Mood gamut: valence and arousal (-1..1 / 0..1 style), plus a band label. */
  mood: { valence: number; arousal: number; band: string } | null;
  /** The emotions she feels most strongly right now (name + 0..100), top few. */
  feelings: Array<{ emotion: string; value: number }>;
  /** Her most-characterful mind values, as label pairs (e.g. "nervous 72"). */
  traits: Array<{ id: string; label: string; value: number }>;
}

const STATUS: Record<string, string> = {
  "band.baseline": "unchanged",
  "band.cosmetic": "a first shimmer of change",
  "band.light_hybrid": "visibly between",
  "band.heavy_hybrid": "more animal than not",
  "band.near_animal": "nearly beast",
  "band.feral_lock": "consumed",
};

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class Cast {
  private readonly regs: Registries;
  private readonly baseSeed: number;
  private readonly composer: ReturnType<typeof buildComposer>;
  private readonly lunar?: { cycleDays?: number };
  private readonly chars = new Map<string, TrackedCharacter>();
  /** The shared world tick every character's clock is kept at. */
  worldTick = 0;

  constructor(regs: Registries, data: Record<string, unknown>, seed: number, lunar?: { cycleDays?: number }) {
    this.regs = regs;
    this.baseSeed = seed;
    this.lunar = lunar;
    this.composer = buildComposer(regs, data);
  }

  get size(): number {
    return this.chars.size;
  }

  get full(): boolean {
    return this.chars.size >= MAX_CAST;
  }

  list(): TrackedCharacter[] {
    return [...this.chars.values()];
  }

  /** id + sim pairs, for engines (coupling, triggers) that step every character. */
  entries(): Array<{ id: string; sim: Sim }> {
    return [...this.chars.values()].map((c) => ({ id: c.id, sim: c.sim }));
  }

  get(id: string): TrackedCharacter | null {
    return this.chars.get(id) ?? null;
  }

  /** Track a new character, caught up to the current world tick. Returns null if full. */
  add(id: string, name: string, baseGender = "female"): TrackedCharacter | null {
    if (this.chars.has(id) || this.full) return null;
    const seed = (this.baseSeed ^ hashString(id)) >>> 0;
    const sim = startSubject({ name, seed, baseGender, regs: this.regs, lunar: this.lunar });
    const char: TrackedCharacter = { id, name, baseGender, sim };
    this.chars.set(id, char);
    if (this.worldTick > 0) sim.engine.advance(this.worldTick);
    return char;
  }

  /** Restore a character from a save string at the current world tick. */
  attach(id: string, name: string, save: string, baseGender = "female"): TrackedCharacter | null {
    if (this.chars.has(id) || this.full) return null;
    const char = this.add(id, name, baseGender);
    if (!char) return null;
    char.sim = restoreSim(save, this.regs, this.lunar) ?? char.sim;
    // the restored clock is authoritative; adopt its tick as the world tick floor
    if (char.sim.session.clock.tick > this.worldTick) this.worldTick = char.sim.session.clock.tick;
    return char;
  }

  remove(id: string): boolean {
    return this.chars.delete(id);
  }

  /**
   * Rebuild a character from a fresh baseline at the current world tick, keeping
   * their id/name/gender/seed. Used by an override so "set to human" truly clears
   * the body and genome list, and "set to X" starts clean rather than stacking X
   * onto whatever they already carried.
   */
  reset(id: string): TrackedCharacter | null {
    const char = this.chars.get(id);
    if (!char) return null;
    const seed = (this.baseSeed ^ hashString(id)) >>> 0;
    const sim = startSubject({ name: char.name, seed, baseGender: char.baseGender, regs: this.regs, lunar: this.lunar });
    char.sim = sim;
    if (this.worldTick > 0) sim.engine.advance(this.worldTick);
    return char;
  }

  /** Rename a tracked character (their card name may be revealed later). */
  rename(id: string, name: string): void {
    const char = this.chars.get(id);
    if (char) { char.name = name; char.sim.subject.displayName = name; }
  }

  /** Apply a genome to a tracked character (forced/narrative trigger). */
  bind(id: string, genomeId: string, dose = DEFAULT_DOSE): boolean {
    const char = this.chars.get(id);
    if (!char || !this.regs.genomes.get(genomeId)) return false;
    bestow(char.sim, genomeId, dose);
    return true;
  }

  /** Advance the whole cast by `ticks`, keeping every clock in lockstep. */
  advance(ticks: number): void {
    if (ticks <= 0) return;
    for (const char of this.chars.values()) {
      const before = char.sim.session.clock.day;
      char.sim.engine.advance(ticks);
      const after = char.sim.session.clock.day;
      // one identity step per day crossed, so realization/awareness progress
      for (let d = before; d < after; d++) runDailyMind(char.sim);
    }
    this.worldTick += ticks;
  }

  /** Per-character reads, in insertion order. */
  frames(): CastFrame[] {
    const out: CastFrame[] = [];
    for (const char of this.chars.values()) {
      const s = char.sim.subject;
      const band = s.derived.band ?? "band.baseline";
      const changes = s.body
        .allInstances()
        .flatMap((i) => i.attributes.filter((a) => a.progress > 0).map((a) => ({ slot: i.slot, id: a.id, p: a.progress, t: a.target_progress ?? 1000 })))
        .sort((a, b) => b.p - a.p);
      const changing = changes.slice(0, 6).map((a) => `${a.slot}: ${humanize(a.id)}`);
      // affected parts only, grouped by attribute (so "fur" covers the whole body
      // as one line), most-progressed first, each with its % toward target
      const byPart = new Map<string, { label: string; pct: number; count: number }>();
      for (const a of changes) {
        const pct = Math.max(0, Math.min(100, Math.round((a.p / Math.max(1, a.t)) * 100)));
        const label = humanize(a.id);
        const cur = byPart.get(label);
        if (cur) { cur.count += 1; if (pct > cur.pct) cur.pct = pct; }
        else byPart.set(label, { label, pct, count: 1 });
      }
      const parts = [...byPart.values()].sort((a, b) => b.pct - a.pct || b.count - a.count);
      out.push({
        id: char.id,
        name: char.name,
        genome: s.genomes[s.genomes.length - 1] ?? null,
        exposure: Math.round(s.derived.exposure ?? 0),
        band,
        statusLine: STATUS[band] ?? "changing",
        describe: this.composer.describeBody(s as never),
        day: char.sim.session.clock.day,
        changing,
        parts,
        awareness: Math.round(s.mind?.awareness ?? 0),
        realized: s.mind?.realized ?? false,
        interior: interiorOf(s),
      });
    }
    return out;
  }

  /** Serialize every character to a checksummed save, keyed by id. */
  saveAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, char] of this.chars) out[id] = saveSim(char.sim);
    return out;
  }
}

function humanize(id: string): string {
  return id.replace(/^(attr|part|genome|react)\./, "").replace(/_/g, " ").trim();
}

/**
 * The interior read (H11): her awareness tier, mood, strongest feelings and most
 * characteristic mind values. Pure over the subject; the pane shows it and the
 * driving floor may name it (from *her* POV, never the Observer's).
 */
function interiorOf(s: Subject): InteriorRead {
  const mind = s.mind as (Subject["mind"] & { labels?: Map<string, string> }) | null;
  if (!mind) return { tier: "blind", mood: null, feelings: [], traits: [] };
  const tier = mind.tier();
  const feelings = mindEmotions(s)
    .map((e) => ({ emotion: e, value: Math.round(s.mood?.get(e) ?? 0) }))
    .filter((x) => x.value >= 25)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  // the mind values furthest from a bland 50 — the ones that characterise her now
  const traits = mind
    .ids()
    .map((id) => ({ id, label: mind.labels?.get(id) ?? id, value: Math.round(mind.read(id)) }))
    .sort((a, b) => Math.abs(b.value - 50) - Math.abs(a.value - 50))
    .slice(0, 3);
  const p = s.mood?.point();
  const mood = s.mood && p ? { valence: Math.round(p.valence), arousal: Math.round(p.arousal), band: s.mood.band() } : null;
  return { tier, mood, feelings, traits };
}

/** The emotion ids the mood model carries (read defensively; the data owns them). */
function mindEmotions(s: Subject): string[] {
  const mood = s.mood as (Subject["mood"] & { ids?: () => string[] }) | null;
  return mood?.ids ? mood.ids() : [];
}

/** Restore a sim from a save string (separate from game.ts to avoid a cycle). */
function restoreSim(save: string, regs: Registries, lunar?: { cycleDays?: number }): Sim | null {
  try {
    const loaded = loadSession(save, {
      skeleton: regs.skeleton,
      library: regs.library,
      genomes: regs.genomes,
      bands: regs.exposureBands,
      attributes: regs.attributes,
      events: regs.events,
    });
    return { subject: loaded.session.subject, session: loaded.session, engine: new TimeEngine(loaded.session), regs, lunar: createLunar(lunar) };
  } catch {
    return null;
  }
}

export { STATUS as CAST_STATUS };
