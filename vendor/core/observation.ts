import type { Session } from "./session";
import type { SceneComposer, SceneRender } from "./scene_composer";
import type { InterruptSystem } from "./interrupts";
import type { SceneGraph } from "./scene_graph";
import { BeatSequence } from "./beats";
import { speak, type SpokenLine } from "./voice";
import type { DialogueRegistry } from "./dialogue";
import type { LinePool } from "./pool";

/**
 * The observation loop (blueprint §33–§34). Observing is **free**; the scene is
 * assembled from the current world state. Divergence D-108: the reference's hub
 * of actions becomes an *assembled* scene the Observer watches.
 *
 * Premise (D-152): she is not talking to the player. The loop selects a line she
 * says aloud for the scene's situation; the unseen Observer overhears it.
 */

export interface AssembledScene {
  sceneId: string;
  render: SceneRender | null;
  beats: BeatSequence | null;
  prose: string;
  speech: SpokenLine | null;
}

export interface ObservationOptions {
  scenes: SceneComposer;
  sceneGraph: SceneGraph;
  interrupts: InterruptSystem;
  dialogue?: DialogueRegistry | null;
  /** scene id -> the dialogue key she speaks while there. */
  speechKeys?: Record<string, string>;
  /** scene id -> its beat arc (for scenes that are not graph nodes). */
  beatsByScene?: Record<string, unknown[]>;
  pool?: LinePool | null;
}

export class ObservationLoop {
  private readonly scenes: SceneComposer;
  private readonly sceneGraph: SceneGraph;
  private readonly interrupts: InterruptSystem;
  private readonly dialogue: DialogueRegistry | null;
  private readonly speechKeys: Record<string, string>;
  private readonly pool: LinePool | null;
  private currentSceneId: string | null = null;

  constructor(opts: ObservationOptions) {
    this.scenes = opts.scenes;
    this.sceneGraph = opts.sceneGraph;
    this.interrupts = opts.interrupts;
    this.dialogue = opts.dialogue ?? null;
    this.speechKeys = opts.speechKeys ?? {};
    this.pool = opts.pool ?? null;
  }

  get sceneId(): string | null {
    return this.currentSceneId;
  }

  /** Enter a scene node (free). Returns the assembled scene, or null. */
  enter(sceneId: string, session: Session): AssembledScene | null {
    const resolved = this.sceneGraph.resolve(sceneId) ?? sceneId;
    const node = this.sceneGraph.get(resolved);
    this.currentSceneId = node ? resolved : sceneId;
    return this.assemble(this.currentSceneId, session);
  }

  observe(sceneId: string, session: Session): AssembledScene {
    return this.assemble(sceneId, session);
  }

  /** Assemble a scene from world state — the composer never invents. */
  assemble(sceneId: string, session: Session): AssembledScene {
    const node = this.sceneGraph.get(sceneId);
    this.currentSceneId = sceneId;
    session.currentLocation = this.scenes.registry.get(sceneId)?.location ?? null;
    const line = this.speechFor(sceneId, session, node as { speech_key?: string } | null);
    const render = this.scenes.render(sceneId, session.subject, {
      slots: this.salientSlots(session),
      world: session.world,
      speech: line?.render ?? null,
    });
    const beats =
      node && Array.isArray(node.beats) && node.beats.length > 0
        ? new BeatSequence(sceneId, node.beats as never)
        : null;
    const prose = render?.prose ?? "";
    // a town beat (M16c): who is about, so the world reads inhabited even when she
    // is alone. Data-driven from the town's own state; never inventing a person.
    const townLine = this.townBeat(session);
    const fullProse = townLine ? `${prose}${prose ? " " : ""}${townLine}` : prose;
    session.bus.emit("scene.changed", { scene: sceneId });
    // the canonical timeline: a scene is an opened prose entry; events chip under it
    if (fullProse) session.timeline.openEntry("scene", sceneId, fullProse, { tick: session.clock.tick, day: session.clock.day, sal: 0.4 });
    if (line?.render) session.timeline.openEntry("speech", line.key, line.render, { tick: session.clock.tick, day: session.clock.day, sal: 0.5 });
    return { sceneId, render: render ? { ...render, prose: fullProse } : render, beats, prose: fullProse, speech: line };
  }

