# Junie session 02: booth kiosk mode (`?kiosk=1`)

| Field | Value |
|---|---|
| Session id | `session-261121-234708-cg4o` |
| Junie task name | "Plan and Implement Event Booth Kiosk Mode" (`summary.json`) |
| Session created | 2026-11-21 23:47 (UTC+8) |
| Prompt timestamps (`history.jsonl`) | 2026-11-21 23:47:54 (plan request), 2026-11-22 00:15:20 (implement) |
| IDE | WebStorm 2026.3 (build WS-263.7307.202), Junie plugin 263.2144.30, Junie agent 4100.10.0 |
| Model | `claude-opus-5-5`, effort `medium` (`settings.json`); helper models listed in `summary.json`: `gemini-3.1-flash-lite`, `gpt-6-luna`, `claude-haiku-5-5` |
| Plan file | `.junie/plans/kiosk-mode.md` (committed in `0d8ac73`) |
| Outcome | Code committed in `420dbdc` |

## Prompt

Turn 1, verbatim:

> Add a kiosk mode for running the game at an event booth, enabled via URL flag ?kiosk=1: after a run finishes and initials are entered, auto-return to the level select after N seconds of inactivity; show an attract screen when idle; hide external links; add a hidden way for the operator to reset the local leaderboard. Plan first, then implement with tests. Do not change the gameplay rules.

Turn 2, verbatim, sent after the user reviewed the plan:

> Implement the approved plan in .junie/plans/kiosk-mode.md, with tests

## Junie's plan

Junie switched to Plan mode (`### Entering **Plan** Mode`), read `main.ts`, `gamePage.ts`, `timing.ts`, `index.html`, `leaderboard.ts` and `input.ts`, then noted:

> I found that the game already has a level-select attract screen and a score screen that returns after 15 seconds, so the idle screen I need to add will be a separate overlay.

> Kiosk mode will be a pure `web/src/game/kiosk.ts` module (config + idle timer + reset-gesture detector), wired into `gamePage.ts` only when `?kiosk=1`. [...] A few product choices:

Before writing the plan it asked the user three questions (see "Human review & corrections" below). Excerpts from the plan:

> ### Overview & Goals
> Add a booth-friendly **kiosk mode**, turned on with `?kiosk=1`. [...] **Gameplay rules are not touched**: no changes to the sim, scoring, round timing or the level contract.

> ### Key Decisions
> - **Pure `kiosk.ts` module plus thin wiring in `gamePage.ts`.** This matches the `challengeLanding.ts` pattern, keeps the logic testable without a DOM, and lets every kiosk branch sit behind `if (kiosk)`, so normal mode is byte-for-byte the same behaviour.
> - **Time is injected (`nowMs`)** into the idle and tap helpers, so tests don't need fake timers.
> [...]
> - **The reset uses an in-page confirm, not `window.confirm`.** Kiosk browsers often suppress native dialogs.

> ### Risks
> - **3-minute session rule**: unattended worst case on the score screen stays at 15 s, so `sessionBudgetS` is unchanged. [...]
> - **Stray input**: `pointermove` from a jittery mouse could keep the booth from ever going idle. Mitigation: ignore moves under 4 px.

> # Delivery Steps
> ### Step 1: Add pure kiosk logic and leaderboard reset with tests
> ### Step 2: Wire kiosk flag, score-screen inactivity return and external-link hiding
> ### Step 3: Add idle attract screen
> ### Step 4: Add hidden operator leaderboard reset and changelog

The plan's test list for `web/tests/kiosk.test.ts` covers `parseKiosk` (flag on/off, idle clamped to 10..600), `kioskScoreDeadline` (activity extends the deadline but never past shown + 60 s), `isResetChord`, `CornerTaps` (5 taps within 3 s, a tap outside the corner or a gap resets the count), `attractSlide` and `clearEntries`.

## What Junie did

Files edited, from the `### Edited` entries in the transcript:

