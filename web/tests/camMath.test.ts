import { describe, expect, it } from "vitest";
import {
  type Bounds,
  CAMERA_FOV_DEG,
  CAMERA_PITCH_DEG,
  fitCamera,
  fromGround,
  groundPoint,
  ndcFromClient,
  project,
  toGround,
} from "../src/render/three3d/camMath";
import { nextFloat, seedRng } from "../src/sim/rng";

const MAP: Bounds = { minX: 0, minY: 0, maxX: 8000, maxY: 8000 };
const MARGIN = 0.04;
const ASPECTS = [16 / 9, 4 / 3, 1, 9 / 16];
const corners = (b: Bounds) => [
  { x: b.minX, y: b.minY },
  { x: b.maxX, y: b.minY },
  { x: b.maxX, y: b.maxY },
  { x: b.minX, y: b.maxY },
];

describe("camera math", () => {
  it("toGround / fromGround round-trip on the Y = 0 plane", () => {
    const p = { x: 1234.5, y: -678.25 };
    expect(toGround(p)).toEqual([1234.5, 0, -678.25]);
    expect(fromGround(toGround(p))).toEqual(p);
  });

  it.each(ASPECTS)("fitCamera is valid and tight at aspect %f", (aspect) => {
    const cam = fitCamera(MAP, aspect);
    expect(cam.fovDeg).toBe(CAMERA_FOV_DEG);
    expect(cam.aspect).toBe(aspect);
    let worst = 0;
    for (const c of corners(MAP)) {
      const p = project(cam, toGround(c));
      expect(p).not.toBeNull();
      expect(Math.abs(p!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(p!.x)).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
      expect(Math.abs(p!.y)).toBeLessThanOrEqual(1 - MARGIN + 1e-9);
      worst = Math.max(worst, Math.abs(p!.x), Math.abs(p!.y));
    }
    expect(Math.abs(worst - (1 - MARGIN))).toBeLessThan(0.02);
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.near).toBeLessThan(cam.far);
    for (const c of corners(MAP)) {
      const d = project(cam, toGround(c))!.depth;
      expect(d).toBeGreaterThan(cam.near);
      expect(d).toBeLessThan(cam.far);
    }
  });

  it("camera sits on the +Z side, above the ground, pitched by CAMERA_PITCH_DEG", () => {
    const cam = fitCamera(MAP, 16 / 9);
    expect(cam.target).toEqual([4000, 0, 4000]);
    expect(cam.position[2]).toBeGreaterThan(cam.target[2]);
    expect(cam.position[1]).toBeGreaterThan(0);
    expect(cam.position[0]).toBeCloseTo(cam.target[0], 9);
    const dy = cam.position[1] - cam.target[1];
    const dz = cam.position[2] - cam.target[2];
    expect((Math.atan2(dy, dz) * 180) / Math.PI).toBeCloseTo(CAMERA_PITCH_DEG, 9);
    expect(Math.hypot(dy, dz)).toBeCloseTo(cam.distance, 6);
  });

  it("keeps the 2D orientation: smaller world y is higher, larger world x is further right", () => {
    const cam = fitCamera(MAP, 4 / 3);
    const centre = project(cam, toGround({ x: 4000, y: 4000 }))!;
    const north = project(cam, toGround({ x: 4000, y: 2000 }))!;
    const east = project(cam, toGround({ x: 6000, y: 4000 }))!;
    expect(centre.x).toBeCloseTo(0, 9);
    expect(centre.y).toBeCloseTo(0, 9);
    expect(north.y).toBeGreaterThan(centre.y);
    expect(east.x).toBeGreaterThan(centre.x);
  });

  it("project -> groundPoint round-trips within 0.01 cm", () => {
    const cam = fitCamera(MAP, 16 / 9);
    const pts = [...corners(MAP), { x: 4000, y: 4000 }];
    let rng = seedRng(42);
    for (let i = 0; i < 50; i++) {
      let fx: number;
      let fy: number;
      [fx, rng] = nextFloat(rng);
      [fy, rng] = nextFloat(rng);
      pts.push({ x: fx * 8000, y: fy * 8000 });
    }
    for (const p of pts) {
      const ndc = project(cam, toGround(p))!;
      const back = groundPoint(cam, ndc.x, ndc.y);
      expect(back).not.toBeNull();
      expect(Math.abs(back!.x - p.x)).toBeLessThan(0.01);
      expect(Math.abs(back!.y - p.y)).toBeLessThan(0.01);
    }
  });

  it("groundPoint returns null for a ray above the horizon", () => {
    const cam = fitCamera(MAP, 16 / 9);
    // At 58 degrees of pitch the horizon is far above the screen top: ndcY = tan(pitch) / tan(fov / 2).
    const horizon = Math.tan((CAMERA_PITCH_DEG * Math.PI) / 180) / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
    expect(horizon).toBeGreaterThan(1.5);
    expect(groundPoint(cam, 0, horizon + 0.5)).toBeNull();
    expect(groundPoint(cam, 0, horizon - 0.5)).not.toBeNull();
    expect(groundPoint(cam, 0, 1.5)).not.toBeNull();
    expect(groundPoint(cam, 0, 0)).not.toBeNull();
  });

  it("ndcFromClient maps rect corners and centre", () => {
    const rect = { left: 10, top: 20, width: 800, height: 600 };
    expect(ndcFromClient(10, 20, rect)).toEqual({ x: -1, y: 1 });
    expect(ndcFromClient(810, 620, rect)).toEqual({ x: 1, y: -1 });
    expect(ndcFromClient(410, 320, rect)).toEqual({ x: 0, y: 0 });
  });

  it("fitCamera is deterministic", () => {
    for (const aspect of ASPECTS) expect(fitCamera(MAP, aspect)).toEqual(fitCamera(MAP, aspect));
  });
});
