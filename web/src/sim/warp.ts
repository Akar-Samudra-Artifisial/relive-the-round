import type { Landmark } from "../maps/types";
import type { Vec2 } from "./geom";

/**
 * Piecewise-affine warp from source-minimap uv (0..1) to original-map world coords.
 * Landmarks are Delaunay-triangulated in uv space; each triangle maps affinely onto
 * the triangle formed by the landmarks' targets, so landmarks map exactly.
 */
export type Warp = {
  readonly landmarks: readonly Landmark[];
  /** Triangles as landmark index triples. */
  readonly triangles: readonly (readonly [number, number, number])[];
};

type Tri = [number, number, number];

function circumcircleContains(pts: readonly Vec2[], t: Tri, p: Vec2): boolean {
  const a = pts[t[0]]!;
  const b = pts[t[1]]!;
  const c = pts[t[2]]!;
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return orient > 0 ? det > 0 : det < 0;
}

/** Bowyer–Watson Delaunay triangulation. Returns index triples into `points`. */
export function delaunay(points: readonly Vec2[]): Tri[] {
  const n = points.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20 + 1;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const pts: Vec2[] = [...points, { x: mx - d, y: my - d }, { x: mx + d, y: my - d }, { x: mx, y: my + d }];
  let tris: Tri[] = [[n, n + 1, n + 2]];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) (circumcircleContains(pts, t, p) ? bad : keep).push(t);
    const edges: [number, number][] = [];
    for (const t of bad) {
      for (const [u, v] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ] as const) {
        const shared = bad.some(
          (o) => o !== t && (o.includes(u) && o.includes(v)),
        );
        if (!shared) edges.push([u, v]);
      }
    }
    tris = keep;
    for (const [u, v] of edges) tris.push([u, v, i]);
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

/** Minimum |2·area| of a source triangle in uv space; smaller means duplicate/collinear landmarks. */
const MIN_SRC_DEN = 1e-9;

export function buildWarp(landmarks: readonly Landmark[]): Warp {
  if (landmarks.length < 3) throw new Error(`warp: need >= 3 landmarks, got ${landmarks.length}`);
  const pts = landmarks.map((l) => ({ x: l.src[0], y: l.src[1] }));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i]!.x - pts[j]!.x;
      const dy = pts[i]!.y - pts[j]!.y;
      if (dx * dx + dy * dy < MIN_SRC_DEN) {
        throw new Error(`warp: landmarks '${landmarks[i]!.name}' and '${landmarks[j]!.name}' share the same src uv`);
      }
    }
  }
  const triangles = delaunay(pts);
  if (triangles.length === 0) throw new Error("warp: all landmarks are collinear in src uv; no triangle can be formed");
  for (const [i, j, k] of triangles) {
    const a = pts[i]!;
    const b = pts[j]!;
    const c = pts[k]!;
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < MIN_SRC_DEN) {
      throw new Error(
        `warp: landmarks '${landmarks[i]!.name}', '${landmarks[j]!.name}', '${landmarks[k]!.name}' are collinear in src uv (den=${den})`,
      );
    }
  }
  return { landmarks, triangles };
}

function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] {
  const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den;
  const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
  return [l1, l2, 1 - l1 - l2];
}

/** Map uv → world. Points outside the triangulated hull use the triangle with the least-negative barycentric weight. */
export function warpUV(w: Warp, u: number, v: number): Vec2 {
  const p = { x: u, y: v };
  let bestTri = w.triangles[0]!;
  let bestBary: [number, number, number] = [1, 0, 0];
  let bestScore = -Infinity;
  for (const t of w.triangles) {
    const [i, j, k] = t;
    const bary = barycentric(p, srcOf(w, i), srcOf(w, j), srcOf(w, k));
    const score = Math.min(bary[0], bary[1], bary[2]);
    if (score > bestScore) {
      bestScore = score;
      bestTri = t;
      bestBary = bary;
    }
    if (score >= 0) break;
  }
  const a = w.landmarks[bestTri[0]]!.dst;
  const b = w.landmarks[bestTri[1]]!.dst;
  const c = w.landmarks[bestTri[2]]!.dst;
  return {
    x: bestBary[0] * a[0] + bestBary[1] * b[0] + bestBary[2] * c[0],
    y: bestBary[0] * a[1] + bestBary[1] * b[1] + bestBary[2] * c[1],
  };
}

function srcOf(w: Warp, i: number): Vec2 {
  const s = w.landmarks[i]!.src;
  return { x: s[0], y: s[1] };
}
