import type { Level } from "../level/types";
import type { MapDef } from "../maps/types";
import { NAV_CELL, NAV_CLEARANCE, RUN_SPEED } from "./constants";
import type { Vec2 } from "./geom";
import { buildNavGrid, cellOf, reachableFrom, snap, type NavGrid } from "./nav";
import { buildRail, type Rail } from "./rail";
import { buildWarp, warpUV, type Warp } from "./warp";

/** Immutable per-level context derived once from map + level. */
export type World = {
  readonly map: MapDef;
  readonly nav: NavGrid;
  readonly warp: Warp;
  readonly level: Level;
  readonly enemyRails: readonly { readonly id: string; readonly rail: Rail }[];
  readonly clutcherRail: Rail;
  /** Spike position on the map (warped + snapped), when the level has a plant. */
  readonly spike: Vec2 | null;
};

export function buildWorld(map: MapDef, level: Level): World {
  if (map.sourceMap !== level.map) {
    throw new Error(`world: map ${map.id} stands in for ${map.sourceMap}, level ${level.id} uses ${level.map}`);
  }
  const nav = buildNavGrid(map, NAV_CELL, NAV_CLEARANCE);
  const warp = buildWarp(map.landmarks);
  const enemyRails = level.enemies.map((e) => ({
    id: e.id,
    rail: buildRail(e.samples, warp, nav, RUN_SPEED, e.diedT),
  }));
  const clutcherRail = buildRail(level.clutcher.samples, warp, nav, RUN_SPEED, level.clutcher.diedT);
  const { spike: s } = level;
  // The spike must sit on a walkable cell the clutcher can reach, or defusing (by either side)
  // would be impossible and bots would re-plan forever.
  const start = clutcherRail.keys[0]!;
  const reachable = reachableFrom(nav, cellOf(nav, snap(nav, start)));
  const spike = s.planted && s.u !== undefined && s.v !== undefined ? snap(nav, warpUV(warp, s.u, s.v), reachable) : null;
  return { map, nav, warp, level, enemyRails, clutcherRail, spike };
}
