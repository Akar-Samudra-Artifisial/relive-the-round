---
sessionId: session-261122-021227-1dsv
---

# Requirements

### Overview & Goals
Phase 0 of an optional 3D renderer: show that the Vite build, the CSP and `verify-dist` all accept Three.js when it ships as a lazily loaded chunk. The chunk is only requested when the URL has `?3d=1`. Normal players see no change and download nothing extra.

### Scope
**In scope**
- Add exact-version deps `three` and `@types/three` (dev) with pnpm.
- Add the probe module `web/src/render/three3d/probe.ts`.
- Add a `?3d` gated dynamic import in `web/src/main.ts`.
- Test guards:
  - the sim regex also forbids `three`;
  - `main.ts` does not import three statically.
- Record measured gzip sizes in `docs/3d-renderer.md`.
- Add one line to `CHANGELOG.md`.

**Out of scope**
- No `GameRenderer` interface and no real 3D rendering.
- No changes to `web/src/sim/`, scoring, replay, kiosk, touch controls or level code.
- No CSP changes and no other dependencies.

### Functional Requirements
- `/` (no `3d` param): no three or probe chunk is requested, and behaviour is identical to today.
- `/?3d=1`: the probe chunk loads, and `console.info` logs `{ revision, webgl2 }`. If WebGL is unavailable the probe still resolves with `webgl2: false` and does not throw. Probe failures never block `startGame()`.
- `pnpm test`, `npx tsc --noEmit` and `pnpm build:public` pass, and the build prints `verify-dist: OK`.

### Notes on task details
- The sim purity regex is at `web/tests/sim.test.ts:87`, not line 97.
- `pnpm preview` uses port **4177** (`--strictPort` in `package.json`), not 4173. Verification will use `http://localhost:4177/`.

# Technical Design

### Current Implementation
- `web/src/main.ts`:
  - imports `pixi.js/unsafe-eval`, the theme CSS and `startGame`;
  - reads `URLSearchParams` for `debug`, which is a dev-only dynamic import behind `import.meta.env.DEV`;
  - calls `start()`.
- CSP (`web/vercel.json`, reused by `vite preview` via `vite.config.mjs`) uses `script-src 'self'` without `unsafe-eval`. Three.js needs neither eval nor external URLs, so the CSP stays unchanged.
- `web/scripts/verify-dist.mjs` scans text files in `dist/` for:
  - `/Users/`
  - UUID-like patterns
  - e-mail addresses
  - `__rtr`
  - debug-page markers
- Vite keeps the three `@license` banner, which contains no e-mail. This will be confirmed by the build.
- `web/tests/sim.test.ts:82-89` reads `../src/sim/*.ts` through `import.meta.glob(..., { query: "?raw" })` and checks the sources against a forbidden regex.

### Key Decisions
- **Probe only, gated in `main.ts`:** the probe runs fire-and-forget next to `start()`, so the game never waits on it. Errors go to `console.warn`.
- **Named imports only** (`REVISION`, `WebGLRenderer`) from `"three"`, so Rolldown/Vite can tree-shake. The whole probe module becomes its own chunk.
- **Offscreen canvas:**
  - Use `new OffscreenCanvas(1, 1)` when available, otherwise a detached `document.createElement("canvas")`.
  - Set `webgl2` to `renderer.getContext() instanceof WebGL2RenderingContext`, guarded with `typeof`.
  - Clean up with `renderer.forceContextLoss()` then `renderer.dispose()`.
- **Static-import guard test** reads `main.ts` as raw text, using the same `import.meta.glob` + `?raw` pattern as `sim.test.ts`.

### Data Models / Contracts
```ts
// web/src/render/three3d/probe.ts
import { REVISION, WebGLRenderer } from "three";
export interface ThreeProbeResult { revision: string; webgl2: boolean }
export async function probeThree(): Promise<ThreeProbeResult> {
  let webgl2 = false;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false });
    webgl2 = typeof WebGL2RenderingContext !== "undefined" && renderer.getContext() instanceof WebGL2RenderingContext;
    renderer.forceContextLoss(); renderer.dispose();
  } catch { webgl2 = false; }
  return { revision: REVISION, webgl2 };
}
```
```ts
// web/src/main.ts (addition)
if (new URLSearchParams(location.search).has("3d")) {
  import("./render/three3d/probe")
    .then(({ probeThree }) => probeThree())
    .then((r) => console.info("[3d probe]", r))
    .catch((e: unknown) => console.warn("[3d probe] failed", e));
}
```

