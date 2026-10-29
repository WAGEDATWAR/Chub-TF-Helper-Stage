import { clampStat } from "./stats";
import { repairIntegrity, tickConditionFlags } from "./health";
import { STREAMS } from "./rng";
import { defaultInterestRegistry, viewOf, type InterestRegistry } from "./interest";
import { growthRate } from "./temporal";
import { coupledGrowth } from "./transformation_coupling";
import { runSocialReactions } from "./social";
import { evaluateConsequences } from "./consequences";
import { buildReason } from "./reason";
import type { Session } from "./session";

/**
 * The time engine (blueprint §29). Divergence D-107: the reference's fixed
 * `ACTION_SLOTS = 4` day becomes a tick/hour clock with a fixed advance order.
 * Nothing moves time except `advance`.
 */

export const TICKS_PER_BLOCK = 4;
export const BLOCKS = Object.freeze(["dawn", "morning", "midday", "afternoon", "evening", "night"] as const);
export type Block = (typeof BLOCKS)[number];

export const SPEEDS = Object.freeze([1, 8, 24, 168] as const);

export function blockOf(tick: number): Block {
  const index = Math.floor((tick % (TICKS_PER_BLOCK * BLOCKS.length)) / TICKS_PER_BLOCK);
  return BLOCKS[index] ?? "night";
}

export const MAX_STEPS = 100_000;

/**
 * The subject's *visible* change tags this block (M16b): part/attr tags the town
 * can see. Absent placeholders (a tail that has not grown) do not register (D-202).
 */
function subjectChangeTags(session: Session): string[] {
  return session.subject.body.allInstances()
    .filter((i) => !(i.tags ?? []).includes("absent_tag"))
    .flatMap((i) => i.tags ?? []);
}

export interface AdvanceResult {
  ticks: number;
  stagesCrossed: number;
  events: Array<{ slot: string; attribute: string; from: number; to: number }>;
}

export interface TickHooks {
  /** optional: resolve an injected dose into growth ticking (wired by the caller) */
  onTick?(session: Session, ticks: number): void;
  /** optional: apply drift under unstable bands */
  onDrift?(session: Session, ticks: number): void;
  /** optional: self-driven practice (§48.5); called once per day. */
  onPractise?(session: Session): void;
  /** optional: the nightly notice + self-read + reaction discovery (§5 tick 8). */
  onDaily?(session: Session): void;
  /** optional: evaluate interrupts each tick; return the scene entered (M14.10). */
  onInterrupt?: ((session: Session) => void) | undefined;
}

export class TimeEngine {
  readonly session: Session;
  private readonly hooks: TickHooks;
  readonly interest: InterestRegistry;

  constructor(session: Session, hooks: TickHooks = {}, interest?: InterestRegistry) {
    this.session = session;
    this.hooks = hooks;
    this.interest = interest ?? defaultInterestRegistry();
  }

