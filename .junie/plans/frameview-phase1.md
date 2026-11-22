---
sessionId: session-261122-022052-m7d8
---

# Requirements

### Overview & Goals
Phase 1 of the optional 3D renderer: separate *what* is drawn each frame from *how* it is drawn. Pure builders produce a `FrameView` for live play and both replay panels. The existing Pixi code draws only from that data. Nothing visible changes: same pixels, same scores.

### Scope
**In scope**
- `web/src/render/renderer.ts`: types only (`ActorView`, `DownView`, `FrameView`, `PanelSpec`, `GameRenderer`).
- `web/src/game/frameView.ts`: pure `liveFrame`, `youFrame`, `proFrame`.
- `drawDynamic` (`gamePage.ts`), `drawYou` and `drawPro` (`replayView.ts`) build a `FrameView` and draw it through one shared Pixi function.
- `web/tests/frameView.test.ts` plus a purity guard for the two new files.
- A "Phase 1 — FrameView" section in `docs/3d-renderer.md`, with the bot score before and after.

**Out of scope**
- No `GameRenderer` implementation (neither Pixi nor three.js).
- No changes to `web/src/sim/`, scoring, kiosk, touch controls, level code or the phase 0 probe.
- No new dependencies and no CHANGELOG entry.

### Functional Requirements
- **Pixel identity**: draw order stays as today. Each actor and down carries an optional `z` (its draw index today) and the drawer merges enemies and downs by it.
- **Live player**: `player` stays non-null in live play, including the death frame. The player is `null` only in the replay builders when dead, where a player-side down marker replaces it.
- **Fog of war**: the live builder drops living enemies that `segmentClear(walls, clutcher, enemy)` hides. Downs are always shown. The replay builders have no fog.
- **Tracer fade**: same formulas as today. Live: `(untilMs - nowMs) / TRACER_MS + 0.3`. Replay: `1 - (tick - k) / TRACER_TICKS` over the last 4 ticks.
- **Spike**: same activation as today. Live uses `clockAt(world, simTimeAt(world, tick))`; replay uses `clockAt(world, t)`. Live: defuse = own progress, enemyDefuse = highest progress among living enemies, pulse = `nowMs/1000` unless reduced motion. Replay: still pulse, no `enemyDefuse`. PRO panel: defuse 0.
- **Bot score**: `/?auto&seed=42` gives the same final score card before and after.

### Non-Functional Requirements
- `frameView.ts` and `renderer.ts` do not use pixi, three, `window`, `document`, `Date` or `performance.now`; time and reduced motion are passed in.
- English only. No GRID data in tests (synthetic fixture only).

# Technical Design

### Current Implementation
- **`gamePage.ts` `drawDynamic(g, world, s, aim, tracers, nowMs)`**, in this order:
  - spike, with `prefersReducedMotion()` read inline;
  - for each enemy: if dead, `drawDown`; else if `segmentClear`, `drawEnemy`;
  - `drawPlayer(p, aim)`;
  - tracers.
  - The local `type Tracer = { shot; untilMs }` and `TRACER_MS = 120` live in `gamePage.ts`.
- **`replayView.ts` `drawYou`**, in this order:
  - spike;
  - enemies, each as down or body in enemy order;
  - player body, or a player-colour down if hp ≤ 0;
  - tracers of the last `TRACER_TICKS = 4` ticks.
- **`replayView.ts` `drawPro`**, in this order:
  - spike (defuse 0);
  - kills from `proFrameAt` as downs (P0 victim in player colour);
  - enemies with no facing;
  - `drawPro` (that is, `drawPlayer(p, null)`) while alive.
- **`render/actors.ts`** holds the Pixi helpers and `SpikeView { defuse; enemyDefuse?; pulseT }`.

### Key Decisions
- **One source of truth for `SpikeView`**: move it into `renderer.ts` and re-export it from `actors.ts`, so existing imports keep working.
- **`z` order index** on `ActorView`/`DownView`. The drawer stable-merges `downs` and `enemies` by `z`, so layering matches today exactly (this was your choice).
- **Live player stays non-null on death** (your choice). The replay builders return `null` plus a player-side down.
- **Impure inputs become parameters**: `nowMs`, `reducedMotion` and replay `t`. `Tracer` and `TRACER_MS` move from `gamePage.ts` to `frameView.ts`, and `TRACER_TICKS` moves from `replayView.ts` to `frameView.ts`.
- **One shared drawer**: `drawFrame(g, frame)` in `actors.ts` draws spike → merged downs/enemies → player → tracers, using the existing helpers. All three call sites use it.

