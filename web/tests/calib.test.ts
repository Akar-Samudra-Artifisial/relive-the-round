import { describe, expect, it } from "vitest";
import { calibMetrics, type DensityRaster } from "../src/calib/metrics";
import { parseLevel } from "../src/level/loader";
import { KILN } from "../src/maps/kiln";

// Real haven levels + density raster are derived from licensed data and git-ignored (repo-root data/).
// When absent (CI, fresh clone) this suite is skipped.
const levelFiles = import.meta.glob<unknown>(["../../data/levels/haven/*.json", "!**/index.json"], {
  eager: true,
  import: "default",
});
const densityFiles = import.meta.glob<DensityRaster>("../../data/calib/haven-density.json", {
  eager: true,
  import: "default",
});

const levels = Object.values(levelFiles).map(parseLevel);
const density = Object.values(densityFiles)[0];

describe.skipIf(levels.length === 0)("Kiln calibration vs real haven levels", () => {
  it("meets walkable / snap / plant targets", () => {
    const m = calibMetrics(KILN, levels, density);
    console.info(
      `[calib] levels=${levels.length} samples=${m.samples} walkable=${(m.walkableShare * 100).toFixed(1)}% ` +
        `snapMedian=${m.snapMedianCm.toFixed(0)}cm snapP90=${m.snapP90Cm.toFixed(0)}cm ` +
        `plantsInSite=${(m.plantInSiteShare * 100).toFixed(1)}% (${m.plants}) ` +
        `densityWalkable=${m.densityWalkableShare === null ? "n/a" : (m.densityWalkableShare * 100).toFixed(1) + "%"}`,
    );
    expect(m.walkableShare).toBeGreaterThanOrEqual(0.9);
    expect(m.snapMedianCm).toBeLessThanOrEqual(150);
    expect(m.plantInSiteShare).toBeGreaterThanOrEqual(0.95);
  });
});
