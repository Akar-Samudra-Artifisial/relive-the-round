import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { facing } from "../src/render/actorMotion";
import {
  CENTRE,
  MAX_REACH,
  modelMuzzle,
  MUZZLE_MODEL,
  MUZZLE_RIG,
  MUZZLE_SHEET_CELLS_PX,
  MUZZLE_SHEET_PX,
  MUZZLE_SPRITE_PX,
  muzzlePoint,
  muzzleRole,
  spriteMuzzles,
  spriteTipPoint,
  spriteTips,
} from "../src/render/muzzle";
import { SHEET_OPERATOR_SIZE, SPRITE_CM_PER_PX } from "../src/render/spritePose";
import type { ActorModels } from "../src/render/three3d/actorModels";
import { ActorLayer, MODEL_SCALE, PLAYER_MODEL_SIZE, TRACER_Y } from "../src/render/three3d/actorScene";
import type { ShotEvent } from "../src/sim/sim";

const o = { forward: 100, side: 20, height: 50 };

describe("muzzlePoint", () => {
  it("offsets forward along the shot and sideways to its right on the y-down map", () => {
    // Shot towards +x: right-hand side (y down) is +y.
    expect(muzzlePoint({ x: 0, y: 0 }, { x: 1000, y: 0 }, o)).toEqual({ x: 100, y: 20 });
    // Shot towards +y: right-hand side is -x.
    const p = muzzlePoint({ x: 10, y: 10 }, { x: 10, y: 1010 }, o);
    expect(p.x).toBeCloseTo(-10, 9);
    expect(p.y).toBeCloseTo(110, 9);
  });

  it("keeps the body centre for CENTRE and a zero-length shot", () => {
    expect(muzzlePoint({ x: 5, y: 6 }, { x: 900, y: -40 }, CENTRE)).toEqual({ x: 5, y: 6 });
    expect(muzzlePoint({ x: 5, y: 6 }, { x: 5, y: 6 }, o)).toEqual({ x: 5, y: 6 });
  });

  it("shrinks the offset for a point-blank shot so it never starts past the target", () => {
    const p = muzzlePoint({ x: 0, y: 0 }, { x: 50, y: 0 }, o);
    expect(p.x).toBeCloseTo(50 * MAX_REACH, 9);
    expect(p.x).toBeLessThan(50);
    expect(p.y).toBeCloseTo(20 * ((50 * MAX_REACH) / 100), 9);
  });

  it("writes into `out` without allocating", () => {
    const out = { x: 0, y: 0 };
    expect(muzzlePoint({ x: 0, y: 0 }, { x: 0, y: -500 }, o, out)).toBe(out);
  });

  it("maps P0 to the player and anything else to the enemy", () => {
    expect(muzzleRole("P0")).toBe("player");
    expect(muzzleRole("E2")).toBe("enemy");
  });
});

