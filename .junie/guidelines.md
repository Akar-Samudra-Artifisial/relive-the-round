# Relive the Round - Project Guidelines

## Purpose

Web mini game for the Sky's The Limit 2026 (Cloud9 x JetBrains) hackathon. Each level is a real
1vN clutch from pro esports matches (2025-2026), rebuilt on an original 2D map. The player takes
over the clutcher while 2-3 enemies move on rails derived from GRID data plus a bot state machine.
After a round the player gets a side-by-side replay (their run vs. the real round) and a shareable
score card / challenge link. Live: https://relive-the-round.vercel.app

## Layout

- `etl/` - Python 3.12+ pipeline managed with `uv` (package `relive_etl`). Reads GRID feeds from
  `STL_DATA_DIR` (outside the repo), finds clutches, exports levels and calibration data into the
  git-ignored `data/` folder. Entry points: `relive-spike`, `relive-export-levels`,
  `relive-calib-anchors`. Tests in `etl/tests/`.
- `web/` - TypeScript game client (PixiJS 8 + Vite, pnpm, vitest).
  - `src/sim/` deterministic simulation (rng, nav, rails, world), `src/game/` pages, scoring,
    replay, share/leaderboard, `src/maps/` original maps (`kiln.ts`, `cistern.ts`),
    `src/level/` level loader/types + synthetic fixtures, `src/render/`, `src/debug/` (dev only).
  - `scripts/prepare-public.mjs` / `scripts/verify-dist.mjs` - public build guard rails.
  - Tests in `web/tests/*.test.ts`.
- `docs/` - notes and reports (aggregates only). Level contract: `docs/level-schema.md` and
  `docs/level.schema.json`. Deploy process: `docs/deploy.md`.

## Running tests and checks

Run these before finishing any change that touches code:

```sh
cd web && pnpm test          # vitest run
cd web && npx tsc --noEmit   # type check (same as `pnpm lint`)
cd etl && uv run pytest      # ETL tests
```

Other useful commands: `pnpm -C web dev` (port 5177), `pnpm -C web build`. The public build
(`pnpm -C web build:public`) and Vercel deploys need the local `data/` folder; see `docs/deploy.md`.
Do not deploy unless explicitly asked.

## Hard rules

1. **Never commit** any of the following (they are git-ignored; keep it that way and never
   force-add them):
   - `data/`
   - `web/public/levels/`
   - `web/public/calib/`
   - `web/dist/`
   - `.vercel/`
   - `*.parquet`, `*.zst`, `*.jsonl` (also `*.sqlite`, `*.duckdb`, `.env*`)
   The pre-commit guard lives in `.githooks/`; enable it with `git config core.hooksPath .githooks`.
   Do not weaken `.gitignore`, the hook, or `scripts/verify-dist.mjs`.
2. **GRID data stays out of the repo.** GRID match data is licensed for the hackathon only. Never
   copy raw feeds, extracts, generated levels, raw GRID ids (UUIDs), player-identifying dumps or
   absolute local paths into tracked files, tests, fixtures, docs or commit messages. Tests must
   use synthetic fixtures (e.g. `web/src/level/fixtures/`). Docs may contain aggregates only.
3. **All project text in English** - code, identifiers, comments, docs, commit messages, UI copy
   and test names.
4. **No Riot / VALORANT names, art or assets in the UI.** Use the original map names (Kiln for
   haven levels, Cistern for lotus levels), original geometry and original art only. Do not add
   Riot map art, agent names/portraits, logos, icons, sounds or fonts. Internal data keys from the
   ETL (e.g. `haven`, `lotus`) must not be shown to players.

## Conventions

- Follow the existing style of each module; keep the simulation deterministic (seeded RNG in
  `web/src/sim/rng.ts`, no `Math.random()` in sim code).
- Level files must validate against `docs/level.schema.json`; update the schema, `docs/level-schema.md`
  and both sides (ETL + web loader) together when changing the contract.
- Keep the CSP in `web/vercel.json` and `web/vite.config.mjs` in sync (no `unsafe-eval`).
- Record notable changes in `CHANGELOG.md`.