### File Structure
- `web/package.json`, `web/pnpm-lock.yaml`: modified to add `three` (dep) and `@types/three` (devDep), exact versions.
- `web/src/render/three3d/probe.ts`: new.
- `web/src/main.ts`: modified to add the gated dynamic import.
- `web/tests/sim.test.ts`: modified so the regex at line 87 becomes `...|pixi|three`.
- `web/tests/three-lazy.test.ts`: new.
- `docs/3d-renderer.md`: new, with the section "Phase 0 — bundle".
- `CHANGELOG.md`: modified to add one English line under Unreleased / Added.

### Risks
- **verify-dist false positive in the three chunk** (UUID or e-mail regex). Mitigation: run `build:public` and inspect any hit. The checker must not be weakened. If a hit occurs, stop and report it.
- **`\bthree\b` in the sim regex matching an ordinary word** in sim comments. Mitigation: match the import specifier instead, e.g. `from\s*["']three|import\(\s*["']three`. The existing `pixi` term stays as it is.
- **TypeScript 7 / `@types/three` compatibility.** Validated with `npx tsc --noEmit`.

# Testing

### Validation Approach
- Run `cd web && pnpm test`.
- Run `npx tsc --noEmit`.
- Run `pnpm build:public` and expect `verify-dist: OK`.
- Run `pnpm preview` (port 4177) and check in a headless Playwright browser, following the webapp-testing skill:
  - which network requests are made;
  - the console output.

### Key Scenarios
- `http://localhost:4177/`: no request for the probe or three chunk, no `[3d probe]` log, and the level select renders.
- `http://localhost:4177/?3d=1`: the probe chunk is requested, and the console logs `{ revision: "<r>", webgl2: true|false }`. No CSP violations appear in the console.

### Test Changes
- `web/tests/sim.test.ts`: the forbidden regex also rejects importing `three`.
- New `web/tests/three-lazy.test.ts`, which loads `../src/main.ts` raw and asserts:
  - no static `import ... from "three"` or `import "three"`;
  - no static import of `./render/three3d/...`;
  - a dynamic `import("./render/three3d/probe")` is present.

### Measurement
- After `build:public`, list `dist/assets/*.js` with `gzip -c f | wc -c` for the main `index-*.js` chunk and the probe/three chunk.
- Write the raw and gzip byte counts plus the three version to `docs/3d-renderer.md`.

# Delivery Steps

### ✓ Step 1: Add three dependency and the probe module
Three.js is installed at exact versions, and a type-checked `probeThree()` exists that nothing imports yet.

- Run `cd web && pnpm add -E three && pnpm add -E -D @types/three`.
- Create `web/src/render/three3d/probe.ts`:
  - named imports `REVISION` and `WebGLRenderer` only;
  - render to `OffscreenCanvas`, falling back to a detached canvas;
  - try/catch around renderer creation;
  - `forceContextLoss()` then `dispose()`;
  - return `{ revision, webgl2 }`.
- Run `npx tsc --noEmit`.

### ✓ Step 2: Gate a dynamic probe import behind ?3d in main.ts, with guard tests
The `?3d` param loads the probe chunk and logs the result, and tests prevent three from leaking into the main entry or the sim.

- In `web/src/main.ts`, when `URLSearchParams(location.search).has("3d")`:
  - fire-and-forget `import("./render/three3d/probe")`;
  - log the result with `console.info`, or the error with `console.warn`;
  - `start()` is unaffected.
- Extend the regex at `web/tests/sim.test.ts:87` to also forbid importing `three` (match the import specifier).
- Add `web/tests/three-lazy.test.ts`. It reads `main.ts` raw and asserts:
  - no static three or probe import;
  - a dynamic `import()` is present.
- Run `pnpm test` and `npx tsc --noEmit`.

### ✓ Step 3: Build, verify in the browser, measure and document
The public build passes verify-dist, browser behaviour is confirmed, and the bundle sizes are recorded.

- Run `pnpm build:public` and confirm `verify-dist: OK`. Investigate any hit without weakening the checker.
- List `dist/assets` and measure gzip sizes (`gzip -c file | wc -c`) for the main `index-*.js` chunk and the probe/three chunk.
- Run `pnpm preview` (port 4177) and check with Playwright:
  - `/` makes no probe/three chunk request;
  - `/?3d=1` loads the chunk and logs `{ revision, webgl2 }`;
  - no CSP errors appear.
- Create `docs/3d-renderer.md` with "Phase 0 — bundle": three version, chunk names, raw and gzip sizes.
- Add one English line to `CHANGELOG.md` under Unreleased / Added about the experimental `?3d=1` probe.