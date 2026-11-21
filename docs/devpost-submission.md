# Devpost submission: copy-ready draft

One section per Devpost form field. Numbers come from `README.md`, `CHANGELOG.md`,
`docs/spike-report.md`, `docs/level-export-*.md`, `docs/calibration-*.md` and `docs/deploy.md`.
Replace every `TODO(user)` before submitting. Rules: https://cloud9.devpost.com/rules (official deadline
12 Jan 2027, 11:00 PT; internal target 5 Jan 2027).

## Project name

Relive the Round

## Tagline

Could you have clutched it? Step into a real pro 1vN clutch on an original map, then watch your round
side by side with the pro's.

## Category

Category 3: Event Mini Game. The game is a short kiosk round (under a minute per attempt) with an
attract screen, a 3-letter local leaderboard, a printable score card and a QR challenge link, built
for a Cloud9 booth.

## Team

TODO(user): team name and members (Devpost usernames).

## Inspiration

Esports fans watch clutches every week: one player left alive against two, three or four opponents,
with seconds on the clock. They watch from the outside. We wanted a booth game that puts a fan in the
clutcher's position for exactly that moment, using what really happened in pro play, and then shows
them how the pro solved it. Short, readable and easy to share is what makes it work in a queue at an event.

## What it does

- **Six real clutch rounds.** Each level is a 1vN clutch from pro VALORANT esports data (2025-2026),
  rebuilt on an original 2D map: 3 levels on **Kiln** and 3 on **Cistern**. You take over the clutcher
  while the 2-3 enemies move on rails derived from the recorded positions, driven by a bot state machine
  (rail → hunt → retake/defuse).
- **Kiosk loop.** Pick a round or press Enter for a random one, play it (WASD to move, mouse to aim,
  click to shoot, hold E on the spike to defuse), get a score, enter 3 initials for the local leaderboard.
- **You vs the pro replay.** After the round, a two-panel replay plays your movement and the pro's
  recorded movement side by side (play/pause, 1×/2×/4×, seek).
- **Score card + QR.** A downloadable PNG score card compares you with the pro and carries a QR code.
- **Challenge link.** The QR opens `/#c=…` on a phone: the same round, with the challenger's score to beat.

## How we built it

- **ETL (Python, uv):** reads GRID series feeds and finds clutch moments: the first kill that leaves a
  team 1 alive against 2 or more opponents with ≤ 45 s left. Across 757 series and 15,609 rounds on two
  maps it found 10,776 clutches. 710 pass our position-density rule and 161 of those were won by the
  clutcher (`docs/spike-report.md`).
- **Level export:** `relive-export-levels` writes level JSON (schema v1, `docs/level-schema.md`), checked
  against a JSON Schema plus semantic checks. 12 valid levels per map with 0 failures; 6 make the event
  playlist (`web/src/game/featured.json`). Level ids are short SHA-256 hashes. The files hold no player,
  team or series names or ids.
- **Original maps from aggregates:** Kiln and Cistern use our own geometry. A warp places the recorded
  tracks on them, calibrated with aggregate anchors: site plant medians, spawns, callouts and density
  hotspots (for haven → Kiln: 8,610 rounds and 1,736,208 position samples, `docs/calibration-haven.md`).
- **Game client (TypeScript, Vite, PixiJS 8):** a deterministic fixed-tick simulation with navmesh
  pathfinding, bot state machine, line-of-sight checks and spike timer/defuse rules; a replay model;
  a canvas score card; QR codes via `qrcode-generator`.
- **Ship it safely:** `pnpm -C web build:public` copies only the 6 featured levels and then checks
  `dist/`: no calibration data, no raw GRID UUIDs, no e-mail addresses, no local paths, no debug page.
  Vercel serves a prebuilt output (never built from Git), with a strict CSP (`script-src 'self'`,
  no `unsafe-eval`, `frame-ancestors 'none'`).
