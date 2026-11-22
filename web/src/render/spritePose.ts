import type { FallSample, MotionSample } from "./actorMotion";

/**
 * Placement of the 2D character sprites (top-down, facing +X, light grey for tinting). Pure: no
 * pixi, so it is unit-testable; `actorSprites.ts` copies a pose onto a Sprite.
 */

/** World cm per sprite pixel (256 px sprites). Tune against PLAYER_R / ENEMY_R. */
export const SPRITE_CM_PER_PX = 2.6;
/** Footstep bob as a scale change (±3 % around 1). */
export const SPRITE_BOB = 0.03;
/** Downed sprites end at this alpha and tint multiplier. */
export const DOWN_ALPHA = 0.5;
export const DOWN_DARK = 0.4;

/**
 * The operator renders smaller and darker than the enemy (footprint 128 vs 176 px): draw it this
 * much larger so YOU is at least as easy to spot as an enemy.
 */
export const OPERATOR_SIZE = 1.35;
/** Darkest grey a sprite pixel may have after `liftLevels` (0..1), so tints stay saturated. */
export const SPRITE_FLOOR = 0.62;

/**
 * Remaps the grey levels of non-transparent RGBA pixels (straight alpha, in place) from their own
 * min..max to `floor`..1. Tinting multiplies, so a dark render (the operator) would turn cyan into
 * near black and dark texture patches (enemy pauldrons) into blotches; this keeps shading but
 * lifts both into a range the tint survives.
 */
export function liftLevels(data: Uint8ClampedArray, floor: number = SPRITE_FLOOR): void {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const l = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  if (hi < lo) return;
  const span = Math.max(hi - lo, 1);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const t = ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 - lo) / span;
    const v = Math.round(255 * (floor + (1 - floor) * t));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

export type SpritePose = { x: number; y: number; rotation: number; scale: number; tint: number; alpha: number };

/** `color` with each channel multiplied by k (0..1). */
export function scaleColor(color: number, k: number): number {
  const c = (shift: number): number => Math.round(((color >> shift) & 0xff) * k) << shift;
  return (c(16) | c(8) | c(0)) >>> 0;
}

/** Writes a standing actor's pose into `out` (no allocation) and returns it. */
export function standingPose(out: SpritePose, x: number, y: number, m: MotionSample, color: number, size = 1): SpritePose {
  out.x = x;
  out.y = y;
  // Pixi and the world share y-down axes, so the world heading is the sprite rotation.
  out.rotation = m.heading;
  // bob is in 0..speed01, so this swings ±SPRITE_BOB at a full run and is exactly 1 at rest.
  out.scale = SPRITE_CM_PER_PX * size * (1 + SPRITE_BOB * (2 * m.bob - m.speed01));
  out.tint = color;
  out.alpha = 1;
  return out;
}

/** Writes a downed actor's pose: fades to DOWN_ALPHA and darkens over the fall. */
export function downPose(out: SpritePose, x: number, y: number, f: FallSample, color: number, size = 1): SpritePose {
  out.x = x;
  out.y = y;
  out.rotation = f.yaw;
  out.scale = SPRITE_CM_PER_PX * size;
  out.tint = scaleColor(color, 1 - (1 - DOWN_DARK) * f.fallT);
  out.alpha = 1 - (1 - DOWN_ALPHA) * f.fallT;
  return out;
}

export function newPose(): SpritePose {
  return { x: 0, y: 0, rotation: 0, scale: SPRITE_CM_PER_PX, tint: 0xffffff, alpha: 1 };
}
