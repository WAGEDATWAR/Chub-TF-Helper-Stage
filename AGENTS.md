## Parent core - the engine (Chimera)

The helper imports the engine's `core/` + `data/` (one core, zero drift) via the
`@core/*` / `@gamedata/*` aliases, which resolve to the pinned **`chimera-core/`**
submodule. It is **never edited here**. Local differences are content overlays
(`data/*.extra.json`); a behaviour change is an upstream PR.

To take an engine release: `npm run engine:pull -- vX.Y.Z`, then commit the pin.
`npm run core:drift` fails if the submodule is modified. Local dev, `npm run check`,
and the build all read the pin, so they are identical everywhere.


