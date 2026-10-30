/**
 * H3 headless test: the lunar clock is deterministic; a werewolf's pressure rises
 * with the moon, an emotion can force a shift, reversion happens when pressure
 * falls, and a playstyle gates which triggers are live.
 */
import { HelperGame } from "../src/game";
import { ambientAt } from "../src/sim/coupling";
import { days } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// the lunar clock is deterministic and peaks at full
{
  const g = new HelperGame(1, { cycleDays: 28 });
  const l = g.lunar;
  check("phase 0 at new moon", Math.abs(l.phase(0)) < 0.001);
  check("intensity peaks at full (phase 0.5)", Math.abs(l.intensity(days(14)) - 1) < 0.001);
  check("intensity 0 at new", Math.abs(l.intensity(0)) < 0.001);
  check("deterministic", g.lunar.intensity(300) === new HelperGame(1, { cycleDays: 28 }).lunar.intensity(300));
}

// a werewolf's pressure climbs toward the full moon
{
  const g = new HelperGame(2, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 1.0);
  const sim = g.cast.get("w")!.sim;
  const at = (tick: number) => g.triggers.readout("w", sim, tick, () => ({}))[0]!;
  check("new moon → low pressure", at(0).pressure < 0.2, `${at(0).pressure}`);
  check("full moon → high pressure", at(days(14)).pressure > 0.6, `${at(days(14)).pressure}`);
  check("pressure names the moon source", at(days(14)).breakdown.some((b) => b.source === "moon"));
}

// an emotion can force a shift on the FULL playstyle, not on classic
{
  const build = (style: string) => {
    const g = new HelperGame(3, { cycleDays: 28 });
    g.track("w", "Wren");
    g.bestow("w", "genome.werewolf", 0.3); // a light baseline so only a trigger shifts
    g.setPlaystyle("w", "genome.werewolf", style);
    return g;
  };
  const full = build("full");
  full.feel("w", "fear", 95);
  const sim = full.cast.get("w")!.sim;
  const pFull = full.triggers.readout("w", sim, 24, () => ({ fear: 95 }))[0]!.pressure;
  const classic = build("classic");
  const sim2 = classic.cast.get("w")!.sim;
  const pClassic = classic.triggers.readout("w", sim2, 24, () => ({ fear: 95 }))[0]!.pressure;
  check("emotion raises pressure on 'full'", pFull > pClassic, `${pFull} vs ${pClassic}`);
  check("classic ignores emotion", pClassic < 0.2, `${pClassic}`);
}

// advancing near the full moon shifts the werewolf and logs it
{
  const g = new HelperGame(4, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 0.5);
  g.advance(days(13)); // walk into the full moon
  const shifted = g.view().coupling.find((c) => c.characterId === "w")?.shifted ?? false;
  check("full moon forces the shift", shifted, JSON.stringify(g.view().coupling));
  check("the shift is logged", g.view().triggers.some((t) => t.kind === "shift"));
}

// pressure falling again reverts
{
  const g = new HelperGame(5, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 0.5);
  g.advance(days(14));
  check("shifted at full", g.view().coupling.find((c) => c.characterId === "w")?.shifted === true);
  g.advance(days(14)); // through to the next new moon
  check("reverted after the moon wanes", g.view().coupling.find((c) => c.characterId === "w")?.shifted === false);
}

// playstyles are exposed for the pane
{
  const g = new HelperGame(6);
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 0.5);
  const styles = g.triggers.playstyles("genome.werewolf").map((s) => s.id);
  check("playstyles include full/classic/emotional/hormonal", ["full", "classic", "emotional", "hormonal"].every((s) => styles.includes(s)), styles.join(","));
}

// determinism
{
  const a = new HelperGame(7); a.track("w", "Wren"); a.bestow("w", "genome.werewolf", 1); a.advance(days(14));
  const b = new HelperGame(7); b.track("w", "Wren"); b.bestow("w", "genome.werewolf", 1); b.advance(days(14));
  check("coupling deterministic", a.view().frames[0]!.exposure === b.view().frames[0]!.exposure);
}

// H10: `voluntary` is a DISTINCT trigger from `emotional` — a realized character on
// a voluntary playstyle forces a shift by choice, with neither moon nor emotion.
{
  const g = new HelperGame(8, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 0.3);
  g.setPlaystyle("w", "genome.werewolf", "voluntary");
  const sim = g.cast.get("w")!.sim;
  // force realization deterministically (advance into the change, then read)
  (sim.subject.mind as { realized: boolean }).realized = true;
  check("voluntary gated on realization", g.triggers.canCallShift("w", sim));
  // at new moon with no emotion, a chosen shift still fires
  const before = g.view().coupling.find((c) => c.characterId === "w")?.shifted ?? false;
  g.callShift("w");
  const after = g.view().coupling.find((c) => c.characterId === "w")?.shifted ?? false;
  check("a called shift fires with no moon/emotion", after === true && before === false, `before=${before} after=${after}`);
  check("the called shift is named 'on purpose'", g.view().triggers.some((t) => t.note.includes("on purpose")));
}

// voluntary on an unrealized character cannot call yet
{
  const g = new HelperGame(9, { cycleDays: 28 });
  g.track("w", "Wren");
  g.bestow("w", "genome.werewolf", 0.3);
  g.setPlaystyle("w", "genome.werewolf", "voluntary");
  const sim = g.cast.get("w")!.sim;
  (sim.subject.mind as { realized: boolean }).realized = false;
  check("unrealized cannot call a shift", !g.triggers.canCallShift("w", sim));
}

// H10: realization progresses as the world advances (awareness rises over days)
{
  const g = new HelperGame(10, { cycleDays: 28 });
  g.track("mira", "Mira");
  g.bestow("mira", "genome.wolf", 2);
  g.advance(days(30));
  const f = g.view().frames[0]!;
  check("awareness rises with the change", f.awareness > 0, `${f.awareness}`);
  check("a strong change leads to realization", f.realized === true);
}

// H10: the vampire's night/sun ambient biases wellbeing
{
  const g = new HelperGame(11);
  g.track("vee", "Vee");
  g.bestow("vee", "genome.vampire", 1);
  const profile = g.triggers.profileFor("genome.vampire")!;
  const night = ambientAt(profile, 2 * 60)!; // 02:00 = night
  const day = ambientAt(profile, 12 * 60)!; // 12:00 = day
  check("night restores the vampire", night.delta > 0 && night.thriving, JSON.stringify(night));
  check("day wearies the vampire", day.delta < 0 && !day.thriving, JSON.stringify(day));
}

console.log(failures === 0 ? "\nCOUPLING PASS" : `\nCOUPLING FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
