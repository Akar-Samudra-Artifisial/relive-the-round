import type { MapDef } from "../maps/types";
import { distToPolygonEdge, pointInPolygon, type Polygon, type Vec2 } from "./geom";

/** Uniform walkability grid derived from map wall polygons. */
export type NavGrid = {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** 1 = walkable. Index = row * cols + col. */
  readonly walkable: Uint8Array;
};

function blocked(px: number, py: number, walls: readonly Polygon[], clearance: number, w: number, h: number): boolean {
  if (px < clearance || py < clearance || px > w - clearance || py > h - clearance) return true;
  for (const poly of walls) {
    if (pointInPolygon(px, py, poly)) return true;
    if (distToPolygonEdge(px, py, poly) < clearance) return true;
  }
  return false;
}

export function buildNavGrid(map: MapDef, cell: number, clearance: number): NavGrid {
  const minClearance = (cell * Math.SQRT2) / 2 + cell / 16;
  if (clearance < minClearance) {
    throw new Error(`nav: clearance ${clearance} must be >= ${minClearance} for cell ${cell}`);
  }
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const walkable = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cell;
      const cy = (r + 0.5) * cell;
      walkable[r * cols + c] = blocked(cx, cy, map.walls, clearance, map.width, map.height) ? 0 : 1;
    }
  }
  return { cell, cols, rows, walkable };
}

export function cellOf(g: NavGrid, p: Vec2): number {
  const c = Math.floor(p.x / g.cell);
  const r = Math.floor(p.y / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function cellCenter(g: NavGrid, idx: number): Vec2 {
  const c = idx % g.cols;
  const r = (idx - c) / g.cols;
  return { x: (c + 0.5) * g.cell, y: (r + 0.5) * g.cell };
}

export function isWalkable(g: NavGrid, p: Vec2): boolean {
  const i = cellOf(g, p);
  return i >= 0 && g.walkable[i] === 1;
}

/**
 * Cells reachable from `start` (1 = reachable). 4-connected flood fill, which matches the
 * 8-connected A* below because it forbids corner cutting.
 */
export function reachableFrom(g: NavGrid, start: number): Uint8Array {
  const seen = new Uint8Array(g.cols * g.rows);
  if (start < 0 || g.walkable[start] !== 1) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const c = cur % g.cols;
    const r = (cur - c) / g.cols;
    const next = [c > 0 ? cur - 1 : -1, c < g.cols - 1 ? cur + 1 : -1, r > 0 ? cur - g.cols : -1, r < g.rows - 1 ? cur + g.cols : -1];
    for (const n of next) {
      if (n < 0 || seen[n] === 1 || g.walkable[n] !== 1) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

/**
 * Nearest walkable cell center (ties → lowest index), optionally restricted to cells marked 1 in
 * `allowed` (e.g. `reachableFrom`). Throws if no cell qualifies.
 */
export function snap(g: NavGrid, p: Vec2, allowed?: Uint8Array): Vec2 {
  const pc = Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell)));
  const pr = Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cell)));
  const maxRing = Math.max(g.cols, g.rows);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let r = pr - ring; r <= pr + ring; r++) {
      if (r < 0 || r >= g.rows) continue;
      for (let c = pc - ring; c <= pc + ring; c++) {
        if (c < 0 || c >= g.cols) continue;
        if (Math.abs(r - pr) !== ring && Math.abs(c - pc) !== ring) continue;
        const idx = r * g.cols + c;
        if (g.walkable[idx] !== 1 || (allowed && allowed[idx] !== 1)) continue;
        const ctr = cellCenter(g, idx);
        const dx = ctr.x - p.x;
        const dy = ctr.y - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && idx < best)) {
          bestD = d;
          best = idx;
        }
      }
    }
    // Any cell in a further ring is at least (ring) cells away; stop once that exceeds best.
    if (best >= 0 && ring * g.cell > Math.sqrt(bestD) + g.cell) break;
  }
  if (best < 0) throw new Error(allowed ? "nav: no allowed walkable cell" : "nav: grid has no walkable cell");
  return cellCenter(g, best);
}

/**
 * Straight segment stays within walkable cells (sampled at 1/8-cell steps). With
 * clearance ≥ half-diagonal + cell/16, unsampled points between samples are still outside walls.
 */
export function lineWalkable(g: NavGrid, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len / (g.cell / 8)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(g, { x: a.x + dx * t, y: a.y + dy * t })) return false;
  }
  return true;
}

// Binary min-heap keyed by f, tie-broken by node index for determinism.
class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  private less(i: number, j: number): boolean {
    const fi = this.fs[i]!;
    const fj = this.fs[j]!;
    return fi < fj || (fi === fj && this.ids[i]! < this.ids[j]!);
  }
  private swap(i: number, j: number): void {
    [this.ids[i], this.ids[j]] = [this.ids[j]!, this.ids[i]!];
    [this.fs[i], this.fs[j]] = [this.fs[j]!, this.fs[i]!];
  }
  push(id: number, f: number): void {
    this.ids.push(id);
    this.fs.push(f);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastF = this.fs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.fs[0] = lastF;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.less(l, m)) m = l;
        if (r < this.ids.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Grid A* (8-connected, no corner cutting) between cell indices. Returns cell indices or null. */
export function astarCells(g: NavGrid, start: number, goal: number): number[] | null {
  if (g.walkable[start] !== 1 || g.walkable[goal] !== 1) return null;
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % g.cols;
  const gr = (goal - gc) / g.cols;
  const h = (idx: number): number => {
    const c = idx % g.cols;
    const r = (idx - c) / g.cols;
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  gScore[start] = 0;
  open.push(start, h(start));
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur] === 1) continue;
    if (cur === goal) {
      const path = [cur];
      let p = came[cur]!;
      while (p !== -1) {
        path.push(p);
        p = came[p]!;
      }
      return path.reverse();
    }
    closed[cur] = 1;
    const cc = cur % g.cols;
    const cr = (cur - cc) / g.cols;
    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ni = nr * g.cols + nc;
      if (g.walkable[ni] !== 1 || closed[ni] === 1) continue;
      if (dc !== 0 && dr !== 0) {
        if (g.walkable[cr * g.cols + nc] !== 1 || g.walkable[nr * g.cols + cc] !== 1) continue;
      }
      const tentative = gScore[cur]! + cost;
      if (tentative < gScore[ni]!) {
        gScore[ni] = tentative;
        came[ni] = cur;
        open.push(ni, tentative + h(ni));
      }
    }
  }
  return null;
}

/**
 * World-space path between two points (both snapped to walkable cells).
 * The grid path is string-pulled with line-of-sight checks. Returns null if unreachable.
 */
export function findPath(g: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const a = snap(g, from);
  const b = snap(g, to);
  const cells = astarCells(g, cellOf(g, a), cellOf(g, b));
  if (!cells) return null;
  const raw = cells.map((i) => cellCenter(g, i));
  const out: Vec2[] = [raw[0]!];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let next = anchor + 1;
    for (let k = raw.length - 1; k > anchor + 1; k--) {
      if (lineWalkable(g, raw[anchor]!, raw[k]!)) {
        next = k;
        break;
      }
    }
    out.push(raw[next]!);
    anchor = next;
  }
  return out;
}

export function pathLength(path: readonly Vec2[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i]!.x - path[i - 1]!.x;
    const dy = path[i]!.y - path[i - 1]!.y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}
