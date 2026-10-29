/**
 * Reason codes (Playground borrow, S72). Every decision the simulation makes for a
 * reason — which activity an agent chose, why an obligation was gated, why a bond
 * moved, why a notice fired — stores a **stable code**, the **source** that decided
 * it, and a small bag of typed params. A template table renders each code as a plain
 * sentence; a lint keeps codes and templates in step, and `dev-cli why` answers a
 * question from the recorded reasons.
 *
 * This is the machine-readable half of "every outcome is explainable from state"
 * (blueprint P-series; §17.5). Reasons are derived, not authoritative: they never
 * enter the save or a hash.
 */
export const REASON_VERSION = 1;

export interface ReasonParams {
  [k: string]: string | number | boolean;
}

export interface ReasonCode {
  /** Stable code, e.g. `town.chose_scheduled`. */
  code: string;
  /** Who decided: the engine, or a data id (a future pack hook). */
  source: string;
  params: ReasonParams;
}

/** Sentence templates. `{name}` is filled from a param; unknown params render "?". */
const TEMPLATES: Record<string, string> = {
  // town activity choice
  "town.chose_scheduled": "the day-plan schedules {activity}, so it was taken",
  "town.chose_deficit": "{activity} was scored highest for the {need} deficit ({deficit})",
  "town.chose_starved": "{need} was starved ({value}), so {activity} overrode the plan",
  "town.chose_leisure": "no plan and no deficit, so {activity} was chosen (jitter {roll})",
  "town.chose_tiebreak": "{activity} won the id tie-break",
  // obligations
  "obl.gated_tag": "{obligation} needs {tag}, which the body now lacks",
  "obl.gated_attr": "{obligation} is impossible with {attr}",
  "obl.gated_capacity": "{obligation} is impossible: {key} is only {value}/1000",
  "obl.late": "{obligation} is running late (lateness {lateness}/{window})",
  "obl.missed": "{obligation} was missed after {lateness} ticks late",
  "obl.attended": "{obligation} was attended on time",
  // social
  "soc.reacted": "{observer} reacted to {change} ({valence})",
  "soc.tempered": "{observer} barely reacted to {change}: familiarity {familiarity}",
  "soc.skipped": "{observer} did not react: nothing about the change registered",
  "soc.bond_moved": "{observer}'s bond moved {delta} toward {subject} after {change}",
  // events
  "event.started": "{event} started at {where}",
  "event.resolved": "{event} resolved with {count} present (subject {present})",
  "event.bond_moved": "{observer}'s bond with {subject} moved {delta} at {label}",
  // consequences
  "con.fire": "{rule} fired: {note}",
  // needs / causal web
  "need.decay": "{need} decayed {amount} over {hours}h",
  "need.drain": "a changing body ({source}) drained {need} by {amount}",
};

export function buildReason(code: string, source: string, params: ReasonParams = {}): ReasonCode {
  return { code, source, params };
}

/** Render a reason as a plain sentence. Unknown codes fall back to the code itself. */
export function render(reason: ReasonCode): string {
  const template = TEMPLATES[reason.code];
  if (!template) return reason.code;
  return template.replace(/\{(\w+)\}/g, (_m, key) => {
    const v = reason.params[key];
    return v === undefined ? "?" : String(v);
  });
}

export function knownCodes(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * A bounded ring of the most recent reasons (Playground keeps reasons with the
 * current day's schedule). Derived, dropped on rollover, never saved.
 */
export const REASON_RING_CAPACITY = 400;

export class ReasonRing {
  readonly capacity: number;
  private readonly entries: Array<ReasonCode & { tick: number; subject: string }> = [];

  constructor(capacity = REASON_RING_CAPACITY) {
    this.capacity = capacity;
  }
  get size(): number {
    return this.entries.length;
  }
  add(subject: string, tick: number, reason: ReasonCode): void {
    this.entries.push({ ...reason, tick, subject });
    if (this.entries.length > this.capacity) this.entries.shift();
  }
  /** Reasons for one subject, newest first, optionally filtered by code prefix. */
  forSubject(subject: string, prefix = ""): Array<ReasonCode & { tick: number }> {
    return this.entries.filter((e) => e.subject === subject && e.code.startsWith(prefix)).reverse();
  }
  clear(): void {
    this.entries.length = 0;
  }
  all(): Array<ReasonCode & { tick: number; subject: string }> {
    return [...this.entries];
  }
}
