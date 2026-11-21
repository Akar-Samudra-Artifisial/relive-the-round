# Junie session 03: public map ids (haven→kiln, lotus→cistern) and level schema v2

| Field | Value |
|---|---|
| Session id | `session-261121-234803-tsmv` |
| Junie task name | "Anonymize Public Map Data and Trim Exports" (`summary.json`) |
| Session created | 2026-11-21 23:48 (UTC+8) |
| Prompt timestamp (`history.jsonl`) | 2026-11-21 23:53:50 (UTC+8) |
| IDE | WebStorm 2026.3 (build WS-263.7307.202), Junie plugin 263.2144.30, Junie agent 4100.10.0 |
| Model | `claude-opus-5-5`, effort `medium` (`settings.json`); helper models listed in `summary.json`: `gemini-3.1-flash-lite`, `gpt-6-luna`, `claude-haiku-5-5` |
| Outcome | Committed in `420dbdc` |

## Prompt

Verbatim:

> Public-facing data must not use real map ids or weapon names. Rename map ids haven->kiln and lotus->cistern across web/src (e.g. web/src/level/types.ts, web/src/maps/cistern.ts, web/src/game/featured.json) and in the ETL level export, and strip weapon names and any field the client does not use from exported level JSON. Keep existing level files loadable or regenerate them. Update tests.

## Junie's plan

Junie did not use Plan mode for this task. It worked out its approach step by step, and the transcript records it in the "Thinking" entries (verbatim, in order, some omitted):

> I'll start by finding every place the old map ids and weapon fields show up, in both the game client and the data pipeline.

> I found that the game never reads weapon names, armor, or the killer's kill position, so the export can drop those fields. Next, I'm checking whether the simulation's enemy rail code uses the raw position values or only the normalised coordinates.

> I found that the game, calibration metrics, and debug page only use normalised coordinates, so the raw positions and weapon and armor fields can be dropped from exported levels. [...]

> I've settled on the new level schema with kiln and cistern as the map names, the loader accepting the legacy names, and the density file renamed to the public map id. Next I'm adding a migration to convert the 24 existing levels into the new kiln and cistern folders [...]

> I've settled on a v2 level format with public map names and only the fields the game uses, plus a migration that converts the existing 24 level files, and the web-side types now match that shape.

Junie changed its mind on one point: at first the loader was going to accept the legacy names, but the final design rejects them:

> I confirmed that `uv` is still in use and that the loader now accepts only the new format, keeping just the fields the game needs.

Before editing, it checked which fields the client actually uses. Excerpt of the command:

> ### Ran cd web/src && for f in weapon armor startClockS plantedAtStart killerUV victimUV diedT plantT hp; do echo "== $f: $(grep -rlw --incl [...]

## What Junie did

Files edited (from `### Edited` / `### Ran` entries in the transcript):

- Web: `web/src/level/types.ts` (+5 -8), `web/src/level/loader.ts` (+9 -11), `web/src/maps/index.ts`, `web/src/game/levels.ts`, `web/src/level/fixtures/synthetic-1v3.ts`, `web/src/debug/debugPage.ts`, `web/src/game/featured.json` (`"map": "haven"` → `"map": "kiln"` via `sed`), `web/tests/sim.test.ts` (+19 -2), other tests updated by script.
- ETL: `etl/src/relive_etl/config.py` (+4, `PUBLIC_MAP_IDS`), `etl/src/relive_etl/calib.py`, `etl/src/relive_etl/levels.py` (+30 -77, +99 -20, +7 -4), `etl/pyproject.toml` (+1 entry point), `etl/tests/test_levels.py`.
- Docs: `docs/level.schema.json` (title → "schema v2"), `docs/level-schema.md`, `docs/deploy.md`, `etl/README.md`, `CHANGELOG.md`.

The new entry point (verbatim diff):

```diff
 relive-export-levels = "relive_etl.levels:main"
+relive-migrate-levels = "relive_etl.levels:migrate_main"
 relive-calib-anchors = "relive_etl.calib:main"
```

Migration of the existing local levels, followed by a scan for removed fields (paths redacted; level file names omitted):

