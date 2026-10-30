/**
 * Time flow (H17, D-292). The parent's sim tick is now one minute, so `advance` and
 * `advanceMinutes` are the same unit. This locks the minute mapping, the day/hour
 * reads, and that elapsed minutes persist.
 */
import { HelperGame } from "../src/game";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "../src/sim/time";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(` FAIL ${name} ${detail}`); }
}

// one tick is one minute; a day is TICKS_PER_DAY minutes
check("a day is 1440 minutes", TICKS_PER_DAY === 1440, String(TICKS_PER_DAY));
check("an hour is 60 minutes", TICKS_PER_HOUR === 60, String(TICKS_PER_HOUR));

// 5 minutes advances the clock by 5 (native minute unit, no hoarding)
{
  const g = new HelperGame(1);
  g.track("m", "Mira");
  const start = g.view().worldTick;
  g.advanceMinutes(5);
  check("advanceMinutes(5) advances 5 ticks", g.view().worldTick - start === 5, String(g.view().worldTick - start));
}

// advance() is the same minute unit
{
  const g = new HelperGame(1);
  g.track("m", "Mira");
  const start = g.view().worldTick;
  g.advance(90);
  check("advance(90) advances 90 minutes", g.view().worldTick - start === 90, String(g.view().worldTick - start));
}

// a day of minutes rolls the day counter
{
  const g = new HelperGame(2);
  g.track("m", "Mira");
  g.advance(TICKS_PER_DAY);
  check("a full day advances the day", g.view().day === 2, String(g.view().day));
}

// elapsed minutes persist across a save/restore
{
  const g = new HelperGame(3);
  g.track("m", "Mira");
  g.advanceMinutes(45);
  const save = g.save()!;
  const h = new HelperGame(3);
  h.restore(save, [{ id: "m", name: "Mira" }]);
  check("restore keeps elapsed minutes", h.partialMinutes === 45, String(h.partialMinutes));
}

console.log(failures === 0 ? "\nTIME PASS" : `\nTIME FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
