import { afterEach, describe, expect, it, vi } from "vitest";
import featuredJson from "../src/game/featured.json";
import { FEATURED, MAX_FEATURED, loadFeatured, parseFeatured } from "../src/game/levels";

const CISTERN_PICKS = ["1273a6914b4e", "90163e309394", "edc320bb8210"];

describe("featured.json", () => {
  it("lists 3 haven + 3 lotus levels within the public cap", () => {
    expect(FEATURED.length).toBeLessThanOrEqual(MAX_FEATURED);
    expect(FEATURED.filter((f) => f.map === "haven")).toHaveLength(3);
    expect(FEATURED.filter((f) => f.map === "lotus").map((f) => f.id)).toEqual(CISTERN_PICKS);
  });

  it("rejects malformed playlists", () => {
    const one = featuredJson[0]!;
    expect(() => parseFeatured(Array.from({ length: MAX_FEATURED + 1 }, () => one))).toThrow(/1\.\.6/);
    expect(() => parseFeatured([{ ...one, file: "../calib/x.json" }])).toThrow(/file/);
    expect(() => parseFeatured([{ ...one, map: "ascent" }])).toThrow(/map/);
    expect(() => parseFeatured([one, one])).toThrow(/duplicate/);
  });
});

describe("loadFeatured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const f = FEATURED[0]!;

  it("falls back to the synthetic fixture in dev when the level is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const l = await loadFeatured(f);
    expect(l.synthetic).toBe(true);
  });

  it("re-tags the fixture per slot: lotus slots play on Cistern, ids stay unique", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const all = await Promise.all(FEATURED.map(loadFeatured));
    for (const l of all) {
      expect(l.level.map).toBe(l.featured.map);
      expect(l.level.id).toBe(`synthetic-${l.featured.id}`);
    }
    expect(new Set(all.map((l) => l.level.id)).size).toBe(all.length);
  });

  it("throws instead of falling back when VITE_REQUIRE_LEVELS=1", async () => {
    vi.stubEnv("VITE_REQUIRE_LEVELS", "1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(loadFeatured(f)).rejects.toThrow(/HTTP 404/);
  });
});
