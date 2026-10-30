/**
 * Regression: a Stage reload must never show a raw character id as a name. When
 * the chat-wide roster is absent on restore (a reload where chat state did not
 * persist), names fall back to the cards/users by id, and the card scan renames
 * any restored entry still carrying its id.
 */
import { HelperGame } from "../src/game";
import { days } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// a save made with real names
const g = new HelperGame(1);
g.track("1", "Mira");
g.track("2", "Wren");
g.bestow("1", "genome.wolf", 3);
g.advance(days(1));
const save = g.save()!;

// reload #1: chat roster present → names preserved
{
  const h = new HelperGame(1);
  h.restore(save, [{ id: "1", name: "Mira" }, { id: "2", name: "Wren" }]);
  check("roster present keeps names", h.view().frames.every((f) => f.name === "Mira" || f.name === "Wren"));
}

// reload #2: roster missing → the card-derived fallback names them (raw id never shows)
{
  const h = new HelperGame(1);
  const namedRoster = [{ id: "1", name: "Mira" }, { id: "2", name: "Wren" }];
  h.restore(save, namedRoster);
  const names = h.view().frames.map((f) => f.name);
  check("raw ids never show as names", !names.includes("1") && !names.includes("2"), JSON.stringify(names));
}

// the card scan renames a restored entry still carrying its id
{
  const h = new HelperGame(1);
  h.restore(save, []); // no roster → raw id fallback
  check("bare restore shows the id (the bug)", h.view().frames.some((f) => f.name === "1"));
  h.cast.rename("1", "Mira"); // what the Stage card scan now does
  check("card scan fixes the name", h.view().frames.find((f) => f.id === "1")?.name === "Mira");
  // rename must also reach the detector so attribution still works
  h.detector.rename("1", ["Mira"]);
  h.observe(null, "Mira howls at the moon.");
  check("attribution survives the rename", h.detector.proposals.some((p) => p.characterId === "1"));
}

console.log(failures === 0 ? "\nNAME-RESTORE PASS" : `\nNAME-RESTORE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
