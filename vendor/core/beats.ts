import { ContentError } from "./loader";

export const BEAT_TYPES = Object.freeze([
  "arrive",
  "quiet",
  "interaction",
  "reveal",
  "decision",
  "depart",
  "tick_loop",
  "scripted",
  // reference-compatible aliases (M6 scene graph still uses these)
  "choice",
  "check",
  "rep_loop",
  "resolve",
  "intimacy",
  "dialogue_loop",
]);

export interface Beat {
  id: string;
  type: string;
  repeat?: number;
  [k: string]: unknown;
}

export class BeatSequence {
  readonly sceneId: string;
  readonly beats: Beat[];
  index: number;
  repIndex: number;
  state: string;

  constructor(sceneId: string, beats: Beat[]) {
    if (!Array.isArray(beats) || beats.length === 0) {
      throw new ContentError(`scene "${sceneId}" must declare a non-empty "beats" array`, "scene_graph.json");
    }
    this.sceneId = sceneId;
    this.beats = beats;
    for (const beat of beats) {
      if (!(BEAT_TYPES as readonly string[]).includes(beat.type)) {
        throw new ContentError(`scene "${sceneId}" beat "${beat.id}" has unknown type "${beat.type}"`, "scene_graph.json");
      }
    }
    this.index = 0;
    this.repIndex = 0;
    this.state = "ready";
  }

  get current(): Beat | null {
    return this.beats[this.index] ?? null;
  }

  get done(): boolean {
    return this.index >= this.beats.length;
  }

  advance(): { beat: Beat; rep?: number; finished: boolean } | null {
    const beat = this.current;
    if (!beat) return null;
    if (beat.type === "rep_loop") {
      const repeat = beat.repeat ?? 1;
      this.repIndex += 1;
      if (this.repIndex < repeat) {
        return { beat, rep: this.repIndex, finished: false };
      }
      const finalRep = this.repIndex;
      this.repIndex = 0;
      this.index += 1;
      return { beat, rep: finalRep, finished: this.done };
    }
    this.index += 1;
    return { beat, finished: this.done };
  }

  resume(index: number, repIndex = 0): Beat | null {
    if (index < 0 || index > this.beats.length) {
      throw new ContentError(`scene "${this.sceneId}" cannot resume at beat index ${index}`, "scene_graph.json");
    }
    this.index = index;
    this.repIndex = repIndex;
    return this.current;
  }

  snapshot(): { sceneId: string; index: number; repIndex: number } {
    return { sceneId: this.sceneId, index: this.index, repIndex: this.repIndex };
  }
}

export function buildBeatSequence(sceneId: string, beats: Beat[]): BeatSequence {
  return new BeatSequence(sceneId, beats);
}
