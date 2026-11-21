import type { Level } from "../level/types";
import type { MapDef } from "../maps/types";
import { NAV_CELL, NAV_CLEARANCE } from "../sim/constants";
import { dist, pointInPolygon } from "../sim/geom";
import { buildNavGrid, isWalkable, snap } from "../sim/nav";
import { buildWarp, warpUV } from "../sim/warp";

/** Calibration quality of a map's landmarks against real level samples (and optionally a density raster). */
export type CalibMetrics = {
  readonly samples: number;
  /** Share of warped samples that land on a walkable nav cell before snapping (0..1). */
  readonly walkableShare: number;
  readonly snapMedianCm: number;
  readonly snapP90Cm: number;
  readonly plants: number;
  /** Share of planted spikes whose warped position lies inside the recorded site polygon (0..1). */
  readonly plantInSiteShare: number;
  /** Density-weighted walkable share of raster cell centres, when a raster is given (0..1). */
  readonly densityWalkableShare: number | null;
};

/** counts[row][col], row = floor(v*size), col = floor(u*size). */
export type DensityRaster = { readonly size: number; readonly counts: readonly (readonly number[])[] };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

export function calibMetrics(map: MapDef, levels: readonly Level[], density?: DensityRaster): CalibMetrics {
  const nav = buildNavGrid(map, NAV_CELL, NAV_CLEARANCE);
  const warp = buildWarp(map.landmarks);
  const snaps: number[] = [];
  let walkable = 0;
  let plants = 0;
  let plantsIn = 0;
  for (const level of levels) {
    for (const actor of [level.clutcher, ...level.enemies]) {
      for (const s of actor.samples) {
        const p = warpUV(warp, s.u, s.v);
        if (isWalkable(nav, p)) walkable++;
        snaps.push(dist(p, snap(nav, p)));
      }
    }
    const sp = level.spike;
    if (sp.planted && sp.site !== undefined && sp.u !== undefined && sp.v !== undefined) {
      plants++;
      const p = warpUV(warp, sp.u, sp.v);
      if (pointInPolygon(p.x, p.y, map.sites[sp.site])) plantsIn++;
    }
  }
  snaps.sort((a, b) => a - b);

  let densityWalkableShare: number | null = null;
  if (density) {
    let total = 0;
    let ok = 0;
    for (let row = 0; row < density.size; row++) {
      for (let col = 0; col < density.size; col++) {
        const c = density.counts[row]?.[col] ?? 0;
        if (c <= 0) continue;
        total += c;
        if (isWalkable(nav, warpUV(warp, (col + 0.5) / density.size, (row + 0.5) / density.size))) ok += c;
      }
    }
    densityWalkableShare = total > 0 ? ok / total : null;
  }

  return {
    samples: snaps.length,
    walkableShare: snaps.length > 0 ? walkable / snaps.length : 0,
    snapMedianCm: quantile(snaps, 0.5),
    snapP90Cm: quantile(snaps, 0.9),
    plants,
    plantInSiteShare: plants > 0 ? plantsIn / plants : 0,
    densityWalkableShare,
  };
}
