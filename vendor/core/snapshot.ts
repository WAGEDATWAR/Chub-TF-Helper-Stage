import type { Session } from "./session";
import { blockOf } from "./time_engine";
import { OBSERVER_SKILLS } from "./observer";
import { sexualCoherence, sexualityRead } from "./sexuality";
import { sexualFrustration } from "./sex";
import { milkFullness, fullnessLabel, inflateCup } from "./lactation";
import { buildDayView } from "./day_view";
import type { SceneRender } from "./scene_composer";
import { buildStatBreakdown, summarizeBreakdown } from "./stat_breakdown";
import { FULL_CAPACITY, CAPACITY_KEYS } from "./capacity";

const DEFAULT_CAPACITIES = Object.fromEntries(CAPACITY_KEYS.map((k) => [k, FULL_CAPACITY])) as import("./capacity").Capacities;

/**
 * The ObserverSnapshot (blueprint §54; presentation spec §6). A single typed
 * core→UI read-model: the UI renders this and derives nothing.
 */
export interface SnapshotStat {
  id: string;
  value: number;
  /** Pressable breakdown (D-200): what affects the value, or a dynamic note. */
  sources: Array<{ label: string; detail: string; value: number }>;
  sourceNote: string;
}

export interface SnapshotPower {
  id: string;
  label: string;
  category: string;
  cost: number;
  tier: number;
  available: boolean;
  reason: string | null;
  /** A one-line hint (D-200): what the power does, or why it is unavailable. */
  hint: string;
}

/** A drawn body-ledger row (presentation spec §4 P4): fixed columns + pips. */
export interface SnapshotLedgerRow {
  slot: string;
  region: string;
  side: string | null;
  part: string;
  partId: string;
  /** The slot's role (D-201), for the tree group and child ordering. */
  role: string;
  stage: string | null;
  /** 0..100, for the drawn pip column. */
  progress: number;
  changed: boolean;
  /** The parent slot in the tree (D-201), or null at a group root. */
  parent: string | null;
  /** Attributes on this part, for the character-sheet read (name + progress). */
  attributes: Array<{ id: string; name: string; progress: number }>;
}

/** A drawn ability row: mastery, tier, held/latent, instinct. */
export interface SnapshotAbility {
  id: string;
  name: string;
  category: string;
  held: boolean;
  index: number;
  tier: number;
  tierName: string;
  instinct: boolean;
  mastery: number;
}

/** A belief row: what she believes about a change, beside the truth (D-134). */
export interface SnapshotBelief {
  id: string;
  name: string;
  believed: boolean;
  path: string | null;
  /** When she last changed this belief (tick), for the belief card (M16.5c). */
  changedAtTick: number | null;
  /** The belief's contribution to awareness (0..1), for the card. */
  awarenessContribution: number;
}

/** The identity read: arc, self-image, noticed/unnoticed counts (§24). */
export interface SnapshotIdentity {
  arc: string;
  coherence: number;
  dysmorphia: number;
  pride: number;
  acceptance: number;
  noticed: number;
  unnoticed: number;
}

