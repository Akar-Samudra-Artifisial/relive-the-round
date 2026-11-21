import type { Vec2 } from "../sim/geom";
import type { Input } from "../sim/sim";

export type Screen = "attract" | "play" | "score";

/** Raw device snapshot: held key codes (`KeyboardEvent.code`), pointer position on the canvas (px), left button. */
export type RawControls = {
  readonly keys: ReadonlySet<string>;
  readonly aimPx: Vec2;
  readonly pointerDown: boolean;
};

/**
 * Device → sim input. WASD/arrows move (opposite keys cancel), the pointer aims (canvas px →
 * world cm via `scale` px/cm), left click or Space fires, holding E defuses.
 */
export function mapInput(raw: RawControls, scale: number): Input {
  if (!(scale > 0)) throw new Error(`mapInput: scale must be > 0, got ${scale}`);
  const k = (...codes: string[]): number => (codes.some((c) => raw.keys.has(c)) ? 1 : 0);
  return {
    move: { x: k("KeyD", "ArrowRight") - k("KeyA", "ArrowLeft"), y: k("KeyS", "ArrowDown") - k("KeyW", "ArrowUp") },
    aim: { x: raw.aimPx.x / scale, y: raw.aimPx.y / scale },
    fire: raw.pointerDown || raw.keys.has("Space"),
    use: raw.keys.has("KeyE"),
  };
}

/** Swallow page scrolling keys only while playing, so menus and the initials field behave normally. */
export function blocksDefault(code: string, screen: Screen): boolean {
  return screen === "play" && (code.startsWith("Arrow") || code === "Space");
}
