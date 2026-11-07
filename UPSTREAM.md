# UPSTREAM — core deltas and pin

**Engine:** Chimera (`chimera-core`), consumed as a pinned git submodule.

| | |
|---|---|
| Pin | `v0.2.1` |
| Core edits in this repo | none — the submodule is never edited in place |

## What this project adds on top of the engine

This stage is a **shell** around the engine: detection in, prose out, the sim authoritative.

- `src/detect/`, `src/sim/` — text→genome detection, the pace control, the cast, the driver.
- `data/*.extra.json` — content overlays (genomes, attributes, parts, phases, feral,
  injectors, coupling, detect tables) merged over the engine's base data by `src/overlay.ts`.
  Same-id entries patch; everything else appends; a later upstream fix makes the local patch
  a no-op.

Pace is a `session.temporal` growth modifier (persisted, one per character); onset stays
proportional to it, so a fast pace still changes within hours (D-259 on the parent).

## Overlay merge (the rule)

Arrays of `{ id }` patch by id; other arrays replace; objects deep-merge. This is why the
overlay files are `*.extra.json` and not edited copies of engine data.

## When the engine needs to change

1. Fix it in Chimera, run its `npm run check:full`, tag a release.
2. `npm run engine:pull -- vX.Y.Z` and commit the pin; the `core:drift` gate proves it.

An overlay can absorb a *content* difference without an engine change; a *behaviour* change is
an upstream PR, never a local core edit.
