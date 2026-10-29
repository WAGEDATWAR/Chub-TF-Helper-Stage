# AGENTS.md — working notes

A Chub stage that simulates and drives a transformation per character, so the chat
LLM renders a real progression. See `PLAN.md` for the milestone plan,
`STAGING.md` for running it in a chat, and `DEFERRED.md` for deferred/stubbed
systems and content gaps.

## Golden rules

- **Spec first.** If code and plan disagree, stop and fix one, or record a decision
  in `DECISIONS.md`.
- **The sim is authoritative.** Detection proposes; the core simulates; the LLM only
  renders. A manual override wins.
- **Deterministic where it must be.** Sim, detection, save. Only the optional
  classifier is non-deterministic, and it never gates state.
- **Everything is data.** New genomes/fantasy reuse traits/parts/tracks; a new genome
  is real only once `npm run check` passes.
- **Ship a headless test (`tools/*.ts`) with every component.** `npm run check` runs
  them all; it must be green before any change is done.
- **Track incompleteness.** When you defer a system, stub a placeholder, or give one
  item special treatment a sibling lacks, record it in `DEFERRED.md`. Do not
  silently leave it.

## Commands

| Command | Does |
|---|---|
| `npm run check` | typecheck + validate + authoring + data-check + smoke + detect + coupling + drive + golden + persist |
| `npm run dev` | dev server with the offline test runner |
| `npm run dev:staging` | dev server for a live chat (Chat Settings → Staging URL) — plain **http** on 5173 |
| `npm run restart` | **kill running node, then start a fresh staging server on 5173** (see below) |
| `npm run build` | production bundle |
| `npm run golden -- --update` | rewrite the view golden |

## Running the dev server — ALWAYS restart clean

**Before starting a dev server, kill any running node process first.** A stale
server squatting port 5173 causes "port already in use" and, worse, a *half-dead*
server that still answers but serves stale/broken output.

Use:
```
npm run restart
```
It kills every running node, waits for port 5173 to free, then starts a fresh
staging server. Prefer it over re-running `npm run dev:staging` while one is up.
The server is started **detached** (logs to `stage-dev.log`), so the command
returns once the port is live instead of blocking until the server exits.

**Port 5173, over plain http.** Chub's stage renderer hardcodes the fallback
`http://localhost:5173/index.html` for a stage with no saved staging URL, and its
postMessage origin allowlist has `localhost:5173` but **not** 5175. Serving there
means the fallback resolves even if the typed URL is not persisted. 5173 is also
the parent game's Vite default — don't run both at once (we use `strictPort`).

**Do this going forward for any node-based project here**: kill the active node
instances, then start fresh — never stack servers.

## Ports (this workspace)

- **5173** — this helper stage. Use this in the Staging URL.
- 5174 — the parent game's *stage* port.

For a **phone**, use the LAN IP (e.g. `http://<pc-ip>:5173/`), not `localhost`, and
ensure the one-time firewall rule exists (`tools/fw-rule.ps1`, run as admin). For
the **same PC's browser**, `http://localhost:5173/` works with no setup.

## Conventions

- Do not commit unless asked. LF endings; 2-space TS/JSON.
- `src/sim/*` and `src/detect/*` are pure and headless; `src/stage/*` is the thin
  `@chub-ai` boundary; `src/view/*` is pure formatting.

## Parent core — the `vendor/` copy

The helper imports the parent game's `core/` + `data/` (one core, zero drift) via the
`@core/*` / `@gamedata/*` aliases, which resolve to the committed **`vendor/`** folder.
The parent lives in a sibling repo (`..\..\Game Projects\Chrysalis`) while you
co-develop; CI has no sibling. So after changing the parent, run
`npm run sync:vendor` (override the sibling with `$env:CHRYSALIS_HOME`) and commit the
refreshed `vendor/`. Local dev, `npm run check`, and the build all read `vendor/`, so
they are identical everywhere.

