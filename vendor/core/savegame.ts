import { ContentError } from "./loader";
import { createSubject } from "./subject";
import { createSession, type Session } from "./session";
import { createObserver } from "./observer";
import { createRng } from "./rng";
import { researchFromJSON } from "./research";
import { progressBlockFor } from "./progress";
import { SAVE_VERSION, assertNoDerived, verify } from "./persistence";
import { migrateToCurrent } from "./migrations";
import { buildDispositionTable } from "./reactions";
import { LinePool } from "./pool";
import { Timeline } from "./timeline";
import { Mind, buildMindData } from "./mind";
import { Mood, buildMoodData } from "./mood";
import type { EventRegistry } from "./events";
import type { Skeleton } from "./skeleton";
import type { PartLibrary } from "./parts";
import type { GenomeRegistry } from "./genomes";
import type { ExposureBandRegistry } from "./registries";
import type { AttributeRegistry } from "./attributes";

export interface SaveContent {
  skeleton: Skeleton;
  library: PartLibrary;
  genomes: GenomeRegistry;
  bands: ExposureBandRegistry;
  attributes: AttributeRegistry;
  dispositionTable?: ReturnType<typeof buildDispositionTable> | null;
  events?: EventRegistry | null;
  mindData?: unknown;
  moodData?: unknown;
}

export function serializeSession(session: Session): Record<string, unknown> {
  const json = session.toJSON();
  return { version: SAVE_VERSION, ...json };
}

/** Warnings collected during the last rehydrate (dropped parts, etc.). */
export const rehydrateWarnings: string[] = [];

