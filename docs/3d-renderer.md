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

## Phase 3 — camera math

Pure camera math and renderer selection. There is still no three.js scene, and the game still draws
with Pixi 2D.

- `web/src/render/three3d/camMath.ts` (no three, no DOM; not imported by the game yet):
  - Convention: the ground is the plane Y = 0, and world (x, y) maps to 3D (X = x, Y = 0, Z = y),
    1 unit = 1 cm. The camera sits on the +Z side of the map centre, raised and pitched down,
    looking toward -Z. Screen-up = smaller world y and screen-right = larger world x, as in 2D.
  - `CAMERA_FOV_DEG = 30` (vertical FOV, like `THREE.PerspectiveCamera`) and
    `CAMERA_PITCH_DEG = 58` (angle below the horizon). No yaw or roll.
  - `fitCamera(bounds, aspect, { fovDeg, pitchDeg, margin = 0.04 })`: the target is the bounds
    centre on the ground. The distance is the smallest one at which all four ground corners
    project inside NDC `[-1 + margin, 1 - margin]` on both axes. It is found with a doubling upper
    bound and a fixed 64-step bisection, so the result is deterministic and always valid.
    `near = distance / 100`, `far = distance * 4`.
  - `project` returns NDC x/y (y up) plus the view-space depth in cm, or null behind the camera.
    `groundPoint` casts the ray through an NDC point onto Y = 0 and returns null when the ray
    never reaches the ground. `ndcFromClient` turns CSS px into NDC for a plain rect.
  - At this pitch the horizon is at NDC y = tan 58° / tan 15° ≈ 5.97, far above the screen, so
    every on-screen point maps to the ground.
- `web/src/render/select.ts`: `pickRenderer(search, caps)` is pure, and `detectCaps()` probes
  WebGL2 on a throwaway canvas. Rules, in order:
  1. `2d=1` → 2d (`forced`).
  2. `3d=1` or a bare `3d` → 3d (`requested`) when WebGL2 is available, otherwise 2d
     (`no webgl2`).
  3. Anything else, including `3d=0` → 2d (`default`). The default stays 2D until phase 8.
- `gamePage.ts` calls `pickRenderer` once at startup. When the pick is `3d`, it logs
  `[renderer] 3D renderer is not implemented yet; using 2D` and still creates the Pixi renderer.
- Entry chunk after `pnpm -C web build:public`: 401,677 B raw / 123,126 B gzip, which is
  +471 B / +184 B gzip over the same build without the selection hook. three is not in it.
- Parity: `/?auto&seed=42` gives the same score card as phase 2 (500 points, 3.7 s / 6.0 s,
  2 / 3 kills). `/?3d=1` plays in 2D with the log line once, and `/?2d=1` logs nothing.

## Phase 4 — static map

A three.js `GameRenderer` that draws the static map with the phase 3 camera. It is opt-in
(`?3d=1` with WebGL2) and loaded lazily. Without `3d`, the game is unchanged.

- `web/src/render/palette.ts` (pure, only imports `ui/theme`): the map palette (`FLOOR`,
  `GRID_MINOR`, `GRID_MAJOR`, `WALL_FILL`, `ATTACK_TINT`, `DEFENSE_TINT`) and the label sizes
  (`SITE_LABEL_SIZE`, `spawnLabelSize`) moved out of `mapView.ts`. `mapView.ts` imports them and
  re-exports `spawnLabelSize`, so 2D drawing is unchanged and the 3D code never pulls in Pixi.
- `web/src/render/three3d/mapScene.ts` (three only, no renderer, no DOM): `buildMapScene(map,
  { makeLabel?, cssPxPerUnit? })` returns a `THREE.Group` named `map`:
  - floor: a `PlaneGeometry(width, height)` at Y = 0 covering exactly `[0, width] x [0, height]`;
  - grid at Y = 1: two `LineSegments` (minor 400 / `line` 0.45, major 2000 / `lineHi` 0.4);
  - spawn zones and sites at Y = 2: `ShapeGeometry` fills (tint 0.07 / amber 0.08, transparent,
    `depthWrite: false`), dashed outlines pre-split into segments with the same dash/gap as 2D
    (120/90 spawns, 160/110 sites) and the amber site corner brackets;
  - walls: one `ExtrudeGeometry` per polygon from Y = 0 to `WALL_HEIGHT = 240` cm, all sharing one
    `MeshLambertMaterial(WALL_FILL)`, plus cyan `EdgesGeometry` lines (opacity 0.55). Merging would
    need the `BufferGeometryUtils` addon, so walls stay one mesh each (the wall counts are small);
  - one `HemisphereLight` and one `DirectionalLight`, no shadows. Only the walls are lit; the floor,
    fills and lines use unlit materials so their colours match the palette;
  - labels at Y = 3, only when a `makeLabel` factory is passed: site letters (display font, 380,
    amber 0.55) and spawn labels (mono font, `spawnLabelSize`, tint 0.7) lying flat at the polygon
    centroid, with text up pointing to -Z (screen up).
  - `disposeMapScene(group)` disposes every geometry, material and material texture once.
