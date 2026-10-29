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
      list.push({ profile, state: createCouplingState(), playstyle, lastDrawTick: -999, willShift: false });
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
        list.push({ profile, state: createCouplingState(), playstyle: this.data.defaultPlaystyle, lastDrawTick: -999, willShift: false });
      }
    }
    return list;
  }

  /**
   * Step every coupled character `ticks` forward. Returns the events that fired.
   * `hoursPerCheck` throttles how often pressure is evaluated.
   */
  step(characters: Array<{ id: string; sim: Sim }>, ticks: number, tick: number, emotionOf: (sim: Sim) => Record<string, number>): TriggerEvent[] {
    const events: TriggerEvent[] = [];
    const hours = this.data.settings.checkEveryHours;
    const checks = Math.max(1, Math.floor(ticks / hours));
    for (const { id, sim } of characters) {
      const list = this.sync(id, sim);
      for (const c of list) {
        for (let k = 0; k < checks; k++) {
          const at = tick - ticks + (k + 1) * hours;
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
      cyclePhase: tick / 24, // the subject's own cycle rides the world clock
      arousal: sim.subject.stats.arousal ?? 0,
      realized,
      willShift: c.willShift,
    });
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
    if (c.profile.draw && readout.pressure >= 0.2 && tick - c.lastDrawTick >= 24 * 3) {
      const dose = readout.pressure >= c.profile.shift_at ? c.profile.draw.dose_at_shift : c.profile.draw.dose_at_draw;
      bestowForced(sim, c.profile.genome, dose * 0.25);
      c.lastDrawTick = tick;
      events.push({ characterId, genome: c.profile.genome, kind: "draw", pressure: readout.pressure, cues: readout.cues, note: readout.cues.join(", ") });
    }
    if (action === "shift") {
      bestowForced(sim, c.profile.genome, c.profile.draw?.dose_at_shift ?? 2.0);
      const why = willed ? "called on purpose" : (readout.breakdown.map((b) => b.source).join("+") || "pressure");
      events.push({ characterId, genome: c.profile.genome, kind: "shift", pressure: readout.pressure, cues: readout.cues, note: `${c.profile.kind} shift forced (${why})` });
    } else if (action === "revert") {
      events.push({ characterId, genome: c.profile.genome, kind: "revert", pressure: readout.pressure, cues: [], note: `${c.profile.kind} recedes` });
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

  /** A per-character read for the pane: pressure, breakdown, cues, playstyle. */
  readout(characterId: string, sim: Sim, tick: number, emotionOf: (sim: Sim) => Record<string, number>): Array<{ genome: string; kind: string; pressure: number; breakdown: Array<{ source: string; value: number }>; cues: string[]; shifted: boolean; playstyle: string; playstyles: Array<{ id: string; note: string }>; canCall: boolean }> {
    const list = this.sync(characterId, sim);
    const realized = sim.subject.mind?.realized ?? false;
    return list.map((c) => {
      const r = readPressure(c.profile, c.playstyle, { tick, lunar: this.lunar, emotions: emotionOf(sim), cyclePhase: tick / 24, arousal: sim.subject.stats.arousal ?? 0, realized, willShift: false });
      return { genome: c.profile.genome, kind: c.profile.kind, pressure: r.pressure, breakdown: r.breakdown, cues: r.cues, shifted: c.state.shifted, playstyle: c.playstyle, playstyles: this.playstyles(c.profile.genome), canCall: canWillShift(c.profile, c.playstyle, realized) };
    });
  }

  toJSON(): Record<string, { genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string }[]> {
    const out: Record<string, Array<{ genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string }>> = {};
    for (const [id, list] of this.perChar) out[id] = list.map((c) => ({ genome: c.profile.genome, shifted: c.state.shifted, shiftedAtTick: c.state.shiftedAtTick, playstyle: c.playstyle }));
    return out;
  }

  loadJSON(data: Record<string, Array<{ genome: string; shifted: boolean; shiftedAtTick: number; playstyle: string }>> | null, characters: Array<{ id: string; sim: Sim }>): void {
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
        list.push({ profile, state: { shifted: rec.shifted, shiftedAtTick: rec.shiftedAtTick, lastPressure: 0 }, playstyle: rec.playstyle, lastDrawTick: -999, willShift: false });
      }
      if (list.length > 0) this.perChar.set(id, list);
    }
  }
}

export function createTriggerEngine(couplingData: unknown, lunar: Lunar): TriggerEngine {
  return new TriggerEngine(couplingData, lunar);
}

