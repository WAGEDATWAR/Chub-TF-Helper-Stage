# Decisions

- **D-034 — Durable controls mirror to localStorage; a failed generation cannot
  wipe them (H25).** Chub reverts/re-inits chat state when a generation fails (a
  common provider hiccup, e.g. Venice "received empty response from API"); snapshots
  lived only in chat state, so a failed send deleted them. Controls now mirror to a
  per-chat `localStorage` key on every action and at send time, merged back on load
  after chat state. `applyControlState` is idempotent so a restored body keeps its
  progress. `tools/mirror.ts` locks it.

- **D-033 — A simile is not an identity (detect).** "Busy as a bee" no longer binds a
  wasp. A species cue preceded by `like`/`as`/`unlike` is a comparison: it proposes at
  lower confidence and waits for the player (chat), and a card simile does not
  auto-bind. `tools/detect.ts` / `control` cover it.

- **D-032 — Durable pane controls persist on action, not on message (H24).** The
  framework only persists state when a message is sent, so a pane action (override,
  snapshot, moon, pace) lived only in memory; a reload pulled the last message's
  state and re-applied an auto-bind the user had cleared. Durable controls now ride
  `chatState.control`, written immediately via `messenger.updateChatState`, and
  re-apply on load *before* the card scan so a manual override beats an auto-bind.

- **D-031 — Genital policy is a per-character switch; additive → intersex (H23).**
  The parent supports four policies but the helper hardcoded `preserve`, so intersex
  was unreachable. Exposed as a switch (preserve | replace | additive | swap), with
  `additive` filling the empty socket so any body can become intersex; a chat-wide
  `genitalPolicy` config sets the default. `tools/genital.ts` locks it.

- **D-030 — Override replaces; a minute tick; manual control (D-250/D-251).** The
  parent's atomic tick is now **one minute** (D-250), so `advance(n)` advances n
  minutes and every helper hour/day site goes through `src/sim/time` (`days()`/
  `hours()`), never a bare `24`. An override now **replaces** rather than stacks: the
  body and genome reset to baseline first, so "human" truly clears a lycan and a
  manual X replaces an auto-bound Y (fixes "override barely works"). The parent
  restores `subject.genomes` on rehydrate again (D-251) — the "human tag + live
  coupling after reload" bug. Chat detection requires **evidence** (a named tie or a
  nearby change cue) before auto-binding; a passing "a wolf" only proposes. New: NPC
  suggestions, moon reset/nudge, snapshots (save + rewind). `tools/control.ts` locks
  it; the driving floor marks sub-30% parts BUDDING so the LLM stops front-running.

- **D-029 — The LLM paces off per-part progress, not the whole baseline body.** The
  floor now annotates each changing part with its progress and a BUDDING/GROWING
  marker, plus a rule that a budding part is only a faint hint. This is the fix for
  "claws called out at the 2% mark": the model no longer reads a barely-started part
  as fully present.

- **D-025 — Eyes are a first-class phase-0 tell; eye colour stages (D-249).** Every
  phase plan now lands `eyes` in phase 0, and a morph step may carry `appearance` so a
  track can recolour across progress (brown → amber → gold for a beast strain) instead
  of only swapping parts. Amber is a valid colour on every eye part. The werewolf's
  eye tell is `morph.eyes_to_tapetum` (amber now, tapetum under the moon); the serpent
  uses `morph.eyes_to_slit`. Built on the parent's staged-appearance + phase changes
  (vendored). `tools/eyes.ts` locks it.

- **D-024 — The helper configures the moon; the core supplies the default (D-248).**
  The parent core now owns a stateless lunar clock (`core/moon.ts`, fixed 29.53-day
  synodic month) and auto-wires `phaseWhenOpen(session)` as the resolver's gate. The
  helper **overrides** it with `whenOpenFor(sim)`, which reads the sim's own
  `src/sim/lunar.ts` — because the stage exposes a configurable `lunarCycleDays`
  knob (4–60) that a fixed cycle cannot express, and the pane/moon read ride it too.
  So: core = sensible default for any consumer; helper = same vocabulary, tunable
  cycle. The two must not drift in *semantics* (both feed `moon_min`/`moon_phase`),
  only in period. Vendoring keeps the core side current.

