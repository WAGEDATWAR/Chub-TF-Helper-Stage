import { ContentError, indexById } from "./loader";
import type { PartLibrary } from "./parts";

export interface MorphStep {
  at: number;
  part: string;
  /** The transformation phase this step belongs to (default 0). A step in a later
   *  phase is held until that phase opens, so a first-phase track can stop partway
   *  (e.g. reach "sharpening nails") and only continue once the next phase opens. */
  phase?: number;
  /**
   * Appearance values this step stamps onto the instance as it is reached (D-249),
   * e.g. `{ colour: "amber" }`. Lets a track stage a *recolour* (shifting eye colour)
   * across progress/phases, not only a part swap. Applied idempotently each tick.
   */
  appearance?: Record<string, string>;
}

export interface MorphTrack {
  id: string;
  occupies_role: string;
  steps: MorphStep[];
  on_step?: { integrity_cost?: number; pain_on_stage?: number };
}

export interface MorphStepEvent extends MorphStep {
  direction: "forward" | "reverse";
  index: number;
}

export class MorphTrackRegistry {
  private readonly byId: Map<string, MorphTrack>;
  /** trackId -> prefix-max of reachable `at` per open phase (O(1) cap lookups). */
  private readonly caps = new Map<string, number[]>();
  readonly library: PartLibrary | null;

  constructor(tracks: MorphTrack[], library: PartLibrary | null = null) {
    this.byId = indexById(tracks, "morph_tracks.json");
    this.library = library;
    for (const track of tracks) {
      const phases = track.steps.map((s) => s.phase ?? 0);
      const maxPhase = Math.max(0, ...phases);
      const caps = new Array<number>(maxPhase + 1).fill(0);
      let running = 0;
      for (let p = 0; p <= maxPhase; p++) {
        for (const s of track.steps) if ((s.phase ?? 0) === p) running = Math.max(running, s.at);
        caps[p] = running;
      }
      this.caps.set(track.id, caps);
    }
    for (const track of tracks) {
      if (typeof track.occupies_role !== "string") {
        throw new ContentError(`morph track "${track.id}" is missing "occupies_role"`, "morph_tracks.json");
      }
      const steps = track.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new ContentError(`morph track "${track.id}" must declare a non-empty "steps" array`, "morph_tracks.json");
      }
      let prev = -1;
      for (const step of steps) {
        if (typeof step.at !== "number" || step.at < 0 || step.at > 1) {
          throw new ContentError(`morph track "${track.id}" step "at" must be 0..1`, "morph_tracks.json");
        }
        if (step.at <= prev) {
          throw new ContentError(`morph track "${track.id}" step "at" values must be strictly ascending`, "morph_tracks.json");
        }
        prev = step.at;
        if (typeof step.part !== "string") {
          throw new ContentError(`morph track "${track.id}" step is missing a "part"`, "morph_tracks.json");
        }
        if (this.library) {
          const template = this.library.get(step.part);
          if (!template) {
            throw new ContentError(`morph track "${track.id}" references unknown part "${step.part}"`, "morph_tracks.json");
          }
          if (template.occupies_role !== track.occupies_role) {
            throw new ContentError(
              `morph track "${track.id}" step part "${step.part}" occupies "${template.occupies_role}", not "${track.occupies_role}"`,
              "morph_tracks.json",
            );
          }
        }
      }
    }
  }

  get(id: string): MorphTrack | null {
    return this.byId.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * The furthest `at` a walk may reach while only phases up to `openPhase` are open
   * (D-245). A step whose `phase` is later than `openPhase` is held, so a track can
   * stop partway through the first phase (e.g. reach "sharpening nails") and only
   * continue once the next phase opens. Returns 1 when every step is unlocked.
   */
  capForPhase(trackId: string, openPhase: number): number {
    const track = this.get(trackId);
    if (!track) return 1;
    // precomputed per track: the furthest `at` reachable at each open phase (built
    // once in the constructor), so this is a table read, not a step scan per tick.
    const caps = this.caps.get(trackId);
    if (!caps) return 0;
    return caps[Math.min(Math.max(0, openPhase), caps.length - 1)] ?? 0;
  }

  all(): MorphTrack[] {
    return [...this.byId.values()];
  }

  stepIndexFor(trackId: string, progress: number): number {
    const track = this.get(trackId);
    if (!track) return -1;
    const p = Math.max(0, Math.min(1, progress));
    let index = 0;
    for (let i = 0; i < track.steps.length; i++) {
      if (p >= track.steps[i]!.at) index = i;
      else break;
    }
    return index;
  }

  partAt(trackId: string, progress: number): string {
    const track = this.get(trackId);
    if (!track) {
      throw new ContentError(`unknown morph track "${trackId}"`, "morph_tracks.json");
    }
    return track.steps[this.stepIndexFor(trackId, progress)]!.part;
  }

  traverse(trackId: string, fromProgress: number, toProgress: number): MorphStepEvent[] {
    const track = this.get(trackId);
    if (!track) {
      throw new ContentError(`unknown morph track "${trackId}"`, "morph_tracks.json");
    }
    const fromIndex = this.stepIndexFor(trackId, fromProgress);
    const toIndex = this.stepIndexFor(trackId, toProgress);
    if (fromIndex === toIndex) {
      return [];
    }
    const steps: MorphStepEvent[] = [];
    if (toIndex > fromIndex) {
      for (let i = fromIndex + 1; i <= toIndex; i++) {
        steps.push({ direction: "forward", index: i, ...track.steps[i]! });
      }
    } else {
      for (let i = fromIndex; i > toIndex; i--) {
        steps.push({ direction: "reverse", index: i - 1, ...track.steps[i - 1]! });
      }
    }
    return steps;
  }
}

export function buildMorphTrackRegistry(data: unknown, library: PartLibrary | null = null): MorphTrackRegistry {
  const tracks = (data as { morph_tracks?: unknown } | null | undefined)?.morph_tracks;
  if (!Array.isArray(tracks)) {
    throw new ContentError('morph_tracks.json must declare a "morph_tracks" array');
  }
  return new MorphTrackRegistry(tracks as MorphTrack[], library);
}