  /** A short line about who else is about (M16c), or null. */
  private townBeat(session: Session): string | null {
    const town = session.town;
    const subject = town?.state("subject");
    if (!town || !subject) return null;
    const here = town.presentAt(subject.at, "subject");
    if (here.length > 0) {
      const names = here.map((a) => town.def(a.id)?.name ?? a.id);
      return names.length === 1 ? `${names[0]} is here, going about ${town.def(here[0]!.id)?.archetype ?? "their"} day.` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are here.`;
    }
    // the followed townsperson, wherever they are, colours the read
    if (session.follow) {
      const f = town.state(session.follow);
      const def = town.def(session.follow);
      if (f && def) return `Somewhere in town, ${def.name} is at ${session.locationNames.get(f.at) ?? f.at.replace(/^loc\./, "").replace(/_/g, " ")}.`;
    }
    return null;
  }

  /** A line she says while in this scene (overheard by the Observer). */
  private speechFor(sceneId: string, session: Session, node: { speech_key?: string } | null | undefined): SpokenLine | null {
    if (!this.dialogue) return null;
    const key = (node?.speech_key as string | undefined) ?? this.speechKeys[sceneId];
    if (!key) return null;
    return speak(session, this.dialogue, key, {}, this.pool);
  }

  /**
   * Advance the current scene's beat arc one step and journal the beat as quiet
   * narration (M14.10). Called on the clock so a scene's little arc progresses.
   */
  progressBeats(session: Session): { beat: string; type: string } | null {
    const sceneId = this.currentSceneId;
    if (!sceneId) return null;
    const node = this.sceneGraph.get(sceneId);
    if (!node || !Array.isArray(node.beats) || node.beats.length === 0) return null;
    const seq = new BeatSequence(sceneId, node.beats as never);
    const at = session.beatIndex.get(sceneId) ?? 0;
    if (at >= node.beats.length) return null;
    seq.resume(at);
    const step = seq.advance();
    if (!step) return null;
    session.beatIndex.set(sceneId, seq.index);
    session.bus.emit("beat.advanced", { scene: sceneId, beat: step.beat.id, type: step.beat.type }, { final: true });
    return { beat: step.beat.id, type: step.beat.type };
  }

  /** Which body slots are salient for a scene — the changed ones first. */
  salientSlots(session: Session): string[] {
    const instances = session.subject.body.allInstances();
    const changed = instances
      .filter((i) => i.attributes.some((a) => a.progress > 0))
      .sort((a, b) => maxProgress(b) - maxProgress(a));
    if (changed.length > 0) {
      return changed.slice(0, 12).map((i) => i.slot);
    }
    return instances
      .map((i) => i.slot)
      .filter((s) => /^(head|face|hand\.|foot\.|nails\.hand)/.test(s))
      .slice(0, 8);
  }

  /** Choose a composable scene for the current block, preferring the home. */
  ambientSceneFor(session: Session): string | null {
    const block = this.blockOf(session);
    const candidates = this.scenes.registry.all();
    const byBlock = candidates.filter((s) => s.block === block);
    const pick = byBlock.find((s) => /^loc\\.(her_|falk_|reyner_|okafor_|rhodes_)?home/.test(s.location)) ?? byBlock[0] ?? candidates[0];
    return pick?.id ?? null;
  }

  private blockOf(session: Session): string {
    const index = Math.floor((session.clock.tick % 24) / 4);
    const blocks = ["dawn", "morning", "midday", "afternoon", "evening", "night"];
    return blocks[index] ?? "night";
  }

  /** The display name of the location a scene is set in. */
  locationName(sceneId: string): string | null {
    return this.scenes.registry.locationName(sceneId);
  }

  /** Evaluate interrupts against current state and return the one to fire. */
  checkInterrupts(session: Session) {
    return this.interrupts.pick(session.conditionContext() as never);
  }

  /**
   * Fire the highest-priority interrupt whose condition holds (if any), advance
   * its cooldown, and return the scene to enter. Returns null when quiet.
   */
  maybeInterrupt(session: Session): { sceneId: string; kind: string } | null {
    const picked = this.checkInterrupts(session);
    if (!picked) return null;
    this.interrupts.fire(picked.id);
    session.bus.emit("interrupt.fired", { interrupt: picked.id, kind: picked.kind }, { final: true });
    return { sceneId: picked.id, kind: picked.kind as string };
  }
}

function maxProgress(instance: { attributes: Array<{ progress: number }> }): number {
  return Math.max(0, ...instance.attributes.map((a) => a.progress));
}

export function createObservationLoop(opts: ObservationOptions): ObservationLoop {
  return new ObservationLoop(opts);
}
