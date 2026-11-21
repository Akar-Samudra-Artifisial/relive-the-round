# Junie task 07 — 3D renderer, phase 0 (add three as a lazy chunk)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (from `main`).

## Prompt (paste into Junie)

```
Goal: phase 0 of an optional 3D renderer. Add Three.js as a lazily loaded chunk that is only
requested when the URL has ?3d=1. No visible or behavioural change for normal players.
Read .junie/guidelines.md first.

Context:
- The game renders with Pixi (web/src/game/gamePage.ts, web/src/render/*, web/src/game/replayView.ts).
  Later phases will put Pixi and Three behind a common GameRenderer interface; this phase only
  proves the bundle/CSP/verify-dist pipeline accepts three.
- CSP in web/vercel.json: script-src 'self', no unsafe-eval. web/scripts/verify-dist.mjs scans dist.
- web/tests/sim.test.ts:93-97 forbids pixi/window/document/etc. in web/src/sim/*.ts.

Do:
1. cd web && pnpm add -E three && pnpm add -E -D @types/three (exact versions, pnpm only).
2. Create web/src/render/three3d/probe.ts exporting async function probeThree(): Promise<{ revision: string;
   webgl2: boolean }> that imports only named exports from "three" (e.g. REVISION, WebGLRenderer),
   creates a WebGLRenderer on an offscreen canvas inside try/catch, disposes it, and returns the result.
3. In web/src/main.ts (or wherever startup reads URL params) when new URLSearchParams(location.search)
   has "3d": `import("./render/three3d/probe")` dynamically, call probeThree(), and console.info the result.
   Without ?3d=1 the three chunk must NOT be requested.
4. Extend the regex in web/tests/sim.test.ts:97 so web/src/sim/*.ts may not import "three" either.
5. Add a Vitest test that the main entry source does not statically import "three"
   (only dynamic import()).
6. Measure: after pnpm build:public, list dist/assets with gzip sizes (gzip -c file | wc -c) for the
   main index chunk and the new three chunk; write the numbers to docs/3d-renderer.md under
   "Phase 0 — bundle", together with the three version.
7. CHANGELOG.md (Unreleased): one line about the experimental ?3d=1 probe.

Constraints:
- Do not modify web/src/sim/, scoring, replay, kiosk, touch controls or level code.
- No other new dependencies. No inline scripts, no external URLs. English only.

Done when:
- cd web && pnpm test, npx tsc --noEmit and pnpm build:public ("verify-dist: OK") pass.
- pnpm preview: http://localhost:4173/ loads no three chunk (Network tab); /?3d=1 loads it and logs
  { revision, webgl2 } in the console.
- docs/3d-renderer.md contains the measured gzip sizes.
- Show me the plan first, then implement.
```

## Evidence to save in this folder
- `plan.png`, `run-tests.png`, `network-3d.png` (Network tab with the three chunk), `corrections.md`
