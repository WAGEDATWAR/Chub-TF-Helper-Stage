/**
 * H17 time-from-prose gate. Runs the labeled corpus through `readTime` and fails on
 * any case outside its expected minute bracket, so the parser is measured rather than
 * guessed. Also locks the semantics that matter: undated → floor, backstory → floor,
 * and a phrase never *lowers* elapsed time below the floor.
 */
import { readFileSync } from "node:fs";
import { readTime } from "../src/sim/timeparse";

interface Case { id: string; text: string; floor?: number; min: number; max: number; note?: string }

const corpus = JSON.parse(readFileSync(new URL("../fixtures/time-corpus.json", import.meta.url), "utf8")) as { cases: Case[] };

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

for (const c of corpus.cases) {
  const floor = c.floor ?? 5;
  const r = readTime(c.text, floor);
  const ok = r.minutes >= c.min && r.minutes <= c.max;
  check(`${c.id} → ${r.minutes}m${r.phrase ? ` (“${r.phrase}”)` : ""}`, ok, `want ${c.min}..${c.max}`);
}

// the floor is the configured value, not a hardcoded 5
check("the floor is configurable", readTime("nothing here", 30).minutes === 30);
check("an empty message uses the floor", readTime("", 7).minutes === 7);

// an explicit span never drops below the floor
check("a tiny span never beats the floor", readTime("A moment later.", 20).minutes === 20);

// backstory 'years ago' is not elapsed-now
check("backstory reads as the floor", readTime("Twenty years ago she fled.", 5).minutes === 5);

console.log(failures === 0 ? "\nTIMEPARSE PASS" : `\nTIMEPARSE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
