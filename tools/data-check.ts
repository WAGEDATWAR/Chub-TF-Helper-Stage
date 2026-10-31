/**
 * Data coverage report (the "sky is the limit" guard). For every genome, bestow
 * it on a fresh subject, run it to settlement, and report what actually lands:
 * attribute count, distinct morph tracks walked, settle time, and exposure. A
 * genome that lands almost nothing, or never reaches a hybrid band, is a weak
 * genome worth fixing. Also checks the fantasy genomes carry their coupling
 * block.
 */
import { mergedContentSet } from "./content";
import { buildRegistries } from "../src/sim/registries";
import { startSubject, bestow, advance } from "../src/sim/subject";
import { days } from "../src/sim/time";

const regs = buildRegistries(mergedContentSet());
const data = mergedContentSet();
const KNOWN = new Set(["genome.wolf","genome.dog","genome.cat","genome.fox","genome.rabbit","genome.bovine","genome.equine","genome.raven","genome.serpent","genome.bat"]);

/** Coarse sample (structure only, D-254): 120-minute step, 50-day horizon. */
const STEP = 120;
const HORIZON_DAYS = 50;
const only = (process.env.AFFECTED_GENOMES ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "all");

interface Row { id: string; attrs: number; morphs: number; settleDay: number; exposure: number; band: string; coupled: string; }
const rows: Row[] = [];

function settled(subject: ReturnType<typeof startSubject>["subject"]): boolean {
  return subject.body.allInstances().every((i) => i.attributes.filter((a) => !a.phase_feral_only).every((a) => a.progress >= (a.target_progress ?? 1000)));
}

for (const genome of regs.genomes.all()) {
  if (genome.id === "genome.human_baseline") continue;
  if (only.length > 0 && !only.includes(genome.id)) continue;
  const sim = startSubject({ name: "Check", seed: 11, regs });
  const morphs = new Set<string>();
  let settleDay = -1;
  try {
    bestow(sim, genome.id, 3.0);
  } catch (e) {
    rows.push({ id: genome.id, attrs: -1, morphs: 0, settleDay: -1, exposure: 0, band: "BESTOW-FAIL", coupled: "" });
    continue;
  }
  for (let t = 0; t < days(HORIZON_DAYS); t += STEP) {
    advance(sim, STEP);
    sim.session.trace.all?.();
    if (settleDay < 0 && settled(sim.subject)) { settleDay = sim.session.clock.day; break; }
  }
  let attrs = 0;
  for (const i of sim.subject.body.allInstances()) {
    for (const a of i.attributes) {
      if (a.progress > 0) { attrs++; if ((a as { morph_chain?: string[] }).morph_chain) morphs.add("chain"); }
    }
  }
  const band = sim.subject.derived.band ?? "-";
  rows.push({
    id: genome.id, attrs, morphs: morphs.size, settleDay,
    exposure: Math.round(sim.subject.derived.exposure ?? 0), band,
    coupled: genome.id === "genome.werewolf" ? "moon" : genome.id === "genome.vampire" ? "ambient" : "",
  });
}

rows.sort((a, b) => a.id.localeCompare(b.id));
console.log("genome                       attrs morph day  exp  band          coupling");
for (const r of rows) {
  console.log(`${r.id.padEnd(28)} ${String(r.attrs).padStart(5)} ${String(r.morphs).padStart(5)} ${String(r.settleDay).padStart(3)} ${String(r.exposure).padStart(4)}  ${r.band.padEnd(13)} ${r.coupled}`);
}

const newRows = rows.filter((r) => !KNOWN.has(r.id));
const weak = newRows.filter((r) => r.attrs < 5 || r.settleDay < 0);
const coupling = rows.filter((r) => r.id === "genome.werewolf" || r.id === "genome.vampire");
console.log(`\ndata-check: ${rows.length} genomes (${newRows.length} new); ${weak.length} weak; coupling blocks: ${coupling.length}`);
for (const c of coupling) {
  const g = regs.genomes.get(c.id) as unknown as Record<string, unknown>;
  const has = Boolean(g.moon_coupling || g.ambient_coupling);
  console.log(`  ${c.id}: coupling ${has ? "present" : "MISSING"}`);
}
if (weak.length > 0) {
  console.log("weak genomes: " + weak.map((w) => w.id).join(", "));
  process.exit(1);
}
