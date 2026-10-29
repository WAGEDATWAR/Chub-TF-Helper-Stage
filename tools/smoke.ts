/**
 * H1 headless smoke: the cast tracks several characters on one clock, they all
 * advance in lockstep, a late joiner is caught up, and two runs are deterministic
 * — all with no DOM and no framework.
 */
import { HelperGame, MAX_CAST } from "../src/game";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

const game = new HelperGame(424242);
check("genomes available", game.genomes().length >= 40, `${game.genomes().length}`);

game.track("mira", "Mira");
game.track("tomas", "Tomas", "male");
check("cast tracks two", game.tracked === 2);

game.bestow("mira", "genome.wolf", 2.0);
game.bestow("tomas", "genome.raven", 2.0);
game.advance(24 * 21);

const view = game.view();
check("both characters have frames", view.frames.length === 2);
check("mira changed", (view.frames.find((f) => f.id === "mira")?.exposure ?? 0) > 0);
check("tomas changed", (view.frames.find((f) => f.id === "tomas")?.exposure ?? 0) > 0);
check("clocks are in lockstep", view.frames.every((f) => f.day === view.day));

// a late joiner is caught up to the shared world tick
const before = view.worldTick;
game.track("lin", "Lin");
const lin = game.cast.get("lin")!;
check("late joiner is at the world tick", lin.sim.session.clock.tick === before, `${lin.sim.session.clock.tick} vs ${before}`);

// advancing moves everyone together
game.advance(24);
check("advance is shared", game.cast.list().every((c) => c.sim.session.clock.tick === before + 24));

// cast cap
for (let i = 0; i < 10; i++) game.track(`x${i}`, `X${i}`);
check("cast caps at MAX_CAST", game.tracked === MAX_CAST, `${game.tracked}`);

// save/restore round-trips the cast
const payload = game.save();
check("save carries every character", payload !== null && Object.keys(payload.chars).length === MAX_CAST);
const clone = new HelperGame(424242);
clone.restore(payload!, game.cast.list().map((c) => ({ id: c.id, name: c.name })));
check("restore rebuilds the cast", clone.tracked === MAX_CAST);
check("restore keeps exposure", clone.cast.get("mira")!.sim.subject.derived.exposure === game.cast.get("mira")!.sim.subject.derived.exposure);

// determinism across runs
const a = new HelperGame(7); a.track("p", "P"); a.bestow("p", "genome.fox", 1.5); a.advance(24 * 14);
const b = new HelperGame(7); b.track("p", "P"); b.bestow("p", "genome.fox", 1.5); b.advance(24 * 14);
check("deterministic across runs", a.view().frames[0]!.exposure === b.view().frames[0]!.exposure && a.view().frames[0]!.describe === b.view().frames[0]!.describe);

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
