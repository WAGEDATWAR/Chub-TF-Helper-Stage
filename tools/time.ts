/**
 * Time-flow groundwork (H17): the clock's unit is whole hours, so sub-hour amounts
 * must bank and roll over. `advanceMinutes` is the seam the future time-parse will
 * feed. Locks the accumulation, the rollover, and that it persists.
 */
import { HelperGame } from "../src/game";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// 5 minutes twelve times advances exactly one hour
{
  const g = new HelperGame(1);
  g.track("m", "Mira");
  const start = g.view().worldTick;
  for (let i = 0; i < 12; i++) g.advanceMinutes(5);
  check("12×5min advances exactly 1 hour", g.view().worldTick - start === 1, String(g.view().worldTick - start));
  check("no minutes banked after a clean hour", g.partialMinutes === 0, String(g.partialMinutes));
}

// a partial amount banks toward the next hour
{
  const g = new HelperGame(1);
  g.track("m", "Mira");
  const start = g.view().worldTick;
  g.advanceMinutes(90); // 1h + 30m banked
  check("90 min advances 1 hour", g.view().worldTick - start === 1, String(g.view().worldTick - start));
  check("90 min banks 30", g.partialMinutes === 30, String(g.partialMinutes));
  g.advanceMinutes(30); // now the bank fills
  check("the bank rolls into a second hour", g.view().worldTick - start === 2, String(g.view().worldTick - start));
  check("the bank is empty again", g.partialMinutes === 0);
}

// 5 minutes alone does not move the clock yet (sub-hour)
{
  const g = new HelperGame(1);
  g.track("m", "Mira");
  const start = g.view().worldTick;
  g.advanceMinutes(5);
  check("5 min alone does not advance the hour", g.view().worldTick === start);
  check("5 min banks", g.partialMinutes === 5);
}

// the bank survives a save/restore round trip
{
  const g = new HelperGame(2);
  g.track("m", "Mira");
  g.advanceMinutes(45);
  const save = g.save()!;
  check("save carries the bank", save.pendingMinutes === 45, String(save.pendingMinutes));
  const h = new HelperGame(2);
  h.restore(save, [{ id: "m", name: "Mira" }]);
  check("restore keeps the bank", h.partialMinutes === 45, String(h.partialMinutes));
}

console.log(failures === 0 ? "\nTIME PASS" : `\nTIME FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