export interface ObserverSnapshot {
  version: string;
  clock: { tick: number; day: number; block: string; speed: number | "pause" };
  subject: {
    id: string;
    name: string;
    band: string;
    transformState: string;
    exposure: number;
    health: number;
    /** Derived capability record (S76): permille abilities the surface reads. */
    capacities: import("./capacity").Capacities;
    /** Creation identity (D-158/E-66): read on the dossier. */
    age: number | null;
    height: number | null;
    sexuality: string | null;
    sexualCoherence: string;
    sexualityDrift: number;
    sexualityRead: string;
    pronouns: string | null;
    /** The mind model (M15.5a): value reads + awareness tier. Curated reach. */
    mind: Array<{ id: string; label: string; value: number; target: number; baseline: number; kind: string; axis: [string, string] | null }>;
    awareness: number;
    awarenessTier: string;
    /** The mood read (M15.5a): mixed label + gamut point + band. */
    mood: { label: string; band: string; valence: number; arousal: number; dominance: number };
    /** Sexual frustration (M15.5f): derived, 0..100. */
    frustration: number;
    stats: SnapshotStat[];
    dispositions: Array<{ reactionId: string; strength: number }>;
    reactions: Array<{ id: string; type: string; strength: number; awakenedAtTick: number; context: string; tags: string[]; displayName: string }>;
    /** Settled preferences (M15.5c): the crystallized outcome of reactions. */
    preferences: Array<{ topic: string; kind: string; tier: string; opinion: number; rule: string | null; settledAtTick: number }>;
    /** A compact status line standing in for a rendered figure (P5). */
    statusLine: string;
    /** A named drift residue (S56): body parts a recent drift left a flinch in. */
    drift: string[];
    /** The changing parts, for the ledger dense read. */
    ledger: SnapshotLedgerRow[];
    /** Held/latent abilities with mastery + tier (§15). */
    abilities: SnapshotAbility[];
    /** What she is practising, if a recent self-driven session (readable). */
    practising: string | null;
    /** Her beliefs about her own change, beside the truth (D-134). */
    beliefs: SnapshotBelief[];
    /** The identity read (§24). */
    identity: SnapshotIdentity | null;
    /** Her last active inspect (D-199), if any. */
    lastInspect: string | null;
  };
  /** Feral lock and lock debt (§19.2, §27). */
  feral: { locked: boolean; profile: string | null; debt: number; slurredSpeech: boolean; greyedOptions: boolean; holdLockout: boolean };
  /** A live resistance (§25): cause, pressure and whether it is pressing (M14.10). */
  resistance: { cause: string; pressure: number } | null;
  observer: {
    charge: number;
    chargeMax: number;
    wellbeing: SnapshotStat[];
    stats: SnapshotStat[];
    /** Progress (0..1) toward the next point of each skill (§S67). */
    skillProgress: Array<{ id: string; value: number; progress: number }>;
    /** The Observer's touch steadiness (0..1): how precisely a dose lands (§11.5). */
    steadiness: number;
    /** The current fractional dose scatter (percent, 0 = exact). */
    touchSpread: number;
  };
  scene: {
    id: string | null;
    location: string | null;
    prose: string;
    objects: string[];
    relations: string[];
  };
  journal: Array<{ day: number; summary: string }>;
  toasts: string[];
  powers: SnapshotPower[];
  reveal: { mode: string; part: string | null } | null;
  /** The salience-gated story log (§3.3): what happened, worth reading. */
  story: Array<{ day: number; text: string; type: string; sal: number }>;
  /** The canonical timeline (S67): one ordered walk, newest last. */
  timeline: SnapshotTimelineEntry[];
  /** The day-grouped view (D-215): entries with prose blocks + changed chips. */
  days: import("./day_view").SnapshotDay[];
  /** Marker ticks, oldest first (dev rewind stops). */
  markers: Array<{ tick: number; label: string }>;
  /** The town map (M16a): who is where, as data. */
  town: {
    agents: Array<{ id: string; name: string; at: string; atName: string; doing: string | null; subject: boolean; late: boolean; household: string | null }>;
    locations: Array<{ id: string; name: string; here: string[] }>;
    /** Live town events (M16b, §47): the world, independent of the subject. */
    events: Array<{ id: string; label: string; whereName: string; remaining: number }>;
    /** The subject's relationships (M16b, §45): type + bond, for the map. */
    relationships: Array<{ to: string; name: string; type: string; bond: number }>;
    /** The subject's most relevant memories right now (S74), best first. */
    memories: Array<{ key: string; importance: number; when: string }>;
  };
}

export interface SnapshotTimelineEntry {
  id: number;
  tick: number;
  day: number;
  kind: string;
  type: string;
  text: string;
  parentId: number | null;
  markers: string[];
}

