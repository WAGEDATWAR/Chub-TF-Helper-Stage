# Deferred, stubbed, and content-gap tracker

A running ledger of things that are **not finished**: deliberately deferred,
stubbed, or inconsistently applied. Nothing here is a bug in the "must fix now"
sense — it is the *known incompleteness* we have chosen to carry. Each entry has an
id, a status, and enough context to pick it back up.

Status legend:
- **DEFERRED** — a decision was made to postpone; needs a design pass, not code.
- **STUB** — code runs but is a placeholder / no-op; safe, but does nothing yet.
- **GAP** — something got a fix/feature that a similar sibling did not; a consistency
  debt, not a crash.

Do not silently resolve these — update this file (and `DECISIONS.md` for a ruling).

Milestones referenced as **H…** are in `PLAN.md`. A status of "scheduled: Hn" means
the item is picked up by that milestone; it is not dropped.

---

## Planned work with no current stub (tracked so it is not lost)

These are features the plan commits to that have **no code yet** — listed here so the
ledger is complete, not because anything is stubbed:

- **H8 — Visualize. Shipped.** Per-character body image via `generator.makeImage`;
  `src/view/visualize.ts` (pure) + `Stage.visualize()` + a pane `see`/`reroll` action.
  Follow-ups noted in `PLAN.md` (before/after via `imageToImage`, aspect-ratio knob).
- **H18 — Transformation duration. Shipped.** Pace knob + card inference; see the
  `DURATION` entry below for the one remaining gap (card-stated order/timing).
- **H20 — Part/skeleton visualizer.** A visual body map (which parts are changed and
  how far), on the menu — not stubbed yet. The H19 parts list is the textual stand-in.
- **H21 — Lycan curse. Shipped.** Bite → permanent phase 0; later phases + genitals
  gated on the moon (D-023), via the parent's phase `when` gate (D-248). The genome,
  feral profile and phase plan now live in the **parent base data** (D-249); the helper
  keeps only the coupling + detect wiring and absorbs on sync.

## MOON-GATED-OTHER-SPECIES — only the werewolf uses the lunar phase gate

- **Status:** GAP (only werewolf; grows per exotic species)
- **Where:** parent `data/phases.json` (`genome.werewolf` plan), `src/sim/subject.ts`
  (`whenOpenFor`).
- **What:** D-248 lets any phase gate on world state (`moon_min`/`moon_phase`), but
  only `genome.werewolf` uses it. Other species whose fiction is moon/light/tide-bound
  (a lunar-tide species, a sun-fearing one) could gate phases the same way; it is
  content, not engine. Vanilla `genome.wolf` stays ungated (it is the plain animal).
- **Decide:** which future species gate on which world state, and whether to add more
  world-state criteria keys (time-of-day, season) alongside the lunar ones.

## WEREWOLF-SOURCE-OF-TRUTH — parent owns it, helper must not shadow

- **Status:** resolved by convention (D-249); watch on future edits
- **Where:** parent `data/genomes.json` + `feral.json` + `phases.json` vs helper
  `data/genomes.extra.json` / `feral.extra.json` / `phases.extra.json`.
- **What:** the werewolf genome, feral profile and lycan plan were **moved to the
  parent** and stripped from the helper overlays. A helper entry with the same id
  *shadows* the parent (overlays replace arrays), so re-adding one there would silently
  win. Keep only helper-specific werewolf bits (coupling, detect cues) in the helper.

- **H12 — Stage polish.** Phone-width layout, a11y (real buttons, focus, aria-live),
  config knobs for existing toggles, status/guard UX.
- **H15 — Voice (optional).** `generator.speak` for the status, `makeSound` foley on
  a shift. Additive only.

---

## GENOME-PACKS — partition content into loadable packs

- **Status:** DEFERRED (needs a design pass; not needed for the base set)
- **Where:** `data/*.extra.json` (genomes, parts, injectors, feral, attributes) +
  `tools/content.ts` (the merge).
- **What:** all content currently lives in a handful of global `*.extra.json` files;
  one `genomes.extra.json` will bloat as the fantasy set grows. Intended: **packs** —
  self-contained bundles that add genomes *and everything they need* (parts,
  injectors, feral profiles, attributes, morph tracks, detect cues) as a unit, so a
  genre (a "fantasy" pack, a "dinosaur" pack) is partitioned and loadable.
- **Open questions:** can packs be **optional** (a chat/setting toggles one on)? Can
  **users author** them (drop a JSON, or a published pack)? How do pack ids namespace
  to avoid collisions, and how does an overlay patch across packs?
- **Bearing:** `tools/content.ts` merge, the `@gamedata` import, `data-check` (must
  validate a pack in isolation too). "Everything is data" doctrine already fits — a
  pack is just scoped data.
- **Note:** the current base set is fine as-is; this is a scaling refactor, not a fix.

## FANTASY-RACES-RULES-AND-CORPUS — rules + corpus per new race

- **Status:** DEFERRED (do at the milestone where fantasy races are added)
- **Where:** `data/detect.json` (`implications`, `anatomy_rules`),
  `fixtures/detect-corpus.json`, `data/coupling.json`.
