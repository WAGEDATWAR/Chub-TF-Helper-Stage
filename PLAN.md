# Chrysalis Transformation Helper — Plan

A Chub stage that **simulates a transformation per character and drives the LLM**
so the chat's prose follows a real, phased progression instead of drifting. Built on
the *Chrysalis* core (committed under `vendor/`, synced from the sibling repo with
`npm run sync:vendor`) — one core, zero drift.

> **Companion docs.** `DEFERRED.md` is the live ledger of what is unfinished
> (deferred / stubbed / gaps) — every plan item that is not "done" must have a
> matching entry there or be spelled out below. `DECISIONS.md` holds rulings.

## Doctrine

- **The chat is the source of truth.** A transformation is *narrative-sparked*: the
  character card and what happens in the chat decide who changes and into what. An
  explicit override/forced transform is allowed and takes precedence when used.
- **Detection is layered.** A deterministic heuristic first (cue tables over the card
  and each message, attributed to named characters); an optional LLM classifier is a
  second/backup layer for when the heuristic is ambiguous. Both are proposals; the
  pane can always override.
- **The sim is authoritative.** Once a genome is bound to a character, the core
  resolves real attributes/progress/phases/morphs and the pane renders them; the LLM
  only *renders* the composed facts.
- **Deterministic where it must be.** Sim, detection, save. Only the optional
  classifier and an external image/audio provider are non-deterministic, and neither
  gates state.
- **Everything is data.** New genomes reuse existing traits/parts/tracks; a new
  genome is only "real" once it clears the parent validator + an authoring gate.
- **A stage is a UI in a chat, not an app.** It has a `generator` (images, TTS,
  music, foley, video, text), a config schema the player sees in Chat Settings, and
  it must hold up at phone width inside an iframe. Lean into that.

## Scope (confirmed)

- Engine: the transformation core, plus **full mind/perception for NPCs** and the
  relevant mind/perception values for a player character (which a player shouldn't
  directly control). Town/dialogue/sex are out for now.
- Up to **~6 characters** tracked transforming at once.
- Genome expansion: **real animals first**, plus **werewolf** (moon-coupled) and
  **vampire** (night/ambience) as the start of the fantasy set. "Sky's the limit"
  thereafter — adding a genome is JSON only.
- **Coupled genres are distinct triggers, never aliases.** A werewolf's levers are
  the moon, emotion, and (optionally) a deliberate choice — each its own mechanism.

## Architecture

```
tools/content.ts     parent data + local *.extra.json overlays (patched by id)
tools/validate.ts    parent validator over the merged set          (gate)
tools/authoring.ts   bestow each genome; must settle < 90d         (gate)
tools/data-check.ts  per-genome coverage: attrs, morphs, settle     (gate)
src/sim/registry     registry build over merged data (stage + gates share it)
src/sim/subject      start a subject; bestow a genome; advance
data/*.extra.json    genomes · feral · injectors · attributes · parts (overlays)
```

Layering (all headless): `sim/*` (cast, lunar, coupling, triggers) → `detect/*` →
`drive/*` → `stage/*` (the thin `@chub-ai` boundary + pane) → `view/*` (formatting).

## Milestones

Shipped milestones are listed for context; open work is **H8 onward**. Every open
milestone names the `DEFERRED.md` entry it closes (if any).