export interface SnapshotOptions {
  sceneId?: string | null;
  render?: SceneRender | null;
  locationName?: string | null;
  powers?: SnapshotPower[];
  toasts?: string[];
  story?: Array<{ day: number; text: string; type: string; sal: number }>;
  abilities?: SnapshotAbility[];
  beliefs?: SnapshotBelief[];
  identity?: SnapshotIdentity | null;
  feral?: ObserverSnapshot["feral"];
  resistance?: { cause: string; pressure: number } | null;
}

const STAT_ORDER = [
  "intelligence",
  "strength",
  "agility",
  "endurance",
  "perception",
  "pain",
  "arousal",
  "drive",
  "composure",
  "resonance",
  "stability",
  "fatigue",
  "overload",
];

/** Slot prefix -> region. Covers the real skeleton slot names. */
const REGION_BY_PREFIX: Array<[RegExp, string]> = [
  [/^head|^face|^ears|^eyes|^horns|^nose|^mouth|^tongue|^teeth|^fangs|^hair/, "head"],
  [/^torso|^chest|^breasts|^nipples|^abdomen|^back/, "torso"],
  [/^arm/, "arm"],
  [/^hand|^fingers|^nails\.hand/, "hand"],
  [/^leg/, "leg"],
  [/^foot|^feet|^toes|^nails\.foot/, "foot"],
  [/^tail/, "tail"],
  [/^pelvis|^genital|^cloaca/, "groin"],
  [/^wings/, "wings"],
];

function regionOf(slot: string): string {
  for (const [re, region] of REGION_BY_PREFIX) if (re.test(slot)) return region;
  return "body";
}

function sideOf(slot: string): string | null {
  const m = /\.(L|R)$/.exec(slot);
  return m ? (m[1] === "L" ? "left" : "right") : null;
}

function humanize(id: string): string {
  return id
    .replace(/^(attr|part|genome|react)\./, "")
    .replace(/^human_/, "")
    .replace(/_/g, " ")
    .replace(/\bside\b/, "")
    .trim();
}

/** Every part, with its attributes, for the character-sheet ledger. */
function buildLedger(session: Session): SnapshotLedgerRow[] {
  const rows: SnapshotLedgerRow[] = [];
  const skeleton = session.subject.body.skeleton;
  for (const inst of session.subject.body.allInstances()) {
    if (inst.role === "root") continue;
    if (/_absent$/.test(inst.id)) continue;
    const progress = inst.attributes.reduce((m, a) => Math.max(m, a.progress), 0);
    const changed = progress > 0;
    const slotData = skeleton.get(inst.slot);
    // a breast part carries a tracked milk fullness; a fuller breast also reads
    // larger, so fullness inflates the base cup (D-212 mini-tweak). The base cup
    // is stored once so repeated snapshots do not compound the inflation.
    if ((inst.tags ?? []).includes("breasts_tag")) {
      const fullness = milkFullness(session.subject);
      inst.appearance.fullness = fullnessLabel(fullness);
      if (inst.appearance.cup) {
        if (!inst.appearance.cup_base) inst.appearance.cup_base = inst.appearance.cup;
        inst.appearance.cup = inflateCup(inst.appearance.cup_base, fullness);
      }
    }
    rows.push({
      slot: inst.slot,
      region: regionOf(inst.slot),
      side: sideOf(inst.slot),
      part: inst.displayName(humanize(inst.id)),
      partId: inst.id,
      role: inst.role,
      parent: slotData?.parent ?? null,
      stage: inst.attributes[0] ? stageNameOf(inst.attributes[0]) : null,
      progress: Math.round((progress / 1000) * 100),
      changed,
      attributes: inst.attributes
        .filter((a) => a.progress > 0)
        .map((a) => ({ id: a.id, name: humanize(a.id), progress: Math.round((a.progress / 1000) * 100) })),
    });
  }
  // parent-absolute order (D-201): no changed-first reordering, so a part stays
  // under its parent group in a stable place as it changes.
  const regionRank = (r: string) => ["head", "torso", "arm", "hand", "leg", "foot", "tail", "wings", "groin", "body"].indexOf(r);
  return rows.sort((a, b) => regionRank(a.region) - regionRank(b.region) || a.slot.localeCompare(b.slot));
}

