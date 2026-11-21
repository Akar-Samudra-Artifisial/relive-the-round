# Optional 3D renderer (three.js)

The game renders with Pixi. A later phase may put Pixi and three.js behind a common
`GameRenderer` interface. Phase 0 only proves that the build, the CSP (`script-src 'self'`, no
`unsafe-eval`) and `scripts/verify-dist.mjs` accept three.js as a lazily loaded chunk.

- `web/src/render/three3d/probe.ts` — `probeThree()` creates a `WebGLRenderer` on an offscreen
  canvas, disposes it and returns `{ revision, webgl2 }`. It never throws.
- `web/src/main.ts` — only when the URL has `?3d` (e.g. `/?3d=1`) the probe is loaded with a
  dynamic `import()` and the result is logged as `[3d probe] { revision, webgl2 }`. It runs
  fire-and-forget next to the normal startup, so it cannot block or break the game.
- Guards: `web/tests/three-lazy.test.ts` (no static three/probe import in `main.ts`) and the sim
  purity test in `web/tests/sim.test.ts` (no `three` import in `web/src/sim/`).

## Phase 0 — bundle

three `0.187.0` (`REVISION` 187), `@types/three` `0.187.0`. Measured after
`pnpm -C web build:public` (Vite 8 / Rolldown, minified); gzip = `gzip -c file | wc -c`.

| Chunk | Contents | Raw bytes | Gzip bytes |
| --- | --- | ---: | ---: |
| `assets/index-bPig10oF.js` | main entry (game, Pixi core) | 398,869 | 122,008 |
| `assets/probe-DC0eAlpZ.js` | probe + three.js (lazy, `?3d` only) | 523,502 | 128,025 |

- The three.js code lives only in the probe chunk; the main entry only holds the dynamic import
  reference to it. Vite warns that the probe chunk is over 500 kB minified; this is expected for
  three.js and does not affect normal players, who never download it.
- `verify-dist: OK` — no UUID, e-mail, local path or debug-code hits in the three chunk.
- `pnpm -C web preview` (port 4177), headless Chrome:
  - `/` requests no probe chunk and logs no `[3d probe]` line.
  - `/?3d=1` requests `probe-*.js` and logs `[3d probe] {revision: 187, webgl2: true}`.
  - No CSP violations in either case.

## Phase 1 — FrameView

What is drawn each frame is now plain data, built by pure functions; the Pixi code only draws it.
Nothing visible changed.

- `web/src/render/renderer.ts` — types only:
  - `FrameView { player, enemies, downs, spike, tracers }`, the data for one map panel;
  - `ActorView`, `DownView`, `TracerView`, and `SpikeView` (moved here, re-exported from
    `render/actors.ts`);
  - `PanelSpec` and the `GameRenderer` interface. Nothing implements `GameRenderer` yet.
- `web/src/game/frameView.ts` — pure builders (time and reduced motion are passed in), plus
  `TRACER_MS`, `TRACER_TICKS` and `LiveTracer`:

| Builder | Feeds | Notes |
| --- | --- | --- |
| `liveFrame(world, state, aim, tracers, nowMs, { reducedMotion })` | live play (`gamePage.ts` `drawDynamic`) | Fog of war via `segmentClear`; downs always shown; tracer fade `(untilMs - nowMs) / TRACER_MS + 0.3`; spike with own and enemy defuse, pulse unless reduced motion; `player` stays non-null on the death tick |
| `youFrame(world, timeline, t)` | YOU replay panel (`replayView.ts`) | No fog; still spike; tracers of the last 4 ticks fading 1 → 0.25; dead player → `player: null` plus a player-side down |
| `proFrame(world, t)` | PRO replay panel (`replayView.ts`) | Wraps `proFrameAt`; kills become downs (P0 victim on the player side); enemies have no facing; spike defuse 0 |

- `drawFrame(g, frame)` in `web/src/render/actors.ts` is the single Pixi draw path: spike, then
  downs and enemies, then player, then tracers, using the existing helpers.
