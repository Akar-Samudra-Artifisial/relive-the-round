import { describe, expect, it } from "vitest";
import { calibMetrics, type DensityRaster } from "../src/calib/metrics";
import { parseLevel } from "../src/level/loader";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import type { MapName } from "../src/level/types";
import { mapFor } from "../src/maps";
import { CISTERN } from "../src/maps/cistern";
import { KILN } from "../src/maps/kiln";
import type { MapDef } from "../src/maps/types";
import { NAV_CELL, NAV_CLEARANCE } from "../src/sim/constants";
import { pointInPolygon, polygonCentroid } from "../src/sim/geom";
import { buildNavGrid, isWalkable } from "../src/sim/nav";
import { buildWarp, warpUV } from "../src/sim/warp";
import { buildWorld } from "../src/sim/world";

// Real levels + density rasters are derived from licensed data and git-ignored (repo-root data/).
// When absent (CI, fresh clone) the per-map suites are skipped.
const levelFiles = import.meta.glob<unknown>(["../../data/levels/*/*.json", "!**/index.json"], {
  eager: true,
  import: "default",
});
const densityFiles = import.meta.glob<DensityRaster>("../../data/calib/*-density.json", {
  eager: true,
  import: "default",
});

const allLevels = Object.values(levelFiles).map(parseLevel);

// minDensityWalkable: share of the real position-density raster that must warp onto floor.
// Kiln sits at 87.9% (kiln.ts is frozen with the golden sim hash), Cistern at 98.7%.
const MAPS: readonly { readonly source: MapName; readonly map: MapDef; readonly minDensityWalkable: number }[] = [
  { source: "haven", map: KILN, minDensityWalkable: 0.85 },
  { source: "lotus", map: CISTERN, minDensityWalkable: 0.95 },
];

for (const { source, map, minDensityWalkable } of MAPS) {
  const levels = allLevels.filter((l) => l.map === source);
  const density = Object.entries(densityFiles).find(([path]) => path.endsWith(`/${source}-density.json`))?.[1];
  const noLevels = levels.length === 0;

  describe.skipIf(noLevels)(`${map.name} calibration vs real ${source} levels${noLevels ? " [SKIPPED: needs data/levels/]" : ""}`, () => {
    it.skipIf(!density)(`density raster lands on floor (≥${minDensityWalkable * 100}%)${density ? "" : " [SKIPPED: needs data/calib/]"}`, () => {
      const m = calibMetrics(map, levels, density);
      expect(m.densityWalkableShare).not.toBeNull();
      expect(m.densityWalkableShare!).toBeGreaterThanOrEqual(minDensityWalkable);
    });

    it("meets walkable / snap / plant targets", () => {
      const m = calibMetrics(map, levels, density);
      console.info(
        `[calib ${map.id}] levels=${levels.length} samples=${m.samples} walkable=${(m.walkableShare * 100).toFixed(1)}% ` +
          `snapMedian=${m.snapMedianCm.toFixed(0)}cm snapP90=${m.snapP90Cm.toFixed(0)}cm ` +
          `plantsInSite=${(m.plantInSiteShare * 100).toFixed(1)}% (${m.plants}) ` +
          `densityWalkable=${m.densityWalkableShare === null ? "n/a" : (m.densityWalkableShare * 100).toFixed(1) + "%"}`,
      );
      expect(m.walkableShare).toBeGreaterThanOrEqual(0.9);
      expect(m.snapMedianCm).toBeLessThanOrEqual(150);
      expect(m.plantInSiteShare).toBeGreaterThanOrEqual(0.95);
    });
  });
}

/** Share of the map bounds covered by walls, sampled on a 50 cm grid (overlapping walls count once). */
function wallCoverage(map: MapDef): number {
  const step = 50;
  let inside = 0;
  let total = 0;
  for (let y = step / 2; y < map.height; y += step) {
    for (let x = step / 2; x < map.width; x += step) {
      total++;
      if (map.walls.some((w) => pointInPolygon(x, y, w))) inside++;
    }
  }
  return inside / total;
}

describe("map geometry is not trivially walkable (data-independent)", () => {
  for (const { map } of MAPS) {
    it(`${map.name}: walls cover 10–60% of the bounds and there are ≥ 8 interior obstacles`, () => {
      const share = wallCoverage(map);
      expect(share).toBeGreaterThanOrEqual(0.1);
      expect(share).toBeLessThanOrEqual(0.6);
      // Outer frame = 4 walls; the rest are interior obstacles.
      expect(map.walls.length - 4).toBeGreaterThanOrEqual(8);
      // The nav grid really blocks interior obstacles.
      const nav = buildNavGrid(map, NAV_CELL, NAV_CLEARANCE);
      for (const w of map.walls.slice(4)) expect(isWalkable(nav, polygonCentroid(w))).toBe(false);
    });
  }
});

describe("Cistern landmarks (data-independent)", () => {
  const warp = buildWarp(CISTERN.landmarks);
  const nav = buildNavGrid(CISTERN, NAV_CELL, NAV_CLEARANCE);

  it("has 30–40 landmarks, each mapped exactly and (corners aside) onto walkable floor", () => {
    expect(CISTERN.landmarks.length).toBeGreaterThanOrEqual(30);
    expect(CISTERN.landmarks.length).toBeLessThanOrEqual(40);
    for (const l of CISTERN.landmarks) {
      const p = warpUV(warp, l.src[0], l.src[1]);
      expect(p.x, l.name).toBeCloseTo(l.dst[0], 6);
      expect(p.y, l.name).toBeCloseTo(l.dst[1], 6);
      if (!l.name.startsWith("corner-")) expect(isWalkable(nav, p), l.name).toBe(true);
    }
  });

  it("builds a world for the synthetic fixture re-tagged as lotus (debug page ?map=lotus)", () => {
    const w = buildWorld(mapFor("lotus"), { ...SYNTHETIC_1V3, map: "lotus" });
    expect(w.map.id).toBe("cistern");
    expect(w.clutcherRail.keys.every((k) => isWalkable(nav, k))).toBe(true);
  });

  it("has no folded triangles (source → Cistern is a left↔right reflection everywhere)", () => {
    const o = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
      (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
    for (const [i, j, k] of warp.triangles) {
      const [a, b, c] = [CISTERN.landmarks[i]!, CISTERN.landmarks[j]!, CISTERN.landmarks[k]!];
      expect(o(a.src, b.src, c.src) * o(a.dst, b.dst, c.dst), `${a.name}/${b.name}/${c.name}`).toBeLessThan(0);
    }
  });
});
