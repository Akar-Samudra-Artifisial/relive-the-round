import { describe, expect, it } from "vitest";
import { clientToCanvas, mapInput, MAX_RESOLUTION, renderResolution } from "../src/game/input";

describe("renderResolution", () => {
  it("follows devicePixelRatio, capped to [1, MAX_RESOLUTION]", () => {
    expect(renderResolution(1)).toBe(1);
    expect(renderResolution(1.5)).toBe(1.5);
    expect(renderResolution(3)).toBe(MAX_RESOLUTION);
    expect(renderResolution(0.5)).toBe(1);
    expect(renderResolution(undefined)).toBe(1);
    expect(renderResolution(Number.NaN)).toBe(1);
  });
});

describe("clientToCanvas", () => {
  const size = 480;
  it("is identity when the canvas is shown at its logical size", () => {
    expect(clientToCanvas(130, 70, { left: 10, top: 20, width: size }, size)).toEqual({ x: 120, y: 50 });
  });

  it("maps a CSS-shrunk canvas back to logical px, independent of the HiDPI backing size", () => {
    // 480 logical px shown 366 px wide on a phone; canvas.width would be 960 at resolution 2.
    const rect = { left: 12, top: 100, width: 366 };
    const p = clientToCanvas(12 + 183, 100 + 91.5, rect, size);
    expect(p.x).toBeCloseTo(240);
    expect(p.y).toBeCloseTo(120);
  });

  it("aims at the same world point whatever the resolution (logical px → world via scale)", () => {
    const scale = size / 8000;
    const p = clientToCanvas(12 + 366, 100 + 366, { left: 12, top: 100, width: 366 }, size);
    const input = mapInput({ keys: new Set(), aimPx: p, pointerDown: false }, scale);
    expect(input.aim.x).toBeCloseTo(8000);
    expect(input.aim.y).toBeCloseTo(8000);
  });
});
