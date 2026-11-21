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