  /** Advance `ticks` hours in the fixed order (blueprint §29.3). */
  advance(ticks = 1): AdvanceResult {
    const session = this.session;
    const result: AdvanceResult = { ticks, stagesCrossed: 0, events: [] };
    for (let i = 0; i < ticks; i++) {
      const prevView = this.interest ? viewOf(session) : null;
      session.clock.tick += 1;
      session.clock.day = Math.floor(session.clock.tick / 24) + 1;
      session.setFlag(`tick_${session.clock.tick}`);

      // 1. world/schedule hooks
      this.hooks.onTick?.(session, 1);
      // 2. incubation release
      session.incubation.advance(1);
      // 3. growth: advance any scheduled attribute toward its target (D-123);
      //    a `hold` power freezes growth until its expiry (D-130)
      if (session.resolver && session.clock.tick > session.growthHoldUntil) {
        // a hook may scale growth (S78): a shifting gait comes on faster
        const growthHook = session.hookValue("growth.rate_modifier");
        const hookScale = growthHook ? growthHook.value / 1000 : 1;
        const temporalRate = growthRate(session) * hookScale;
        // growth honours the temporal rate *and* her mind-coupling; the onset
        // schedule burns down under the temporal rate alone, so a pace knob or a
        // compress power speeds the whole timeline without her stance
        // re-calibrating where parts land (D-H02). Normally temporalRate is 1.
        const step = session.resolver.tick(session.subject, 1, coupledGrowth(session, temporalRate), temporalRate);
        if (step.events.length > 0) {
          for (const event of step.events) {
            const forward = event.to >= event.from;
            const entry = session.subject.body.get(event.slot)?.attributes.find((a) => a.id === event.attribute);
            const atTarget = entry ? entry.progress >= (entry.target_progress ?? entry.progress) : true;
            // a morph rewrites the body (R10): emit body.modified alongside
            if (event.morph) session.bus.emit("body.modified", { slot: event.slot }, { path: event.slot, final: false });
            session.journal.recordChange({
              tick: session.clock.tick,
              day: session.clock.day,
              slot: event.slot,
              attribute: event.attribute,
              stageName: event.stageName,
              direction: forward ? "forward" : "reverse",
            });
            session.bus.emit(
              forward ? "stage.crossed" : "attribute.reverted",
              { slot: event.slot, attribute: event.attribute, stage: event.stageName ?? "a new stage", pct: entry ? Math.round((entry.progress / 1000) * 100) : 0 },
              { path: `${event.slot}:${event.attribute}`, causes: entry?.causes ?? [], final: atTarget },
            );
            if (atTarget) {
              session.bus.emit("attribute.settled", { slot: event.slot, attribute: event.attribute, stage: event.stageName ?? "a new stage" }, { path: `${event.slot}:${event.attribute}`, causes: entry?.causes ?? [], final: true });
            } else {
              session.bus.emit("attribute.progressed", { slot: event.slot, attribute: event.attribute, pct: entry ? Math.round((entry.progress / 1000) * 100) : 0 }, { path: `${event.slot}:${event.attribute}`, causes: entry?.causes ?? [] });
            }
          }
          session.markDirty();
        }
      }
      // 4. drift under unstable bands
      this.hooks.onDrift?.(session, 1);
      // 4b. interrupts: evaluate pressure each tick (M14.10)
      this.hooks.onInterrupt?.(session);
      // 5. Observer charge + wellbeing
      session.observer.tick();
      // 6. daily boundary
      if (session.clock.tick % 24 === 0) {
        this.dailyBoundary();
      }
      // 7. town block boundary (M16a): every 4 hours, agents choose, converge, move
      if (session.town && session.clock.tick % TICKS_PER_BLOCK === 0) {
        this.blockBoundary();
      }
      // remember where something interesting happened (rewind marker, §29.4)
      if (prevView) for (const f of this.interest!.fire(session, prevView)) session.timeline.mark(session.clock.tick, f.label);
    }    session.markDirty();
    session.refresh();
    this.session.bus.emit("world.tick", { tick: session.clock.tick, day: session.clock.day, block: blockOf(session.clock.tick) });
    session.bus.noteTick();
    return result;
  }

  /** Skip to the next tick the sim marks interesting (blueprint §29.4). */
  skipToInterest(maxTicks = MAX_STEPS): number {
    const startedAt = this.session.clock.tick;
    for (let n = 1; n <= maxTicks; n++) {
      const prev = viewOf(this.session);
      this.advance(1);
      const fired = this.interest.fire(this.session, prev);
      if (fired.length > 0) {
        for (const f of fired) this.session.timeline.mark(this.session.clock.tick, f.label);
        this.session.bus.emit("skip.landed", { ticks: n, at: this.session.clock.tick, signals: fired.map((f) => f.label) }, { final: true });
        return n;
      }
    }
    void startedAt;
    return maxTicks;
  }

  /** The labels that fire on the next tick (advances one tick). */
  interestNow(): string[] {
    const prev = viewOf(this.session);
    this.advance(1);
    return this.interest.fire(this.session, prev).map((f) => f.label);
  }

