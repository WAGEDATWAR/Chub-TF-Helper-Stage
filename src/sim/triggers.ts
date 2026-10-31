/**
 * The trigger engine (H3). Per character with a coupled genome (werewolf, vampire),
 * each world step it reads the coupling pressure from the lunar clock, the subject's
 * emotions and their cycle, and drives the draw → shift → revert music:
 *
 *  - draw: as pressure rises, a **partial** dose lands (fur, nails, senses) — the
 *    moon drawing near, not a full change.
 *  - shift: past `shift_at`, the full shift is forced (a big dose + a temporary form).
 *  - revert: below `revert_below`, the shift recedes.
 *
 * Pressure sources are gated by the chosen `playstyle`, so a player can make the
 * werewolf moon-only (classic), emotion-driven, hormonal, or all of them (default).
 * Pure over the sim: it only bestows doses and records shift state.
 */
import { bestowForced, type Sim } from "./subject";
import { ambientAt, buildCouplingData, canWillShift, createCouplingState, readPressure, stepCoupling, type CouplingData, type CouplingProfile, type CouplingState } from "./coupling";
import type { Lunar } from "./lunar";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "@core/time";

export interface TriggerEvent {
  characterId: string;
  genome: string;
  kind: "draw" | "shift" | "revert";
  pressure: number;
  cues: string[];
  note: string;
}

interface Coupling {
  profile: CouplingProfile;
  state: CouplingState;
  playstyle: string;
  /** The tick the last draw dose was applied, so we do not re-dose every step. */
  lastDrawTick: number;
  /** H10: the character has chosen to shift on the next step (voluntary). */
  willShift: boolean;
  /** Manually cleared: suppressed until pressure drops below `revert_below` again. */
  cleared: boolean;
}

export class TriggerEngine {
  readonly data: CouplingData;
  private readonly lunar: Lunar;
  private readonly perChar = new Map<string, Coupling[]>();

  constructor(couplingData: unknown, lunar: Lunar) {
    this.data = buildCouplingData(couplingData);
    this.lunar = lunar;
  }

  profileFor(genomeId: string): CouplingProfile | null {
    return this.data.profiles.find((p) => p.genome === genomeId) ?? null;
  }

  /** Re-base the shared lunar offset (a moon reset). The engine holds the same
   *  Lunar as the game, so this just mirrors it for callers that reach here. */
  setLunarOffset(off: number): void {
    this.lunar.offsetTicks = off;
  }

  playstyles(genomeId: string): Array<{ id: string; note: string }> {
    const p = this.profileFor(genomeId);
    if (!p) return [];
    return Object.entries(p.playstyles).map(([id, s]) => ({ id, note: s.note }));
  }

  /** Set a character's playstyle for a coupled genome (records it even if untouched). */
  setPlaystyle(characterId: string, genomeId: string, playstyle: string): void {
    let list = this.perChar.get(characterId);
    if (!list) { list = []; this.perChar.set(characterId, list); }
    const existing = list.find((c) => c.profile.genome === genomeId);
    if (existing) { if (existing.profile.playstyles[playstyle]) existing.playstyle = playstyle; return; }
    // record a pending playstyle so it survives even before the coupling is synced
    const profile = this.profileFor(genomeId);
    if (profile?.playstyles[playstyle]) {
      list.push({ profile, state: createCouplingState(), playstyle, lastDrawTick: -999, willShift: false, cleared: false });
    }
  }

  playstyleFor(characterId: string): string | null {
    return this.perChar.get(characterId)?.[0]?.playstyle ?? null;
  }

  /** The genomes a character currently carries that have a coupling. */
  private couplingsFor(sim: Sim): CouplingProfile[] {
    const out: CouplingProfile[] = [];
    for (const g of sim.subject.genomes) {
      const p = this.profileFor(g);
      if (p) out.push(p);
    }
    return out;
  }

  /** Ensure a state record exists for every coupled genome the subject carries. */
  private sync(characterId: string, sim: Sim): Coupling[] {
    let list = this.perChar.get(characterId);
    if (!list) { list = []; this.perChar.set(characterId, list); }
    for (const profile of this.couplingsFor(sim)) {
      if (!list.some((c) => c.profile.genome === profile.genome)) {
        list.push({ profile, state: createCouplingState(), playstyle: this.data.defaultPlaystyle, lastDrawTick: -999, willShift: false, cleared: false });
      }
    }
    return list;
  }

  /**
   * Drop coupling state for genomes the subject no longer carries (an override
   * removed a lycan), keeping any still-held genome's state and playstyle. Without
   * this a removed genome keeps drawing its change forever.
   */
  prune(characterId: string, keptGenomes: readonly string[]): void {
    const list = this.perChar.get(characterId);
    if (!list) return;
    const keep = new Set(keptGenomes);
    const filtered = list.filter((c) => keep.has(c.profile.genome));
    if (filtered.length > 0) this.perChar.set(characterId, filtered);
    else this.perChar.delete(characterId);
  }

