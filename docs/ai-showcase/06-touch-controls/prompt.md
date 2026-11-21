# Junie task 06 — Touch controls for phones

IDE: WebStorm + Junie. Branch: `feat/touch-controls` (from `main`).

## Prompt (paste into Junie)

```
Goal: make a full round of Relive the Round playable on a phone with touch only (no keyboard,
no mouse), without changing desktop/keyboard behaviour or the simulation. Read .junie/guidelines.md first.

Context (current code):
- web/src/game/input.ts: RawControls {keys, aimPx, pointerDown} -> mapInput(raw, scale) -> sim Input.
  Sim Input contract (web/src/sim/sim.ts:39): move components in [-1, 1] (analog is fine, sim clamps
  at :250-251), aim is a world point in cm, fire: boolean, use: boolean (hold to defuse).
- web/src/game/gamePage.ts:79-117 class Controls: keyboard keys + pointer on canvas; pointer px are
  converted with clientToCanvas(..., logicalWidth) and divided by scale (px per cm).
- On a 390x844 portrait phone the square map canvas sits at the top and the lower ~40% of the
  screen is empty; the HUD tells the player to "hold E", which is impossible on touch.
- Kiosk corner-tap reset (web/src/game/kiosk.ts) only listens on the attract/idle screens.

Design (implement exactly this):
1. Twin-stick overlay, shown only on the "play" screen and only when touch is the active input:
   matchMedia("(pointer: coarse)") OR the first PointerEvent with pointerType "touch"; also
   force-enable with ?touch=1 for desktop testing. Hide it again on keyboard/mouse input.
2. Left stick = move: analog vector in [-1, 1] (dead zone 0.15, clamp to unit circle).
3. Right stick = aim: aim direction from the stick; fire while the stick is pushed beyond 0.7.
   The aim point is player position + direction x AIM_REACH (choose a sensible value in cm and
   export it). When the right stick is released, keep the last aim direction, stop firing.
4. DEFUSE button: hold-to-use, visible only while the player is within defuse range of a planted
   spike (reuse the existing range/helper from the sim or HUD code, do not duplicate constants);
   holding it sets use=true.
5. Layout: place the sticks and the button in the empty area below the map on portrait phones;
   on landscape phones overlay them at the bottom-left/bottom-right corners with translucent
   backgrounds so the map stays readable. Use the existing theme tokens in web/src/ui/theme.css
   (Tactical HUD style). Minimum touch target 56 CSS px. Use pointer events with
   setPointerCapture so each stick tracks its own finger (multi-touch: move + aim at once).
6. Prevent page scroll/zoom while playing: touch-action: none on the play area and controls.
   No double-tap zoom on the buttons.
7. HUD hint text: on touch show "Left stick move · Right stick aim/fire · Hold DEFUSE", on desktop
   keep the current text.
8. Keep all new logic that can be pure in pure functions with Vitest tests in web/tests/touch.test.ts:
   stickVector(dx, dy, radius, deadZone) -> Vec2 in the unit circle; stickAim(player, dir, reach)
   -> world point; mapInput must accept the touch state (extend RawControls with optional
   move/aim/fire/use overrides, keyboard still works and wins when both are present).

Constraints:
- Do NOT modify anything in web/src/sim/ and do not change scoring, replay, kiosk or level code.
- No new dependencies. No inline <script> (CSP in web/vercel.json). No external URLs.
- Desktop behaviour must be identical (keyboard + mouse), tests in web/tests/display.test.ts and
  kiosk tests must still pass.
- English for all code, comments and UI text. Update CHANGELOG.md (Unreleased).

Done when:
- cd web && pnpm test passes (all old tests + new touch tests), npx tsc --noEmit passes,
  pnpm build:public prints "verify-dist: OK".
- In Chrome DevTools device mode (iPhone 12 Pro, touch) with ?touch=1 a round can be finished:
  move, aim, shoot an enemy, defuse the spike, reach the score screen.
- Show me the plan first, then implement.
```

## Evidence to save in this folder

- `plan.png` — Junie's plan before implementation
- `run-*.png` — Junie running tests / build
- `corrections.md` — anything you had to correct or re-prompt
- `result-portrait.png`, `result-landscape.png` — device-mode screenshots of the controls
- `ide.txt` — WebStorm version + Junie version/model
