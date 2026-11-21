import type { Polygon } from "../sim/geom";

export type SiteId = "A" | "B" | "C";

export type Landmark = {
  readonly name: string;
  /** Position in the calibrated source-minimap uv space (0..1) used by level JSON. */
  readonly src: readonly [number, number];
  /** Corresponding point on the original map (world units, cm). */
  readonly dst: readonly [number, number];
};

export type MapDef = {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Solid geometry: everything inside any polygon is not walkable. */
  readonly walls: readonly Polygon[];
  readonly sites: Readonly<Record<SiteId, Polygon>>;
  readonly spawns: { readonly attack: Polygon; readonly defense: Polygon };
  readonly landmarks: readonly Landmark[];
};
