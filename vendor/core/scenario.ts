import { ContentError } from "./loader";

/**
 * Scenario files (Playground borrow, S73). An executable acceptance test: build a
 * world from a seed, run scripted inputs, take a state digest at checkpoints, and
 * assert against recorded pins — so a roadmap "done when" line is a file, not prose.
 *
 * Data (`scenarios/*.json`); the runner (`tools/scenario.ts`) supplies the harness.
 */
export const SCENARIO_VERSION = 1;

export type ScenarioStep =
  | { do: "commit"; power: string; dose?: number }
  | { do: "advance"; ticks: number }
  | { do: "advanceDays"; days: number }
  | { do: "assertDay"; day: number }
  | { do: "digest"; name: string }
  | { do: "checkFlag"; flag: string; equals?: boolean };

export interface Scenario {
  version: number;
  name: string;
  /** The focus seed, so a run is reproducible. */
  seed: number;
  steps: ScenarioStep[];
}

export function buildScenario(data: unknown): Scenario {
  const d = data as Partial<Scenario> | null | undefined;
  if (!d || typeof d.seed !== "number" || !Array.isArray(d.steps)) {
    throw new ContentError("a scenario needs a numeric seed and a steps array", "scenario");
  }
  return { version: d.version ?? SCENARIO_VERSION, name: d.name ?? "scenario", seed: d.seed, steps: d.steps as ScenarioStep[] };
}

export interface ScenarioResult {
  name: string;
  digests: Record<string, string>;
  failures: string[];
  ok: boolean;
}

/** Run a scenario against provided hooks (the runner binds these to a real session). */
export function runScenario(
  scenario: Scenario,
  io: {
    create: (seed: number) => void;
    commit: (power: string, dose: number) => void;
    advance: (ticks: number) => void;
    digest: () => string;
    flag: (name: string) => boolean;
    day: () => number;
  },
): ScenarioResult {
  const digests: Record<string, string> = {};
  const failures: string[] = [];
  io.create(scenario.seed);
  for (const step of scenario.steps) {
    switch (step.do) {
      case "commit": io.commit(step.power, step.dose ?? 1); break;
      case "advance": io.advance(step.ticks); break;
      case "advanceDays": io.advance(step.days * 24); break;
      case "digest": digests[step.name] = io.digest(); break;
      case "assertDay":
        if (io.day() !== step.day) failures.push(`expected day ${step.day}, at ${io.day()}`);
        break;
      case "checkFlag":
        if (io.flag(step.flag) !== (step.equals ?? true)) failures.push(`flag ${step.flag} expected ${step.equals ?? true}`);
        break;
      default:
        failures.push(`unknown step ${(step as { do: string }).do}`);
    }
  }
  return { name: scenario.name, digests, failures, ok: failures.length === 0 };
}