function stageNameOf(entry: { stage_index: number }): string | null {
  return entry.stage_index > 0 ? `stage ${entry.stage_index}` : null;
}

/** A compact "exposure · band · the parts changing" line (P5). */
function buildStatusLine(session: Session, ledger: SnapshotLedgerRow[]): string {
  const s = session.subject;
  const exposure = s.derived.exposure ?? 0;
  const band = (s.derived.transformState ?? "baseline").replace(/_/g, " ");
  const parts = [...new Set(ledger.filter((r) => r.changed).map((r) => r.part))].slice(0, 3);
  const tail = parts.length > 0 ? ` — ${parts.join(", ")} changing` : "";
  return `exposure ${Math.round(exposure)}% · ${band}${tail}`;
}

function buildTownMap(session: Session): ObserverSnapshot["town"] {
  const town = session.town;
  if (!town) return { agents: [], locations: [], events: [], relationships: [], memories: [] };
  const name = (id: string): string => session.locationNames.get(id) ?? id.replace(/^loc\./, "").replace(/_/g, " ");
  const agents = town.all().map((a) => ({
    id: a.id,
    name: town.def(a.id)?.name ?? a.id,
    at: a.at,
    atName: name(a.at),
    doing: a.current,
    subject: a.subject,
    late: a.lateness > 0,
    household: a.household,
  }));
  const byLoc = new Map<string, string[]>();
  for (const a of agents) byLoc.set(a.at, [...(byLoc.get(a.at) ?? []), a.name]);
  const locations = [...byLoc.entries()].map(([id, here]) => ({ id, name: name(id), here }));
  const events = (session.townEvents?.active() ?? []).map((e) => ({
    id: e.id,
    label: session.townEvents!.registry.get(e.def)?.label ?? e.def,
    whereName: name(e.where),
    remaining: e.remaining,
  }));
  const subject = town.state("subject");
  const relationships = (subject?.relationships ?? []).map((r) => ({
    to: r.to,
    name: town.def(r.to)?.name ?? r.to,
    type: r.type,
    bond: Math.round(r.bond),
  })).sort((a, b) => b.bond - a.bond);
  const memories = (subject?.memory.relevant({ tick: session.clock.tick }, 5) ?? []).map((r) => ({
    key: r.memory.summary_key,
    importance: r.memory.importance,
    when: `day ${Math.floor(r.memory.tick / 24) + 1}`,
  }));
  return { agents, locations, events, relationships, memories };
}

