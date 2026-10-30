/**
 * Eye change (D-249): eyes enter phase 0 for every genome, and eye colour stages
 * across progress via morph-step appearance (amber is a first-class value). Locks the
 * sweeping phase placement and the colour walk.
 */
import { buildRegistries } from "../src/sim/registries";
import { contentBundle } from "../src/sim/bundle";
import { startSubject, bestow, advance } from "../src/sim/subject";
import { days } from "../src/sim/time";

const regs = buildRegistries(contentBundle());

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// 1. every phase plan lists `eyes` in phase 0 (the sweeping change)
{
  const merged = contentBundle().phases as { plans: Record<string, { phases: Array<{ families?: string[] }> }>; default: { phases: Array<{ families?: string[] }> } };
  const plans: Array<[string, { phases: Array<{ families?: string[] }> }]> = [
    ["default", merged.default],
    ...Object.entries(merged.plans),
  ];
  const missing = plans.filter(([, p]) => !(p.phases[0]?.families ?? []).includes("eyes")).map(([id]) => id);
  check("every phase plan has eyes in phase 0", missing.length === 0, missing.join(", "));
}

// 2. amber is an allowed eye colour on every eye part
{
  const parts = contentBundle().parts as { parts: Array<{ occupies_role?: string; appearance?: { colour?: { values?: string[] } } }> };
  const eyeParts = parts.parts.filter((p) => p.occupies_role === "eyes");
  check("eye parts exist", eyeParts.length > 0);
  check("amber is allowed on every eye part", eyeParts.every((p) => (p.appearance?.colour?.values ?? []).includes("amber")));
}

// 3. a werewolf's eye colour stages brown -> amber -> gold, and the eyes land in phase 0
{
  const g = startSubject({ name: "Eyes", seed: 3, regs });
  bestow(g, "genome.werewolf", 3);
  const s = g.subject;
  const eyeColour = () => s.body.allInstances().filter((i) => i.role === "eyes").map((i) => i.appearance.colour)[0];
  check("eyes start brown", eyeColour() === "brown", String(eyeColour()));
  const ke = s.body.allInstances().flatMap((i) => i.attributes).find((a) => a.id === "attr.keen_sight");
  check("the eye change is phase 0", (ke as { phase_index?: number })?.phase_index === 0 || (ke as { phase_index?: number })?.phase_index === undefined);

  const seen = new Set<string>();
  for (let t = 0; t < days(30); t++) { advance(g, 1); seen.add(eyeColour()); }
  check("colour passes through amber", seen.has("amber"), [...seen].join(","));
  check("colour ends gold", eyeColour() === "gold", String(eyeColour()));
}

// 4. the werewolf plan's phase 0 is ungated (a bite alone lands it)
{
  const merged = contentBundle().phases as { plans: Record<string, { phases: Array<{ id: string; when?: unknown }> }> };
  const plan = merged.plans["genome.werewolf"];
  check("werewolf has its own plan (from the parent)", !!plan);
  check("phase 0 is ungated (bite alone)", !plan.phases[0]!.when);
  check("a later phase is moon-gated", plan.phases.some((p) => p.when));
}

// 5. an eye morph track's cap lets the attribute reach its target (ends at 1)
{
  const tracks = contentBundle().morph_tracks as { morph_tracks: Array<{ id: string; steps: Array<{ at: number }> }> };
  const eyeTracks = tracks.morph_tracks.filter((t) => /^morph\.eyes/.test(t.id));
  check("eye morph tracks exist", eyeTracks.length > 0);
  check("every eye track ends at progress 1", eyeTracks.every((t) => t.steps[t.steps.length - 1]!.at === 1));
}

console.log(failures === 0 ? "\nEYES PASS" : `\nEYES FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
