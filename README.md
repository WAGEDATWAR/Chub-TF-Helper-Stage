# Chrysalis Transformation Helper

A Chub **stage** that simulates a transformation per character and drives the chat
LLM, so the prose follows a real, phased progression instead of drifting.

The stage is the authority on *what is physically happening* (species, phase,
exposure, mood, realization); the LLM renders it. Detection reads the cards and the
chat and proposes who changes into what — a manual override always wins.

## Docs

- `PLAN.md` — the milestone plan and doctrine.
- `DEFERRED.md` — the live ledger of what is unfinished (deferred / stubbed / gaps).
- `DECISIONS.md` — rulings and any parent bugs found.
- `STAGING.md` — run it locally against a real chat before publishing.
- `AGENTS.md` — working notes, ports, the `vendor/` core.

## Develop

```
npm install
npm run restart     # staging server on http://localhost:5173/
npm run check       # typecheck + all headless gates (must be green)
npm run build       # production bundle -> dist/
```

`src/sim/*` and `src/detect/*` are pure and headless; `src/stage/*` is the thin
`@chub-ai` boundary; `src/view/*` is pure formatting. The parent *Chrysalis* core is
committed under `vendor/` (refresh with `npm run sync:vendor`).

## Publish

Pushing to `main` runs `.github/workflows/stage-deploy.yml`, which creates the stage
on first run, builds `dist/`, and uploads it. It needs one repo secret:

1. Create a **write** token at <https://chub.ai/my_stages?active=tokens>.
2. Add it as a repo secret named `CHUB_AUTH_TOKEN`
   (Settings → Secrets and variables → Actions).
3. Push a commit (a real change — an empty commit will not match the `paths` filter),
   or run the workflow from the **Actions** tab.
