import { describe, expect, it } from "vitest";
import { initialTier, lowerTier, parseQuality, pixelRatioFor, QUALITY } from "../src/render/quality";

describe("quality tiers", () => {
  it("has the tier table", () => {
    expect(QUALITY).toEqual({
      high: { maxPixelRatio: 2, antialias: true, shadows: true },
      medium: { maxPixelRatio: 1.5, antialias: true, shadows: false },
      low: { maxPixelRatio: 1, antialias: false, shadows: false },
    });
  });

  it("parses ?quality=high|medium|low and nothing else", () => {
    expect(parseQuality("?quality=high")).toBe("high");
    expect(parseQuality("?3d=1&quality=medium")).toBe("medium");
    expect(parseQuality("?quality=low&auto")).toBe("low");
    expect(parseQuality("")).toBeNull();
    expect(parseQuality("?quality")).toBeNull();
    expect(parseQuality("?quality=ultra")).toBeNull();
    expect(parseQuality("?quality=HIGH")).toBeNull();
  });

  it("starts on the requested tier, otherwise high", () => {
    expect(initialTier("?quality=low")).toBe("low");
    expect(initialTier("?quality=bogus")).toBe("high");
    expect(initialTier("")).toBe("high");
  });

  it("starts coarse pointers at medium unless ?quality= is given", () => {
    expect(initialTier("", { coarse: true })).toBe("medium");
    expect(initialTier("", { coarse: false })).toBe("high");
    expect(initialTier("", {})).toBe("high");
    expect(initialTier("?quality=high", { coarse: true })).toBe("high");
    expect(initialTier("?quality=low", { coarse: true })).toBe("low");
    expect(initialTier("?quality=medium", { coarse: false })).toBe("medium");
    expect(initialTier("?quality=bogus", { coarse: true })).toBe("medium");
  });

  it("steps high -> medium -> low -> null", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBeNull();
  });

  it("caps the device pixel ratio per tier (same [1, 2] clamp as 2D)", () => {
    const table = [1, 1.5, 2, 3].map((dpr) => [dpr, pixelRatioFor("high", dpr), pixelRatioFor("medium", dpr), pixelRatioFor("low", dpr)]);
    expect(table).toEqual([
      [1, 1, 1, 1],
      [1.5, 1.5, 1.5, 1],
      [2, 2, 1.5, 1],
      [3, 2, 1.5, 1],
    ]);
    expect(pixelRatioFor("high", undefined)).toBe(1);
    expect(pixelRatioFor("high", 0.5)).toBe(1);
  });
});
