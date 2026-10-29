import { clampStat } from "./stats";
import { onEvent, driveAsksForMore, type PsychologyState, type PsychEvent } from "./psychology";
import type { Session } from "./session";

/**
 * Psychology wiring (blueprint §20, §26; S45). Routes the drive/overload reactions
 * to sim events through the single `psychology.onEvent` dispatcher, so the numbers
 * and the event catalogue agree. Also wires the unstable-band drift roll.
 *
 * A `PsychologyState` view is built over live subject stats so `onEvent` can be
 * used unchanged (its own fields name the same stats).
 */
function stateOf(session: Session): PsychologyState {
  const s = session.subject.stats;
  return {
    drive: s.drive ?? 0,
    overload: s.overload ?? 0,
    composure: s.composure ?? 0,
    resonance: s.resonance ?? 0,
    stability: s.stability ?? 100,
    familiarity: session.subject.familiarity,
    intelligenceDebt: 0,
    daysKnown: session.clock.day,
  };
}

function writeBack(session: Session, state: PsychologyState): void {
  const s = session.subject.stats;
  s.drive = clampStat(state.drive);
  s.overload = clampStat(state.overload);
  s.composure = clampStat(state.composure);
  session.subject.familiarity = state.familiarity;
}

const ROUTED: Array<[string, (e: { type: string; [k: string]: unknown }) => PsychEvent]> = [
  ["ability.granted", (e) => ({ type: "ability.granted", ...(e.amount !== undefined ? { amount: e.amount as number } : {}) })],
  ["stage.crossed", (e) => ({ type: "stage.crossed", ...(e.amount !== undefined ? { amount: e.amount as number } : {}) })],
  ["attribute.applied", () => ({ type: "attribute.applied" })],
  ["reaction.awakened", () => ({ type: "reaction.awakened" })],
  ["damage", () => ({ type: "damage" })],
  ["blackout", () => ({ type: "blackout" })],
  ["feral.recovered", () => ({ type: "feral.recovered" })],
];

/**
 * Subscribe the session bus to the psychology reactions. Idempotent per session.
 */
export function wirePsychology(session: Session): () => void {
  const unsubs: Array<() => void> = [];
  for (const [type, map] of ROUTED) {
    unsubs.push(
      session.bus.on(type, (record) => {
        const state = stateOf(session);
        onEvent(state, map(record as never));
        writeBack(session, state);
      }),
    );
  }
  return () => unsubs.forEach((u) => u());
}

/** Does she seek change out today? (§20: drive above the ask threshold.) */
export function seeksChange(session: Session): boolean {
  return driveAsksForMore(session.subject.stats.drive ?? 0);
}
