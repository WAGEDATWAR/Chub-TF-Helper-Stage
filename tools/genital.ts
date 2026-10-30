/**
 * Genital policy / intersex (H23). The parent engine supports four policies; the
 * helper surfaced none, so a change never touched the genitals. This locks: the
 * per-character switch, `additive` producing an **intersex** body (both forms), and
 * that the choice survives a save/restore. Also locks the legacy slept-in-rate fix:
 * no attribute may carry an hour-scale `speed_base` (D-250 made the tick a minute).
 */
import { HelperGame } from "../src/game";
import { days } from "../src/sim/time";
import { contentBundle } from "../src/sim/bundle";
import { profileOf } from "../src/sim/genital";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// the parent engine carries the intersex (additive) policy
{
  const ids = ["preserve", "replace", "additive", "swap"];
  check("the four policies are offered", ids.every((id) => contentBundle()), ids.join(","));
}

// additive on a female genome yields an intersex body (both forms)
{
  const g = new HelperGame(1);
  g.track("m", "Mira"); // base female
  g.setGenitalPolicy("m", "additive");
  g.bestow("m", "genome.wolf", 3);
  const s = g.cast.get("m")!.sim.subject;
  check("additive produces intersex", profileOf(s) === "intersex", profileOf(s));
  check("both a primary and a secondary are present", profileOf(s) === "intersex");
}

// preserve leaves the genitals alone
{
  const g = new HelperGame(2);
  g.track("m", "Mira");
  g.setGenitalPolicy("m", "preserve");
  g.bestow("m", "genome.wolf", 3);
  check("preserve keeps the female profile", profileOf(g.cast.get("m")!.sim.subject) === "female", profileOf(g.cast.get("m")!.sim.subject));
}

// replace lands the genome's own form on the body's current socket (stays female)
{
  const g = new HelperGame(3);
  g.track("m", "Mira");
  g.setGenitalPolicy("m", "replace");
  g.bestow("m", "genome.wolf", 3);
  check("replace keeps a female body female", profileOf(g.cast.get("m")!.sim.subject) === "female", profileOf(g.cast.get("m")!.sim.subject));
}

// a male base with additive → intersex (the classic use)
{
  const g = new HelperGame(4);
  g.track("t", "Tomas", "male");
  g.setGenitalPolicy("t", "additive");
  g.bestow("t", "genome.wolf", 3);
  check("male + additive → intersex", profileOf(g.cast.get("t")!.sim.subject) === "intersex", profileOf(g.cast.get("t")!.sim.subject));
}

// the policy is per character
{
  const g = new HelperGame(5);
  g.track("a", "Ada");
  g.track("b", "Bo", "male");
  g.setGenitalPolicy("a", "additive");
  g.setGenitalPolicy("b", "preserve");
  check("policy is per character", g.policyFor("a") === "additive" && g.policyFor("b") === "preserve");
}

// override honours the character's policy
{
  const g = new HelperGame(6);
  g.track("m", "Mira");
  g.setGenitalPolicy("m", "additive");
  g.override("m", "genome.werewolf");
  check("override applies the chosen policy", profileOf(g.cast.get("m")!.sim.subject) === "intersex", profileOf(g.cast.get("m")!.sim.subject));
}

// a service holds its own body profile (a full animal keeps its own genitals)
{
  const g = new HelperGame(7);
  g.track("g", "Griz", "male");
  g.setGenitalPolicy("g", "replace");
  g.bestow("g", "genome.bear", 3);
  check("a species change lands the species form", ["male", "female", "intersex", "none"].includes(profileOf(g.cast.get("g")!.sim.subject)));
}

// --- the legacy-rate regression (claws jumping 0 -> 50%) --------------------
{
  const attrs = contentBundle().attributes as { attributes: Array<{ id: string; progress?: { speed_base?: number } }> };
  // a sane per-minute speed_base is < 0.01; anything higher is an unconverted hour value
  const bad = attrs.attributes.filter((a) => (a.progress?.speed_base ?? 0) > 0.01).map((a) => a.id);
  check("no attribute carries an hour-scale speed_base", bad.length === 0, bad.join(","));

  // and the actual feel: a dog's claws must not be at 50% in three hours
  const g = new HelperGame(8);
  g.track("d", "Dog");
  g.bestow("d", "genome.dog", 3);
  g.advance(3 * 60);
  const claw = g.view().frames[0]!.parts.find((p) => /claw/.test(p.label));
  check("claws are not already at 50% after 3 hours", (claw?.pct ?? 0) < 40, String(claw?.pct));
  g.advance(days(3));
  const later = g.view().frames[0]!.parts.find((p) => /claw/.test(p.label));
  check("but the claws do progress within days", (later?.pct ?? 0) > (claw?.pct ?? 0), `${claw?.pct} -> ${later?.pct}`);
}

console.log(failures === 0 ? "\nGENITAL PASS" : `\nGENITAL FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
