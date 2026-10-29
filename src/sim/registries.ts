/**
 * Registry build over the merged (parent + overlay) content. The stage and the
 * authoring gate both go through here, so "the data is valid" and "the data the
 * stage runs" are the same bytes.
 */
import { buildSkeleton } from "@core/skeleton";
import { buildPartLibrary } from "@core/parts";
import { buildGenomeRegistry } from "@core/genomes";
import { buildTraitRegistry } from "@core/traits";
import { buildAttributeRegistry } from "@core/attributes";
import { buildMorphTrackRegistry } from "@core/morph";
import { buildExposureBandRegistry, buildFeralRegistry } from "@core/registries";
import { buildDistribution } from "@core/distribution";
import { buildPhaseSequencer } from "@core/phases";
import { buildInjectorRegistry } from "@core/injectors";
import { buildEventRegistry } from "@core/events";

export interface Registries {
  skeleton: ReturnType<typeof buildSkeleton>;
  library: ReturnType<typeof buildPartLibrary>;
  genomes: ReturnType<typeof buildGenomeRegistry>;
  traits: ReturnType<typeof buildTraitRegistry>;
  attributes: ReturnType<typeof buildAttributeRegistry>;
  morphTracks: ReturnType<typeof buildMorphTrackRegistry>;
  exposureBands: ReturnType<typeof buildExposureBandRegistry>;
  feral: ReturnType<typeof buildFeralRegistry>;
  distribution: ReturnType<typeof buildDistribution>;
  phases: ReturnType<typeof buildPhaseSequencer>;
  injectors: ReturnType<typeof buildInjectorRegistry>;
  events: ReturnType<typeof buildEventRegistry>;
  /** Raw mind/mood content, passed to subjects so emotions exist (H3). */
  data: { mind?: unknown; mood?: unknown };
}

export function buildRegistries(data: Record<string, unknown>): Registries {
  const library = buildPartLibrary(data.parts);
  return {
    data: { mind: data.mind, mood: data.mood },
    skeleton: buildSkeleton(data.skeleton),
    library,
    genomes: buildGenomeRegistry(data.genomes),
    traits: buildTraitRegistry(data.traits),
    attributes: buildAttributeRegistry(data.attributes),
    morphTracks: buildMorphTrackRegistry(data.morph_tracks, library),
    exposureBands: buildExposureBandRegistry(data.exposure_bands ?? { bands: [] }),
    feral: buildFeralRegistry(data.feral ?? { profiles: [] }),
    distribution: buildDistribution(data.distribution ?? {}),
    phases: buildPhaseSequencer(data.phases),
    injectors: buildInjectorRegistry(data.injectors ?? { injectors: [] }),
    events: buildEventRegistry(data.events ?? { events: [] }),
  };
}
