import type { Composer } from "./composer";
import { joinNatural } from "./composer";
import type { Scene, SceneRegistry } from "./scene";
import type { Subject } from "./subject";
import type { WorldState } from "./world";

/**
 * Scene composer (blueprint §32). Extends the subject prose composer
 * (`composer.ts`) with the scene layer: location ambient, objects, and spatial
 * relations are rendered *around* the subject, so the prose is grounded in real
 * state and never invents.
 */
export interface SceneComposerOptions {
  composer: Composer;
  scenes: SceneRegistry;
}

export interface SceneRender {
  ambient: string;
  objects: string[];
  relations: string[];
  subjectLines: string[];
  prose: string;
}

export interface RenderOptions {
  slots?: string[] | null;
  world?: WorldState | null;
  /** A line she speaks this render (M14.10): rendered as overheard speech. */
  speech?: string | null;
}

const AMBIENT_LEAD: Record<string, string> = {
  light: "In",
  sound: "Under",
  smell: "Smelling of",
};

function ambientLead(ambient: { light?: string; sound?: string; smell?: string }): string {
  const bits: string[] = [];
  if (ambient.light) bits.push(ambient.light);
  if (ambient.sound) bits.push(ambient.sound);
  if (ambient.smell) bits.push(`the smell of ${ambient.smell}`);
  if (bits.length === 0) return "";
  return bits.join(", ");
}

export class SceneComposer {
  readonly composer: Composer;
  readonly scenes: SceneRegistry;

  constructor(opts: SceneComposerOptions) {
    this.composer = opts.composer;
    this.scenes = opts.scenes;
  }

  /** Alias for the scene registry (used by the observation loop). */
  get registry(): SceneRegistry {
    return this.scenes;
  }

  render(sceneId: string, subject: Subject | null, { slots = null, world = null, speech = null }: RenderOptions = {}): SceneRender | null {
    const scene = this.scenes.get(sceneId);
    if (!scene) return null;
    return this.renderScene(scene, subject, { slots, world, speech });
  }

  renderScene(scene: Scene, subject: Subject | null, { slots = null, world = null, speech = null }: RenderOptions = {}): SceneRender {
    const placed = this.scenes.place(scene, world ?? undefined);
    const ambient = ambientLead(placed.ambient);
    const objects = placed.objects;
    const relations = (scene.spatial ?? []).map((rel) =>
      this.scenes.spatial.render(rel.rel, this._name(rel.a, subject), this._name(rel.b, subject)),
    );
    const subjectLines = subject ? this.composer.describeSubject(subject as never, { slots }) : [];
    const body = subject && subjectLines.length > 0 ? this.composer.describeBody(subject as never, { slots }) : "";
    const prose = this.assemble(ambient, objects, relations, subject, body, speech);
    return { ambient, objects, relations, subjectLines, prose };
  }

  /** Resolve a scene referent (`subject`, `obj.x`, `agent.x`) to a display name. */
  private _name(ref: string, subject: Subject | null): string {
    if (ref === "subject") return subject?.displayName ?? "the subject";
    if (ref.startsWith("obj.")) return this.scenes.objects.get(ref)?.name ?? ref.slice(4);
    if (ref.startsWith("agent.")) return ref.slice(6);
    return ref;
  }

  /**
   * The scene as prose (M14.6, S48): the setting — ambient, objects, space, her
   * place in it — flows as one paragraph; her body, when it has changed, follows
   * as its own beat. No "Present:" ledger label; objects are woven into a clause.
   */
  private assemble(ambient: string, objects: string[], relations: string[], subject: Subject | null, body: string, speech: string | null): string {
    const lead: string[] = [];
    if (ambient) lead.push(`${capitalise(ambient)}.`);
    const setting: string[] = [];
    if (objects.length > 0) setting.push(joinNatural(objects));
    if (relations.length > 0) setting.push(...relations);
    if (setting.length > 0) {
      const who = subject ? `${subject.displayName} ` : "";
      lead.push(capitalise(`${who}${subject ? "is here: " : ""}${joinNatural(setting)}.`));
    } else if (subject) {
      lead.push(`${subject.displayName} is here.`);
    }
    const paragraphs = [lead.join(" ")];
    if (body) paragraphs.push(body);
    if (speech) paragraphs.push(speech);
    return paragraphs.filter(Boolean).join("\n\n");
  }
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export const AMBIENT_RENDER_ORDER = Object.freeze(Object.keys(AMBIENT_LEAD));
