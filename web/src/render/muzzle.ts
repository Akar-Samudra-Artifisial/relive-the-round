import type { Vec2 } from "../sim/geom";
import { operatorSize, SPRITE_CM_PER_PX } from "./spritePose";

/**
 * Where a shot tracer starts. The sim fires from the actor's position (the body centre); the
 * renderers draw the tracer from the muzzle of the gun the character art holds instead. Pure and
 * render-only: the shot itself (origin, hits, scoring) is unchanged.
 *
 * Offsets are in the shot frame: `forward` along the shot direction, `side` towards the shot's
 * right-hand side on the y-down map, i.e. along (-dy, dx), and `height` above the floor (3D only).
 * They were measured on the art in its idle pose, so the tracer meets the gun tip when the body
 * faces the shot (the clutcher faces its aim, a bot turns to its target before firing).
 */
export type MuzzleOffset = { readonly forward: number; readonly side: number; readonly height: number };
export type MuzzleRole = "player" | "enemy";
export type MuzzleSet = Readonly<Record<MuzzleRole, MuzzleOffset>>;

/** No offset: the body centre (circle bodies, primitive cylinders). */
export const CENTRE: MuzzleOffset = { forward: 0, side: 0, height: 0 };

/**
 * 3D barrel tips in model cm (before MODEL_SCALE and the clutcher size), per art: the rigs
 * (`*-rig.glb`, idle clip at t = 0) and the static fallback models. Model +X is the shot's left
 * (pivot yaw π/2 - heading), so side = -x.
 */
export const MUZZLE_RIG: Readonly<Record<MuzzleRole, MuzzleOffset>> = {
  player: { forward: 115, side: -10.5, height: 32 },
  enemy: { forward: 115, side: -12.7, height: 35.4 },
};
export const MUZZLE_MODEL: Readonly<Record<MuzzleRole, MuzzleOffset>> = {
  player: { forward: 51.3, side: 21.9, height: 96.9 },
  enemy: { forward: 70.4, side: 15.4, height: 118.3 },
};

/**
 * 2D gun tips in sprite px from the sprite centre (sprites face +X, y down), per art: the idle
 * cell of the walk sheets and the static sprites.
 */
export const MUZZLE_SHEET_PX: Readonly<Record<MuzzleRole, MuzzleOffset>> = {
  player: { forward: 104, side: 33, height: 0 },
  enemy: { forward: 104, side: 30, height: 0 },
};
export const MUZZLE_SPRITE_PX: Readonly<Record<MuzzleRole, MuzzleOffset>> = {
  player: { forward: 63, side: 26, height: 0 },
  enemy: { forward: 87, side: 18, height: 0 },
};

/** A point-blank shot never starts past this fraction of its length. */
export const MAX_REACH = 0.8;

export function scaleMuzzle(o: MuzzleOffset, k: number): MuzzleOffset {
  return { forward: o.forward * k, side: o.side * k, height: o.height * k };
}

export function muzzleRole(by: string): MuzzleRole {
  return by === "P0" ? "player" : "enemy";
}

/**
 * Start of the tracer of a shot `from` → `to` for a gun at offset `o`. Written into `out` (no
 * allocation per tracer) and returned. The offset shrinks for a shot shorter than
 * `o.forward / MAX_REACH`, so the tracer never starts at or behind its end.
 */
export function muzzlePoint(from: Vec2, to: Vec2, o: MuzzleOffset, out: { x: number; y: number } = { x: 0, y: 0 }): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    out.x = from.x;
    out.y = from.y;
    return out;
  }
  const ux = dx / len;
  const uy = dy / len;
  const k = o.forward > 0 ? Math.min(1, (len * MAX_REACH) / o.forward) : 1;
  out.x = from.x + (ux * o.forward - uy * o.side) * k;
  out.y = from.y + (uy * o.forward + ux * o.side) * k;
  return out;
}

/**
 * 2D muzzles for the loaded sprites: `*Frames` is the role's frame count (> 1: a walk sheet);
 * `enemyIsOperator` when the enemy fell back to the operator's art. Sizes follow `standingPose`.
 */
export function spriteMuzzles(playerFrames: number, enemyFrames: number, enemyIsOperator: boolean): MuzzleSet {
  const art = (role: MuzzleRole, frames: number): MuzzleOffset => (frames > 1 ? MUZZLE_SHEET_PX : MUZZLE_SPRITE_PX)[role];
  return {
    player: scaleMuzzle(art("player", playerFrames), SPRITE_CM_PER_PX * operatorSize(playerFrames)),
    enemy: scaleMuzzle(art(enemyIsOperator ? "player" : "enemy", enemyFrames), SPRITE_CM_PER_PX),
  };
}

/**
 * 3D muzzle of one role: the art's tip (`rigged` picks the rig over the static model) scaled by the
 * body's world scale (MODEL_SCALE × the clutcher size).
 */
export function modelMuzzle(art: MuzzleRole, rigged: boolean, scale: number): MuzzleOffset {
  return scaleMuzzle((rigged ? MUZZLE_RIG : MUZZLE_MODEL)[art], scale);
}
