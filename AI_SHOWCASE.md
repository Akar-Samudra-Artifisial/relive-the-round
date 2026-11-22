# AI Showcase: building Relive the Round with Junie

This document covers the JetBrains part of our AI workflow: the tasks that **Junie** (JetBrains' coding
agent) did inside **WebStorm**. Every statement links to an exported Junie session log in
[`docs/ai-showcase/`](docs/ai-showcase/README.md) or to a commit you can inspect with `git show`.

## Summary

| | |
|---|---|
| IDE | WebStorm 2026.3 (build WS-263.7307.202) |
| Agent | Junie plugin 263.2144.30, Junie agent 4100.10.0 |
| Model | `claude-opus-5-5`, effort `medium` (from each session's `settings.json`) |
| Sessions documented | 5 (2026-11-21 21:45 to 2026-11-22 ~01:53, UTC+8) |
| Commits with Junie work | `0d8ac73`, `420dbdc`, `4081eb6`, `680d58d` |

Junie's role: it wrote the project's agent guidelines, planned features in Plan mode, implemented them
across the TypeScript client and the Python ETL, wrote the unit tests, ran tests/type checks/builds, and
applied review corrections. The game design, the data pipeline that came before these sessions and the
product decisions are the team's.

**Scope of the claim.** The prompts we gave Junie were drafted with help from another AI assistant
outside JetBrains, which we also used for planning and code review. That work is **not** claimed here.
This showcase and the bonus entry cover only the work done by Junie in WebStorm, as recorded in the
Junie session logs.

## The workflow we actually used

1. **Guidelines first.** Junie wrote `.junie/guidelines.md` (session 01). Later sessions follow it:
   no GRID data in the repo, English only, no Riot names or assets.
2. **Plan first.** For larger features Junie worked in Plan mode and wrote a plan file under
   `.junie/plans/` (`kiosk-mode.md`, `touch-twin-stick-controls.md`). Junie asked product questions
   where the brief was open; a human answered them and approved the plan.
3. **Implement.** Only after approval did Junie write code and tests. Edits outside the main code
   (`etl/pyproject.toml`, `web/package.json`) needed an explicit approval in the session.
4. **Verify.** Each code session ended with `pnpm test`, `npx tsc --noEmit` and/or `uv run pytest`;
   session 06 also ran `pnpm build:public` (`verify-dist: OK`) and a Playwright touch run. Junie also
   reported what it had *not* verified.
5. **Independent review pass.** A human reviewed the diff (with the help of the outside assistant
   mentioned above) and sent the findings back to Junie.
6. **Junie follow-up correction.** Junie fixed the findings, added tests and re-ran the checks.

## Tasks

### 01 · Agent guidelines — [session](docs/ai-showcase/01-junie-guidelines/session.md)

Junie needed project rules before touching code. Prompted to write `.junie/guidelines.md`, it
documented the purpose, the test commands and hard rules (licensed GRID data never committed, English
only, no Riot assets, deterministic sim). Docs only, so no tests ran; Junie self-checked that the sim
uses no `Math.random`. Commit `0d8ac73`.

### 02 · Booth kiosk mode — [session](docs/ai-showcase/02-kiosk-mode/session.md)

The game runs on a shared booth screen, so it needs to reset itself. In Plan mode Junie asked three
questions; the user chose idle timeouts of 15 s / 60 s, "hide download only" and both reset gestures.
Junie wrote the 4-step plan `.junie/plans/kiosk-mode.md` (`0d8ac73`), then implemented `kiosk.ts`, the
idle/attract flow and an operator reset panel, with 15 new kiosk tests: **127 web tests pass (11 files)**,
type check clean, **51 ETL tests pass**. Junie noted the feature was not checked in a browser. Code in
`420dbdc`.

### 03 · Original map ids + level schema v2 — [session](docs/ai-showcase/03-public-map-ids-schema-v2/session.md)

Public level files still carried source map names and fields the client never reads. Junie renamed
the public ids (haven → `kiln`, lotus → `cistern`), dropped weapon, armor, raw `x`/`y` and `killerUV`,
bumped the schema to v2 (the loader rejects v1) and added the `relive-migrate-levels` command, which
migrated the 12 + 12 local levels. **109 web tests (9 files) and 51 ETL tests pass**, type check clean.
The user approved the `etl/pyproject.toml` edit. Commit `420dbdc`.

### 04 · Link previews — [session](docs/ai-showcase/04-link-previews/session.md)

Shared links (including `/#c=` challenges) showed no preview. Junie added Open Graph / Twitter meta
tags and a 1200x630 `og-image.png` drawn by a dependency-free, deterministic script, plus
`social-meta.test.ts`, without changing the CSP. Its first test run failed because the script entry was
missing; after the user approved the `package.json` edit: **112 tests (10 files) pass**, type check
clean, build OK with 15 og/twitter tags in `dist`. Commit `420dbdc`.

### 06 · Twin-stick touch controls — [session](docs/ai-showcase/06-touch-controls/session.md)

The game was desktop-only. From a design brief
([`prompt.md`](docs/ai-showcase/06-touch-controls/prompt.md)) Junie planned
`.junie/plans/touch-twin-stick-controls.md` (`4081eb6`), then built `touch.ts` and `touchControls.ts`
with 16 tests: **149 tests (13 files) pass**, type check clean, `verify-dist: OK`. A Playwright run on an
emulated iPhone 12 Pro played a full round (18 shots, 12 hits, 3 kills, won by defuse); from the
screenshots Junie enlarged the landscape map from 265 px to 334 px. After the review pass below:
**151 tests pass**. Commit `680d58d` (8 files, +561/−14).

## Highlights

- **Tests grew with every session.** The web suite stood at 107 tests before the Junie sessions
  (`docs/devpost-submission.md` at commit `657d92c`). The logs then show 109 → 112 → 127 → 149 → 151
  web tests; the ETL suite went from 43 to 51 in the same period (51 in sessions 02 and 03).
- **Human-in-the-loop catch (session 06).** The review pass found two real bugs that the green test
  run did not show, and Junie fixed both:
  - the compact landscape CSS also applied to *short desktop windows* and hid the round goal
    (`#hudGoal`); Junie scoped it to touch mode (`#game[data-touch="1"]`);
  - firing cancels a defuse in the sim, so a thumb resting on the fire stick while holding DEFUSE
    could ruin the defuse; Junie added `touchFire()` to suppress touch fire during DEFUSE, plus 2 tests.
  It also removed the unused `hasAim` field. Junie stated that it did not re-run the browser check
  after these fixes.
- **Humans decide product questions.** Kiosk timeouts, what to hide and how to reset (02) came from
  the user's answers to Junie's questions, not from Junie's guesses.
- **Self-verification beyond unit tests.** Junie looked at its own Playwright screenshots and fixed a
  layout problem the plan did not mention (06).

## Up next (planned, not done)

The 3D renderer is planned as phased Junie tasks. Phase 0 is written as a prompt in
[`docs/ai-showcase/07-3d-phase-0/prompt.md`](docs/ai-showcase/07-3d-phase-0/prompt.md): load Three.js
as a lazy chunk only when the URL has `?3d=1`, with no change for normal players, inside the existing
CSP and `verify-dist` checks. That session has not run yet; it will be exported the same way once it does.
Update: phases 0-8 of the 3D renderer have shipped, and 3D is now the default renderer when WebGL2
is available (`?2d=1` forces 2D); see [`docs/3d-renderer.md`](docs/3d-renderer.md).

## How to verify

- Evidence index and method: [`docs/ai-showcase/README.md`](docs/ai-showcase/README.md). Each
  `session.md` holds the prompt, plan excerpts, commands with their results, human corrections and the
  commit, exported from the local Junie logs (`~/.junie/sessions/<id>/`) with verbatim excerpts;
  only local paths were redacted.
- Junie's own artifacts in the repo: `.junie/guidelines.md`, `.junie/plans/kiosk-mode.md`,
  `.junie/plans/touch-twin-stick-controls.md`.
- Commits:

  ```sh
  git show --stat 0d8ac73   # guidelines + kiosk plan
  git show --stat 420dbdc   # kiosk mode, level schema v2, link previews (37 files)
  git show --stat 4081eb6   # touch-controls plan + prompt
  git show --stat 680d58d   # touch controls + review fixes (8 files)
  ```

- Re-run the checks (commands from `.junie/guidelines.md`): `cd web && pnpm test && npx tsc --noEmit`,
  `cd etl && uv run pytest`.