- **What:** detection is now measured (H9), but each new fantasy genome needs its own
  **implication rules**, **anatomy-signature rules**, **coupling block** (if coupled),
  **and corpus cases** — or it silently regresses to literal-word-only. A new race is
  "real" only when it also lands detect rules + corpus cases that keep the eval at
  100%/100%.
- **Do:** for each new race, add detect cues + at least ~2 corpus cases (an explicit
  one and an implied/anatomy-only one), plus a coupling profile if it is triggered.

---

## TIME-MODEL — infer elapsed time from message content

- **Status:** DEFERRED (scheduled: H17)
- **Where:** `src/sim/cast.ts` (`advance`), `src/stage/Stage.tsx` (`beforePrompt`),
  `chub_meta.yaml` (`ticksPerMessage`), the pane's time controls.
- **What:** today the world advances a fixed `ticksPerMessage` hours per message.
  Intended: time advances **only** via a message or a pane time control, and a message
  advances however much its *content implies*. An undated/uncertain message advances a
  **5-minute minimum**; a dated one ("the next morning", "three days later") advances
  that much. The fixed config becomes the fallback, not the rule.
- **Decide:** the cue grammar (absolute dates, relative phrases, sleeps, "later"),
  how to disambiguate "years ago" (backstory) from elapsed time, and whether an
  inferred jump is ever surfaced/editable in the pane.
- **Building:** a pure `src/sim/timeparse.ts` with a labeled corpus + eval (mirrors
  H9 detection). Must call the per-day mind step for each day it skips.

---

## DURATION — how long a transformation takes

- **Status:** shipped (H18); one GAP remains
- **Where:** `src/sim/pace.ts` (pure), `src/game.ts` (`setPace`), `src/stage/Stage.tsx`
  (config + card inference), pane Tools tab, `core/resolver.ts` (D-H02 onset fix).
- **What:** shipped — a pane **pace** (slow/normal/fast/quick/instant) as a persistent
  temporal growth modifier, applied cast-wide, inferred from card text when present, so
  duration is player- and card-controllable instead of fixed at the authored ~30 days.
- **GAP — card-stated order/pacing instructions.** A card that spells out its own
  transformation (a specific part *order*, a forced duration per stage, "her ears go
  first, then over a week her tail") is only crudely read: `inferPace` matches a few
  duration keywords and ignores any stated **ordering** or per-step timing. A card's
  bespoke morph script therefore does not steer the sim's phase plan.
- **Decide:** how far to honour a card's own pacing/order (a light keyword read of the
  pace only, vs. parsing a stated sequence and remapping phases). Big ask; the pace
  knob already covers the common case ("make it faster/slower").
- **Bearing:** `src/sim/pace.ts` (`inferPace`), `data/phases.json` (per-genome order —
  the parent's, not the card's).

---

## DOSE — the bestow dose system

- **Status:** DEFERRED (scheduled: H16; needs a ruling — implement, expose, or drop)
- **Where:** `src/sim/subject.ts` (`DEFAULT_DOSE`), `src/game.ts`, `src/sim/cast.ts`,
  `src/sim/triggers.ts`, `core/observer.ts` + `core/phases.ts` (parent).
- **What:** the core's `dose` genuinely scales a change — magnitude, distribution
  push (`phases.ts:180`, clamped at `dose/5`), and observer scatter
  (`observer.ts:scatterDose`). The stage, however, never surfaced it to the player
  and the call sites had **drifted**: `cast.bind` / `game.bestow` defaulted to `1.0`
  and `subject.bestow` to `3.0`. Coupling draws also scale a dose by `*0.25` and
  shifts by `dose_at_shift`.
- **Now:** every path funnels through one `DEFAULT_DOSE = 3.0` constant, so behaviour
  is consistent and there is one knob. Doses are still not player-visible.