export function rehydrate(save: Record<string, unknown>, content: SaveContent): Session {
  rehydrateWarnings.length = 0;
  const s = save.subject as {
    displayName?: string;
    baseGender?: string;
    personalitySeed?: string | null;
    stats?: Record<string, number>;
    parts?: Array<{ template: string; slot: string; integrity?: number; flags?: string[]; attributes?: Array<{ id: string; progress: number; stage_index?: number; target_progress?: number; dose_mult?: number; start_delay?: number; phase_index?: number; morph_chain?: string[] }> }>;
    pronouns?: string;
    age?: number | null;
    height?: number | null;
    weight?: number | null;
    sexuality?: string | null;
    sexualityDrift?: number;
    appliedGenomeMods?: Record<string, number>;
    mind?: unknown;
    mood?: unknown;
    preferences?: unknown;
    dispositions?: Array<{ reactionId: string; strength: number }>;
    reactions?: unknown[];
    abilities?: Record<string, { mastery: number; peak: number }>;
    know?: Record<string, { belief: number; noticedAtTick: number; path: string }>;
    memory?: Array<{ tick: number; kind: string; ref: string; until: number }>;
    self?: { coherence: number; dysmorphia: number; pride: number; acceptance: number };
    familiarity?: Record<string, number>;
    feral?: { locked: boolean; lockedAtDay: number; peakExposure: number; profile: string | null };
  };
  const subject = createSubject({
    skeleton: content.skeleton,
    library: content.library,
    genomesRegistry: content.genomes,
    exposureBands: content.bands,
    attributeRegistry: content.attributes,
    displayName: s.displayName,
    baseGender: s.baseGender,
    stats: s.stats,
    personalitySeed: s.personalitySeed ?? null,
    dispositions: s.dispositions ?? [],
    pronouns: s.pronouns,
    age: s.age ?? null,
    height: s.height ?? null,
    weight: s.weight ?? null,
    sexuality: s.sexuality ?? null,
  });
  for (const part of s.parts ?? []) {
    let inst;
    try {
      inst = subject.body.attach(part.template, part.slot);
    } catch (err) {
      rehydrateWarnings.push(`dropped part ${part.slot} (${part.template}): ${(err as Error).message}`);
      continue;
    }
    if (typeof part.integrity === "number") inst.setIntegrity(part.integrity);
    for (const attr of part.attributes ?? []) {
      const entry = inst.addAttribute(attr.id, attr.progress);
      entry.progress_block = progressBlockFor(content.attributes.get(attr.id));
      entry.target_progress = attr.target_progress ?? attr.progress;
      if (attr.dose_mult !== undefined) entry.dose_mult = attr.dose_mult;
      if (attr.start_delay && attr.start_delay > 0) entry.start_delay = attr.start_delay;
      if (attr.phase_index !== undefined) entry.phase_index = attr.phase_index;
      if (attr.morph_chain) entry.morph_chain = attr.morph_chain;
      entry.stage_index = attr.stage_index ?? 0;
    }
    for (const flag of part.flags ?? []) inst.flags.push(flag);
  }
  if (s.pronouns) subject.pronouns = s.pronouns;
  if (typeof s.sexualityDrift === "number") subject.sexualityDrift = s.sexualityDrift;
  if (s.mind && content.mindData) subject.mind = Mind.fromJSON(s.mind as never, buildMindData(content.mindData));
  if (s.mood && content.moodData) subject.mood = Mood.fromJSON(s.mood as never, buildMoodData(content.moodData));
  if (s.appliedGenomeMods) subject.appliedGenomeMods = { ...s.appliedGenomeMods };
  if (s.preferences) {
    subject.preferences.adopt((s.preferences as { preferences?: never[] }).preferences ?? [], (s.preferences as { log?: never[] }).log ?? []);
    subject.syncReactionsFromPreferences();
  }
  if (Array.isArray(s.reactions)) subject.reactions = s.reactions as never;
  if (s.abilities && typeof s.abilities === "object") {
    for (const [id, state] of Object.entries(s.abilities)) subject.abilities[id] = { mastery: state.mastery ?? 0, peak: state.peak ?? 0 };
  }
  if (s.know && typeof s.know === "object") {
    for (const [id, entry] of Object.entries(s.know)) subject.know[id] = { belief: entry.belief ?? 0, noticedAtTick: entry.noticedAtTick ?? 0, path: (entry.path ?? "felt") as never };
  }
  if (Array.isArray(s.memory)) subject.memory = s.memory.map((m) => ({ tick: m.tick ?? 0, kind: "notice", ref: m.ref, until: m.until ?? 0 }));
  if (s.self) subject.self = { coherence: s.self.coherence ?? 60, dysmorphia: s.self.dysmorphia ?? 0, pride: s.self.pride ?? 0, acceptance: s.self.acceptance ?? 55 };
  if (s.familiarity && typeof s.familiarity === "object") subject.familiarity = { ...s.familiarity };
  if (s.feral) subject.feral = { locked: s.feral.locked ?? false, lockedAtDay: s.feral.lockedAtDay ?? 0, peakExposure: s.feral.peakExposure ?? 100, profile: s.feral.profile ?? null };
  subject.recomputeDerived();

  const session = createSession({ subject, observer: createObserver(), saveSeed: (save.saveSeed as number) ?? 1, events: content.events ?? null });
  const clock = save.clock as { tick?: number; day?: number; speed?: number | "pause" } | undefined;
  session.clock.tick = clock?.tick ?? 0;
  session.clock.day = clock?.day ?? 1;
  session.clock.speed = clock?.speed ?? 1;
  session.rng = createRng((save.saveSeed as number) ?? 1, ((save.rng as { counters?: never } | undefined)?.counters) ?? undefined);
  // restore the Observer (the reference kept it in the save; D-095/RNG-counters aside)
  const obs = save.observer as { charge?: number; chargeMax?: number; stats?: Record<string, number>; wellbeing?: Record<string, number>; skillXp?: Record<string, number> } | undefined;
  if (obs) {
    if (typeof obs.charge === "number") session.observer.charge = obs.charge;
    if (obs.stats) Object.assign(session.observer.stats, obs.stats);
    if (obs.wellbeing) Object.assign(session.observer.wellbeing, obs.wellbeing);
    if (obs.skillXp) Object.assign(session.observer.skillXp, obs.skillXp);
  }
  for (const flag of save.flags as string[] | undefined ?? []) session.setFlag(flag);
  const journal = save.journal as { entries?: unknown[] } | undefined;
  for (const entry of journal?.entries ?? []) {
    (session.journal as unknown as { entries: unknown[] }).entries.push(entry);
  }
  session.research = researchFromJSON((save.research as never) ?? {});
  const settings = save.settings as Partial<Session["settings"]> | undefined;
  if (settings) session.settings = { ...session.settings, ...settings };
  const progression = save.progression as Session["progression"] | undefined;
  if (progression) session.progression = progression;
  const world = save.world as ReturnType<Session["world"]["toJSON"]> | undefined;
  if (world) {
    const w = session.world;
    for (const [id, state] of Object.entries(world.objectStates ?? {})) w.setObjectState(id, state);
    for (const [id, patch] of Object.entries(world.ambient ?? {})) w.setAmbient(id, patch);
    for (const id of world.openDoors ?? []) w.open(id);
  }
  for (const [id, until] of (save.cooldowns as Array<[string, number]> | undefined) ?? []) {
    session.cooldowns.set(id, until);
  }
  if (typeof save.growthHoldUntil === "number") session.growthHoldUntil = save.growthHoldUntil;
  if (save.reveal) session.reveal = save.reveal as Session["reveal"];
  if (typeof save.currentLocation === "string") session.currentLocation = save.currentLocation;
  session.bus.loadJSON(save.story as { story?: never } | undefined);
  if (save.training) session.training = save.training as Session["training"];
  if (save.play) session.play = save.play as Session["play"];
  if (typeof save.practising === "string" || save.practising === null) session.practising = save.practising as string | null;
  if (save.nudge) session.nudge = save.nudge as Session["nudge"];
  for (const [k, v] of (save.beatIndex as Array<[string, number]> | undefined) ?? []) session.beatIndex.set(k, v);
  if (Array.isArray(save.recentLines)) session.recentLines = save.recentLines as string[];
  session.pool.adopt(LinePool.fromJSON(save.linePool as never));
  if (save.sex) session.sex = { heldArousalTicks: (save.sex as never as { heldArousalTicks?: number }).heldArousalTicks ?? 0, refractoryTicks: (save.sex as never as { refractoryTicks?: number }).refractoryTicks ?? 0, sessionCount: { ...((save.sex as never as { sessionCount?: Record<string, number> }).sessionCount ?? {}) } };
  if (save.timeline) session.timeline.adopt(Timeline.fromJSON(save.timeline as never));
  if (save.inspect) {
    const ins = save.inspect as { cooldown?: number; count?: number; last?: { focus: string; subject: string; line: string } | null };
    session.inspectState = {
      cooldown: ins.cooldown ?? 0,
      count: ins.count ?? 0,
      last: ins.last ? { focus: ins.last.focus as never, subject: ins.last.subject, line: ins.last.line } : null,
    };
  }
  if (save.town && session.town) session.town.adopt(save.town as never);
  if ((save as { townEvents?: unknown }).townEvents && session.townEvents) session.townEvents.adopt((save as { townEvents?: never }).townEvents);
  for (const id of (save as { consequencesFired?: string[] }).consequencesFired ?? []) session.consequencesFired.add(id);
  if (save.temporal) {
    session.temporal.growth = (save.temporal as { growth?: number }).growth ?? 1;
    const mods = (save.temporal as { modifiers?: Array<{ id: string; rate: number; untilTick: number }> }).modifiers ?? [];
    session.temporal.modifiers.push(...mods.map((m) => ({ ...m })));
  }
  return session;
}

export function loadSession(text: string, content: SaveContent): { session: Session; migrations: unknown[]; derivedClean: boolean; warnings: string[] } {
  const checked = verify(text);
  if (!checked.ok) {
    throw new ContentError(`savegame: ${checked.reason} (expected ${checked.expected}, got ${checked.actual})`, "save");
  }
  const { save, applied } = migrateToCurrent(checked.save!);
  const boundary = assertNoDerived(save);
  const session = rehydrate(save, content);
  return { session, migrations: applied, derivedClean: boundary.ok, warnings: [...boundary.present, ...rehydrateWarnings] };
}

export function validateSaveShape(save: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof save !== "object" || save === null) errors.push("save is not an object");
  if (save?.subject === undefined) errors.push("missing subject block");
  const subject = save?.subject as { parts?: unknown } | undefined;
  if (subject?.parts !== undefined && !Array.isArray(subject.parts)) errors.push("subject.parts must be an array");
  return { ok: errors.length === 0, errors };
}
