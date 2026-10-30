/**
 * H8 headless test: the visualize prompt is deterministic, names the character and
 * species, threads the most-progressed parts, and the key changes when the body does
 * but stays stable when it does not.
 */
import { HelperGame } from "../src/game";
import { visualBundle, visualKey, salientParts, VISUAL_STYLE, VISUAL_NEGATIVE } from "../src/view/visualize";
import { days as dayTicks } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

function frameOf(seed: number, genome: string, days: number) {
  const g = new HelperGame(seed);
  g.track("mira", "Mira", "female");
  g.bestow("mira", genome, 2);
  g.advance(dayTicks(days));
  return { g, frame: g.view().frames[0]! };
}

// a digestible, well-formed prompt
{
  const { frame } = frameOf(1, "genome.werewolf", 25);
  const b = visualBundle(frame, { phase: "waxing gibbous", intensity: 0.7 });
  check("prompt names the character", b.prompt.includes("Mira"));
  check("prompt names the species", /werewolf/i.test(b.prompt));
  check("prompt carries the house style", b.prompt.includes(VISUAL_STYLE));
  check("negative prompt is non-empty", b.negative === VISUAL_NEGATIVE);
  check("prompt is a single sane line", !b.prompt.includes("\n") && b.prompt.length < 600, String(b.prompt.length));
}

// determinism: identical frame → identical prompt and key
{
  const { frame } = frameOf(2, "genome.wolf", 20);
  const a = visualBundle(frame, { phase: "full", intensity: 1 });
  const b = visualBundle(frame, { phase: "full", intensity: 1 });
  check("prompt is deterministic", a.prompt === b.prompt);
  check("key is deterministic", a.key === b.key);
}

// salient parts: most-progressed, deduped, humanised
{
  const { frame } = frameOf(3, "genome.eagle", 30);
  const parts = salientParts(frame);
  check("salient parts are humanised (no slot prefix)", parts.every((p) => !p.includes(":")), JSON.stringify(parts));
  check("salient parts are deduped", new Set(parts).size === parts.length);
  check("salient parts respect the limit", parts.length <= 6);
}

// the key changes as the body progresses
{
  const g = new HelperGame(4);
  g.track("mira", "Mira");
  g.bestow("mira", "genome.wolf", 1);
  g.advance(dayTicks(3));
  const early = visualKey(g.view().frames[0]!);
  g.advance(dayTicks(30));
  const late = visualKey(g.view().frames[0]!);
  check("key changes as the body changes", early !== late);
}

// a seed changes the key (so a reroll is a distinct render) but not the prompt
{
  const { frame } = frameOf(5, "genome.wolf", 10);
  const a = visualBundle(frame, { phase: "full", intensity: 1 }, undefined, { seed: 1 });
  const b = visualBundle(frame, { phase: "full", intensity: 1 }, undefined, { seed: 2 });
  check("seed does not change the prompt", a.prompt === b.prompt);
  check("seed changes the key", a.key !== b.key);
}

// moon light enters the prompt only when bright
{
  const { frame } = frameOf(6, "genome.werewolf", 5);
  check("dark moon omits moon-light", !/moonlight/.test(visualBundle(frame, { phase: "new", intensity: 0.1 }).prompt));
  check("bright moon adds moon-light", /moonlight/.test(visualBundle(frame, { phase: "full", intensity: 0.95 }).prompt));
}

// a human frame still renders sensibly
{
  const g = new HelperGame(7);
  g.track("pat", "Pat");
  const b = visualBundle(g.view().frames[0]!, { phase: "new", intensity: 0 });
  check("a baseline human prompt is valid", b.prompt.includes("Pat") && /human/i.test(b.prompt), b.prompt);
}

console.log(failures === 0 ? "\nVISUALIZE PASS" : `\nVISUALIZE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
