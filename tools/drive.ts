/**
 * H4 headless test: the driving layer builds a per-character facts floor (one
 * block per character, multiple at once), forbids invention, and the guard passes
 * faithful prose while replacing hard drift with the floor.
 */
import { HelperGame } from "../src/game";
import { directions, guardMessage, floorText, instrumentRead, type DriveInput } from "../src/drive/drive";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

function inputFor(g: HelperGame): DriveInput {
  const view = g.view();
  return {
    frames: view.frames,
    coupling: view.coupling.map((c) => ({ characterId: c.characterId, kind: c.kind, pressure: c.pressure, cues: c.cues, shifted: c.shifted })),
    moon: view.moon,
    objects: ["a mug", "a radio"],
    ambient: "morning light",
  };
}

// directions carry one fact block per character, and forbid invention
{
  const g = new HelperGame(1);
  g.track("mira", "Mira");
  g.track("tomas", "Tomas", "male");
  g.bestow("mira", "genome.wolf", 2);
  g.bestow("tomas", "genome.eagle", 2);
  g.advance(24 * 20);
  const dir = directions(inputFor(g));
  check("directions name both characters", dir.includes("Mira") && dir.includes("Tomas"));
  check("directions forbid invention", /do not invent/i.test(dir) || /Do NOT invent/i.test(dir));
  check("directions carry exposure", /exposure \d+%/.test(dir));
  const floor = floorText(inputFor(g));
  check("floor lists each character", floor.includes("Mira") && floor.includes("Tomas"));
}

// a faithful line passes the guard
{
  const g = new HelperGame(2);
  g.track("mira", "Mira");
  g.bestow("mira", "genome.wolf", 2);
  g.advance(24 * 20);
  const inp = inputFor(g);
  const floor = floorText(inp);
  const ok = guardMessage(floor, inp);
  check("a faithful line passes", ok.ok === true, JSON.stringify(ok.failures));
}

// hard drift (an unknown number) is replaced by the floor
{
  const g = new HelperGame(3);
  g.track("mira", "Mira");
  g.bestow("mira", "genome.wolf", 2);
  g.advance(24 * 20);
  const inp = inputFor(g);
  const drifted = guardMessage("Mira's skin prickles at 999 degrees.", inp);
  check("unknown numbers are caught", drifted.ok === false, JSON.stringify(drifted.failures));
  check("drift falls back to the floor", drifted.line === floorText(inp));
}

// ordinary prose is NOT replaced (the previous over-eager new_object bug)
{
  const g = new HelperGame(7);
  g.track("mira", "Mira");
  const inp = inputFor(g);
  const greeting = "Auburn hair catching the morning light, Mira smiles at you. She stretches.";
  const greeter = guardMessage(greeting, inp);
  check("a normal greeting is left as-is", greeter.ok === true, JSON.stringify(greeter.failures));
  check("a normal greeting keeps its text", greeter.line === greeting);
  const quoted = guardMessage('*Mira looks up from her tea.* "Morning. You slept well?"', inp);
  check("quoted dialogue is left as-is", quoted.ok === true, JSON.stringify(quoted.failures));
}

// the moon directive appears when the moon is bright
{
  const g = new HelperGame(4, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 1);
  g.advance(13 * 24);
  const dir = directions(inputFor(g));
  check("bright moon adds a moon directive", /moon:/i.test(dir));
}

// the instrument read is human-readable and compact
{
  const g = new HelperGame(5);
  g.track("mira", "Mira");
  g.bestow("mira", "genome.wolf", 1);
  g.advance(24 * 5);
  const read = instrumentRead(inputFor(g));
  check("instrument read names the character", read.includes("Mira"));
  check("instrument read is multi-line-ish/compact", read.split("\n").length <= 8);
}

// empty cast → empty directions
{
  const g = new HelperGame(6);
  check("no cast → empty directions", directions(inputFor(g)) === "");
}

console.log(failures === 0 ? "\nDRIVE PASS" : `\nDRIVE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