- **Draw order (`z`)**: downs and enemies are merged by their optional `z`, a stable sort with
  downs first on ties, so overlaps layer as before:
  - live and YOU: enemy `i` has `z = i`, as a body or as a down; the YOU player's down has
    `z = enemies.length`;
  - PRO: kill `j` has `z = j`, and enemy `i` has `z = kills.length + i`.
- **Purity guard**: `web/tests/frameView.test.ts` checks both files with the sim purity regex (no
  `Math.random`, `Date`, `performance.now`, `window`, `document`, the 2D lib or three). It also
  covers fog, downs, tracer fades, spike fields, the player/down rules and both replay builders at
  several times on the synthetic 1v3 level.

### Parity check

Bot round `/?auto&seed=42` (`pnpm -C web dev`, headless Chrome 1280×800). The final score card is
the same on both:

| Build | Result | Time (you / pro) | Kills | HP left | Accuracy | Points |
| --- | --- | --- | --- | --- | --- | ---: |
| `main` | Lost (death) / pro won | 3.7 s / 6.0 s | 2 / 3 | 0 | 100% | 500 |
| this branch (Phase 1) | Lost (death) / pro won | 3.7 s / 6.0 s | 2 / 3 | 0 | 100% | 500 |

- Replay screenshots (paused at 0, 50, 80 and 100% of the span) are pixel-identical before and
  after the change.
- Live screenshots (ticks 40 and 80) differ only in a small area, by the same amount as two
  unchanged runs (`main` against the branch before the change). That is wall-clock frame timing,
  not drawing.

## Phase 2 — renderer seam

All game drawing now goes through `GameRenderer`. Our own `requestAnimationFrame` loop drives live
play and the replay, and the Pixi ticker no longer runs. Nothing visible changed.

- `web/src/game/frameLoop.ts`:
  - `frameDelta(prev, now, max = 100)`: returns 0 on the first frame and 0 when the clock goes
    back. Otherwise it returns `now - prev`, clamped like the Pixi ticker's `maxElapsedMS`.
  - `createFrameLoop(onFrame, deps)`: `raf`/`caf`/`now` can be injected. `start` is idempotent,
    and no callback runs after `stop`, not even one that is already queued. A restart begins with
    delta 0.
- `web/src/render/pixi2d.ts`:
  - `createPixi2dRenderer({ width, height })` is async (Pixi init) and returns a
    `Pixi2dRenderer` (`kind: "2d"`).
  - It owns the `Application`, the map per panel (`drawMap`) and one `Graphics` per panel
    (`drawFrame`).
  - It also draws the replay panel chrome, moved over unchanged from the old `replayView.ts`:
    header plate, frame and YOU/PRO labels, and the note is hidden when it does not fit.
- `web/src/game/replayPlayer.ts` — `ReplayPlayer` has no Pixi or DOM code:
  - time, speed and play/pause;
  - `update(deltaMS)` advances by `deltaMS / 1000 × speed` and fires `onTime`/`onEnd` exactly as
    before;
  - `frames()` returns `[youFrame, proFrame]`;
  - `panels(w, h, layout)` returns the two `PanelSpec`s.
- `web/src/game/gamePage.ts` no longer imports `pixi.js`. `replayView.ts` is deleted, and
  `ReplaySpeed` moved to `replayPlayer.ts`.
- Only `render/pixi2d.ts`, `render/mapView.ts`, `render/actors.ts`, `main.ts` (`unsafe-eval`) and
  the dev-only `src/debug/` import `pixi.js`.

**Frame order** (one loop callback per animation frame):

1. fps meter;
2. screen logic (`step`): replay cap/end, kiosk idle, score countdown, then in play the abort
   check, `session.advance(deltaMS)` with autopilot/input, countdown, tracers, defuse button and
   the switch to the score screen. `nowMs` from the loop replaces `performance.now()` inside the
   tick;
3. `replay.update(deltaMS)`;
4. build the frames:
   - replay: `replay.frames()`;
   - play and score: the last live frame;
   - attract/idle (canvas hidden): none;