### Data Models / Contracts
```ts
// web/src/render/renderer.ts (types only; imports: Vec2, ShotEvent, MapDef as types)
export type SpikeView = { readonly defuse: number; readonly enemyDefuse?: number; readonly pulseT: number | null };
export type ActorView = { readonly x: number; readonly y: number; readonly fx?: number; readonly fy?: number; readonly z?: number };
export type DownView = { readonly x: number; readonly y: number; readonly side: "player" | "enemy"; readonly z?: number };
export type TracerView = { readonly shot: ShotEvent; readonly fade: number }; // fade unclamped, drawTracer clamps
export type FrameView = {
  readonly player: { readonly x: number; readonly y: number; readonly aim: Vec2 | null } | null;
  readonly enemies: readonly ActorView[]; // already fog-filtered
  readonly downs: readonly DownView[];
  readonly spike: (Vec2 & SpikeView) | null;
  readonly tracers: readonly TracerView[];
};
export type PanelSpec = { readonly x: number; readonly y: number; readonly size: number; readonly title?: string; readonly note?: string; readonly accent?: number };
export interface GameRenderer {
  readonly kind: "2d" | "3d"; readonly canvas: HTMLCanvasElement;
  resize(cssW: number, cssH: number): void;
  loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void;
  setPanels(panels: readonly PanelSpec[]): void;
  draw(frames: readonly FrameView[]): void;
  screenToWorld(clientX: number, clientY: number): Vec2 | null;
  destroy(): void;
}

// web/src/game/frameView.ts (pure)
export const TRACER_MS = 120; export const TRACER_TICKS = 4;
export type LiveTracer = { readonly shot: ShotEvent; readonly untilMs: number };
export function liveFrame(world: World, s: SimState, aim: Vec2 | null, tracers: readonly LiveTracer[], nowMs: number, opts?: { reducedMotion?: boolean }): FrameView;
export function youFrame(world: World, timeline: readonly SimState[], t: number): FrameView;
export function proFrame(world: World, t: number): FrameView; // wraps proFrameAt(world, world.level, t)
```
**`z` assignment**
- Live / YOU panel: enemy `i` gets `z = i`, whether shown as a body or a down. The player's own down in the YOU panel gets `z = enemies.length`.
- PRO panel: kill `j` gets `z = j`; enemy `i` gets `z = kills.length + i`.

**Colours**: down colour comes from `side` (`player` → `PLAYER_COLOR`, `enemy` → `ENEMY_COLOR`).

### File Structure
- `web/src/render/renderer.ts`: new, types only.
- `web/src/game/frameView.ts`: new, pure builders.
- `web/src/render/actors.ts`: re-export `SpikeView`; add `drawFrame`.
- `web/src/game/gamePage.ts`: `drawDynamic` becomes `drawFrame(g, liveFrame(..., { reducedMotion: prefersReducedMotion() }))`; use `LiveTracer` and `TRACER_MS` from `frameView.ts`.
- `web/src/game/replayView.ts`: `drawYou`/`drawPro` become `drawFrame(g, youFrame(...))` / `drawFrame(g, proFrame(...))`; remove the private `drawSpike`.
- `web/tests/frameView.test.ts`: new.
- `docs/3d-renderer.md`: append the Phase 1 section.

### Risks
- **Hidden draw-order or alpha drift.** Mitigation: the `z` merge, unclamped fade values passed through unchanged, and before/after screenshot comparison.
- **Purity regex.** It matches the plain text `pixi`, so comments in the new files must not mention it either.

# Testing

### Validation Approach
- Unit tests (vitest) on the pure builders, using `buildWorld(KILN, SYNTHETIC_1V3)` and hand-built `SimState`s.
- `pnpm test`, `npx tsc --noEmit` and `pnpm build:public` (expect `verify-dist: OK`).
- A headless Playwright script with the webapp-testing `with_server.py` helper against `pnpm dev` (port 5177). Screenshots are saved in the scratch directory only, never committed.

### Key Scenarios (`web/tests/frameView.test.ts`)
- **Fog**: an enemy behind a Kiln wall (`segmentClear` false) is missing from `enemies`; a clear-line enemy is present with `fx/fy`.
- **Downs**: a dead enemy is always in `downs` (side `enemy`), even behind a wall.
- **Tracer fade**: `nowMs` at `untilMs - 120` gives fade 1.3; at `untilMs - 60` gives 0.8. In `youFrame`, fades are 1, 0.75, 0.5, 0.25 over 4 ticks.
- **Spike**:
  - `null` before the plant;
  - after the plant, `defuse`/`enemyDefuse` ratios match the ticks;
  - `pulseT` is `null` when `reducedMotion` is set, and `null` in the replay builders.
