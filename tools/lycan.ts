/**
 * H21 headless test (D-248): the lycan curse is bite-then-moon. A bite alone lands
 * phase 0 permanently on its own timetable; later phases (including the genitals
 * that drive her heat) only advance under the moon. Also proves the phase `when`
 * gate is honoured at all (it was declared but unenforced before D-248).
 */
import { HelperGame } from "../src/game";
import { whenOpenFor } from "../src/sim/subject";
import { days } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

function bite(seed = 5, cycleDays = 56) {
  const g = new HelperGame(seed, { cycleDays });
  g.track("m", "Mira");
  g.bestow("m", "genome.werewolf", 3);
  return { g, sim: g.cast.get("m")!.sim };
}
const entriesAt = (sim: ReturnType<typeof bite>["sim"], phase: number) =>
  sim.subject.body.allInstances().flatMap((i) => i.attributes.filter((a) => ((a as { phase_index?: number }).phase_index ?? -1) === phase).map((a) => a.id));
const progressSum = (sim: ReturnType<typeof bite>["sim"], minPhase: number) => {
  let s = 0;
  for (const i of sim.subject.body.allInstances()) for (const a of i.attributes) if (((a as { phase_index?: number }).phase_index ?? -1) >= minPhase) s += a.progress;
  return s;
};

// the werewolf has its own phase plan; phase 0 is the bite's mark
{
  const { sim } = bite();
  const p0 = entriesAt(sim, 0);
  check("phase 0 exists and is the bite's mark", p0.length > 0, p0.join(","));
  check("fangs land in phase 0", p0.includes("attr.fangs"));
  check("claws land in phase 0", p0.some((id) => id === "attr.canine_claws"));
  check("genitals are NOT in phase 0 (they ride the moon)", !p0.includes("attr.species_genital"));
}

// genitals sit in a moon-gated phase with a moon_min gate
{
  const { sim } = bite();
  const g1 = sim.subject.body.allInstances().flatMap((i) => i.attributes.filter((a) => a.id === "attr.species_genital"));
  check("genitals exist", g1.length > 0);
  check("genitals are phase >= 1", g1.every((a) => ((a as { phase_index?: number }).phase_index ?? -1) >= 1));
  check("genitals carry a moon gate", g1.every((a) => Boolean((a as { phase_when?: { moon_min?: number } }).phase_when?.moon_min)));
}

// the `when` evaluator reads the sim's moon
{
  const { sim } = bite();
  const evalWhen = whenOpenFor(sim);
  sim.session.clock.tick = 0; // new moon (intensity 0)
  check("moon_min fails at new moon", evalWhen({ moon_min: 0.5 }) === false);
  sim.session.clock.tick = days(28); // ~full on the 56d test cycle (intensity 1)
  check("moon_min holds at full moon", evalWhen({ moon_min: 0.8 }) === true);
  check("moon_max fails at full moon", evalWhen({ moon_max: 0.3 }) === false);
}

// a bite alone lands phase 0 and NOT the later phases
{
  const { g, sim } = bite();
  g.advance(days(4)); // a few days, moon not full
  const p0 = sim.subject.body.allInstances().flatMap((i) => i.attributes.filter((a) => ((a as { phase_index?: number }).phase_index ?? -1) === 0).map((a) => a.progress));
  const later = sim.subject.body.allInstances().flatMap((i) => i.attributes.filter((a) => ((a as { phase_index?: number }).phase_index ?? -1) >= 1).map((a) => a.progress));
  check("a bite alone starts the mark", p0.some((v) => v > 0), JSON.stringify(p0));
  check("later phases wait for the moon", later.every((v) => v === 0), JSON.stringify(later));
}

// with phase 0 forced done, a full moon accelerates later phases; a new moon freezes them
{
  const run = (startDay: number) => {
    const { g, sim } = bite();
    while (sim.session.clock.day < startDay) g.advance(1);
    for (const i of sim.subject.body.allInstances())
      for (const a of i.attributes) {
        const p = (a as { phase_index?: number }).phase_index ?? -1;
        if (p === 0) a.progress = a.target_progress ?? 1000;
        if (p >= 1) a.start_delay = 0;
      }
    const before = progressSum(sim, 1);
    g.advance(days(6));
    return progressSum(sim, 1) - before;
  };
  const atNew = run(3);
  const atFull = run(30);
  check("later phases freeze at new moon", atNew === 0, String(atNew));
  check("later phases advance at full moon", atFull > 0, String(atFull));
}

console.log(failures === 0 ? "\nLYCAN PASS" : `\nLYCAN FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