export function buildSnapshot(session: Session, opts: SnapshotOptions = {}): ObserverSnapshot {
  const s = session.subject;
  const stats: SnapshotStat[] = STAT_ORDER.filter((id) => id in s.stats).map((id) => {
    const breakdown = buildStatBreakdown(session, id, s.genomesRegistry ?? null);
    return { id, value: s.derived.bandStats?.[id] ?? s.stats[id] ?? 0, sources: breakdown.sources, sourceNote: summarizeBreakdown(breakdown) };
  });
  const ledger = buildLedger(session);
  const statusLine = buildStatusLine(session, ledger);
  return {
    version: "0.1.0",
    clock: {
      tick: session.clock.tick,
      day: session.clock.day,
      block: blockOf(session.clock.tick),
      speed: session.clock.speed,
    },
    subject: {
      id: s.id,
      name: s.displayName,
      band: s.derived.band ?? "band.baseline",
      transformState: s.derived.transformState ?? "baseline",
      exposure: s.derived.exposure ?? 0,
      health: s.derived.globalHealth ?? 100,
      capacities: s.derived.capacities ?? DEFAULT_CAPACITIES,
      age: s.age,
      height: s.height,
      sexuality: s.sexuality,
      sexualCoherence: sexualCoherence(s),
      sexualityDrift: Number((s.sexualityDrift ?? 0).toFixed(3)),
      sexualityRead: sexualityRead(s),
      pronouns: s.pronouns ?? null,
      mind: s.mind
        ? s.mind.ids().map((id) => ({ id, label: s.mind!.labels.get(id) ?? id, value: Math.round(s.mind!.read(id)), target: Math.round(s.mind!.get(id)?.target ?? 0), baseline: Math.round(s.mind!.get(id)?.baseline ?? 0), kind: s.mind!.kinds.get(id) ?? "core", axis: s.mind!.axes.get(id) ?? null }))
        : [],
      awareness: Math.round(s.mind?.awareness ?? 0),
      awarenessTier: s.mind?.tier() ?? "blind",
      mood: s.mood
        ? { label: s.mood.label(), band: s.mood.band(), ...s.mood.point() }
        : { label: "even", band: "neutral-still", valence: 50, arousal: 30, dominance: 50 },
      frustration: sexualFrustration(session),
      stats,
      dispositions: s.dispositions.map((d) => ({ ...d })),
      reactions: s.reactions.map((r) => {
        const def = session.reactionCatalog?.get(r.id);
        return { id: r.id, type: r.type as string, strength: r.strength, awakenedAtTick: r.awakenedAtTick, context: r.context, tags: (def?.match.tags ?? []) as string[], displayName: (def?.display_name as string | undefined) ?? r.id.replace(/^react\./, "") };
      }),
      preferences: s.preferences.all().map((p) => ({ topic: p.topic, kind: p.kind, tier: p.tier, opinion: Math.round(p.opinion), rule: p.rule ?? null, settledAtTick: p.settledAtTick })),
      statusLine,
      drift: [...session.flags].filter((f) => f.startsWith("flinch_")).map((f) => f.replace(/^flinch_/, "").replace(/_/g, " ")),
      ledger,
      abilities: opts.abilities ?? [],
      practising: session.practising,
      beliefs: opts.beliefs ?? [],
      identity: opts.identity ?? null,
      lastInspect: session.inspectState.last?.line ?? null,
    },
    feral: opts.feral ?? { locked: false, profile: null, debt: 0, slurredSpeech: false, greyedOptions: false, holdLockout: false },
    resistance: opts.resistance ?? null,
    observer: {
      charge: session.observer.charge,
      chargeMax: session.observer.chargeMax,
      wellbeing: Object.entries(session.observer.wellbeing).map(([id, value]) => ({ id, value, sources: [], sourceNote: "" })),
      stats: Object.entries(session.observer.stats).map(([id, value]) => ({ id, value, sources: [], sourceNote: "" })),
      skillProgress: OBSERVER_SKILLS.map((id) => ({ id, value: session.observer.stats[id] ?? 0, progress: Number(session.observer.skillProgress(id).toFixed(3)) })),
      steadiness: Number(session.observer.touchSteadiness().toFixed(2)),
      touchSpread: Number((session.observer.doseScatter() * 100).toFixed(1)),
    },
    scene: {
      id: opts.sceneId ?? null,
      location: opts.locationName ?? null,
      prose: opts.render?.prose ?? "",
      objects: opts.render?.objects ?? [],
      relations: opts.render?.relations ?? [],
    },
    journal: session.journal.tail(20).map((e) => ({ day: e.day, summary: e.summary })).reverse(),
    toasts: opts.toasts ?? [],
    powers: opts.powers ?? [],
    reveal: session.reveal,
    story: opts.story ?? session.bus.tale().map((l) => ({ day: l.day, text: l.text, type: l.type, sal: l.sal })),
    timeline: session.timeline.walk().map((e) => ({ id: e.id, tick: e.tick, day: e.day, kind: e.kind, type: e.type, text: e.text, parentId: e.parentId, markers: [...e.markers] })),
    days: buildDayView(session),
    markers: session.timeline.rewindTicks(),
    town: buildTownMap(session),
  };
}
