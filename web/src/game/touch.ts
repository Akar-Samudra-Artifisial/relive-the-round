import { DEFUSE_RADIUS } from "../sim/constants";
import { dist, type Vec2 } from "../sim/geom";
import { clockAt, simTimeAt, type SimState } from "../sim/sim";
import type { World } from "../sim/world";

/** Stick magnitude below which the stick reads as centred. */
export const STICK_DEAD_ZONE = 0.15;
/** Right-stick magnitude above which the clutcher fires. */
export const FIRE_THRESHOLD = 0.7;
/** Distance (cm) from the player to the touch aim point along the right-stick direction. */
export const AIM_REACH = 1500;

/**
 * Finger offset (px) from the stick centre → vector in the unit circle. Inside the dead zone the
 * result is {0,0}; outside it the magnitude is rescaled so it starts at 0 at the dead-zone edge.
 */
export function stickVector(dx: number, dy: number, radius: number, deadZone = STICK_DEAD_ZONE): Vec2 {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy) / radius;
  if (!(len > deadZone)) return { x: 0, y: 0 };
  const mag = Math.min(1, (Math.min(len, 1) - deadZone) / (1 - deadZone));
  const k = mag / len / radius;
  return { x: dx * k, y: dy * k };
}

/** World aim point = player + unit(dir) × reach. A zero direction aims along +x. */
export function stickAim(player: Vec2, dir: Vec2, reach = AIM_REACH): Vec2 {
  const len = Math.hypot(dir.x, dir.y);
  if (!(len > 0)) return { x: player.x + reach, y: player.y };
  return { x: player.x + (dir.x / len) * reach, y: player.y + (dir.y / len) * reach };
}

/**
 * Touch fire: the aim stick is pushed past FIRE_THRESHOLD and DEFUSE is not held (firing cancels a
 * defuse in the sim, so a thumb resting on the aim stick must not break it).
 */
export function touchFire(aim: Vec2, defuseHeld: boolean): boolean {
  return !defuseHeld && Math.hypot(aim.x, aim.y) > FIRE_THRESHOLD;
}

export type TouchModeEvent = "touch" | "mouse" | "pen" | "key";

/** Touch mode turns on with a touch pointer, off with keyboard/mouse input, unless forced (?touch=1). */
export function nextTouchActive(active: boolean, ev: TouchModeEvent, forced: boolean): boolean {
  if (forced) return true;
  if (ev === "touch") return true;
  if (ev === "mouse" || ev === "key") return false;
  return active;
}

/** Whether the clutcher stands in defuse range of the active spike (mirrors the sim's defuse rule). */
export function defuseAvailable(world: World, s: SimState): boolean {
  if (world.level.clutcherSide !== "defense" || world.spike === null || s.clutcher.hp <= 0 || s.outcome) return false;
  if (!clockAt(world, simTimeAt(world, s.tick)).spikeActive) return false;
  return dist({ x: s.clutcher.x, y: s.clutcher.y }, world.spike) <= DEFUSE_RADIUS;
}

const DESKTOP_HINT = "WASD move · mouse aim · click shoot · hold E on the spike to defuse";
const TOUCH_HINT = "Left stick move · Right stick aim/fire · Hold DEFUSE";

/** Countdown controls hint for the active input. */
export function controlsHint(touch: boolean): string {
  return touch ? TOUCH_HINT : DESKTOP_HINT;
}

/** HUD goal line for the clutcher's side and the active input. */
export function goalText(side: "attack" | "defense", touch: boolean): string {
  if (side === "defense") {
    return touch ? "Defend: hold DEFUSE on the spike for 5 s, or win the fight" : "Defend: hold E on the spike for 5 s, or win the fight";
  }
  return "Attack: survive until the spike blows, or win the fight";
}
