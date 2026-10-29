/**
 * Content loader: reads the parent game's `data/*.json`, then merges this
 * stage's `data/*.extra.json` overlays on top (arrays concatenated, maps
 * merged). The merged set is what the parent validator and the authoring gate
 * run over — so a new genome is only "real" once it passes both.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJson } from "@core/loader";
import { applyOverlays } from "../src/overlay";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DATA = join(ROOT, "data");
// the parent's `data/` is vendored under `vendor/` (see tools/sync-vendor.ps1), so
// local dev and CI merge the same base before the local overlays are applied
export const PARENT = join(ROOT, "vendor");
export const PARENT_DATA = join(PARENT, "data");

function readDir(dir: string, suffix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(suffix)) continue;
    const key = f.replace(/\.extra\.json$/, "").replace(/\.json$/, "");
    out[key] = parseJson(readFileSync(join(dir, f), "utf8"), f);
  }
  return out;
}

/** The merged content set (parent data + local overlays), post-processed to
 *  match how the parent's own `tools/validate.ts` shapes dialogue/prose. */
export function mergedContentSet(): Record<string, unknown> {
  const base = readDir(PARENT_DATA, ".json");
  const overlays = readDir(DATA, ".extra.json");
  const out = applyOverlays(base, overlays);
  // local (non-extra) data: detection cue tables + fantasy coupling
  if (hasLocalData("detect.json")) out.detect = localData("detect.json");
  if (hasLocalData("coupling.json")) out.coupling = localData("coupling.json");
  // dialogue/*.json aggregate; prose.json is a `keys` array (parent parity)
  out.dialogue = aggregateDir(join(PARENT_DATA, "dialogue"), (p) => (p as { keys?: unknown[] }).keys ?? []);
  const prose = (out.prose as { keys?: unknown[] } | undefined)?.keys;
  out.prose = prose ?? [];
  return out;
}

function aggregateDir(dir: string, pick: (parsed: unknown) => unknown[]): unknown[] {
  const out: unknown[] = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    out.push(...pick(parseJson(readFileSync(join(dir, f), "utf8"), `dialogue/${f}`)));
  }
  return out;
}

/** A local (non-extra) data file, e.g. lunar.json / detect.json. */
export function localData(name: string): unknown {
  const path = join(DATA, name.endsWith(".json") ? name : `${name}.json`);
  if (!existsSync(path)) throw new Error(`no local data: ${name}`);
  return parseJson(readFileSync(path, "utf8"), name);
}

export function hasLocalData(name: string): boolean {
  return existsSync(join(DATA, name.endsWith(".json") ? name : `${name}.json`));
}