  isInteresting(): boolean {
    const prev = viewOf(this.session);
    this.advance(1);
    return this.interest.fire(this.session, prev).length > 0;
  }

  private dailyBoundary(): void {
    const session = this.session;
    const subject = session.subject;
    const rested = session.hasFlag("rested");
    const s = subject.stats;
    s.stability = clampStat((s.stability ?? 0) + (rested ? REGEN.stabilityRested : REGEN.stability));
    s.overload = clampStat((s.overload ?? 0) + (rested ? REGEN.overloadRested : REGEN.overload));
    s.drive = clampStat((s.drive ?? 0) + REGEN.drive);
    // drive mean-reverts toward an appetite set by her libido, so a settled run
    // neither pegs at 0 nor at 100 (D-197). This replaces the flat daily decay
    // once a mind exists; before that, the legacy decay stands.
    if (subject.mind) {
      const target = 30 + Math.round(((subject.mind.read("libidinous") ?? 50) / 100) * 35);
      const d = subject.stats.drive ?? 0;
      const pull = d < target ? 8 : 4;
      if (d < target) subject.stats.drive = clampStat(d + pull);
      else if (d > target) subject.stats.drive = clampStat(d - pull);
    }
    s.fatigue = clampStat((s.fatigue ?? 0) + REGEN.fatigue);
    s.pain = clampStat((s.pain ?? 0) - (rested ? PAIN_DECAY_RESTED : PAIN_DECAY_PER_DAY));
    for (const inst of subject.body.allInstances()) {
      repairIntegrity(inst, rested ? INTEGRITY_REPAIR_RESTED : INTEGRITY_REPAIR_PER_DAY);
      tickConditionFlags(inst, 1);
    }
    // clear day-scoped flags
    for (const flag of [...session.flags]) {
      if (/^tick_/.test(flag)) session.flags.delete(flag);
    }
    session.flags.delete("still");
    session.bus.emit("day.advanced", { day: session.clock.day });
    // reasons are day-scoped: drop them at rollover (S72)
    session.town?.reasons.clear();
    // memories fade daily (S74): minor ones are forgotten, rolled into the bond
    if (session.town) for (const agent of session.town.all()) agent.memory.age(session.clock.tick);
    // the Observer keeps their own small life (rest when spent, eat when empty)
    session.observer.dailyCare();
    // the nightly notice + self-read + reaction discovery (§5 tick 8)
    this.hooks.onDaily?.(session);
    // self-driven practice: she trains herself as part of her life (§48.5)
    this.hooks.onPractise?.(session);
    session.markDirty();
  }