  /**
   * Step every coupled character `ticks` (minutes) forward. Returns the events that
   * fired. Pressure is evaluated once per `checkEveryHours` worth of ticks.
   */
  step(characters: Array<{ id: string; sim: Sim }>, ticks: number, tick: number, emotionOf: (sim: Sim) => Record<string, number>): TriggerEvent[] {
    const events: TriggerEvent[] = [];
    const checkTicks = this.data.settings.checkEveryHours * TICKS_PER_HOUR;
    const checks = Math.max(1, Math.floor(ticks / checkTicks));
    for (const { id, sim } of characters) {
      const list = this.sync(id, sim);
      for (const c of list) {
        for (let k = 0; k < checks; k++) {
          const at = tick - ticks + (k + 1) * checkTicks;
          this.doTick(id, sim, c, at, emotionOf, events);
        }
      }
    }
    return events;
  }

  private doTick(characterId: string, sim: Sim, c: Coupling, tick: number, emotionOf: (sim: Sim) => Record<string, number>, events: TriggerEvent[]): void {
    const emotion = emotionOf(sim);
    const realized = sim.subject.mind?.realized ?? false;
    const readout = readPressure(c.profile, c.playstyle, {
      tick,
      lunar: this.lunar,
      emotions: emotion,
      cyclePhase: tick / TICKS_PER_DAY, // the subject's own cycle rides the world clock
      arousal: sim.subject.stats.arousal ?? 0,
      realized,
      willShift: c.willShift,
    });
    // a manual clear holds while the pressure stays at/above revert_below; only once
    // it genuinely falls (and would revert anyway) do we release the suppression
    if (c.cleared) {
      if (readout.pressure < c.profile.revert_below) { c.cleared = false; c.state.shifted = false; }
      else { c.state.shifted = false; c.state.lastPressure = readout.pressure; c.willShift = false; return; }
    }
    const action = stepCoupling(c.profile, c.state, readout.pressure, tick);
    const willed = c.willShift && readout.breakdown.some((b) => b.source === "choice");
    c.willShift = false;

    // ambient (H10): a nocturnal profile recovers at night, wearies in the sun
    const ambient = ambientAt(c.profile, tick);
    if (ambient) {
      const wellbeing = (sim.subject.stats.wellbeing ?? 50) + ambient.delta;
      sim.subject.stats.wellbeing = Math.max(0, Math.min(100, wellbeing));
      c.state.thriving = ambient.thriving;
    }

    // the draw: a partial dose as the pressure builds, re-applied as it climbs
    if (c.profile.draw && readout.pressure >= 0.2 && tick - c.lastDrawTick >= 3 * TICKS_PER_DAY) {
      const dose = readout.pressure >= c.profile.shift_at ? c.profile.draw.dose_at_shift : c.profile.draw.dose_at_draw;
      bestowForced(sim, c.profile.genome, dose * 0.25);
      c.lastDrawTick = tick;
      events.push({ characterId, genome: c.profile.genome, kind: "draw", pressure: readout.pressure, cues: readout.cues, note: readout.cues.join(", ") });
    }
    if (action === "shift") {
      bestowForced(sim, c.profile.genome, c.profile.draw?.dose_at_shift ?? 2.0);
      const why = willed ? "called on purpose" : describeBreakdown(readout.breakdown, readout.pressure, c.profile.shift_at);
      events.push({ characterId, genome: c.profile.genome, kind: "shift", pressure: readout.pressure, cues: readout.cues, note: `${c.profile.kind} shift forced — ${why}` });
    } else if (action === "revert") {
      events.push({ characterId, genome: c.profile.genome, kind: "revert", pressure: readout.pressure, cues: [], note: `${c.profile.kind} recedes (pressure ${pct(readout.pressure)} fell below ${pct(c.profile.revert_below)})` });
    }
  }

  /** H10: a realized character on a voluntary playstyle deliberately calls the shift. */
  callShift(characterId: string, sim: Sim): boolean {
    const list = this.sync(characterId, sim);
    const realized = sim.subject.mind?.realized ?? false;
    let any = false;
    for (const c of list) {
      if (canWillShift(c.profile, c.playstyle, realized)) { c.willShift = true; any = true; }
    }
    return any;
  }

  /** Whether this character may call a shift right now (for the pane). */
  canCallShift(characterId: string, sim: Sim): boolean {
    const list = this.sync(characterId, sim);
    const realized = sim.subject.mind?.realized ?? false;
    return list.some((c) => canWillShift(c.profile, c.playstyle, realized));
  }

