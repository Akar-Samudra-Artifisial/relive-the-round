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