- Axis flip: rotating about X by -90° maps (x, y, z) to (x, z, -y). Shapes are therefore built from
  (x, -y) and then rotated, so a polygon point lands on (x, 0, y) and the extrusion depth becomes
  +Y. `mapScene.test.ts` checks that a wall vertex at world (x, y) appears at (x, *, y), not
  (x, *, -y).
- `web/src/render/three3d/labels.ts`: `makeCanvasLabel` draws bold text onto a 2D canvas (fonts are
  already loaded by `ensureFonts`), wraps it in an sRGB `CanvasTexture` and returns a transparent
  plane sized in world units. Labels skip the depth test so they draw over walls like in 2D (on
  Kiln, DEF SPAWN sits on a wall). No remote fonts or textures, so the CSP is unaffected.
- `web/src/render/three3d/three3d.ts`: `Three3dRenderer` (`kind = "3d"`):
  - `WebGLRenderer({ antialias: true, powerPreference: "high-performance" })`, pixel ratio
    `renderResolution(devicePixelRatio)` (capped at 2), clear colour `THEME_NUM.bg`, sRGB output;
  - `resize` and `loadMap` re-fit a `PerspectiveCamera` with
    `fitCamera({ 0, 0, width, height }, cssW / cssH)`; `loadMap` disposes the previous map group;
  - `setPanels` only stores the specs: this phase renders panels[0] into the whole canvas;
  - `draw` renders the scene once and ignores actors;
  - `screenToWorld` goes `ndcFromClient` → `groundPoint` and returns null outside
    `[0, width] x [0, height]`, so `Controls` aims at the ground point under the cursor unchanged;
  - `destroy` disposes the map, the renderer, forces a context loss and removes the canvas.
- Fallback rule (`gamePage.ts`): the 2D pick keeps the single `await createPixi2dRenderer(...)`.
  For a 3D pick, `create3dOr2d` does `await import("../render/three3d/three3d")` and creates the
  renderer. Any error (chunk load or WebGL init) logs one
  `console.warn("[renderer] 3D unavailable, falling back to 2D", err)` and uses Pixi 2D. No WebGL2 is
  already handled by `pickRenderer`, silently. The phase 3 info log is gone.
- `three-lazy.test.ts` now also checks that only files under `src/render/three3d/` import `three`,
  and that `gamePage.ts` reaches `three3d.ts` only through `import()`.
- Chunks after `pnpm -C web build:public` (gzip = `gzip -9`, Vite's own figure in brackets):

  | Chunk | Raw bytes | Gzip bytes |
  | --- | ---: | ---: |
  | `index-*.js` (entry) | 402,205 | 123,014 (124.71 kB) |
  | `three3d-*.js` (renderer, scene, labels, camera math) | 7,378 | 3,393 (3.38 kB) |
  | `three.module-*.js` (three, shared with the probe) | 564,392 | 138,722 (141.08 kB) |
  | `probe-*.js` | 388 | 301 (0.28 kB) |

  The entry grows by +466 B raw / +165 B gzip over the phase 3 commit built the same way. three
  is now its own chunk, shared by the probe and the renderer.
- Parity notes (3D vs. 2D): WebGL lines are always 1 px (wide lines would need the `Line2` addon),
  so the grid, outlines, brackets and wall edges are thin. The 2D 70 cm cyan wall halo is left out
  (the cyan edges stand in for it). Walls are lit, so their faces are a little lighter or darker
  than `WALL_FILL`.
- Still missing: actors, tracers and the spike (phase 5); the side-by-side replay panels (phase 6,
  the replay shows panels[0] only); shadows (phase 7).
- Checks (headless Chrome, 1280x800, `pnpm dev`):
  - `/?auto&seed=42` (2D) and `/?3d=1&auto&seed=42` (3D, canvas `data-engine="three.js r187"`)
    give the same score card: 500 points, 3.7 s / 6.0 s, 2 / 3 kills, tick 111. The 3D run logs no
    warnings or errors; the replay opens and plays.
  - Aim: on `/?3d=1&level=0`, the mouse was moved to the projected client position of five ground
    points and the button held. Every clutcher shot left within 1.5° of the target (weapon spread).
  - Fallback: `--disable-webgl2` plays in 2D with no warning; a blocked `three3d.ts` request and a
    `getContext("webgl2")` that fails for the renderer both log the one warn and play in 2D (the
    second also prints three's own context error).