| File | Change |
|---|---|
| `web/src/game/kiosk.ts` (new) | +83, then +2 -8 |
| `web/src/game/input.ts` | +2 -1 (`Screen` gains `"idle"`) |
| `web/src/game/leaderboard.ts` | +11 (`clearEntries`) |
| `web/tests/kiosk.test.ts` (new) | +158 |
| `web/src/game/gamePage.ts` | +39 -3, +81 -4, +3 -1, +62 -3, +9 -1 |
| `web/index.html` | +17, +12 (`#idle` overlay, `#kioskReset` panel) |
| `CHANGELOG.md` | +2, then -1 (removed a stray blank line) |
| `.junie/plans/kiosk-mode.md` | step markers ticked as each step finished (`* Step 4` → `✓ Step 4`) |

Commands and results (verbatim excerpts):

After Step 1:

```text
### Ran pnpm test 2>&1 | tail -15; npx tsc --noEmit && echo TSC_OK
 ✓ tests/game.test.ts (38 tests) 488ms
 Test Files  11 passed (11)
      Tests  127 passed (127)
TSC_OK
```

Type check after the Step 2 and Step 3 wiring:

```text
### Ran npx tsc --noEmit && echo TSC_OK
TSC_OK
```

Final checks:

```text
### Ran npx tsc --noEmit && echo TSC_OK; pnpm test 2>&1 | tail -5
TSC_OK
 Test Files  11 passed (11)
      Tests  127 passed (127)

### Ran npx vitest run tests/kiosk.test.ts 2>&1 | tail -5; cd ../etl && uv run pytest -q 2>&1 | tail -2
 Test Files  1 passed (1)
      Tests  15 passed (15)
...................................................                      [100%]
51 passed in 0.16s
```

One command failed: Junie's first shell call in turn 2 used the wrong working directory (`cd: web: No such file or directory`). It re-ran the command from the right directory.

Junie also made the reset confirm block input to the screen behind it, which the plan did not spell out:

> I've blocked clicks behind the reset confirm so they can't start a round, added the kiosk changelog entry, and confirmed that tsc and all 127 tests pass.

## Human review & corrections

1. **Product decisions made by the user.** Junie asked three questions in Plan mode. The answers are recorded in `events.jsonl` (`UserAsyncResponseEvent`):

   | Junie's question | User's answer |
   |---|---|
   | Which idle timeouts should kiosk mode use (overridable via `?idle=` seconds)? | 15 s / 60 s |
   | In kiosk mode, what should happen to sharing surfaces? | Hide download only |
   | How should the operator reset the local leaderboard? | Both |

   The plan reflects these answers: score screen idle 15 s with a 60 s cap, "The QR code stays", and the chord **or** the corner taps as the reset trigger.
2. **Plan approval gate.** Junie did not write any code until the user sent "Implement the approved plan in .junie/plans/kiosk-mode.md, with tests". The plan was committed as a reviewed artifact in `0d8ac73`.
3. **Things Junie flagged as not verified.** From the task result:

> I haven't checked it in a browser yet.
> [...]
> Try it in a browser with `pnpm -C web dev`, then open `?kiosk=1&idle=10`, before using it at the booth.

## Outcome

- Plan: `0d8ac73` (`.junie/plans/kiosk-mode.md`, +242).
- Code: `420dbdc`, "feat: add kiosk mode, level schema v2 and link previews". This one commit also contains the work from sessions 03 and 04. The kiosk-related lines from `git show --stat 420dbdc`:

```
 web/index.html                          |  47 +++++++
 web/src/game/gamePage.ts                | 196 ++++++++++++++++++++++++++-
 web/src/game/input.ts                   |   3 +-
 web/src/game/kiosk.ts                   |  76 +++++++++++
 web/src/game/leaderboard.ts             |  11 ++
 web/tests/kiosk.test.ts                 | 157 ++++++++++++++++++++++
 37 files changed, 1098 insertions(+), 253 deletions(-)
```

(`web/index.html` and `CHANGELOG.md` in that commit also contain session 04 changes.)