```text
### Ran cd <repo>/etl && uv run relive-migrate-levels && [...] assert 'weapon' not in t and 'haven' not in t and 'lotus' not in t and 'killerUV' not in t [...]
[migrate] 12 levels -> <repo>/data/levels/kiln
[migrate] 12 levels -> <repo>/data/levels/cistern
```

The migrated level data stays in the git-ignored `data/` folder, so none of it was committed.

Web tests and type check:

```text
### Ran cd <repo>/web && npx tsc --noEmit && pnpm test 2>&1 | tail -8
 ✓ tests/game.test.ts (38 tests) 452ms
 Test Files  9 passed (9)
      Tests  109 passed (109)
```

Leak check on the public build input. Remaining hits were only in docs, which Junie then updated:

```text
### Ran cd <repo> && node web/scripts/prepare-public.mjs && grep -l -E "weapon|haven|lotus" web/public/levels/* ; grep -rn -E "haven|lotus|weapon|killerUV|armor" web/src web/scripts ; [...]
prepare-public: copied 6 level(s) to public/levels/
docs/deploy.md:10:- `web/src/game/featured.json` — the playlist (max 6): 3 haven levels (Kiln) + 3 lotus levels (Cistern).
[...]
```

Final run:

```text
### Ran cd <repo> && (cd etl && uv run pytest -q 2>&1 | tail -2) && (cd web && npx tsc --noEmit && pnpm test 2>&1 | tail -4) && git status --short
51 passed in 0.16s
      Tests  109 passed (109)
```

From the task result:

> ETL tests: 51 passed. New tests cover the schema rejecting weapons, raw positions, the killer's kill position and old map names, plus the converter's success and failure cases.
> Web: the type check is clean and 109 tests passed [...] New loader tests confirm version 1 files and old map names are refused and leftover weapon/raw-position fields are dropped.

## Human review & corrections

- **Edit approval.** Junie needed approval to edit `etl/pyproject.toml` (an `ApproveEditFileData` request in `events.jsonl`). The user answered "Yes" (`## User response` in the transcript).
- **Trade-offs Junie surfaced for review** (task result, "Notes"):

> The loader no longer accepts version 1 level files, so that the old names stay out of the browser code. Any other machine with old exports needs to run `cd etl && uv run relive-migrate-levels` before building.
> The calibration anchor files and their docs still use the internal names. They are dev-only and never shipped.
> I wrote the new `CHANGELOG.md` entry in English, as the project rules require, although the existing entries are in Indonesian.

- The transcript has no other user corrections. The user committed the result together with sessions 02 and 04.

## Outcome

Committed in `420dbdc`, "feat: add kiosk mode, level schema v2 and link previews". The schema v2 lines from `git show --stat 420dbdc`:

```
 docs/deploy.md                          |   8 +-
 docs/level-schema.md                    |  32 +++--
 docs/level.schema.json                  |  18 +--
 etl/README.md                           |  12 +-
 etl/pyproject.toml                      |   1 +
 etl/src/relive_etl/calib.py             |  11 +-
 etl/src/relive_etl/config.py            |   4 +
 etl/src/relive_etl/levels.py            | 229 ++++++++++++++++++--------------
 etl/tests/test_levels.py                | 111 +++++++++++-----
 web/scripts/prepare-public.mjs          |   2 +-
 web/src/debug/debugPage.ts              |   8 +-
 web/src/game/featured.json              |  12 +-
 web/src/game/levels.ts                  |   8 +-
 web/src/level/fixtures/synthetic-1v3.ts |  21 +--
 web/src/level/loader.ts                 |  20 ++-
 web/src/level/types.ts                  |  13 +-
 web/src/maps/cistern.ts                 |   3 +-
 web/src/maps/index.ts                   |   6 +-
 web/src/maps/kiln.ts                    |   3 +-
 web/src/maps/types.ts                   |   2 -
 web/src/sim/world.ts                    |   4 +-
 web/tests/balance.test.ts               |   4 +-
 web/tests/calib.test.ts                 |  18 +--
 web/tests/featured.test.ts              |   8 +-
 web/tests/game.test.ts                  |  12 +-
 web/tests/sim.test.ts                   |  21 ++-
 37 files changed, 1098 insertions(+), 253 deletions(-)
```

The last line covers the whole commit, including sessions 02 and 04.
