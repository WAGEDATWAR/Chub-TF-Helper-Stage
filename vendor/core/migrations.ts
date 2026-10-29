import { SAVE_VERSION } from "./persistence";

export interface Migration {
  to: number;
  fn: (save: Record<string, unknown>) => Record<string, unknown>;
  note: string;
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  0: {
    to: 1,
    fn: (save) => ({
      ...save,
      version: 1,
      research: save.research ?? {},
      progression: save.progression ?? { discoveredGenomes: [], essences: [], ingredients: [] },
      settings: save.settings ?? { locale: "en", reduceMotion: false, textScale: 100, colourBlindBands: false },
      dev: save.dev ?? { touched: false },
    }),
    note: "v0 -> v1: add research/progression/settings/dev blocks.",
  },
});

export function hasMigration(fromVersion: number): boolean {
  return Object.prototype.hasOwnProperty.call(MIGRATIONS, fromVersion);
}

export function migrateToCurrent(
  save: Record<string, unknown>,
  { migrations = MIGRATIONS, target = SAVE_VERSION }: { migrations?: Readonly<Record<number, Migration>>; target?: number } = {},
): { save: Record<string, unknown>; applied: Array<{ from: number; to: number; note: string }> } {
  if (!save || typeof save !== "object") {
    throw new Error("migrations: a save object is required");
  }
  let current: Record<string, unknown> = { ...save, version: (save.version as number) ?? 0 };
  const applied: Array<{ from: number; to: number; note: string }> = [];
  let guard = 0;
  while ((current.version as number) < target) {
    const from = current.version as number;
    const step = migrations[from];
    if (!step) {
      throw new Error(`migrations: no migration from version ${from}`);
    }
    current = step.fn(current);
    if (current.version === from) {
      throw new Error(`migrations: migration from ${from} did not advance the version`);
    }
    applied.push({ from, to: current.version as number, note: step.note ?? "" });
    guard++;
    if (guard > 1000) throw new Error("migrations: runaway migration loop");
  }
  return { save: current, applied };
}

export function migrationChain(fromVersion: number, target = SAVE_VERSION): Array<{ from: number; to: number }> {
  const chain: Array<{ from: number; to: number }> = [];
  let v = fromVersion;
  let guard = 0;
  while (v < target) {
    const step = MIGRATIONS[v];
    if (!step) break;
    chain.push({ from: v, to: step.to });
    v = step.to;
    guard++;
    if (guard > 1000) break;
  }
  return chain;
}

export function isIdempotent(
  save: Record<string, unknown>,
  { migrations = MIGRATIONS, target = SAVE_VERSION }: { migrations?: Readonly<Record<number, Migration>>; target?: number } = {},
): boolean {
  const once = migrateToCurrent(save, { migrations, target }).save;
  const twice = migrateToCurrent(once, { migrations, target }).save;
  return JSON.stringify(once) === JSON.stringify(twice);
}
