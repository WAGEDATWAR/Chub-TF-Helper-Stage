/**
 * Multi-genome handling (H14). A second species **supersedes** rather than stacks,
 * the superseded body is saved so a revert restores its exact progress, and a weak
 * stray auto-bind does not auto-supersede a cultivated change. Locks the behaviour
 * that "one stray accepted auto-bind can undo a real transformation".
 */
import { HelperGame } from "../src/game";
import { days } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// a second species supersedes: one body, not two
{
  const g = new HelperGame(1);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(10));
  g.bestow("s", "genome.eagle", 3);
  g.advance(days(2));
  const genomes = g.cast.get("s")!.sim.subject.genomes;
  check("a second species leaves one genome", genomes.length === 1 && genomes[0] === "genome.eagle", JSON.stringify(genomes));
  check("the old species is in history", g.view().frames[0]!.genomeHistory.includes("genome.wolf"));
}

// the superseded body is restored exactly on revert (progress intact)
{
  const g = new HelperGame(2);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(20));
  const before = g.view().frames[0]!;
  check("the change is well underway", before.exposure > 40, String(before.exposure));
  g.bestow("s", "genome.eagle", 3);
  g.advance(days(2));
  check("the supersede reset the body", g.view().frames[0]!.exposure < before.exposure);
  const ok = g.revertSpecies("s");
  const after = g.view().frames[0]!;
  check("revert succeeds", ok);
  check("revert restores the exact exposure", after.exposure === before.exposure, `${after.exposure} vs ${before.exposure}`);
  check("revert restores the parts", after.parts.length === before.parts.length, `${after.parts.length} vs ${before.parts.length}`);
  check("revert restores the species", after.genome === "genome.wolf");
}

// revert takes the override, so a re-scan cannot immediately re-supersede
{
  const g = new HelperGame(3);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.bestow("s", "genome.eagle", 3);
  g.revertSpecies("s");
  check("revert sets the override", g.detector.overrideFor("s") === "genome.wolf");
}

// history is bounded: deep chain reverts newest-first
{
  const g = new HelperGame(4);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.bestow("s", "genome.eagle", 3);
  g.bestow("s", "genome.serpent", 3);
  check("history has both prior species", JSON.stringify(g.view().frames[0]!.genomeHistory) === JSON.stringify(["genome.wolf", "genome.eagle"]));
  g.revertSpecies("s");
  check("the first revert is the newest prior", g.view().frames[0]!.genome === "genome.eagle");
  g.revertSpecies("s");
  check("the second revert is the oldest prior", g.view().frames[0]!.genome === "genome.wolf");
}

// a weak evidenced proposal does NOT auto-supersede a changing body
{
  const g = new HelperGame(5);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(5));
  g.detector.proposeExternal({ characterId: "s", genome: "genome.serpent", family: "serpentine", confidence: 0.6, source: "chat", token: "snake", evidence: true }, 0);
  g.autoApplyPending(1.0);
  check("a weak proposal waits (does not supersede)", g.cast.get("s")!.sim.subject.genomes[0] === "genome.wolf", JSON.stringify(g.cast.get("s")!.sim.subject.genomes));
}

// a strong evidenced proposal auto-supersedes
{
  const g = new HelperGame(6);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(5));
  g.detector.proposeExternal({ characterId: "s", genome: "genome.serpent", family: "serpentine", confidence: 0.75, source: "chat", token: "snake", evidence: true }, 0);
  g.autoApplyPending(1.0);
  check("a sure proposal supersedes", g.cast.get("s")!.sim.subject.genomes[0] === "genome.serpent", JSON.stringify(g.cast.get("s")!.sim.subject.genomes));
}

// a manual override resets history (a fresh start)
{
  const g = new HelperGame(7);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.bestow("s", "genome.eagle", 3);
  g.override("s", "genome.bear");
  check("an override clears history", g.view().frames[0]!.genomeHistory.length === 0);
}

// history survives a save/restore
{
  const g = new HelperGame(8);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(3));
  g.bestow("s", "genome.eagle", 3);
  const h = new HelperGame(8);
  h.restore(g.save()!, [{ id: "s", name: "Sarah" }]);
  check("history survives a reload", h.view().frames[0]!.genomeHistory.includes("genome.wolf"));
  check("a revert after reload works", h.revertSpecies("s") && h.view().frames[0]!.genome === "genome.wolf");
}

// re-binding the current genome tops up rather than superseding
{
  const g = new HelperGame(9);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(3));
  const exp = g.view().frames[0]!.exposure;
  g.bestow("s", "genome.wolf", 3);
  check("re-binding the same genome pushes it on", g.view().frames[0]!.exposure >= exp, `${g.view().frames[0]!.exposure} vs ${exp}`);
  check("no history for a repeat bind", g.view().frames[0]!.genomeHistory.length === 0);
}

console.log(failures === 0 ? "\nMULTIGENOME PASS" : `\nMULTIGENOME FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