5. `renderer.draw(frames)`, which ends in a single `app.render()`;
6. `updateHud` (only when play ran).

**Why `autoStart: false`.** Pixi's `TickerPlugin` renders after every ticker callback. With our own
loop on top, that would render twice per frame, in an order we do not control. The app is created
with `autoStart: false` and the ticker is also stopped. This gives one render per frame, after the
sim and replay update, so a 3D renderer can plug into the same loop. The score screen redraws the
last live frame every frame, so the canvas is not blank after the replay resizes it back.

**Panel and aim contract.**

- `PanelSpec.x/y` is the panel's top-left in logical px, and `size` is its square map field.
- A panel with a `title` gets the 32 px header strip above the field.
- Live play uses one panel `{ x: 0, y: 0, size }` and passes `cssPxPerUnit` (scale × CSS shrink).
  The replay omits it: its canvas is viewport-sized, so the panel scale is used.
- `screenToWorld(clientX, clientY)`:
  - converts with `clientToCanvas` (logical width, HiDPI and CSS-shrink safe);
  - subtracts the field origin and divides by the panel scale;
  - returns `null` outside every field.
- `Controls` keeps the last world aim on `null` and calls `mapInput(..., 1)`. For live play this
  is the same math as the old `px / scale`.

**Guards.**

- `web/tests/frameLoop.test.ts` covers the frame loop.
- `web/tests/replayPlayer.test.ts` covers the replay player on the synthetic 1v3 level.
- `web/tests/frameView.test.ts` checks that:
  - `replayPlayer.ts` passes the full purity regex;
  - `frameLoop.ts` uses no pixi, three, `document` or `window`;
  - only the allowlisted files import `pixi.js`;
  - `gamePage.ts` does not import `pixi.js`;
  - `replayView.ts` is gone.

### Parity check

Same method as phase 1: bot round `/?auto&seed=42`, `pnpm -C web dev`, headless Chrome 1280×800,
DPR 1. The baseline is the phase 1 commit in a separate worktree, served from the same origin (the
share QR encodes the origin).

| Build | Result | Time (you / pro) | Kills | HP left | Accuracy | Points |
| --- | --- | --- | --- | --- | --- | ---: |
| Phase 1 commit | Lost (death) / pro won | 3.7 s / 6.0 s | 2 / 3 | 0 | 100% | 500 |
| this branch (Phase 2) | Lost (death) / pro won | 3.7 s / 6.0 s | 2 / 3 | 0 | 100% | 500 |

Changed pixels in full-page screenshots (1,024,000 px):

| Screenshot | Baseline vs baseline | Baseline vs Phase 2 |
| --- | ---: | ---: |
| Score screen | 0 | 0 |
| Replay paused at 0 / 50 / 80 / 100% | 46 (fps counter) | 0 |
| Back to score after the replay | 0 | 0 |
| Live, tick 40 | 2,460 | 2,463 |
| Live, tick 80 | 1,138 | 1,064 |

- The replay and score canvases are pixel-identical. The only replay differences between runs are
  in the DOM fps counter (`?auto` shows it).
- The live differences stay in the range of two unchanged runs. That is wall-clock frame timing
  (tracer fade, spike pulse), not drawing.
- Smoke run (same headless setup), all passing with no console errors:
  - a keyboard and mouse round: W moves, the first shot follows the pointer within the weapon
    spread, and Escape returns to the level select;
  - the replay: Space pauses, `4` sets the speed, → seeks +2 s, the slider scrubs, and the natural
    end returns to the score screen;
  - `?kiosk=1&idle=10`: the attract loop starts after about 10 s with the canvas hidden, and a key
    dismisses it;
  - `?touch=1`: the sticks are visible and the sim keeps ticking.
- `pnpm -C web preview` (strict CSP, no `unsafe-eval`): `/` and `/?auto` show no
  `securitypolicyviolation` events and no console errors.
- `pnpm -C web build:public` prints `verify-dist: OK`.
