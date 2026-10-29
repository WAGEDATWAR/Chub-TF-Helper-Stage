/**
 * The browser content bundle. Where `tools/content.ts` reads parent `data/` from
 * disk, this imports the same files as JSON and applies the **same** overlays via
 * the shared browser-safe `applyOverlays`. Result: the stage runs the exact merged
 * content the gates validated.
 *
 * Only the files the transformation engine needs are bundled (no town/dialogue),
 * which keeps the stage small.
 */
import { applyOverlays } from "../overlay";

import skeleton from "@gamedata/skeleton.json";
import parts from "@gamedata/parts.json";
import attributes from "@gamedata/attributes.json";
import traits from "@gamedata/traits.json";
import genomes from "@gamedata/genomes.json";
import morphTracks from "@gamedata/morph_tracks.json";
import exposureBands from "@gamedata/exposure_bands.json";
import feral from "@gamedata/feral.json";
import distribution from "@gamedata/distribution.json";
import phases from "@gamedata/phases.json";
import injectors from "@gamedata/injectors.json";
import events from "@gamedata/events.json";
import archetypes from "@gamedata/archetypes.json";
import names from "@gamedata/names.json";
import fragments from "@gamedata/fragments.json";
import tone from "@gamedata/tone.json";
import mind from "@gamedata/mind.json";
import mood from "@gamedata/mood.json";
import detect from "../../data/detect.json";
import coupling from "../../data/coupling.json";

import genomesExtra from "../../data/genomes.extra.json";
import feralExtra from "../../data/feral.extra.json";
import injectorsExtra from "../../data/injectors.extra.json";
import attributesExtra from "../../data/attributes.extra.json";
import partsExtra from "../../data/parts.extra.json";
import phasesExtra from "../../data/phases.extra.json";

const BASE: Record<string, unknown> = {
  skeleton,
  parts,
  attributes,
  traits,
  genomes,
  morph_tracks: morphTracks,
  exposure_bands: exposureBands,
  feral,
  distribution,
  phases,
  injectors,
  events,
  archetypes,
  names,
  fragments,
  tone,
  mind,
  mood,
  detect,
  coupling,
};

const OVERLAYS: Record<string, unknown> = {
  genomes: genomesExtra,
  feral: feralExtra,
  injectors: injectorsExtra,
  attributes: attributesExtra,
  parts: partsExtra,
  phases: phasesExtra,
};

/** The merged content set the stage runs. */
export function contentBundle(): Record<string, unknown> {
  return applyOverlays(BASE, OVERLAYS);
}
