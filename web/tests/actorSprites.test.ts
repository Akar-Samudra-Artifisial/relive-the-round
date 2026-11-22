import { Texture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { destroySpriteTextures, isSheetSize, SHEET_GRID, sheetFrames } from "../src/render/actorSprites";

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