- **Player**:
  - live: non-null even at hp 0;
  - `youFrame`: `null` plus a player down once dead;
  - `proFrame`: `null` plus a P0 down after the clutcher's `diedT`.
- **youFrame/proFrame timestamps**: at a few `t` (start, mid, after a kill, end), check positions against `youStateAt`/`proFrameAt`, the counts, and that `z` values are ordered.
- **Purity**: `?raw` glob over `src/game/frameView.ts` and `src/render/renderer.ts`, using the same regex as the sim purity test.

### Manual / browser checks
- **Baseline first**: make sure `git diff main -- web/src/sim web/src/game/score.ts` is empty, then capture the `/?auto&seed=42` final score card and screenshots before any edit. Also run `main` in a temporary worktree in the scratch directory for the score.
- **After the refactor**: same score card. Screenshots of a live round mid-play and the replay at fixed times match the baseline.

# Delivery Steps

### ✓ Step 1: Capture baseline (score + screenshots)
The bot's final score card and the reference screenshots from before any code change are recorded.

- Confirm that sim and scoring match `main` (`git diff main -- web/src/sim web/src/game/score.ts`). Run `main` from a temporary worktree in the scratch directory for the score.
- Write a Playwright script, run with `with_server.py` and `pnpm -C web dev`, that:
  - opens `/?auto&seed=42` and screenshots the live round at fixed points;
  - reads the final score card;
  - screenshots the replay at start, middle and end.
- Keep the outputs in the scratch directory only.

### ✓ Step 2: Add renderer types and pure FrameView builders with tests
`renderer.ts` and `frameView.ts` exist and are fully unit-tested; no draw code changes yet.

- `web/src/render/renderer.ts`: `SpikeView` (moved here), `ActorView`, `DownView`, `TracerView`, `FrameView`, `PanelSpec`, `GameRenderer`, all types only.
- `web/src/render/actors.ts`: re-export `SpikeView` from `renderer.ts`.
- `web/src/game/frameView.ts`:
  - `TRACER_MS`, `TRACER_TICKS`, `LiveTracer`;
  - `liveFrame`: fog filter via `segmentClear`, tracer fade, spike with `enemyDefuse` and `reducedMotion`, non-null player;
  - `youFrame`: timeline at replay time `t`, player down when dead;
  - `proFrame`: wraps `proFrameAt`, kills become downs;
  - every actor and down gets a `z` draw index.
- `web/tests/frameView.test.ts`: fog, downs, tracer fade, spike fields, player null/down rules, youFrame/proFrame at several timestamps on `SYNTHETIC_1V3` + `KILN`, and the purity guard for both files.
- Run `pnpm test` and `npx tsc --noEmit`.

### ✓ Step 3: Route live and replay drawing through FrameView
`drawDynamic`, `drawYou` and `drawPro` all draw through one `drawFrame` path, with unchanged pixels.

- `actors.ts`: add `drawFrame(g, frame)`, which draws spike → downs/enemies stable-merged by `z` → player → tracers, using the existing helpers.
- `gamePage.ts`:
  - `drawDynamic` calls `drawFrame(g, liveFrame(..., { reducedMotion: prefersReducedMotion() }))`;
  - use `LiveTracer` and `TRACER_MS` from `frameView.ts`;
  - remove the local `Tracer` type.
- `replayView.ts`:
  - `drawYou`/`drawPro` use `youFrame`/`proFrame` + `drawFrame`;
  - remove the private `drawSpike` and the local `TRACER_TICKS`;
  - drop the imports that are no longer used.
- Run `pnpm test`, `npx tsc --noEmit` and `pnpm build:public` (expect `verify-dist: OK`).

### ✓ Step 4: Verify parity and document Phase 1
The score and visuals match the baseline, and `docs/3d-renderer.md` describes Phase 1.

- Re-run the baseline Playwright script on this branch.
- Compare the final score card for `/?auto&seed=42` and the live/replay screenshots against the baseline; fix any difference.
- Append "Phase 1 — FrameView" to `docs/3d-renderer.md`:
  - the types and where they live;
  - which builder feeds which view;
  - the `z` ordering rule;
  - the purity guard;
  - both final score cards (main and branch).