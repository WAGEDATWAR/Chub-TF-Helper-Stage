/**
 * H5 headless test: the pane formatters are pure and their digest is stable, so
 * the surface cannot silently drift. Also proves band phrasing/tone and the moon
 * read.
 */
import { HelperGame } from "../src/game";
import { bandRead, frameHeadline, speciesLabel, moonRead, digest } from "../src/view/format";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GOLDEN = fileURLToPath(new URL("../fixtures/view-golden.txt", import.meta.url));
let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// a stable scenario
const g = new HelperGame(4242, { cycleDays: 28 });
g.track("mira", "Mira");
g.track("wren", "Wren");
g.bestow("mira", "genome.wolf", 2);
g.bestow("wren", "genome.werewolf", 0.5);
g.advance(24 * 12);

const view = g.view();

check("band read tracks exposure", bandRead(view.frames[0]!).pct === view.frames[0]!.exposure);
check("band phrase is stable", bandRead({ ...view.frames[0]!, band: "band.baseline", exposure: 0 }).phrase === "unchanged");
check("species label humanises", speciesLabel("genome.human_baseline") === "human baseline" && speciesLabel(null) === "human");
check("headline names the character", frameHeadline(view.frames[0]!).startsWith(view.frames[0]!.name));
check("moon read is non-empty", moonRead(view.moon).length > 3);

const d = digest(view.frames, view.moon, view.coupling);
check("digest is deterministic", d === digest(g.view().frames, g.view().moon, g.view().coupling));
check("digest names both characters", d.includes("Mira") && d.includes("Wren"));

// the per-character affected-parts read (H19): only parts with progress, each
// carrying a 0..100 % toward its target, de-duplicated, most-progressed first
{
  const p = new HelperGame(99);
  p.track("mira", "Mira");
  p.bestow("mira", "genome.wolf", 2);
  p.advance(24 * 8);
  const frame = p.view().frames[0]!;
  check("parts list is non-empty once changing", frame.parts.length > 0, String(frame.parts.length));
  check("every part carries a 0..100 %", frame.parts.every((x) => x.pct >= 0 && x.pct <= 100), JSON.stringify(frame.parts));
  check("parts are de-duplicated", new Set(frame.parts.map((x) => x.label)).size === frame.parts.length);
  check("parts are ordered most-progressed first", frame.parts.every((x, i, a) => i === 0 || a[i - 1]!.pct >= x.pct));
  check("no part label repeats (grouped)", new Set(frame.parts.map((x) => x.label)).size === frame.parts.length);
  const human = new HelperGame(7);
  human.track("pat", "Pat");
  check("a baseline human has no changed parts", human.view().frames[0]!.parts.length === 0);
}

if (process.argv.includes("--update") || !existsSync(GOLDEN)) {
  writeFileSync(GOLDEN, d + "\n");
  console.log("  wrote golden");
} else {
  const expected = readFileSync(GOLDEN, "utf8").trim();
  check("digest matches the golden", expected === d, "\n--- expected ---\n" + expected + "\n--- actual ---\n" + d);
}

console.log(failures === 0 ? "\nVIEW PASS" : `\nVIEW FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
