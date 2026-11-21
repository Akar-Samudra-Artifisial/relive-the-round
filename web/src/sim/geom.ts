// Pure geometry helpers. Only IEEE-exact ops (+ - * / sqrt) to stay deterministic.

export type Vec2 = { readonly x: number; readonly y: number };
/** Flat polygon: [x0, y0, x1, y1, ...] in world units (cm). */
export type Polygon = readonly number[];

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointInPolygon(px: number, py: number, poly: Polygon): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i]!;
    const yi = poly[2 * i + 1]!;
    const xj = poly[2 * j]!;
    const yj = poly[2 * j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

export function distToPolygonEdge(px: number, py: number, poly: Polygon): number {
  let best = Infinity;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distToSegment(px, py, poly[2 * j]!, poly[2 * j + 1]!, poly[2 * i]!, poly[2 * i + 1]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Fraction f in [0, 1] of segment a→b where it first crosses a wall edge, or Infinity if it
 * crosses none. Parallel/collinear edges are ignored (walls are closed polygons, so a grazing
 * segment still hits an adjacent edge).
 */
export function firstWallHit(walls: readonly Polygon[], a: Vec2, b: Vec2): number {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  let best = Infinity;
  for (const poly of walls) {
    const n = poly.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const cx = poly[2 * j]!;
      const cy = poly[2 * j + 1]!;
      const sx = poly[2 * i]! - cx;
      const sy = poly[2 * i + 1]! - cy;
      const den = rx * sy - ry * sx;
      if (den === 0) continue;
      const qx = cx - a.x;
      const qy = cy - a.y;
      const t = (qx * sy - qy * sx) / den;
      const u = (qx * ry - qy * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return best;
}

/** True when the segment a→b crosses no wall edge (line of sight). */
export function segmentClear(walls: readonly Polygon[], a: Vec2, b: Vec2): boolean {
  return firstWallHit(walls, a, b) === Infinity;
}

export function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

export function polygonCentroid(poly: Polygon): Vec2 {
  let sx = 0;
  let sy = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    sx += poly[2 * i]!;
    sy += poly[2 * i + 1]!;
  }
  return { x: sx / n, y: sy / n };
}
