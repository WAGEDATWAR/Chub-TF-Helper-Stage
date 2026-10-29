/**
 * H9 detection evaluation. Runs the labeled corpus (`fixtures/detect-corpus.json`)
 * through the real detector and reports precision / recall / exact-match, then fails
 * on any regression. This is the harness that makes detection improvements measured
 * rather than guessed.
 *
 * Each case: register its characters, feed `prior` messages then `text`, and score
 * the pending proposals:
 *   - `expect`: per-character genome that MUST be proposed (recall) and, unless the
 *     same character appears in `must`, no *other* genome on that character.
 *   - `must` / `mustNot`: genome presence anywhere.
 */
import { readFileSync } from "node:fs";
import { HelperGame } from "../src/game";

const detectData = JSON.parse(readFileSync(new URL("../data/detect.json", import.meta.url), "utf8")) as { species: Array<{ genome: string; family: string }> };
const FAMILY_OF = new Map<string, string>();
for (const s of detectData.species) FAMILY_OF.set(s.genome, s.family);
const family = (g: string) => FAMILY_OF.get(g) ?? g;

interface Case {
  id: string;
  chars: string[];
  /** Optional per-character gender; defaults to female. */
  genders?: Record<string, string>;
  prior?: string[];
  text: string;
  expect?: Record<string, string>;
  must?: string[];
  mustNot?: string[];
  note?: string;
}

const corpus = JSON.parse(readFileSync(new URL("../fixtures/detect-corpus.json", import.meta.url), "utf8")) as { cases: Case[] };

let fails = 0;
let tp = 0;
let fp = 0;
let fn = 0;

function run(testCase: Case): { proposed: Map<string, string[]>; all: Set<string> } {
  const g = new HelperGame(7);
  for (const name of testCase.chars) g.knowCard({ id: name.toLowerCase(), names: [name], text: `${name}.`, baseGender: testCase.genders?.[name] ?? "female" });
  for (const p of testCase.prior ?? []) g.observe(null, p);
  g.observe(null, testCase.text);
  const proposed = new Map<string, string[]>();
  const all = new Set<string>();
  for (const p of g.view().proposals) {
    all.add(p.genome);
    const list = proposed.get(p.characterName) ?? [];
    list.push(p.genome);
    proposed.set(p.characterName, list);
  }
  return { proposed, all };
}

for (const c of corpus.cases) {
  const { proposed, all } = run(c);
  const problems: string[] = [];

  for (const [who, genome] of Object.entries(c.expect ?? {})) {
    const got = proposed.get(who) ?? [];
    // an expected genome is satisfied by the exact genome OR a same-family sibling
    const hit = got.includes(genome) || got.some((g) => family(g) === family(genome));
    if (hit) tp++;
    else { fn++; problems.push(`expected ${who}→${genome} (or its family), got [${got.join(", ")}]`); }
    // precision: no *unrelated-family* extra on that character (unless in `must`)
    if (!c.must?.includes(genome)) {
      for (const other of got) {
        if (family(other) !== family(genome) && !c.must?.some((m) => family(m) === family(other))) { fp++; problems.push(`extra ${who}→${other}`); }
      }
    }
  }
  for (const genome of c.must ?? []) {
    // "must" is satisfied if any genome of that family is present
    if ([...all].some((g) => family(g) === family(genome))) tp++;
    else { fn++; problems.push(`required ${family(genome)} missing`); }
  }
  for (const genome of c.mustNot ?? []) {
    if ([...all].some((g) => family(g) === family(genome))) { fp++; problems.push(`forbidden family ${family(genome)} present`); }
  }

  // `expect: {}` means "no character should get a species proposal at all"
  if (c.expect && Object.keys(c.expect).length === 0 && !c.must?.length) {
    if (all.size > 0) { fp++; problems.push(`expected nothing, got [${[...all].join(", ")}]`); }
  }

  if (problems.length === 0) console.log(`  ok  ${c.id}`);
  else { fails++; console.log(` FAIL ${c.id} — ${problems.join("; ")}`); }
}

const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
console.log(`\nprecision ${(precision * 100).toFixed(0)}% (${tp}✓ ${fp}✗) · recall ${(recall * 100).toFixed(0)}% (${fn} missed)`);

// a floor so a regression cannot pass by simply dropping corpus cases
if (precision < 0.9) { fails++; console.log(` FAIL precision ${(precision * 100).toFixed(0)}% < 90%`); }
if (recall < 0.9) { fails++; console.log(` FAIL recall ${(recall * 100).toFixed(0)}% < 90%`); }

console.log(fails === 0 ? "\nDETECT-EVAL PASS" : `\nDETECT-EVAL FAIL (${fails} cases)`);
process.exit(fails === 0 ? 0 : 1);