describe("muzzle sets per art", () => {
  it("scales the sprite tips by the sprite size, sheets vs static sprites", () => {
    const sheets = spriteMuzzles(9, 9, false);
    expect(sheets.player.forward).toBeCloseTo(MUZZLE_SHEET_PX.player.forward * SPRITE_CM_PER_PX * SHEET_OPERATOR_SIZE, 9);
    expect(sheets.enemy.side).toBeCloseTo(MUZZLE_SHEET_PX.enemy.side * SPRITE_CM_PER_PX, 9);
    const fallback = spriteMuzzles(1, 1, true);
    // An enemy drawn with the operator's art uses the operator's tip at the enemy size.
    expect(fallback.enemy.forward).toBeCloseTo(MUZZLE_SPRITE_PX.player.forward * SPRITE_CM_PER_PX, 9);
  });

  it("puts every gun tip in front of the body", () => {
    for (const set of [MUZZLE_RIG, MUZZLE_MODEL, MUZZLE_SHEET_PX, MUZZLE_SPRITE_PX]) {
      for (const tip of [set.player, set.enemy]) expect(tip.forward).toBeGreaterThan(Math.abs(tip.side));
    }
  });

  it("has a tip for every walk cell, the idle one first", () => {
    for (const role of ["player", "enemy"] as const) {
      expect(MUZZLE_SHEET_CELLS_PX[role]).toHaveLength(9);
      expect(MUZZLE_SHEET_PX[role]).toBe(MUZZLE_SHEET_CELLS_PX[role][0]);
      for (const tip of MUZZLE_SHEET_CELLS_PX[role]) expect(tip.forward).toBeGreaterThan(Math.abs(tip.side));
      expect(spriteTips(role, 9)).toBe(MUZZLE_SHEET_CELLS_PX[role]);
      expect(spriteTips(role, 1)).toEqual([MUZZLE_SPRITE_PX[role]]);
    }
  });

  it("rotates and scales a sprite tip like the sprite (y-down, facing +X)", () => {
    const tip = { forward: 100, side: 20, height: 0 };
    expect(spriteTipPoint(10, 10, 0, 2, tip)).toEqual({ x: 210, y: 50 });
    const p = spriteTipPoint(0, 0, Math.PI / 2, 1, tip);
    expect(p.x).toBeCloseTo(-20, 9);
    expect(p.y).toBeCloseTo(100, 9);
  });

  it("scales the model tips by the body scale", () => {
    expect(modelMuzzle("enemy", true, 2)).toEqual({ forward: MUZZLE_RIG.enemy.forward * 2, side: MUZZLE_RIG.enemy.side * 2, height: MUZZLE_RIG.enemy.height * 2 });
    expect(modelMuzzle("player", false, 1)).toEqual(MUZZLE_MODEL.player);
  });
});

describe("clutcher facing", () => {
  it("prefers the aim, then the face point, else none", () => {
    expect(facing({ x: 0, y: 0, face: { x: 9, y: 9 } }, true, 3, 4)).toEqual({ x: 3, y: 4 });
    expect(facing({ x: 1, y: 1, face: { x: 1, y: 6 } }, false, 0, 0)).toEqual({ x: 0, y: 5 });
    expect(facing({ x: 1, y: 1 }, false, 0, 0)).toBeUndefined();
    expect(facing({ x: 1, y: 1, face: { x: 1, y: 1 } }, false, 0, 0)).toBeUndefined();
  });
});

const shot = (by: string, from: [number, number], to: [number, number]): ShotEvent =>
  ({ by, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, hit: null }) as ShotEvent;

function worldPos(o3: THREE.Object3D): THREE.Vector3 {
  o3.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o3.matrixWorld);
}

describe("3D tracers", () => {
  const frame = {
    player: { x: 1000, y: 2000, aim: { x: 3000, y: 2000 } },
    enemies: [],
    downs: [],
    spike: null,
    tracers: [{ shot: shot("P0", [1000, 2000], [3000, 2000]), fade: 1 }],
  };
  const core = (layer: ActorLayer): THREE.Object3D => {
    let found: THREE.Object3D | null = null;
    layer.group.traverse((x) => {
      if (x.name === "tracer-core" && x.visible && x.parent?.visible) found = x;
    });
    return found!;
  };

  it("starts at the body centre on the cylinders and at the model's muzzle with models", () => {
    const layer = new ActorLayer();
    layer.update(frame, 0);
    const p0 = worldPos(core(layer));
    expect([p0.x, p0.y, p0.z]).toEqual([1000, TRACER_Y, 2000]);
    const geo = new THREE.BoxGeometry(50, 180, 50).translate(0, 90, 0);
    const models: ActorModels = { operator: { geometry: geo, map: null, height: 180, back: 25 }, enemy: { geometry: geo, map: null, height: 180, back: 25 } };
    layer.setModels(models);
    layer.update(frame, 16);
    const tip = modelMuzzle("player", false, MODEL_SCALE * PLAYER_MODEL_SIZE);
    const p1 = worldPos(core(layer));
    expect(p1.x).toBeCloseTo(1000 + tip.forward, 6);
    expect(p1.z).toBeCloseTo(2000 + tip.side, 6);
    expect(p1.y).toBeCloseTo(tip.height, 6);
    layer.dispose();
  });
});
