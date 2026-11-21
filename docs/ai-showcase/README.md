# AI-powered workflow: Junie session evidence

Relive the Round was partly built with **Junie** (JetBrains' coding agent) in WebStorm 2026.3 (build WS-263.7307.202, Junie plugin 263.2144.30, Junie agent 4100.10.0), using the model `claude-opus-5-5` at effort `medium`. Each folder below documents one real Junie session: the prompt, Junie's plan, what it changed and ran, where a human reviewed or corrected it, and the resulting commit.

| Folder | Task | Date (UTC+8) | Commit |
|---|---|---|---|
| [01-junie-guidelines](01-junie-guidelines/session.md) | Write `.junie/guidelines.md`: purpose, test commands, hard rules (no GRID data, English only, no Riot assets) | 2026-11-21 | `0d8ac73` |
| [02-kiosk-mode](02-kiosk-mode/session.md) | Booth kiosk mode `?kiosk=1`: plan in Plan mode (3 product questions answered by the user), then implement with 15 tests | 2026-11-21 → 22 | `0d8ac73` (plan), `420dbdc` (code) |
| [03-public-map-ids-schema-v2](03-public-map-ids-schema-v2/session.md) | Public map ids haven→kiln, lotus→cistern; strip weapon/unused fields; level schema v2 + migration command | 2026-11-21 → 22 | `420dbdc` |
| [04-link-previews](04-link-previews/session.md) | Open Graph / Twitter meta tags + an original, reproducible 1200x630 preview image, CSP unchanged | 2026-11-22 | `420dbdc` |
| [06-touch-controls](06-touch-controls/session.md) | Twin-stick touch controls: plan, implement, Playwright touch run on an emulated iPhone, then a human code-review follow-up | 2026-11-22 | `4081eb6` (plan + prompt), `680d58d` (code) |

There is no folder 05. The kiosk plan and its implementation happened in the same Junie session, so both are covered in 02. `07-3d-phase-0/` holds only a prompt for a later session and is not part of this export.

## Workflow pattern seen across sessions

- **Guidelines first.** Session 01 wrote the project rules, and later sessions cite them (English CHANGELOG entries, no GRID data, no Riot names).
- **Plan, approve, implement.** For larger features (02, 06), Junie wrote a plan in Plan mode, the user approved it, and only then did Junie write code. The plans are committed under `.junie/plans/`.
- **Humans make the product and review decisions.** The user chose the kiosk timeouts, what sharing to hide and how the reset works (02). The user approved file edits outside the main code (03, 04). The user also sent a three-point code-review follow-up that Junie implemented with a new unit test (06).
- **Verify before claiming done.** Every code session ends with `pnpm test`, `npx tsc --noEmit` and/or `uv run pytest`, and session 06 adds `pnpm build:public` (`verify-dist: OK`) and a real touch run. Junie also said what it had *not* verified (no browser check in 02; no browser re-run after the review fixes in 06).

## How this evidence was produced

- **Source:** the local Junie session logs in `~/.junie/sessions/<session-id>/`: `transcript.md`, `summary.json` (task name, timestamps, models), `settings.json` (model, effort) and `events.jsonl` (answers to Junie's questions and edit approvals). Prompt timestamps come from `~/.junie/history.jsonl`. Commits come from `git show --stat <hash>`.
- **Verbatim excerpts:** quoted text (`> `) and code blocks are copied from the transcripts. `[...]` marks omitted text. Apart from the redactions below, Junie's output was not edited.
- **Redactions:** absolute local paths were replaced with `<repo>` (project root) or `<tmp>` (Junie's temporary folder). Level file names and the test output lines that list them were left out as a precaution, because the levels come from licensed data. No credentials, e-mail addresses or machine names appear.
- **Screenshots:** none are included. This export uses the text logs, so every claim can be traced to a log line or a commit.
- **Timezone:** all times are local, assumed UTC+8. The commit dates (`+0800`) are consistent with this.
- **Version info:** the IDE, plugin and agent versions come from the IDE installation and are not recorded in the session files. The model id and effort come from each session's `settings.json`.
