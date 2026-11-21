# Junie session 01: project guidelines (`.junie/guidelines.md`)

| Field | Value |
|---|---|
| Session id | `session-261121-214513-q44v` |
| Junie task name | "Document Project Purpose, Tests, and Hard Rules in Junie Guidelines" (`summary.json`) |
| Session created | 2026-11-21 21:45 (UTC+8) |
| Prompt timestamp (`history.jsonl`) | 2026-11-21 23:46:44 (UTC+8) |
| IDE | WebStorm 2026.3 (build WS-263.7307.202), Junie plugin 263.2144.30, Junie agent 4100.10.0 |
| Model | `claude-opus-5-5`, effort `medium` (`settings.json`); helper models listed in `summary.json`: `gpt-6-luna`, `gemini-3.1-flash-lite`, `claude-haiku-5-5` |
| Outcome | `.junie/guidelines.md` committed in `0d8ac73` |

## Prompt

Verbatim from `transcript.md` (identical to `history.jsonl`):

> Analyze this repo (etl/ Python uv, web/ PixiJS + Vite) and write .junie/guidelines.md: project purpose, how to run tests (cd web && pnpm test; npx tsc --noEmit; cd etl && uv run pytest), and hard rules: never commit data/, web/public/levels/, web/public/calib/, web/dist/, .vercel/, *.parquet/*.zst/*.jsonl; all project text in English; no Riot/VALORANT names, art or assets in UI; GRID data stays out of the repo.

## Junie's plan

This was a short documentation task, so Junie did not enter Plan mode. Its stated approach:

> I'm looking over the README, the ETL code, and the web package.json to get a quick sense of the repository.

Steps recorded in the transcript (tool calls, in order):

> ### Searched {.junie/**,.gitignore,web/package.json,etl/pyproject.toml,web/vite.config.*,web/tsconfig.json}
> ### Read README.md
> ### Ran MCP webstorm/list_directory_tree
> ### Read .gitignore
> ### Read web/package.json
> ### Read etl/pyproject.toml
> ### Ran ls .githooks etl etl/* web web/src web/tests docs 2>/dev/null | head -80; cat .githooks/* | head -60
> ### Ran ls etl/src/relive_etl web/src/* web/scripts; cat etl/README.md docs/deploy.md | head -80
> ### Edited .junie/guidelines.md +71
> ### Searched Math\.random

Junie found the existing pre-commit hook while exploring and summarized it:

> A pre-commit hook blocks commits containing GRID data or derived extracts.

## What Junie did

- **Created** `.junie/guidelines.md` (+71 lines). Excerpt of the diff (hard rules section):

```diff
+## Hard rules
+
+1. **Never commit** any of the following (they are git-ignored; keep it that way and never
+   force-add them):
+   - `data/`
+   - `web/public/levels/`
+   - `web/public/calib/`
+   - `web/dist/`
+   - `.vercel/`
+   - `*.parquet`, `*.zst`, `*.jsonl` (also `*.sqlite`, `*.duckdb`, `.env*`)
+   The pre-commit guard lives in `.githooks/`; enable it with `git config core.hooksPath .githooks`.
+   Do not weaken `.gitignore`, the hook, or `scripts/verify-dist.mjs`.
+2. **GRID data stays out of the repo.** GRID match data is licensed for the hackathon only. Never
+   copy raw feeds, extracts, generated levels, raw GRID ids (UUIDs), player-identifying dumps or
+   absolute local paths into tracked files, tests, fixtures, docs or commit messages. [...]
+3. **All project text in English** - code, identifiers, comments, docs, commit messages, UI copy
+   and test names.
+4. **No Riot / VALORANT names, art or assets in the UI.** Use the original map names (Kiln for
+   haven levels, Cistern for lotus levels), original geometry and original art only. [...]
```

- **Self-check:** Junie checked its own determinism claim against the code:

> ### Searched Math\.random
>
> No matches found

- **Tests/build:** none were run. From the task result:

> Nothing was run, since this is a documentation-only change.
> I checked one claim against the code: the simulation in `web/src/sim` doesn't use `Math.random`, so the deterministic-simulation rule matches the current code.

## Human review & corrections

- The transcript has no further user turns after the prompt, so the user made no in-session corrections.
- Junie pointed out on its own where it went beyond the prompt, so the user could review it:

> The "Conventions" section goes beyond what you asked for; I took it from the existing docs and code. Remove it if you only want the hard rules.

> I also listed `*.sqlite`, `*.duckdb` and `.env*`, because `.gitignore` already blocks them.

- The user kept the file and committed it. The committed version is 70 lines, while the session diff added 71 (`git show --stat 0d8ac73`). The session logs do not record what caused the one-line difference.
- Later sessions relied on these guidelines. The kiosk plan says "The guidelines require English, even though older entries are in Indonesian" (session 02). Junie wrote CHANGELOG entries in English "as the project rules require" (session 03) and "per the project guidelines" (session 06). The session 06 prompt starts with "Read .junie/guidelines.md first."

## Outcome

```
0d8ac73 2026-11-22 00:26:00 +0800 chore: add Junie guidelines and kiosk mode plan

 .junie/guidelines.md       |  70 +++++++++++++
 .junie/plans/kiosk-mode.md | 242 +++++++++++++++++++++++++++++++++++++
 2 files changed, 312 insertions(+)
```