  /**
   * Force the full shift now regardless of pressure or playstyle (a manual override).
   * The body gets the shift dose; the coupling is marked shifted after the world next
   * steps, so a later fall below `revert_below` will still recede it normally.
   */
  forceShift(characterId: string, sim: Sim): string[] {
    const list = this.sync(characterId, sim);
    const shifted: string[] = [];
    for (const c of list) {
      if (c.state.shifted) continue;
      bestowForced(sim, c.profile.genome, c.profile.draw?.dose_at_shift ?? 2.0);
      c.state.shifted = true;
      c.state.shiftedAtTick = sim.session.clock.tick;
      shifted.push(c.profile.genome);
    }
    return shifted;
  }

  /**
   * Clear the shift now: mark it receded and suppress re-shifting until the pressure
   * genuinely falls below `revert_below` and climbs again — so a manually cleared
   * shift does not instantly re-fire on the next tick while the moon is still full.
   */
  clearShift(characterId: string, sim: Sim): string[] {
    const list = this.sync(characterId, sim);
    const cleared: string[] = [];
    for (const c of list) {
      if (!c.state.shifted) continue;
      c.state.shifted = false;
      c.cleared = true;
      cleared.push(c.profile.genome);
    }
    return cleared;
  }

  /** A per-character read for the pane: pressure, breakdown, cues, playstyle. */
  readout(characterId: string, sim: Sim, tick: number, emotionOf: (sim: Sim) => Record<string, number>): Array<{ genome: string; kind: string; pressure: number; breakdown: Array<{ source: string; value: number }>; cues: string[]; shifted: boolean; playstyle: string; playstyles: Array<{ id: string; note: string }>; canCall: boolean }> {
    const list = this.sync(characterId, sim);
    const realized = sim.subject.mind?.realized ?? false;
    return list.map((c) => {
      const r = readPressure(c.profile, c.playstyle, { tick, lunar: this.lunar, emotions: emotionOf(sim), cyclePhase: tick / TICKS_PER_DAY, arousal: sim.subject.stats.arousal ?? 0, realized, willShift: false });
      return { genome: c.profile.genome, kind: c.profile.kind, pressure: r.pressure, breakdown: r.breakdown, cues: r.cues, shifted: c.state.shifted, playstyle: c.playstyle, playstyles: this.playstyles(c.profile.genome), canCall: canWillShift(c.profile, c.playstyle, realized) };
    });
  }

  toJSON(): Record<string, { genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string; cleared: boolean; lastDrawTick: number }[]> {
    const out: Record<string, Array<{ genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string; cleared: boolean; lastDrawTick: number }>> = {};
    for (const [id, list] of this.perChar) out[id] = list.map((c) => ({ genome: c.profile.genome, shifted: c.state.shifted, shiftedAtTick: c.state.shiftedAtTick, playstyle: c.playstyle, cleared: c.cleared, lastDrawTick: c.lastDrawTick }));
    return out;
  }

  loadJSON(data: Record<string, Array<{ genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string; cleared?: boolean; lastDrawTick?: number }>> | null, characters: Array<{ id: string; sim: Sim }>): void {
    if (!data) return;
    this.perChar.clear();
    for (const { id, sim } of characters) {
      void sim;
      const saved = data[id];
      if (!saved) continue;
      const list: Coupling[] = [];
      for (const rec of saved) {
        const profile = this.profileFor(rec.genome);
        if (!profile) continue;
        list.push({ profile, state: { shifted: rec.shifted, shiftedAtTick: rec.shiftedAtTick, lastPressure: 0 }, playstyle: rec.playstyle, lastDrawTick: rec.lastDrawTick ?? -999, willShift: false, cleared: rec.cleared === true });
      }
      if (list.length > 0) this.perChar.set(id, list);
    }
  }
}

export function createTriggerEngine(couplingData: unknown, lunar: Lunar): TriggerEngine {
  return new TriggerEngine(couplingData, lunar);
}

/** A pressure value as a whole percent. */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Explain a threshold crossing with the actual factors: each contributing source and
 * its value against the threshold, e.g. "moon 94% + hormonal 38% = 132% ≥ 62%". This
 * is so a shift says *why* the criteria were met, not just that they were.
 */
function describeBreakdown(breakdown: Array<{ source: string; value: number }>, pressure: number, threshold: number): string {
  if (breakdown.length === 0) return `pressure ${pct(pressure)} ≥ ${pct(threshold)}`;
  const parts = breakdown.map((b) => `${b.source} ${pct(b.value)}`);
  return `${parts.join(" + ")} = ${pct(pressure)} ≥ ${pct(threshold)}`;
}


