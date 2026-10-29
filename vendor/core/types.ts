import type { TraitRegistry } from "./traits";
import type { AttributeRegistry } from "./attributes";
import type { MorphTrackRegistry } from "./morph";
import type { PartLibrary } from "./parts";
import type { Distribution } from "./distribution";
import type { PhaseSequencer } from "./phases";
import type { GenomeRegistry } from "./genomes";
import type { ReactionCatalog } from "./registries";
import type { DispositionTable } from "./reactions";

/** Registries the resolver/power pipeline needs. */
export interface ResolverRegistries {
  traits: TraitRegistry;
  attributes: AttributeRegistry;
  morphTracks: MorphTrackRegistry;
  library: PartLibrary;
  distribution?: Distribution | null;
  phases?: PhaseSequencer | null;
  genomes?: GenomeRegistry | null;
  reactions: ReactionCatalog;
  dispositionTable: DispositionTable | null;
  /** Evaluates a phase `when` gate (D-248) against the caller's world state. */
  whenOpen?: ((when: Record<string, unknown>) => boolean) | null;
}
