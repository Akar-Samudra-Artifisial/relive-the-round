import type { Vec2 } from "../sim/geom";
import type { Input } from "../sim/sim";

/** `attract` is the level select; `idle` is the kiosk-only attract loop shown over it. */
export type Screen = "attract" | "idle" | "play" | "score" | "replay";

/** On-screen touch controls: analog move in the unit circle, aim as a world point (cm), fire, use. */
export type TouchOverrides = {
  readonly move?: Vec2;
  readonly aim?: Vec2;
  readonly fire?: boolean;
  readonly use?: boolean;
};

/** Raw device snapshot: held key codes (`KeyboardEvent.code`), pointer position on the canvas (px), left button. */
export type RawControls = {
  readonly keys: ReadonlySet<string>;
  readonly aimPx: Vec2;
  readonly pointerDown: boolean;
  readonly touch?: TouchOverrides;
};

/**
 * Device → sim input. WASD/arrows move (opposite keys cancel), the pointer aims (canvas px →
 * world cm via `scale` px/cm), left click or Space fires, holding E defuses. Optional touch
 * overrides merge in: keyboard move wins when non-zero, touch aim replaces the pointer aim,
 * fire/use are ORed.
 */
export function mapInput(raw: RawControls, scale: number): Input {
  if (!(scale > 0)) throw new Error(`mapInput: scale must be > 0, got ${scale}`);
  const k = (...codes: string[]): number => (codes.some((c) => raw.keys.has(c)) ? 1 : 0);
  const t = raw.touch;
  const keyMove = { x: k("KeyD", "ArrowRight") - k("KeyA", "ArrowLeft"), y: k("KeyS", "ArrowDown") - k("KeyW", "ArrowUp") };
  const move = keyMove.x === 0 && keyMove.y === 0 && t?.move ? { x: t.move.x, y: t.move.y } : keyMove;
  return {
    move,
    aim: t?.aim ? { x: t.aim.x, y: t.aim.y } : { x: raw.aimPx.x / scale, y: raw.aimPx.y / scale },
    fire: raw.pointerDown || raw.keys.has("Space") || t?.fire === true,
    use: raw.keys.has("KeyE") || t?.use === true,
  };
}

/** Highest renderer resolution used on HiDPI screens (sharpness vs. fill-rate on phones). */
export const MAX_RESOLUTION = 2;

/** Pixi renderer resolution for a device pixel ratio: dpr capped to [1, MAX_RESOLUTION]. */
export function renderResolution(dpr: number | undefined): number {
  return Number.isFinite(dpr) && dpr! > 0 ? Math.min(Math.max(dpr!, 1), MAX_RESOLUTION) : 1;
}

/**
 * Pointer client px → logical canvas px (the units the stage is laid out in). Uses the logical
 * width (`app.screen.width`), never `canvas.width`, which is logical × resolution on HiDPI screens;
 * CSS may also shrink the canvas on narrow screens.
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: { readonly left: number; readonly top: number; readonly width: number },
  logicalWidth: number,
): Vec2 {
  const k = rect.width > 0 ? logicalWidth / rect.width : 1;
  return { x: (clientX - rect.left) * k, y: (clientY - rect.top) * k };
}

/**
 * Swallow page scrolling keys only while playing or watching a replay (where Space/arrows are
 * replay shortcuts), so menus and the initials field behave normally.
 */
export function blocksDefault(code: string, screen: Screen): boolean {
  return (screen === "play" || screen === "replay") && (code.startsWith("Arrow") || code === "Space");
}