- **Tooling:** WebStorm 2026.3 with Junie (JetBrains' coding agent) planned, implemented and tested
  kiosk mode, level schema v2, link previews and touch controls (see the Tooling section and
  `AI_SHOWCASE.md`).

## Challenges we ran into

- **Positions refresh per event, not per tick.** Most clutches have too few clutcher positions to
  replay: 9,328 failed the ≥ 6 distinct positions rule. We dropped the requirement for dense enemy tracks
  and drive enemies with bots, so only the clutcher track has to be dense. That took us from 132 strict
  passes to 710.
- **Making a real round playable.** The pro's enemies have to react to a different player. Rails
  carry them along their recorded routes until contact, then a hunt/retake state machine takes over;
  a defuse attempt is audible and pulls nearby enemies.
- **Original maps without losing the data.** Recorded coordinates belong to a different map. We
  warp them onto our own layouts using aggregate anchors, so sites, spawns and routes still line up.
- **Licensed data on a public site.** The data cannot be committed. Levels exist only on the build
  machine, a guard hook blocks commits, and the public build verifies its own output before upload.

## Accomplishments that we're proud of

- 6 playable rounds, each one a real clutch that a pro won, on two original maps.
- The two-panel "you vs pro" replay: the moment a player sees where their route differs from the pro's.
- An event loop that works end to end: attract → play → score → replay → card → phone challenge.
- 202 automated tests (151 web, 51 ETL) and a public build that fails if any data it should not
  ship ends up in `dist/`.

## What we learned

- Measure the data before designing the game: the spike report decided the level rule and the
  number of maps (GO for 2 maps: 710 ≥ 30 passed, 161 ≥ 12 won).
- A bot that is "good enough" beats a replay that cannot react: players remember the enemy reacting
  to them.
- Treat compliance as a build step: checks in the build catch leaks a code review misses.

## What's next

- More maps and a larger rotating playlist (each map already has 12 valid levels exported).
- A booth leaderboard that syncs between kiosks.
- Difficulty tiers based on clutch size (1v2 to 1v5).
- Gamepad support for event hardware.

## Built with

python, uv, pytest, typescript, vite, pixi.js, vitest, ajv, qrcode-generator, json-schema, vercel,
grid, webstorm, junie

## Try it out

- Demo: https://relive-the-round.vercel.app
- Repository: https://github.com/Akar-Samudra-Artifisial/relive-the-round
- Video: TODO(user): public YouTube URL (< 3 min)

## Testing instructions

Judges, no install needed:

1. Open https://relive-the-round.vercel.app on a desktop browser (keyboard + mouse).
2. Press Enter for a random round, or pick one of the 6 rounds.
3. Controls: WASD move · mouse aim · click shoot · hold E on the spike to defuse · Esc quit.
4. After the round: watch the replay (Space play/pause, 1/2/4 speed, ← → seek), type 3 initials
   and press Enter to save, then download the score card.
5. Scan the QR on the card with a phone (or open the `/#c=…` link) to get the same round as a
   challenge.

From source (code only; the licensed data is not in the repo):

```sh
pnpm -C web install && pnpm -C web test     # 151 tests
pnpm -C web dev                              # http://localhost:5177; without the data the
                                             # rounds use a synthetic fixture level
cd etl && uv run pytest                      # 51 tests
```

Rebuilding the real levels needs the hackathon GRID data: set `STL_DATA_DIR` and see `README.md` (ETL)
and `docs/deploy.md`.

## Methodology

1. **Feasibility spike first** (`docs/spike-report.md`): we defined a clutch, measured how dense
   positions are, and set GO/Plan-B bars before building the game. Result: GO for 2 maps.
2. **Contract between pipeline and game** (`docs/level-schema.md`, `docs/level.schema.json`): one
   versioned schema, validated on both sides (ETL export and web loader test).
3. **Calibration from aggregates** (`docs/calibration-*.md`): anchors and density only. No raw
   positions or map art are used for the maps.
4. **Deterministic simulation + tests:** fixed tick, seeded RNG, an autopilot that plays every
   featured level in tests, plus balance tests.
5. **Release gate** (`docs/deploy.md`): prepare → build with `VITE_REQUIRE_LEVELS=1` → verify `dist/`
   → prebuilt deploy, preview before production.
6. **Changelog** kept in `CHANGELOG.md` (Keep a Changelog).

## Tooling

- **JetBrains IDE:** WebStorm 2026.3 (build WS-263.7307.202) for the TypeScript client and the Python ETL.
- **Junie** (plugin 263.2144.30, agent 4100.10.0, model `claude-opus-5-5`) did 5 documented sessions:
  agent guidelines (`.junie/guidelines.md`), booth kiosk mode, original map ids + level schema v2,
  link previews, and twin-stick touch controls.
- Workflow: guidelines → plan in Plan mode (`.junie/plans/*.md`) → human answers/approval → implement
  with tests → `pnpm test`, `tsc`, `pytest`, `build:public` → human review → Junie follow-up fixes.
  The web suite went from 107 to 151 tests across these sessions.
- Other AI assistants: prompts were drafted, and reviews done, with help from an AI assistant outside
  JetBrains. Only Junie's work is claimed for the JetBrains/Junie bonus.
- Evidence: [`AI_SHOWCASE.md`](https://github.com/Akar-Samudra-Artifisial/relive-the-round/blob/main/AI_SHOWCASE.md)
  and the exported session logs in `docs/ai-showcase/`; commits `0d8ac73`, `420dbdc`, `4081eb6`, `680d58d`.
- Runtime/tooling facts: uv (Python), pnpm + Vite + Vitest (web), TypeScript, Vercel CLI (prebuilt deploy).

## Data & IP compliance

- **Data:** GRID data is licensed for the hackathon only. No raw or derived data is committed
  (`data/`, `web/public/levels/` are git-ignored; a pre-commit guard hook is in `.githooks`). Public
  reports in `docs/` contain aggregates only.
- **Public site:** ships 6 level files with hashed ids and no player/team/series names or ids;
  `verify-dist` rejects UUIDs, e-mails, local paths, calibration data and raw data formats.
  TODO(user): confirm with the organizers that hosting 6 derived level files publicly is allowed.
- **Original presentation:** game name, maps (Kiln, Cistern), map geometry, favicon and UI are our own;
  no Riot map art, geometry, agents, logos or audio. The game has no audio assets.
- **Video:** no third-party trademarks or logos, no copyrighted music (see `docs/demo-video-script.md`).

## Submission checklist

| Required item | Status |
|---|---|
| Category selected (Category 3: Event Mini Game) | Draft ready |
| Project name, tagline, description | Draft ready (this file) |
| Methodology write-up | Draft ready |
| Tooling explanation (≥ 1 JetBrains tool / Junie) | Done: WebStorm + Junie (Tooling section, `AI_SHOWCASE.md`) |
| Testing instructions | Draft ready |
| Demo link | Done: https://relive-the-round.vercel.app |
| Public repo with OSS license | Done: https://github.com/Akar-Samudra-Artifisial/relive-the-round (public, GitHub detects MIT; history scanned, no data files) |
| Video < 3 min, public on YouTube, shows the project running | **TODO(user)**: record from `docs/demo-video-script.md`, upload, paste URL |
| Team members added on Devpost | **TODO(user)** |
| `AI_SHOWCASE.md` (optional bonus, JetBrains/Junie/Air entries only) | Done: `AI_SHOWCASE.md` + `docs/ai-showcase/` |
| Organizer OK for hosting derived level files | **TODO(user)** |

### IP risk check (grep of `web/src` and `web/index.html`, 2026-11-21)

- Pro player names / pro team names in UI code: **none found**.
- "VALORANT", "Riot", map names "Haven"/"Lotus" (capitalised), agent or weapon names in UI strings:
  **none found**.
- Low risk, review manually:
  - Internal source-map ids `"haven"`/`"lotus"` are used in code (`web/src/level/types.ts:3`,
    `web/src/maps/kiln.ts:12`, `web/src/maps/cistern.ts:13`, `web/src/game/featured.json:2-7`) and in the
    `map` field of the served level JSON. The UI shows Kiln/Cistern instead.
  - Served level JSON carries lowercase weapon names (`Actor.weapon`, `docs/level-schema.md`); they are not
    shown in the UI.
  - The UI says "spike" and "Pro #1" (`web/src/game/levels.ts:57-61`, `web/src/game/gamePage.ts:311`).
    Both are generic terms; no player is named.
