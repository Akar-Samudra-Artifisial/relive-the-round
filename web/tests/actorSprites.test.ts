import { type Sprite, Texture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { destroySpriteTextures, isSheetSize, SHEET_GRID, sheetFrames, SpriteLayer, type SpriteTextures } from "../src/render/actorSprites";
import { MUZZLE_SHEET_CELLS_PX, type MuzzleOffset, muzzlePoint, spriteTipPoint } from "../src/render/muzzle";
import type { ShotEvent } from "../src/sim/sim";

describe("walk sheet frames", () => {
  it("splits a 768 px sheet into 3 × 3 cells of 256 px, row-major", () => {
    const source = new TextureSource({ width: 768, height: 768 });
    const frames = sheetFrames(source);
    expect(frames).toHaveLength(SHEET_GRID * SHEET_GRID);
    for (const f of frames) expect(f.source).toBe(source);
    expect([frames[0]!.frame.x, frames[0]!.frame.y, frames[0]!.frame.width, frames[0]!.frame.height]).toEqual([0, 0, 256, 256]);
    expect([frames[1]!.frame.x, frames[1]!.frame.y]).toEqual([256, 0]);
    expect([frames[3]!.frame.x, frames[3]!.frame.y]).toEqual([0, 256]);
    expect([frames[8]!.frame.x, frames[8]!.frame.y]).toEqual([512, 512]);
  });

  it("accepts only a full square grid as a walk sheet", () => {
    expect(isSheetSize(768, 768)).toBe(true);
    expect(isSheetSize(384, 384)).toBe(true);
    expect(isSheetSize(768, 512)).toBe(false);
    expect(isSheetSize(512, 512)).toBe(false);
    expect(isSheetSize(3, 4)).toBe(false);
    expect(isSheetSize(0, 0)).toBe(false);
  });

  it("destroys every frame and each shared source once", () => {
    const sheet = new TextureSource({ width: 768, height: 768 });
    const frames = sheetFrames(sheet);
    const single = new Texture({ source: new TextureSource({ width: 256, height: 256 }) });
    const sheetDestroy = vi.spyOn(sheet, "destroy");
    const singleDestroy = vi.spyOn(single.source, "destroy");
    const frameDestroy = frames.map((f) => vi.spyOn(f, "destroy"));
    // The enemy reusing the operator frames must not destroy them twice.
    destroySpriteTextures({ operator: frames, enemy: frames });
    destroySpriteTextures({ operator: [single], enemy: [single] });
    expect(sheetDestroy).toHaveBeenCalledTimes(1);
    expect(singleDestroy).toHaveBeenCalledTimes(1);
    for (const s of frameDestroy) expect(s).toHaveBeenCalledTimes(1);
  });
});

describe("2D tracer origin", () => {
  const shot = (by: string, from: [number, number], to: [number, number]): ShotEvent =>
    ({ by, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, hit: null }) as ShotEvent;
  const sheets = (): SpriteTextures => ({
    operator: sheetFrames(new TextureSource({ width: 768, height: 768 })),
    enemy: sheetFrames(new TextureSource({ width: 768, height: 768 })),
  });
  /** The world gun tip of the one visible sprite at (x, y) whose texture is `frames[cell]`. */
  const drawnTip = (layer: SpriteLayer, frames: readonly Texture[], tips: readonly MuzzleOffset[], x: number, y: number) => {
    const s = layer.container.children.find((c) => c.visible && c.position.x === x && c.position.y === y) as Sprite;
    const cell = frames.indexOf(s.texture);
    expect(cell).toBeGreaterThanOrEqual(0);
    return { cell, tip: spriteTipPoint(s.position.x, s.position.y, s.rotation, s.scale.x, tips[cell]!) };
  };

  it("starts the clutcher's tracer at the gun tip of its sprite as drawn, standing and walking", () => {
    const tex = sheets();
    const layer = new SpriteLayer(tex);
    const out = { x: 0, y: 0 };
    // Standing, aiming up-right: idle cell, tip rotated with the sprite.
    const still = { player: { x: 1000, y: 1000, aim: { x: 3000, y: -1000 } }, enemies: [], downs: [], spike: null, tracers: [] };
    layer.update(still, 0, false);
    layer.update(still, 16, false);
    const a = drawnTip(layer, tex.operator, MUZZLE_SHEET_CELLS_PX.player, 1000, 1000);
    expect(a.cell).toBe(0);
    const s = layer.tracerStart(shot("P0", [1000, 1000], [3000, -1000]), out);
    expect(s.x).toBeCloseTo(a.tip.x, 6);
    expect(s.y).toBeCloseTo(a.tip.y, 6);
    // Walking: a walk cell with its own tip, even when the aim differs from the shot direction.
    for (let i = 1; i <= 20; i++) {
      layer.update({ ...still, player: { x: 1000 + i * 8, y: 1000, aim: { x: 1000 + i * 8, y: 3000 } } }, 16 + i * 16, false);
    }
    const b = drawnTip(layer, tex.operator, MUZZLE_SHEET_CELLS_PX.player, 1160, 1000);
    expect(b.cell).toBeGreaterThan(0);
    const t = layer.tracerStart(shot("P0", [1160, 1000], [3160, 1300]), out);
    expect(t.x).toBeCloseTo(b.tip.x, 6);
    expect(t.y).toBeCloseTo(b.tip.y, 6);
  });

  it("matches an enemy's shot to the nearest drawn enemy, else uses the shot-frame tip", () => {
    const tex = sheets();
    const layer = new SpriteLayer(tex);
    const enemies = [
      { x: 0, y: 0, fx: 1, fy: 0, z: 0 },
      { x: 2000, y: 0, fx: 0, fy: 1, z: 1 },
    ];
    layer.update({ player: null, enemies, downs: [], spike: null, tracers: [] }, 0, false);
    const e = drawnTip(layer, tex.enemy, MUZZLE_SHEET_CELLS_PX.enemy, 2000, 0);
    const out = { x: 0, y: 0 };
    const s = layer.tracerStart(shot("E1", [2010, 0], [2000, 3000]), out);
    expect(s.x).toBeCloseTo(e.tip.x, 6);
    expect(s.y).toBeCloseTo(e.tip.y, 6);
    // No drawn enemy near the origin (fogged): the shot-frame idle tip.
    const far = shot("E3", [9000, 9000], [9000, 12000]);
    expect(layer.tracerStart(far, out)).toEqual(muzzlePoint(far.from, far.to, layer.muzzles.enemy));
    // Point blank: shrinks along the shot instead of starting past the target.
    const near = shot("E1", [2000, 0], [2000, 100]);
    expect(layer.tracerStart(near, out)).toEqual(muzzlePoint(near.from, near.to, layer.muzzles.enemy));
  });
});
