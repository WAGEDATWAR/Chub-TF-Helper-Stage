/**
 * The manual-control layer: an override **replaces** (so human truly clears a genome
 * and X replaces an auto-bound Y), candidate NPCs are suggested then trackable, the
 * moon can be reset/nudged, and snapshots save+rewind. Locks the fixes for the
 * "override barely works / can't reset the moon / no manual save" reports.
 */
import { HelperGame } from "../src/game";
import { days } from "../src/sim/time";
import { directions } from "../src/drive/drive";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// an override REPLACES: werewolf over an auto-bound wolf is a single genome
{
  const g = new HelperGame(1);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(2));
  g.override("s", "genome.werewolf");
  const genomes = g.cast.get("s")!.sim.subject.genomes;
  check("override replaces, never stacks", genomes.length === 1 && genomes[0] === "genome.werewolf", JSON.stringify(genomes));
  check("the tag shows the override", g.view().frames[0]!.genome === "genome.werewolf");
}

// override to human truly clears the genome AND the body
{
  const g = new HelperGame(2);
  g.track("s", "Sarah");
  g.bestow("s", "genome.werewolf", 3);
  g.advance(days(5));
  check("changed before reset", (g.view().frames[0]!.exposure ?? 0) > 0);
  g.override("s", null);
  check("human clears the genome", g.cast.get("s")!.sim.subject.genomes.length === 0, JSON.stringify(g.cast.get("s")!.sim.subject.genomes));
  check("human clears the body", g.view().frames[0]!.exposure === 0, String(g.view().frames[0]!.exposure));
  check("the tag reads human", g.view().frames[0]!.genome === null);
  check("no coupling lingers", g.view().coupling.length === 0, JSON.stringify(g.view().coupling));
}

// override survives a save/restore (the reload bug: genome was dropped on rehydrate)
{
  const g = new HelperGame(3);
  g.track("s", "Sarah");
  g.override("s", "genome.werewolf");
  const save = g.save()!;
  const h = new HelperGame(3);
  h.restore(save, [{ id: "s", name: "Sarah" }]);
  check("the bound genome survives a reload", h.cast.get("s")!.sim.subject.genomes.includes("genome.werewolf"), JSON.stringify(h.cast.get("s")!.sim.subject.genomes));
  check("the override flag survives a reload", h.detector.overrideFor("s") === "genome.werewolf");
  check("the tag survives a reload", h.view().frames[0]!.genome === "genome.werewolf");
}

// a named stranger beside a species becomes a trackable candidate
{
  const g = new HelperGame(4);
  g.track("sarah", "Sarah");
  g.observe(null, "Marek the werewolf growls, his claws lengthening.");
  check("a candidate NPC is offered", g.candidates().some((c) => c.name === "Marek"), JSON.stringify(g.candidates()));
  const id = g.trackCandidate("Marek");
  check("tracking the candidate adds them", id !== null && g.cast.get("marek") !== null);
  check("the candidate carries the implied genome", g.cast.get("marek")!.sim.subject.genomes.includes("genome.werewolf"));
  check("the candidate is removed after tracking", !g.candidates().some((c) => c.name === "Marek"));
}

// a passing mention with no name and no change cue proposes but does NOT auto-bind
{
  const g = new HelperGame(5);
  g.track("sarah", "Sarah");
  g.observe(null, "Outside, a wolf crossed the road.");
  g.autoApplyPending(1.0);
  check("a bare species mention does not auto-bind", (g.cast.get("sarah")!.sim.subject.genomes.length === 0), JSON.stringify(g.cast.get("sarah")!.sim.subject.genomes));
  check("but the proposal is still offered", g.view().proposals.some((p) => p.genome === "genome.wolf"));
}

// a named species with a change cue DOES propose AND auto-bind
{
  const g = new HelperGame(6);
  g.track("sarah", "Sarah");
  g.observe(null, "Sarah clutches her shoulder where the wolf bit her.");
  g.autoApplyPending(1.0);
  check("an evidenced species auto-binds", g.cast.get("sarah")!.sim.subject.genomes.includes("genome.wolf"), JSON.stringify(g.cast.get("sarah")!.sim.subject.genomes));
}

// the moon can be set to a phase and nudged, without moving the day clock
{
  const g = new HelperGame(7, { cycleDays: 28 });
  g.track("s", "Sarah");
  g.advance(days(3));
  const day = g.view().day;
  g.setMoon("full");
  check("setMoon('full') reaches full", g.lunar.intensity(g.view().worldTick) > 0.99, String(g.lunar.intensity(g.view().worldTick)));
  check("setMoon does not move the clock", g.view().day === day);
  g.setMoon("new");
  check("setMoon('new') reaches new", g.lunar.intensity(g.view().worldTick) < 0.01, String(g.lunar.intensity(g.view().worldTick)));
  const before = g.lunar.phase(g.view().worldTick);
  g.nudgeMoonDays(3);
  check("nudging moves the phase", Math.abs(g.lunar.phase(g.view().worldTick) - before) > 0.01);
}

// the moon offset survives a reload
{
  const g = new HelperGame(8, { cycleDays: 28 });
  g.track("s", "Sarah");
  g.setMoon("full");
  const save = g.save()!;
  const h = new HelperGame(8, { cycleDays: 28 });
  h.restore(save, [{ id: "s", name: "Sarah" }]);
  check("the reset moon survives a reload", h.lunar.intensity(h.view().worldTick) > 0.99, String(h.lunar.intensity(h.view().worldTick)));
}

// snapshots save and rewind
{
  const g = new HelperGame(9);
  g.track("s", "Sarah");
  g.bestow("s", "genome.wolf", 3);
  g.advance(days(5));
  const snap = g.snapshot("checkpoint");
  const expAtSnap = g.view().frames[0]!.exposure;
  g.advance(days(20));
  check("time moved on", g.view().frames[0]!.exposure > expAtSnap, `${g.view().frames[0]!.exposure} vs ${expAtSnap}`);
  check("the snapshot is listed", g.listSnapshots().some((s) => s.id === snap));
  const ok = g.rewind(snap);
  check("rewind restores the state", ok && g.view().frames[0]!.exposure === expAtSnap, `${g.view().frames[0]!.exposure} vs ${expAtSnap}`);
  check("rewind keeps the character", g.cast.get("s") !== null);
  check("rewind keeps the snapshot", g.snapshotCount() >= 1);
}

// the floor marks a barely-started part as BUDDING (the front-running fix)
{
  const g = new HelperGame(10);
  g.track("s", "Sarah");
  g.bestow("s", "genome.werewolf", 3);
  // find the first day a part exists but is early
  let sawBudding = false;
  for (let d = 1; d <= 6; d++) {
    g.advance(days(1));
    const dir = g.view();
    void dir;
    const f = g.view().frames[0]!;
    const early = f.parts.filter((p) => p.pct < 30);
    if (early.length > 0) { sawBudding = true; break; }
  }
  check("an early part exists to mark", sawBudding);
  const view = g.view();
  const dirText = directions({ frames: view.frames, coupling: [], moon: view.moon });
  check("the floor uses BUDDING for early parts", /BUDDING/.test(dirText) || view.frames[0]!.parts.every((p) => p.pct >= 30), dirText);
}

console.log(failures === 0 ? "\nCONTROL PASS" : `\nCONTROL FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
