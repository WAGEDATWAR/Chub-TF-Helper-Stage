/**
 * Time from prose (H17). A message advances however much its *content* implies; an
 * undated one advances a small floor. Time never moves on a wall clock — only a
 * message or a pane control moves it.
 *
 * Pure and deterministic. This is a coarse reader, not a parser: it matches explicit
 * and common relative time phrases. Ambiguity resolves conservatively (the floor), and
 * "N years ago" backstory is not elapsed time.
 *
 * The result is **minutes**, and `floorMinutes` is the configured per-message minimum.
 */

export interface TimeRead {
  minutes: number;
  /** The phrase that was read, or null when the floor applied. */
  phrase: string | null;
  /** True when the floor (the configured per-message minimum) was used. */
  floor: boolean;
}

/** Minutes in the units a phrase can name (a month is taken as 30 days, a year 365). */
const UNIT_MINUTES: Record<string, number> = {
  second: 1 / 60,
  minute: 1,
  hour: 60,
  day: 1440,
  week: 10080,
  fortnight: 20160,
  month: 43200,
  year: 525600,
};

/** Words that introduce a time span, with the multiplier they imply when bare. */
const BARE: Array<[RegExp, number]> = [
  [/\bmoments?\b|\bseconds?\b|\ban instant\b|\binstantly\b/, 1],
  [/\ba couple( of)?\b/, 2],
  [/\ba (moment|little while|short while)\b|\bmoments? later\b|\bmoments?\b/, 2],
  [/\bover ?night\b|\bovernight\b/, 8 * 60],
  [/\bthe next (morning|day)\b|\bthe following (morning|day)\b|\bin the morning\b(?!.*\bof\b)/, 12 * 60],
  [/\bthe next (evening|night)\b|\bthat (evening|night)\b/, 8 * 60],
  [/\blater that (day|afternoon|evening|night)\b|\bthat afternoon\b/, 4 * 60],
  [/\ba (little|short) while\b|\bsome time\b|\ba while\b/, 20],
  [/\blater\b(?!\s+\d)/, 15],
  [/\bsoon\b/, 10],
];

/** Number words that can precede a unit. */
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, "a few": 3, few: 3, several: 4, couple: 2,
};

/** "three days", "a week", "2 hours", "a couple of days" — a number then a unit. */
const SPAN = /\b(a few|several|a couple(?: of)?|couple(?: of)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|fortnights?|months?|years?)\b/gi;

/** "in 3 days", "over 2 weeks", "3 days later" — an elapsed span (not "years ago"). */
function spanMinutes(numText: string, unitText: string): number {
  const raw = numText.toLowerCase().replace(/\s+of$/, "").replace(/^a couple$/, "couple");
  const num = NUMBER_WORDS[raw] ?? (/^\d+$/.test(raw) ? Number(raw) : NaN);
  const unit = unitText.toLowerCase().replace(/s$/, "");
  const per = UNIT_MINUTES[unit];
  if (!Number.isFinite(num) || per === undefined) return NaN;
  return num * per;
}

/**
 * Read the elapsed minutes a message implies. `floorMinutes` is the configured
 * per-message minimum (default 5). A backstory "twenty years ago" reads as 0 minutes
 * (it is not elapsed-now) — the floor applies instead.
 */
export function readTime(text: string, floorMinutes = 5): TimeRead {
  const t = (text ?? "").toLowerCase();
  const floor = Math.max(1, Math.round(floorMinutes));
  if (!t.trim()) return { minutes: floor, phrase: null, floor: true };

  // an explicit span only counts when it reads as "now"-relative, not backstory
  let best: TimeRead | null = null;
  for (const m of t.matchAll(SPAN)) {
    const [phrase, numText, unitText] = m;
    const at = m.index ?? 0;
    const before = t.slice(Math.max(0, at - 12), at);
    const after = t.slice(at + phrase.length, at + phrase.length + 8);
    // "years ago" / "a lifetime ago" = backstory unless prefixed by "in"
    if (/\bago\b/.test(after) && !/\bin\s*$/.test(before)) continue;
    const minutes = spanMinutes(numText!, unitText!);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    if (!best || minutes > best.minutes) best = { minutes, phrase: phrase!.trim(), floor: false };
  }

  if (best) return { minutes: Math.max(floor, Math.round(best.minutes)), phrase: best.phrase, floor: false };

  // bare cue phrases (no number) — only used when no explicit span matched. The
  // first matching cue wins (the list is ordered most-specific first), so "a moment
  // later" reads as a moment, not as the generic "later".
  let bare: TimeRead | null = null;
  for (const [re, minutes] of BARE) {
    const m = re.exec(t);
    if (m) { bare = { minutes, phrase: m[0], floor: false }; break; }
  }

  if (bare) return { minutes: Math.max(floor, Math.round(bare.minutes)), phrase: bare.phrase, floor: false };
  return { minutes: floor, phrase: null, floor: true };
}
