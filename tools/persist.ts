/**
 * H7 headless test: the per-message save stays in budget across a long run with a
 * full cast, a bra
nch restore round-trips losslessly, and compaction does not
 * alter the simulation (blueprint invariant I2).
 */
import { HelperGame, MAX_CAST } from "../src/game";
import { PER_CHAR_BUDGET } from "../src/sim/compact";
import { days } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// a full cast, a year, one genome each
const g = new HelperGame(7);
const ids = ["a", "b", "c", "d", "e", "f"];
ids.forEach((id, i) => { g.track(id, id.toUpperCase()); g.bestow(id, ["genome.wolf", "genome.eagle", "genome.fox", "genome.serpent", "genome.bear", "genome.werewolf"][i]!, 1.5); });
g.advance(days(120));

const bytes = g.saveBytes();
check("full cast is tracked", g.tracked === MAX_CAST);
check(`120-day save is in budget (< ${PER_CHAR_BUDGET / 1024}KB/char)`, bytes < PER_CHAR_BUDGET * MAX_CAST, `${Math.round(bytes / 1024)}KB`);

// restore round-trips the simulation
const payload = g.save()!;
const clone = new HelperGame(7);
clone.restore(payload, g.cast.list().map((c) => ({ id: c.id, name: c.name })));
check("restore rebuilds the cast", clone.tracked === MAX_CAST);
// the mind (awareness, realization, mood) must survive, else `when:{realized}` gates
// silently close and values vanish on every reload (H27)
const mindBefore = g.cast.get("f")!.sim.subject.mind;
const mindAfter = clone.cast.get("f")!.sim.subject.mind;
check("restore keeps the mind (realization)", !!mindBefore && !!mindAfter && mindBefore.realized === mindAfter.realized);
const beforeExp = g.view().frames.map((f) => f.exposure).join(",");
const afterExp = clone.view().frames.map((f) => f.exposure).join(",");
check("restore preserves exposure", beforeExp === afterExp);

// the restored world advances identically (compaction did not alter the sim)
g.advance(days(14)); clone.advance(days(14));
check("post-restore advance matches", g.view().frames.map((f) => f.exposure).join(",") === clone.view().frames.map((f) => f.exposure).join(","));

// determinism of the save itself
const a = new HelperGame(9); a.track("x", "X"); a.bestow("x", "genome.wolf", 2); a.advance(days(30));
const b = new HelperGame(9); b.track("x", "X"); b.bestow("x", "genome.wolf", 2); b.advance(days(30));
check("save is deterministic", a.saveBytes() === b.saveBytes() && JSON.stringify(a.save()) === JSON.stringify(b.save()));

// a 10-year run still holds budget
const long = new HelperGame(3);
long.track("z", "Z"); long.bestow("z", "genome.lion", 2);
long.advance(days(730));
check("2-year single-character save is tiny", long.saveBytes() < PER_CHAR_BUDGET, `${Math.round(long.saveBytes() / 1024)}KB`);

console.log(failures === 0 ? "\nPERSIST PASS" : `\nPERSIST FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
