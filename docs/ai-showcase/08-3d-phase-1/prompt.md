# Junie task 08 — 3D renderer, phase 1 (pure FrameView builders)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 0 committed first).

## Prompt (paste into Junie)

```
Goal: phase 1 of the optional 3D renderer. Extract WHAT is drawn each frame into pure, tested data
builders, so a Pixi renderer and a future three.js renderer can draw the same data. Rendering must
not change yet: Pixi code keeps drawing as today. Read .junie/guidelines.md and docs/3d-renderer.md.

Context:
- Live play draws per frame in web/src/game/gamePage.ts drawDynamic(...) (spike + defuse progress,
  enemies filtered by fog-of-war via segmentClear, downed actors, player + aim cone, tracers with fade).
- Replay draws two panels in web/src/game/replayView.ts drawYou(...) (from buildYouTimeline) and
  drawPro(...) (from proFrameAt in web/src/game/replayModel.ts).
- Actor drawing helpers live in web/src/render/actors.ts. Sim types: web/src/sim/sim.ts
  (SimState, ClutcherState, EnemyState, ShotEvent, clockAt).

Do:
1. web/src/render/renderer.ts — TYPES ONLY (no pixi/three/DOM imports):
   - ActorView { x; y; fx?; fy? } (fx/fy = facing), DownView { x; y; side: "player" | "enemy" }
   - FrameView { player: { x; y; aim: Vec2 | null } | null; enemies: readonly ActorView[] (already
     fog-filtered); downs: readonly DownView[]; spike: (Vec2 & <existing spike view fields>) | null;
     tracers: readonly { shot: ShotEvent; fade: number }[] }
   - PanelSpec { x; y; size; title?; note?; accent? }
   - interface GameRenderer { readonly kind: "2d" | "3d"; readonly canvas: HTMLCanvasElement;
     resize(cssW, cssH): void; loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void;
     setPanels(panels: readonly PanelSpec[]): void; draw(frames: readonly FrameView[]): void;
     screenToWorld(clientX, clientY): Vec2 | null; destroy(): void }
   Adjust field names to match the existing code where it already has equivalents (keep one source
   of truth; reuse existing types instead of duplicating them).
2. web/src/game/frameView.ts — pure functions (no pixi/three/DOM/time APIs; time passed in):
   liveFrame(world, state, aim, tracers, nowMs) — exactly the data drawDynamic uses, including the
   segmentClear fog filter and tracer fade; youFrame(...) and proFrame(...) — exactly the data
   drawYou / drawPro use.
3. Make drawDynamic, drawYou and drawPro consume these builders (build FrameView, then draw from it)
   so there is a single code path. Pixel output must stay identical.
4. Tests web/tests/frameView.test.ts: fog filter (enemy behind a wall hidden, in line of sight shown),
   tracer fade over time, spike/defuse fields, downs, player null after death, youFrame/proFrame at
   a few timestamps of a small synthetic level. Extend the purity check so web/src/game/frameView.ts
   and web/src/render/renderer.ts may not use pixi, three, window, document, Date or performance.now.
5. Append "Phase 1 — FrameView" to docs/3d-renderer.md (types + where they are built). CHANGELOG
   not needed (no user-visible change).

Constraints:
- Do not modify web/src/sim/, scoring, kiosk, touch controls, level code or the phase 0 probe.
- No new dependencies. English only.

Done when:
- cd web && pnpm test, npx tsc --noEmit, pnpm build:public ("verify-dist: OK") pass.
- Same score before/after for the bot: open /?auto&seed=42 on main and on this branch (pnpm dev),
  note both final score cards in docs/3d-renderer.md.
- Visual check: a live round and a replay look the same as before (screenshots before/after).
- Show me the plan first, then implement.
```

## Evidence
Junie session log is exported later from `~/.junie/sessions`. Optional screenshots: before/after.