  /**
   * The world moves one block on (M16a, §44/§46). Agents decay needs and choose
   * an activity; a blocked obligation (a body that can no longer do the task)
   * raises its lateness toward a real miss. Emits `town.blocked` so the causal web
   * can react. Runs on the same machinery for everyone, subject included.
   */
  private blockBoundary(): void {
    const session = this.session;
    const town = session.town;
    if (!town) return;
    // refresh derived first: the obligation gate reads capabilities, which must
    // reflect the body as of this tick (a raw attribute change sets no dirty flag)
    session.refresh();
    const block = blockOf(session.clock.tick);
    town.tick = session.clock.tick;
    // a hook may scale how fast her needs fall (S78): fur keeps her warmer
    const decayHook = session.hookValue("needs.decay_modifier");
    town.decayNeeds(TICKS_PER_BLOCK * ((decayHook?.value ?? 1000) / 1000));
    // causal web (§17.5): a body change feeds needs — a strained, changing body
    // burns energy and appetite faster, so behaviour visibly shifts.
    const exposure = session.subject.derived.exposure ?? 0;
    const pain = session.subject.stats.pain ?? 0;
    if (exposure > 5 || pain > 10) {
      const subject = town.state("subject");
      if (subject) {
        // a strained, changing body runs hotter: appetite and energy burn faster.
        // scalar reads live per-day (1.0 for exposure, 0.5 for pain) so a real
        // change visibly pulls her toward eat/rest over her obligations.
        const drain = exposure * 1.0 + pain * 0.5;
        subject.needs["need.energy"] = Math.max(0, (subject.needs["need.energy"] ?? 100) - drain * TICKS_PER_BLOCK * 0.15);
        subject.needs["need.hunger"] = Math.max(0, (subject.needs["need.hunger"] ?? 100) - drain * TICKS_PER_BLOCK * 0.15);
      }
    }
    // town events (M16b, §47): they exist independently of the change; start, pull,
    // and resolve — a resolution lands even if the subject is elsewhere.
    if (session.townEvents) {
      for (const e of session.townEvents.startTick(town, session.clock.day, block)) {
        session.bus.emit("town.event", { event: e.id, label: session.townEvents.registry.get(e.def)?.label ?? e.def, where: e.where }, { final: true });
      }
      session.townEvents.pull(town, block);
    }
    town.stepBlock(block);
    // a move is a readable town beat (R10): emit when the subject relocates
    const subjectNow = town.state("subject");
    if (subjectNow && session.lastSubjectAt !== subjectNow.at) {
      session.bus.emit("town.moved", { agent: "subject", at: subjectNow.at }, { final: false });
      session.lastSubjectAt = subjectNow.at;
    }
    // social reactions to a visible change (§45; P2/Q5): everyone present reacts,
    // each reaction an event that moves a bond, tempered by familiarity.
    if (session.social) {
      const changeTags = subjectChangeTags(session);
      for (const beat of runSocialReactions(town, session.social, session.rng, "subject", changeTags, "the change")) {
        session.bus.emit("social.reaction", { observer: beat.observer, reaction: beat.reaction.id, line: beat.line, household: beat.household }, { final: true });
        // a hook (S78) may scale how hard a beat lands: bias, never override
        const bondHook = session.hookValue("social.bond_modifier");
        const scale = bondHook ? bondHook.value / 1000 : 1;
        if (scale !== 1) {
          const scaled = Math.round(beat.bondDelta * scale * 10) / 10;
          if (scaled !== 0) town.changeBond(beat.observer, "subject", scaled - beat.bondDelta);
          beat.bondDelta = scaled;
          beat.bondAfter = town.bond(beat.observer, "subject")?.bond ?? beat.bondAfter;
        }
        const dir = beat.bondDelta >= 0 ? "warmer" : "cooler";
        session.bus.emit("bond.changed", { observer: beat.observer, subject: "subject", direction: dir, bond: Math.round(beat.bondAfter), delta: beat.bondDelta }, { path: beat.observer, final: false });
        if (beat.household) session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: beat.line });
        // a reaction means she is told about her change (R1, §17.5): a bond moved,
        // so the nightly told-notice path closes a gap she could not see alone.
        session.setFlag("told");
        town.reasons.add(beat.observer, session.clock.tick, buildReason("soc.bond_moved", "social", { observer: beat.observer, subject: "subject", change: beat.reaction.label, delta: beat.bondDelta }));
        // the beat leaves a memory in the one who reacted (S74)
        town.remember(beat.observer, {
          type: beat.bondDelta >= 0 ? "reacted.kindly" : "reacted.coldly",
          participants: ["subject"],
          severity: 2 + Math.min(3, Math.round(Math.abs(beat.bondDelta))),
          impact: beat.bondDelta,
          topic: "reaction",
        });
      }
    }
    // town events resolve (after movement, so attendance is read from where people are)
    if (session.townEvents) {
      for (const res of session.townEvents.step(town, "subject", block)) {
        session.bus.emit("town.event.resolved", { event: res.def.id, label: res.def.label, line: res.line, subjectPresent: res.subjectPresent, present: res.attendees.length }, { path: res.def.id, final: true });
        session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: res.line });
        // everyone present carries the shared event as a memory (S74)
        for (const id of res.attendees) {
          town.remember(id, { type: "event.shared", participants: res.attendees.filter((x) => x !== id), severity: 3, impact: 4, topic: "event", summary_key: `event.${res.def.id}` });
        }
        // the durable bond the event left is recorded like the social path (B4)
        for (const b of res.bonds) {
          town.reasons.add(b.observer, session.clock.tick, buildReason("event.bond_moved", "town_events", { observer: b.observer, subject: b.to, label: res.def.label, delta: b.delta }));
        }
      }
    }
    // obligations: a blocked task on the subject is the world reacting to the change
    const obligations = session.obligations;
    if (obligations) {
      const gate = { tags: session.subject.body.allInstances().flatMap((i) => i.tags), attrs: session.subject.body.allInstances().flatMap((i) => i.attributes.map((a) => a.id)), capacities: session.subject.derived.capacities };
      for (const o of obligations.forAgent("subject")) {
        if (!o.window.includes(block)) continue;
        if (obligations.blocked(o, gate)) {
          const res = town.noteLateness("subject", TICKS_PER_BLOCK, o.lateness_window);
          const gateTag = o.gated_by_tags?.find((t) => gate.tags.includes(t));
          const gateAttr = o.gated_by_attrs?.find((a) => gate.attrs.includes(a));
          const capGate = o.gated_by_capacity && (gate.capacities?.[o.gated_by_capacity.key] ?? 1000) < o.gated_by_capacity.below ? o.gated_by_capacity : null;
          town.reasons.add("subject", session.clock.tick, buildReason(
            capGate ? "obl.gated_capacity" : gateAttr ? "obl.gated_attr" : "obl.gated_tag",
            "obligations",
            capGate ? { obligation: o.id, key: capGate.key, value: Math.round(gate.capacities?.[capGate.key] ?? 0) }
              : gateAttr ? { obligation: o.id, attr: gateAttr } : { obligation: o.id, tag: gateTag ?? "?" },
          ));
          if (res.missed) {
            const c = o.consequence;
            if (c.need) session.subject.stats[c.need.replace(/^need\./, "")] ??= 0;
            session.subject.mood?.impulse("fear", 4);
            session.bus.emit("town.missed", { obligation: o.id, note: c.note ?? "an obligation goes unmet" }, { final: true });
            session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: c.note ?? "An obligation goes unmet." });
            town.reasons.add("subject", session.clock.tick, buildReason("obl.missed", "obligations", { obligation: o.id, lateness: res.missed ? o.lateness_window + 1 : 0 }));
            town.remember("subject", { type: "obligation.missed", participants: [], severity: 3, impact: -(c.bond ?? 5), topic: "obligation" });
          } else if (res.late) {
            session.bus.emit("town.late", { obligation: o.id }, { final: false });
            town.reasons.add("subject", session.clock.tick, buildReason("obl.late", "obligations", { obligation: o.id, lateness: TICKS_PER_BLOCK, window: o.lateness_window }));
          }
        }
      }
    }
    // second-order consequences (M16b, S11): a durable world change from the above
    if (session.consequences) {
      for (const c of evaluateConsequences(town, session.consequences, "subject", session.consequencesFired)) {
        session.bus.emit("town.consequence", { id: c.id, note: c.note, agent: c.agent ?? "subject" }, { final: true });
        session.journal.recordObservation({ tick: session.clock.tick, day: session.clock.day, note: c.note });
      }
    }
    session.markDirty();
  }
}

export const INTEGRITY_REPAIR_PER_DAY = 5;
export const INTEGRITY_REPAIR_RESTED = 12;
export const PAIN_DECAY_PER_DAY = 25;
export const PAIN_DECAY_RESTED = 40;

export const REGEN = Object.freeze({
  stability: 8,
  stabilityRested: 15,
  overload: -10,
  overloadRested: -20,
  drive: -6,
  fatigue: -30,
  intelligenceDebt: -2,
});

export function createTimeEngine(session: Session, hooks: TickHooks = {}): TimeEngine {
  return new TimeEngine(session, hooks);
}

export const RNG_STREAM_COUNT = STREAMS.length;