| # | Deliverable | Status | Closes |
|---|---|---|---|
| H0 | Stage scaffold, aliases, headless smoke, minimal pane | done | — |
| H1 | Cast + shared clock + per-message advance | done | — |
| H2 | Detection: cue tables, clause attribution, override, classifier | done | — |
| H3 | Lunar/ambient coupling + distinct werewolf + playstyles | done | — |
| H4 | Prompt driving (per-character facts floor) + message guard | done | — |
| H5 | Instrument pane (cast read, detection feed, tools) + golden view | done | — |
| H6 | Genome expansion (36) + overlay merge + gates | done | — |
| H7 | Persistence: per-character save, budget cap, restore, gate | done | — |
| H8 | **Visualize: render each body as an image** (`generator.makeImage`) | **done** | — |
| H9 | **Detection depth: implication rules, per-family cues, focus** | **done** | detection gaps |
| H10 | **Trigger fidelity: voluntary≠emotional, vampire ambient, stress, decay** | **done** | voluntary, ambient, stress |
| H11 | **Mind/perception: surface to pane + the driving floor** | planned | mind-depth |
| H12 | **Stage polish: mobile width, a11y, config knobs, status/guard UX** | planned | scene-props |
| H13 | **Publish: `chub_meta`, deploy workflow, first push (H8/old)** | planned | packaging |
| H14 | **Hardening: multi-genome on one char, second-genome semantics** | planned | applyRelated |
| H15 | **Optional voice: TTS the status, foley for a shift** | planned | — |
| H16 | **Dose ruling** (implement / expose / drop) | planned | DOSE |
| H17 | **Time model: infer elapsed time from message content** | planned | — |
| H18 | **Transformation duration: a pace knob + card-inferred rate** | **done** | PACE |
Milestone order is a suggestion; H8–H12 are independent and can be resequenced.

## H18 — Transformation duration — done

Shipped. The authored set settles in ~22–41 simulated days (median 30) — right for
some chats, far too slow for others. The pane now offers a **Transformation pace**
(slow / normal / fast / quick / instant) applied to the whole cast as a **persistent
temporal growth modifier** (the parent's own `session.temporal`, `untilTick: 0`), so
it scales growth without touching any genome and rides the per-character save.
Setting a pace replaces rather than stacks; a late joiner inherits it; a card that
states its own pacing ("over months", "instantly", "overnight") is inferred at load
and applied unless a config `transformationPace` overrides. `src/sim/pace.ts` is
pure/deterministic; `tools/pace.ts` locks the curve (instant ≤ 3 days, normal ≈ 30,
monotonic) and non-stacking.

- **Fixed a parent-core bug (D-H02):** the phase **onset** (`resolver.start_delay`)
  burned down by raw ticks and ignored the growth rate, so every pace floored at the
  same ~8-day phase schedule — `instant` never went below ~8 days and the `compress`
  power's "Nx faster" was a lie past the onsets. The onset now scales by the
  temporal-rate multiplier (normally 1, so the authored calibration is unchanged).
  Instant now genuinely collapses to 1–2 days; parent `npm run test` stays green.

## H8 — Visualize (image of the current body) — done

Shipped. `src/view/visualize.ts` (pure) builds a deterministic prompt/negative/key
from a frame + moon + scene; `Stage.visualize()` calls `generator.makeImage`
(non-blocking, pending → url/error state, seed re-rolls, key dedupes); the pane's
cast card has a `see`/`reroll` action that renders the image inline. The image is
never authoritative — the composed text is. `tools/visualize.ts` locks the prompt
(deterministic, names the character/species, threads the most-progressed parts, key
changes only when the body does). The dev runner's mock generator returns a
placeholder, so it is testable offline.

- Follow-ups (not blocking): `imageToImage` for before/after; a per-band framing
  pass; an aspect-ratio config knob. A `remove` button beside `reroll` drops the
  current image (D-021).

## H9 — Detection depth — done

Shipped. Detection is now **measured** (`tools/detect-eval.ts` over
`fixtures/detect-corpus.json`, 90% precision/recall floor in `npm run check`) and
multi-channel: explicit species → family → implication (cue combos like bite+growl,
moon+howl) → anatomy signature (fur+ears+muzzle). All channels are **negation-aware**
("not a wolf") and **inflection-aware** ("wolfish", "howled"); one claim per
character+family so siblings don't stack. Attribution ladder unclamped (clause →
nearest name → pronoun → focus → sole). The pane shows a confidence band and a
"why" reason per proposal. Corpus recall 46% → 100% at 100% precision.

- Also fixed the `track` path not registering names with the detector (D-017).
- Remainder (planned): scene-prop extraction for the guard haystack; a classifier
  cross-check in the eval.

## H10 — Trigger fidelity — done

