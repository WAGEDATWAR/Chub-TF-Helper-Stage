/**
 * Authoring gate (adapted from the parent's tools/authoring-lint.ts). For every
 * genome in the merged set: bestow it and prove the change starts, does not
 * stall, settles within 50 days, and has no degenerate morph chain / short
 * target. A new genome that does not fully land fails here. Exit non-zero on
 * any error-level finding.
 *
 * Coarsened like the parent (D-254): a 120-minute step over a 50-day horizon —
 * this gate checks *structure* (settles, no stall, no degenerate chain), not exact
 * timing, so the sample can be coarse. `AFFECTED_GENOMES` narrows the run.
 */
import { mergedContentSet } from "./content";
import { buildRegistries } from "../src/sim/registries";
import { startSubject, bestow, advance, mutagenPowerId } from "../src/sim/subject";
import { runDailyMind } from "../src/sim/mind";
import { days } from "../src/sim/time";

interface Finding {
  level: "error" | "warn";
  genome: string;
  message: string;
}

const data = mergedContentSet();
const regs = buildRegistries(data);
const fragments = (data.fragments as { attribute?: Record<string, unknown> }) ?? {};
const attributes = (data.attributes as { attributes: Array<{ id: string; hidden?: boolean; morph_track?: string }> }).attributes;
const tracks = (data.morph_tracks as { morph_tracks: Array<{ id: string; steps: unknown[] }> }).morph_tracks;
const trackById = new Map(tracks.map((t) => [t.id, t]));

/** How coarse the sim sample is, and how far it runs (structure only; see header). */
const STEP = 120;
const HORIZON_DAYS = 50;

/** A genome filter from `AFFECTED_GENOMES` (comma list); absent/`all` = every genome. */
const only = (process.env.AFFECTED_GENOMES ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "all");

const findings: Finding[] = [];
const flag = (level: Finding["level"], genome: string, message: string): void => {
  findings.push({ level, genome, message });
};

function settled(subject: ReturnType<typeof startSubject>["subject"]): boolean {
  return subject.body
    .allInstances()
    .every((i) => i.attributes.filter((a) => !a.phase_feral_only).every((a) => a.progress >= (a.target_progress ?? 1000)));
}

function lintGenome(genomeId: string): void {
  const power = mutagenPowerId(genomeId);
  if (!regs.injectors.get(`injector.${power.replace(/^power\./, "")}`)) {
    flag("warn", genomeId, "no mutagen injector for this genome");
    return;
  }
  const sim = startSubject({ name: "Lint", seed: 7, regs });
  bestow(sim, genomeId, 3.0);
  const subject = sim.subject;
  const scheduled = subject.body.allInstances().flatMap((i) => i.attributes.map((a) => ({ slot: i.slot, a })));

  let settledTick: number | null = null;
  for (let t = 0; t < days(HORIZON_DAYS); t += STEP) {
    const before = sim.session.clock.day;
    // the mind step runs per whole day crossed (a coarse step can skip several)
    advance(sim, STEP);
    for (let d = before; d < sim.session.clock.day; d++) runDailyMind(sim);
    if (settledTick === null && settled(subject)) {
      settledTick = sim.session.clock.tick;
      break;
    }
  }
  if (settledTick === null) flag("error", genomeId, `transformation did not settle within ${HORIZON_DAYS} days`);
  for (const { slot, a } of scheduled) {
    if ((a.target_progress ?? 1000) < 1000 && a.target_progress !== 0) flag("warn", genomeId, `short target ${slot}:${a.id} = ${a.target_progress}`);
    // a slow creep (phase_rate_mult < 1, D-256) trails long after settle by design
    const creeping = ((a as { phase_rate_mult?: number }).phase_rate_mult ?? 1) < 1;
    if (settledTick !== null && !a.phase_feral_only && !creeping && a.progress < (a.target_progress ?? 1000)) flag("error", genomeId, `stalled change ${slot}:${a.id} at ${a.progress}`);
  }
  for (const inst of subject.body.allInstances()) {
    for (const entry of inst.attributes) {
      const chained = (entry as { morph_chain?: string[] }).morph_chain;
      if (chained && chained.length < 2) flag("error", genomeId, `degenerate morph chain on ${inst.slot}:${entry.id}`);
    }
  }
  const changed = subject.body.allInstances().some((i) => i.attributes.some((a) => a.progress > 0));
  if (!changed) flag("error", genomeId, "bestow produced no change");
}

const genomes = regs.genomes.all().filter((g) => only.length === 0 || only.includes(g.id));
for (const genome of genomes) lintGenome(genome.id);

for (const attr of attributes) {
  if (attr.hidden) continue;
  if (attr.morph_track) {
    const track = trackById.get(attr.morph_track);
    if (!track) flag("error", "*", `attribute ${attr.id} names missing track ${attr.morph_track}`);
    else if (track.steps.length < 2) flag("warn", "*", `track ${attr.morph_track} has <2 steps`);
  }
  void fragments;
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
for (const f of findings) console.log(`  ${f.level === "error" ? "ERROR" : "warn "} [${f.genome}] ${f.message}`);
console.log(`\nauthoring: ${errors.length} error(s), ${warns.length} warning(s) over ${regs.genomes.all().length} genomes`);
if (errors.length > 0) process.exit(1);