- **D-023 — The lycan curse is bite-then-moon (H21).** The werewolf is the first user
  of the parent's phase `when` gate (D-248, vendored): a bite alone lands **phase 0**
  — fangs, claws, tongue, the mark — *permanently* and on its own timetable; every
  later phase is gated on `moon_min`, so the change only deepens as the moon fills.
  The genitals sit in phase 1 behind the same gate, so the moon brings the genital
  change and with it the heat cycle. The gate predicate is supplied per sim
  (`whenOpenFor`, reading that sim's own lunar clock) so the resolver stays
  world-agnostic; the plan is a helper overlay (`data/phases.extra.json`, werewolf
  only). `tools/lycan.ts` proves it: a bite starts the mark, later phases freeze at a
  new moon and advance under a full one.

- **D-022 — The stage page is transparent; the host owns the frame (H19).** Chub has
  **no height/resize API** — the SDK `ReactRunner` never messages a size, and the docs
  describe a stage as an *overlay* on the chat ("messages fade out in the background").
  So a collapsed pane cannot shrink the frame itself; what reclaims space is
  **transparency**: the page (`html/body/#root`) paints nothing and only our panels
  (header, bar, cards) carry a background, so the chat shows through behind them. The
  parent stage does the same (`* { background-color: transparent }`). The dev runner
  paints a backdrop so this is visible offline. (Supersedes the earlier opaque page.)

- **D-021b — The pane collapses; changed parts are listed, not dumped (H19).** Two
  mobile-usability fixes. (a) The pane header has a **collapse/expand** toggle (a
  one-line `▸ chrysalis` bar with a live cast summary + moon); the choice persists in
  `localStorage`, so it stays hidden across reloads and reclaims the chat area on a
  phone. The active tab is persisted too, and an alert dot (`●n`) flags pending
  proposals while collapsed. (b) A cast card now shows an **affected-parts list** —
  only attributes with progress, grouped by part (so "fur" is one line, not 18), each
  with its `(N%)` toward target, most-progressed first; the full composer dump moves
  behind a `full body` disclosure. The frame carries `parts` (label/pct/count) and the
  digest locks it. Touch targets were bumped to a 32px min height.

- **D-021 — A reload never shows a raw id as a name; images are removable.** Two
  small stage quirks. (a) When the chat-wide roster is absent on restore (a reload
  where chat state did not persist), `Stage` now falls back to card/user names by id
  and the card scan renames any restored entry still carrying its id — so a
  placeholder id never surfaces, and detection attribution (which needs the real
  name) keeps working. (b) The rendered body image gains a **remove** button beside
  `reroll` (`Stage.clearVisual`), so a stale picture can be dropped without waiting
  for a change. Locked by `tools/name-restore.ts`.

- **D-020 — Transformation duration is a player pace, applied as a temporal modifier
  (H18).** The authored set settles in ~22–41 days (median 30). The pane offers
  slow / normal / fast / quick / instant; a pace is a **persistent** growth modifier
  (`session.temporal`, `untilTick: 0`) applied to every character, so it scales growth
  without editing genomes and rides the save. One modifier per pace (replace, never
  stack); a joiner inherits it; a config `transformationPace` wins over a card-inferred
  pace. `src/sim/pace.ts` is pure; `tools/pace.ts` locks the curve. (User-directed.)

- **D-H02 — Phase onsets burn down under the temporal rate (parent core fix).** The
  parent's `resolver.start_delay` (the phase schedule) decremented by raw ticks and
  ignored the rate multiplier, so growth scaled but the *schedule* did not: every pace
  floored at the same ~8-day onset, `instant` never dropped below ~8 days, and the
  `compress` power's "Nx faster" was false past the onsets. `tick()` now takes a
  separate `onsetMult` (the temporal rate only, normally 1) and scales the decrement;
  `time_engine` passes the temporal rate. The mind-coupling factor deliberately does
  **not** scale onsets, so the authored calibration is unchanged at defaults and the
  parent suite stays green. Instant now lands in 1–2 days.

- **D-018 — `voluntary` is a distinct trigger gated on realization (H10).** Not a
  synonym for `emotional`: `emotional` is forced-by-feeling; `voluntary` is a
  deliberate shift the character can call **once they have realized** what is
  happening. Realization is the parent's own system, wired in via `src/sim/mind.ts`
  (run per simulated day, awareness from noticed changes); the sim — not the LLM —
  decides it. `triggers.callShift` + a pane button only appear when realized.
  (`data/coupling.json` unchanged in intent; the flag now does something.)

- **D-019 — Ambient and stress are modeled, from data (H10).** A coupled profile's
  `ambient` block (night recovery / sun weariness / thrive) is consumed by
  `ambientAt`, biasing wellbeing so a nocturnal species genuinely thrives at night;
  the `stress` source models like `mood` (threshold + curve). Both stay data-driven.

- **D-015 — Detection has layered channels, weakest last, one-per-family (H9).**
  Channels, in order: explicit species token → family token → implication (cue
  combination) → anatomy signature. Each is gated by negation ("not a wolf"), and a
  single character+family keeps only its strongest claim so siblings never stack.
  Inflection-aware matching ("wolfish", "howled") widens recall without loosening
  precision. Attribution ladder unchanged (clause → nearest name → pronoun → focus →
  sole). Recall went 46%→100% on the corpus at 100% precision.

- **D-016 — Detection is measured by a corpus gate (H9).** Detection is the project's
  greatest asset and its sharpest risk, so it is now **scored**, not vibed:
  `fixtures/detect-corpus.json` holds labeled real-ish prose (explicit, simile,
  metaphor, anatomy-only, negation, focus, sibling-family) and `tools/detect-eval.ts`
  computes precision/recall with a **90% floor** in `npm run check`. Every accuracy
  change is measured against it.

- **D-017 — `track` registers with the detector.** A plain `game.track` (the pane /
  cast path) previously added the character to the cast but not to the detector, so
  detection was blind when characters were added without a card. `track` now
  registers the name + gender. Found by the H9 pane check.

- **D-014 — Visualize renders the sim, never authors it (H8).** A per-character image
  is built *purely* from the frame (species, band, exposure, most-progressed parts)
  plus moon/scene, as a deterministic prompt with a stable cache key; the network
  call is `generator.makeImage` and is non-blocking. The composed text stays
  authoritative — the picture is a rendering of the same facts the prose follows. A
  seed re-rolls; the same key dedupes. `src/view/visualize.ts` is pure and gated by
  `tools/visualize.ts`.

- **D-013 — The dose system is deferred, unified behind one constant.** The core's
  `dose` scales a change, but the stage never surfaced it and the call sites had
  drifted (1.0 vs 3.0). All bestows now use `DEFAULT_DOSE` so behaviour is
  consistent; *whether* to expose, model, or drop dose is parked in `DEFERRED.md`
  (entry `DOSE`) pending a design pass. (User-directed.)

- **D-001 — Import the parent core via a committed `vendor/` copy.** The helper uses
  the parent game's `core/` + `data/` (one core, zero drift). The parent lives in a
  sibling folder while co-developing, but CI has no sibling — so the parent's `core/`
  and `data/` are **committed under `vendor/`** and the aliases (`@core/*`,
  `@gamedata/*`) point there; local dev and CI resolve the exact same core. After a
  parent change, run `npm run sync:vendor` (override the sibling with
  `$env:CHRYSALIS_HOME`) and commit the result. (The parent folder was renamed
  `Mobile Transformation Game` → `Chrysalis`; the vendored copy supersedes the old
  cross-folder `tsconfig` `paths`.)
- **D-002 — Transformation is narrative-sparked.** The card and chat decide who
  changes; an explicit override/forced transform takes precedence when the user uses
  one. (User-confirmed.)
- **D-003 — Detection is layered.** Heuristic first; an optional LLM classifier is a
  second/backup layer for ambiguity. Both propose; the pane can override.
- **D-004 — Owning folder is this workspace.** The helper is its own project, not a
  second stage inside the game repo.
- **D-005 — Patches are by-id overlays.** Local `*.extra.json` fix/extend parent data
  without editing the parent. Matched entries patch by `id` and **replace** plain
  arrays (so a `tags` patch replaces, not concats). If the parent fixes the same
  thing upstream the local patch becomes an equal no-op — no conflict.

## Inherited parent bugs found (H6)

Discovered by `tools/data-check` + a dead-morph scan. All fixed locally via overlays:

1. **`attr.beak` could never apply** — it `requires_part_tags: ["beak_tag"]` and morphs
   the `mouth`, but `part.human_mouth` lacked `beak_tag`. Chicken-and-egg: birds never
   got a beak. Fixed by adding `beak_tag` to `part.human_mouth`.
2. **`attr.paw_pads` could never apply** — it `requires_part_tags: ["foot_tag"]` and
   morphs the `toes`, but `part.human_toes` lacked `foot_tag`. Fixed by adding
   `foot_tag` to `part.human_toes`.
3. **`attr.muzzle` blocked on the `face` role** — requires `head_tag`; `part.human_face`
   lacked it (the `head` role carried it). Fixed by adding `head_tag` to
   `part.human_face`.
4. **`attr.fixed_claws` had no morph track** — fixed-claw species kept human nails.
   Fixed by giving it the canine nail tracks.
5. **`attr.paw_pads` out-competed by `attr.wet_skin`** (same `skin` family, higher
   priority) on amphibious species. Raised `attr.paw_pads` priority to 38.

The parent validator did **not** catch 1–3 because it checks reachability from *any*
part (including the morph destination), not from the starting human part.

## Parent bug fixed directly (H1): composer regex

`core/composer.ts:phraseNamesPart` built a `RegExp` from a part's display name
without escaping; a name with metacharacters (`"penis (5 in.)"`) threw at compose
time. Unlike the patches above this is a **core fix in the parent** (not an overlay),
because it is a plain bug with no data workaround. Parent tests re-run green.

## Parent bug fixed directly (H18): phase onset ignored the rate — see D-H02

`core/resolver.ts` burned `start_delay` down by raw ticks, so a pace/temporal
modifier sped growth but not the schedule (every pace floored at ~8 days). Fixed in
the parent core (no data workaround): the onset now scales by the temporal rate.

## D-006 — Cast = N subjects on one clock

The parent's `Subject` is single-instance, so a cast is N subjects. They share one
world tick and advance together; a late joiner is advanced to the tick on add. The
roster lives chat-wide; per-character saves are branch-local.

## D-010 — Save budget: cap the view rings, keep the sim

The per-message state is dominated by view rings the simulation never reads. We
tail-cap `journal`/`timeline`/`story` (blueprint invariant I2) at save time only,
so the sim is bit-identical and a 6-character year stays ~188 KB. A hard design cap
of 40 KB/character is asserted by `tools/persist.ts` and shown live in the pane.

## D-008 — Werewolf is moon + emotion + hormone, with playstyles

Deliberate divergence from the usual full-moon-only curse: a werewolf's change is
still **triggered by the full moon**, but it is also **hormonal** (her cycle) and can
be **forced by heightened emotion** (fear, rage, desire). The player picks which
levers are live via a per-character **playstyle** — `full` (default), `classic`
(moon only), `emotional`, `hormonal`, `voluntary` — so people play it the way they
like. Moon proximity gives a **partial draw** (fur, nails, senses) rather than a full
shift; the full shift is forced past a pressure threshold and recedes as the moon
wanes.

## D-009 — Coupling is data, not code

A coupled genome declares its sources and curve in `coupling.json`; new fantasy
(dragon, kitsune, fae) is content, not engine. Trigger doses bypass the player's
charge/cooldown economy (they are the world acting, not the player).

## D-011 — Status appends; the guard is conservative and opt-out

The bot's prose is never silently rewritten by the status readout. Two independent
mechanisms, both config-gated (`chub_meta.yaml` → `statusMessage`, `guardProse`):

- **Status (`instrumentRead`)** is returned as a `systemMessage`, which Chub renders
  **after** the bot's message — so it can no longer overwrite a greeting. Default on.
- **Guard** only replaces the prose on a *real* contradiction. The parent `guard()`'s
  `new_object` check is a crude capitalized-word scan that flags ordinary prose
  ("You", "Morning", "Auburn"), so it is treated as **soft**; only `fact_drift`,
  `observer_awareness`, and `empty` replace the message with the floor. Default on.

Regression guarded by `tools/drive.ts` (a normal greeting must survive intact).

## D-012 — Detection reads implication, not just keywords

Literal token matching alone was too weak: prose like *"a wolf bit her"* or *"teeth
sink into her shoulder, a growl fills the night"* produced nothing. Detection now
has four layers, all still data-driven and deterministic:

1. **Literal species tokens** (unchanged).
2. **Family tokens** now carry a representative genome and *propose* rather than
   only journal.
3. **Implication rules** (`implications` in `data/detect.json`): an `any` cue plus a
   `support` cue implies a genome (bite + growl → werewolf). Marked `~token`.
4. **Forgiving attribution**: same clause → nearest name → pronoun-by-gender →
   the message focus (the last person named) → the sole character. So bare,
   pronominal follow-ups still land on the right person.

Also: common-word tokens (`ass`, `kid`, `pup`…) are `weak` and are dropped when a
stronger species token is present ("a wolf with a nice ass" is wolf, not donkey);
and the Stage de-duplicates the roster by lowercased name so a character card and a
same-named user persona do not track twice.

Regression guarded by `tools/detect.ts`.

## D-007 — Detection is heuristic-first, clause-attributed, override-wins

Detection reads the **cards** and the **chat** (never a hidden source). Attribution
is clause-aware so multiple characters transform at once correctly. A **manual
override always wins** and suppresses further proposals. The **classifier** (LLM) is
a non-blocking, non-gating second opinion that only fires when the heuristic found
nothing in new prose. Proposals are always explicit and user-applicable; nothing is
bound silently except a card that plainly names a species (`autoApplyPending`).