- **Decide:** (a) drop the knob entirely and hardcode a settled dose, (b) expose it
  as a per-bestow/per-proposal control, or (c) model it (a "potency" stat, dose
  economy with the observer's charge). Feel/UX is unclear: does the player ever *want*
  a weak vs strong bestow, or is the genome's own growth curve enough?
- **Bearing:** `data/coupling.json` `dose_at_draw`/`dose_at_shift`; the `?dose=` dev
  query in `Pane.tsx`. Removing the system means folding these into constants.

## Voluntary shift — the `voluntary` playstyle flag

- **Status:** resolved (H10)
- **Where:** `data/coupling.json`, `src/sim/coupling.ts` (`canWillShift`),
  `src/sim/triggers.ts` (`callShift`), pane Tools tab.
- **RULING (user):** `voluntary` and `emotional` **must be distinct triggers**. Done:
  `voluntary` is a deliberate, player-facing shift gated on the character having
  **realized** the change (parent realization wired via `src/sim/mind.ts`); the pane
  shows a "call shift" button only once realized. `emotional` is unchanged
  (forced-by-feeling). `tools/coupling.ts` proves the distinction.

## Coupling `ambient` block — night/sun for the vampire

- **Status:** resolved (H10)
- **Where:** `src/sim/coupling.ts` (`ambientAt`), `src/sim/triggers.ts`.
- **What:** wired — a nocturnal profile recovers wellbeing at night and wearies by
  day; a `thriving` read is exposed. `tools/coupling.ts` asserts the day/night bias.

## Coupling `stress` source + unused settings

- **Status:** mostly resolved (H10); `emotionDecayPerCheck` still open
- **Where:** `src/sim/coupling.ts`.
- **What:** `stress` now models like `mood` (threshold + curve over named emotions).
- **Remainder:** `emotionDecayPerCheck` is still parsed-but-unused; the mind step does
  decay mood nightly, so decide whether this knob is redundant and drop it.

## `applyRelated` — post-apply hook

- **Status:** STUB (scheduled: H14)
- **Where:** `src/game.ts:237` (`applyRelated`).
- **What:** called after a proposal applies; currently only logs. Intended to handle
  a *second* species naming someone already changing (a "later proposal"), and any
  cross-character consequence. The comment says "nothing to do here".
- **Decide:** what applying one genome to one character should do to others (if
  anything), and whether a second genome on one character is allowed, stacks, or
  supersedes.

## Detection ↔ content coverage asymmetries

- **Status:** mostly resolved (H9); remainder tracked
- **Where:** `data/detect.json`, `src/detect/*`.
- **What:** was uneven — only werewolf/vampire had implication rules, real animals
  relied on a literal word. H9 added implication + anatomy-signature channels across
  families, negation + inflection handling, a labeled corpus, and a precision/recall
  gate (100%/100% on the corpus).
- **Remainder:** scene-prop extraction for the guard haystack; a classifier
  cross-check in the eval; more corpus cases as fantasy genomes land.

## Scene props are never populated — `sceneObjects` / `sceneAmbient`

- **Status:** STUB (still open; H9 added the detection channels but not prop parsing)
- **Where:** `src/stage/Stage.tsx:21-22` (declared, always `[]` / `""`), consumed by
  `drive.ts` `castBundle` (scene haystack for the guard).
- **What:** the guard's "no new objects" haystack only ever contains the cast's names,
  never real scene props.
- **Decide:** derive props from the last bot message (parse? the classifier?) or drop.

## Coupling coverage is only werewolf + vampire

- **Status:** GAP / DEFERRED (grows per new coupled genome)
- **Where:** `data/coupling.json`.
- **What:** only the two fantasy genomes have a coupling profile. The plan says the
  fantasy set may grow ("sky's the limit"); a new fantasy genome (dragon, kitsune,
  fae) is described as content-only, but each would need a `coupling` block and
  `data-check` only *requires* one for genomes flagged as fantasy.
- **Decide:** which future genomes are "coupled" and what sources they use.

## Classifier is the only non-deterministic layer

- **Status:** GAP (scheduled: H13)
- **Where:** `src/stage/Stage.tsx` (`classifyInBackground` → `generator.textGen`).
- **What:** the optional LLM classifier fires from `afterResponse` but its result was
  never observed end-to-end in a live chat (dev runner has no model). It self-disables
  on error. Unverified in production.
- **Decide:** confirm it parses real model output and only ever *adds* proposals.

## Composer / mind-perception depth

- **Status:** resolved (H11)
- **Where:** `src/sim/cast.ts` (`interiorOf`), `src/drive/drive.ts` (`interiorLine`).
- **What:** each frame carries an `interior` (awareness tier, mood, top feelings,
  characteristic mind values), shown on the card and folded into the floor from her
  POV. Gated to awareness so a blind subject reads as all surface (the observer rule).
- **Remainder:** perception (the `seen`/`felt`/`told` notice paths and beliefs about
  her own body) is still only partially surfaced — the betrayal/self-image dynamics
  are in the core but not yet shown. Promote to its own entry if it grows.

## Lunar clock: helper overrides the core default (D-024)

- **Status:** deliberate divergence (not a gap)
- **Where:** `src/sim/lunar.ts`, `src/sim/subject.ts` (`whenOpenFor`) vs the parent
  `core/moon.ts` + `phaseWhenOpen`.
- **What:** the parent core supplies a fixed 29.53-day lunar clock + gate; the helper
  overrides the gate to read its own **configurable-cycle** moon (`lunarCycleDays`
  knob, 4–60, also used by the pane moon read). Same vocabulary (`moon_min`/
  `moon_phase`), different period. Do not let the two drift in semantics.

## Packaging / publish

- **Status:** DEFERRED (scheduled: H13)
- **Where:** `.github/workflows/stage-deploy.yml`, `public/chub_meta.yaml`.
- **What:** deploy wiring exists but the stage has not been published; the first push
  is meant to create the stage and write back its id.
- **Decide:** when to publish (out of testing).

---

## How this file is maintained

- Add an entry whenever a system is deferred, stubbed, or given special treatment a
  sibling does not get.
- Keep entries honest: state the *current* behaviour, not the intent alone.
- When resolved, move the summary to `DECISIONS.md` (for a ruling) or delete the
  entry (for a plain gap fix). `npm run check` does not read this file.

