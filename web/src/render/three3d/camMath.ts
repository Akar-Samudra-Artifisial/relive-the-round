import type { Vec2 } from "../../sim/geom";

/**
 * Pure camera math for the 3D renderer (no renderer libs, no DOM).
 *
 * Coordinate convention:
 * - The ground is the plane Y = 0. World (x, y) maps to 3D (X = x, Y = 0, Z = y). 1 unit = 1 cm.
 * - The camera sits on the +Z side of the map centre, raised and pitched down, looking toward -Z.
 *   So screen-up = smaller world y and screen-right = larger world x, the same orientation as 2D.
 * - NDC x/y are in [-1, 1] with y up (WebGL style). `fovDeg` is the vertical field of view.
 */

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Vec3 = [number, number, number];
export type CameraFit = {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  aspect: number;
  near: number;
  far: number;
  distance: number;
};

export const CAMERA_FOV_DEG = 30;
/** Angle below the horizon. */
export const CAMERA_PITCH_DEG = 58;
const DEFAULT_MARGIN = 0.04;
const BISECT_STEPS = 64;
const MAX_DOUBLINGS = 64;

const DEG = Math.PI / 180;

export function toGround(p: Vec2): Vec3 {
  return [p.x, 0, p.y];
}

export function fromGround(v: Vec3): Vec2 {
  return { x: v[0], y: v[2] };
}

type Basis = { f: Vec3; r: Vec3; u: Vec3 };

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Camera basis from the eye and target: forward, right (no roll, Y up), up = right x forward. */
function basisOf(cam: CameraFit): Basis {
  const dx = cam.target[0] - cam.position[0];
  const dy = cam.target[1] - cam.position[1];
  const dz = cam.target[2] - cam.position[2];
  const len = Math.hypot(dx, dy, dz);
  const f: Vec3 = [dx / len, dy / len, dz / len];
  // right = forward x worldUp(0, 1, 0), normalised.
  const rx = -f[2];
  const rz = f[0];
  const rl = Math.hypot(rx, rz);
  const r: Vec3 = [rx / rl, 0, rz / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

function cameraAt(target: Vec3, pitch: number, distance: number, fovDeg: number, aspect: number): CameraFit {
  const f: Vec3 = [0, -Math.sin(pitch), -Math.cos(pitch)];
  return {
    position: [target[0] - f[0] * distance, target[1] - f[1] * distance, target[2] - f[2] * distance],
    target,
    fovDeg,
    aspect,
    near: distance / 100,
    far: distance * 4,
    distance,
  };
}

/**
 * Smallest camera distance at which all four ground corners of `bounds` land inside
 * NDC [-1 + margin, 1 - margin] on both axes. Doubling upper bound plus a fixed-step bisection,
 * so the result is deterministic and always valid (it returns the fitting end of the interval).
 */
export function fitCamera(
  bounds: Bounds,
  aspect: number,
  opts: { fovDeg?: number; pitchDeg?: number; margin?: number } = {},
): CameraFit {
  const fovDeg = opts.fovDeg ?? CAMERA_FOV_DEG;
  const pitch = (opts.pitchDeg ?? CAMERA_PITCH_DEG) * DEG;
  const limit = 1 - (opts.margin ?? DEFAULT_MARGIN);
  const target: Vec3 = [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minY + bounds.maxY) / 2];
  const corners: Vec3[] = [
    [bounds.minX, 0, bounds.minY],
    [bounds.maxX, 0, bounds.minY],
    [bounds.maxX, 0, bounds.maxY],
    [bounds.minX, 0, bounds.maxY],
  ];
  const fitness = (d: number): number => {
    const cam = cameraAt(target, pitch, d, fovDeg, aspect);
    let worst = 0;
    for (const c of corners) {
      const p = project(cam, c);
      if (!p) return Infinity;
      worst = Math.max(worst, Math.abs(p.x) / limit, Math.abs(p.y) / limit);
    }
    return worst;
  };

  let hi = Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  for (let i = 0; i < MAX_DOUBLINGS && fitness(hi) > 1; i++) hi *= 2;
  let lo = 0;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (fitness(mid) <= 1) hi = mid;
    else lo = mid;
  }
  return cameraAt(target, pitch, hi, fovDeg, aspect);
}

/** NDC x/y (y up) and view-space depth along the forward axis in cm; null if behind the camera. */
export function project(cam: CameraFit, p: Vec3): { x: number; y: number; depth: number } | null {
  const { f, r, u } = basisOf(cam);
  const v: Vec3 = [p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]];
  const depth = dot(v, f);
  if (!(depth > 0)) return null;
  const t = Math.tan((cam.fovDeg * DEG) / 2);
  return { x: dot(v, r) / (depth * t * cam.aspect), y: dot(v, u) / (depth * t), depth };
}

/** Ray from the camera through an NDC point, intersected with Y = 0; null if it never hits the ground. */
export function groundPoint(cam: CameraFit, ndcX: number, ndcY: number): Vec2 | null {
  const { f, r, u } = basisOf(cam);
  const t = Math.tan((cam.fovDeg * DEG) / 2);
  const sx = ndcX * t * cam.aspect;
  const sy = ndcY * t;
  const dir: Vec3 = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
  if (!(dir[1] < 0)) return null;
  const s = -cam.position[1] / dir[1];
  if (!(s > 0)) return null;
  return fromGround([cam.position[0] + dir[0] * s, 0, cam.position[2] + dir[2] * s]);
}

/** CSS pixels to NDC for a plain rect (the caller passes the canvas bounding rect). */
export function ndcFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return { x: (2 * (clientX - rect.left)) / rect.width - 1, y: 1 - (2 * (clientY - rect.top)) / rect.height };
}