Shipped. `voluntary` is now a **distinct trigger** from `emotional` (RULING): a
realized character may call the shift on purpose (`triggers.callShift`, a pane
button), with neither moon nor emotion. The parent's realization system is wired in
(`src/sim/mind.ts`, run once per simulated day): awareness rises from noticed
changes and fires the realization moment; frames carry `awareness`/`realized`, shown
in the pane. The vampire's night/sun `ambient` block is consumed (wellbeing
recovery/wearying, a `thriving` read), and `stress` is modeled like mood. Playstyle
is chat-wide and survives a swipe.

- `tools/coupling.ts` proves voluntary≠emotional, realization gating, awareness
  progression, and the ambient day/night bias.
- Remainder (planned): emotion decay knob; more coupled genomes.

## H11 — Mind/perception depth

- Surface core mind/perception (fear, trust, arousal, realization) in the pane and,
  selectively, in the driving floor so prose reflects an interior, not just a body.
- Respect the observer rule: a subject may not know it is watched until revealed.

## H12 — Stage polish

- **Mobile/narrow width**: the stage renders on phones; verify at 390px; the pane
  must not overflow the chat iframe.
- **Accessibility**: real `<button>`s, focus order, `aria-live` on the status.
- **Config knobs** for every toggle that exists in code (status, guard, playstyle
  policy, detection strictness) so a player tunes without a rebuild.
- **Status/guard UX**: a compact, legible status; optional per-character status.

## H13 — Publish

- `chub_meta.yaml` final pass (position, tags, description, real icon).
- Verify the classifier against a live model in a real chat (closes `classifier`).
- First deploy via `.github/workflows/stage-deploy.yml`; write back the stage id.

## H14 — Multi-genome hardening

- Decide `applyRelated` semantics: a second species on one character — stack,
  supersede, or block? Cross-character consequences?
- Guard the save budget under stacked genomes.

## H15 — Optional voice (stage-native, post-publish)

- `generator.speak` to voice the status readout or a character line; `makeSound`
  foley on a shift. Strictly additive; never blocks the loop.

## H16 — Dose ruling

- Resolve `DOSE`: fold the draw/shift doses into constants (drop) or expose a
  potency control (implement). One constant today; one place to change.

## H17 — Time model: infer elapsed time from prose

Time advances **only** from (a) a chat message or (b) the pane's time controls — never
a wall clock. The tick-per-message config is the *fallback*, not the rule.

- Parse each message for an explicit or implied elapsed time ("later that night",
  "the next morning", "an hour passed", "three days later", "she slept") → advance by
  that much. An uncertain/undated message advances a **minimum of 5 minutes**.
- Deterministic and pure (`src/sim/timeparse.ts`), data-driven cue tables, with a
  corpus + eval like detection (H9) — the sim's pacing is only as good as this.
- A manual time control (existing +1h/+1d) always wins and is recorded.
- Same-message multiple characters advance together; a big inferred jump runs the
  per-day mind step (H10) for each day crossed.
- Gate: `tools/timeparse.ts` over a labeled corpus (explicit, relative, sleep,
  undated→5min, negation like "years ago").
- Bearing: `Cast.advance`, `Stage.beforePrompt`, `chub_meta` `ticksPerMessage`.

## Cross-cutting

- **Every component ships a headless `tools/*.ts`.** `npm run check` must stay green.
- **Determinism budget.** Any new provider call must be off the state path.
- **Tracking.** A deferral, a stub, or a sibling-inconsistency lands in
  `DEFERRED.md` in the same change.

## Gates

`npm run check` = `typecheck` + `validate` + `lint:authoring` + `data-check` +
`smoke` + `detect` + `detect-eval` + `coupling` + `pace` + `drive` + `visualize` +
`golden` + `persist`. All must be green
for any content or code change. `data-check` fails if a new genome lands < 5
attributes, never settles, or (if fantasy) is missing its coupling block.

## Open risks

- **Detection false positives** rise with depth (H9) — budget them.
- **Mixed-content / staging** is solved (plain http on :5173, Chub's own fallback);
  a future move to https or a tunnel must not regress it.
- **Provider latency** (images/audio) must never gate `beforePrompt`/`afterResponse`.
- **Save growth** under stacked genomes / long runs — the budget gate is the alarm.

