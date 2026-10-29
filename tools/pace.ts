/**
 * H10b headless test: the pace control scales how fast a transformation settles,
 * is applied per character, persists in the save, and is inferable from card text.
 */
import { HelperGame } from "../src/game";
import { inferPace, applyPace, currentPace } from "../src/sim/pace";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

function settleDays(seed: number, pace: "slow" | "normal" | "fast" | "quick" | "instant"): number {
  const g = new HelperGame(seed);
  g.track("m", "Mira");
  g.setPace(pace);
  g.bestow("m", "genome.wolf", 3.0);
  const sim = g.cast.get("m")!.sim;
  for (let t = 0; t < 500 * 24; t++) {
    g.advance(1);
    const done = sim.subject.body.allInstances().every((i) => i.attributes.filter((a) => !a.phase_feral_only).every((a) => a.progress >= (a.target_progress ?? 1000)));
    if (done) return Math.ceil(sim.session.clock.tick / 24);
  }
  return 999;
}

// faster paces settle sooner, and the schedule compresses (not just the tail)
{
  const slow = settleDays(1, "slow");
  const normal = settleDays(1, "normal");
  const fast = settleDays(1, "fast");
  const quick = settleDays(1, "quick");
  const instant = settleDays(1, "instant");
  check("slow burn is slower than normal", slow > normal, `${slow} > ${normal}`);
  check("fast is faster than normal", fast < normal, `${fast} < ${normal}`);
  check("quick is faster than fast", quick < fast, `${quick} < ${fast}`);
  check("normal lands near the authored baseline", normal >= 20 && normal <= 45, `${normal}`);
  // instant must collapse the whole timeline, phase schedule included (D-H02):
  // before the onset-scaling fix this floored at ~8 days no matter the rate. It is
  // now a handful of days because the wolf's `skull` phase is `stability_min`-gated
  // (D-248), so it waits for the body to steady (truer than an artificial floor).
  check("instant settles in a beat (<= 5 days)", instant <= 5, `${instant}`);
  check("quick is a scene or two (<= 10 days)", quick <= 10, `${quick}`);
}

// a pace is applied to the whole cast, and re-setting replaces (no stacking)
{
  const g = new HelperGame(2);
  g.track("a", "Ada");
  g.track("b", "Bo");
  g.setPace("instant");
  check("pace reported as instant", g.paceId() === "instant");
  const rates = g.cast.entries().map((c) => c.sim.session.temporal.modifiers.filter((m) => m.id === "pace.transformation").length);
  check("exactly one pace modifier per character", rates.every((n) => n === 1), JSON.stringify(rates));
  g.setPace("slow");
  const again = g.cast.entries().map((c) => c.sim.session.temporal.modifiers.filter((m) => m.id === "pace.transformation").length);
  check("re-setting a pace does not stack", again.every((n) => n === 1), JSON.stringify(again));
}

// a new character added later inherits the current pace
{
  const g = new HelperGame(3);
  g.setPace("fast");
  g.track("late", "Late");
  check("a late joiner inherits the pace", currentPace(g.cast.entries()[0]!.sim) === "fast");
}

// card inference
{
  check("'over months' → slow", inferPace("She changes slowly, over months.") === "slow");
  check("'instantly' → instant", inferPace("It happens instantly, all at once.") === "instant");
  check("'overnight' → quick", inferPace("The change comes overnight.") === "quick");
  check("no signal → normal", inferPace("A cheerful woman who likes tea.") === "normal");
}

// determinism
{
  const g = new HelperGame(4); g.track("m", "Mira"); g.setPace("fast"); g.bestow("m", "genome.wolf", 3); g.advance(24 * 10);
  const h = new HelperGame(4); h.track("m", "Mira"); h.setPace("fast"); h.bestow("m", "genome.wolf", 3); h.advance(24 * 10);
  check("pace is deterministic", g.view().frames[0]!.exposure === h.view().frames[0]!.exposure);
}

// applyPace is idempotent with a raw host
{
  const host = { session: { temporal: { modifiers: [] as Array<{ id: string; rate: number; untilTick: number }> }, clock: { tick: 0 } } };
  applyPace(host, "fast"); applyPace(host, "fast");
  check("applyPace idempotent", host.session.temporal.modifiers.length === 1);
}

console.log(failures === 0 ? "\nPACE PASS" : `\nPACE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
