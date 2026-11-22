import { describe, expect, it } from "vitest";
import { angleDelta, downKey, FALL_MS, LEAN_MAX, MotionTracker, yawFromPosition } from "../src/render/actorMotion";
import { RUN_SPEED } from "../src/sim/constants";

/** Moves actor 0 along +x at `speed` cm/s for `frames` frames of 16 ms. */
function run(t: MotionTracker, speed: number, frames: number, reduced = false, start = 0) {
  let s = null as ReturnType<MotionTracker["actor"]> | null;
  for (let i = 0; i <= frames; i++) {
    const ms = start + i * 16;
    t.begin(ms, reduced);
    s = t.actor(0, (speed * ms) / 1000, 0);
    t.end();
  }
  return s!;
}

describe("angleDelta / yawFromPosition", () => {
  it("returns the shortest signed angle", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    expect(angleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2, 9);
    expect(angleDelta(0, Math.PI * 4)).toBeCloseTo(0, 9);
  });

  it("is deterministic and in [0, 2π)", () => {
    const a = yawFromPosition(1234, 5678);
    expect(yawFromPosition(1234, 5678)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    expect(yawFromPosition(4000, 500)).not.toBe(yawFromPosition(4200, 700));
  });
});

describe("MotionTracker", () => {
  it("is at rest for a standing actor", () => {
    const s = run(new MotionTracker(), 0, 30);
    expect(s.speed01).toBe(0);
    expect(s.bob).toBe(0);
    expect(s.lean).toBe(0);
  });

  it("reaches full speed, leans and bobs when running", () => {
    const t = new MotionTracker();
    const s = run(t, RUN_SPEED, 60);
    expect(s.speed01).toBeGreaterThan(0.95);
    expect(s.lean).toBeCloseTo(LEAN_MAX * s.speed01, 9);
    expect(s.heading).toBeCloseTo(0, 6);
    let maxBob = 0;
    for (let i = 61; i < 120; i++) {
      t.begin(i * 16, false);
      maxBob = Math.max(maxBob, t.actor(0, (RUN_SPEED * i * 16) / 1000, 0).bob);
      t.end();
    }
    expect(maxBob).toBeGreaterThan(0.8);
    expect(maxBob).toBeLessThanOrEqual(1);
  });

  it("turns toward the movement direction without a facing and snaps to a facing", () => {
    const t = new MotionTracker();
    for (let i = 0; i <= 40; i++) {
      t.begin(i * 16, false);
      t.actor(0, 0, (RUN_SPEED * i * 16) / 1000);
      t.end();
    }
    t.begin(41 * 16, false);
    const s = t.actor(0, 0, (RUN_SPEED * 41 * 16) / 1000);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 3);
    t.end();
    t.begin(42 * 16, false);
    expect(t.actor(0, 0, (RUN_SPEED * 42 * 16) / 1000, -1, 0).heading).toBeCloseTo(Math.PI, 9);
    t.end();
    // Standing still keeps the last heading.
    t.begin(43 * 16, false);
    expect(t.actor(0, 0, (RUN_SPEED * 42 * 16) / 1000).heading).toBeCloseTo(Math.PI, 9);
  });

  it("resets on a teleport instead of reporting a huge speed", () => {
    const t = new MotionTracker();
    run(t, RUN_SPEED, 40);
    t.begin(41 * 16, false);
    const s = t.actor(0, 50_000, 50_000);
    expect(s.speed01).toBe(0);
  });

  it("resets an actor that was not seen in the previous frame", () => {
    const t = new MotionTracker();
    run(t, RUN_SPEED, 40);
    t.begin(41 * 16, false);
    t.end(); // actor hidden for a frame
    t.begin(42 * 16, false);
    expect(t.actor(0, (RUN_SPEED * 42 * 16) / 1000, 0).speed01).toBe(0);
  });

  it("drops bob and lean with reduced motion", () => {
    const s = run(new MotionTracker(), RUN_SPEED, 60, true);
    expect(s.speed01).toBeGreaterThan(0.9);
    expect(s.bob).toBe(0);
    expect(s.lean).toBe(0);
  });

  it("falls over FALL_MS for a new down and is lying at once for downs on the first frame", () => {
    const t = new MotionTracker();
    t.begin(0, false);
    expect(t.fall(100, 100, "enemy").fallT).toBe(1);
    t.end();
    t.begin(16, false);
    t.fall(100, 100, "enemy");
    const d = t.fall(500, 500, "enemy");
    expect(d.fallT).toBe(0);
    expect(d.yaw).toBe(yawFromPosition(500, 500));
    t.end();
    t.begin(16 + FALL_MS / 2, false);
    expect(t.fall(500, 500, "enemy").fallT).toBeCloseTo(0.5, 9);
    t.end();
    t.begin(16 + FALL_MS * 2, false);
    expect(t.fall(500, 500, "enemy").fallT).toBe(1);
  });

  it("snaps a new down with reduced motion", () => {
    const t = new MotionTracker();
    t.begin(0, true);
    t.end();
    t.begin(16, true);
    expect(t.fall(500, 500, "enemy").fallT).toBe(1);
  });

  it("snaps downs present on the first real frame even after null frames", () => {
    const t = new MotionTracker();
    // A renderer clearing its scene before the first frame (update(null)).
    t.begin(0, false, false);
    t.end();
    t.begin(16, false, false);
    t.end();
    t.begin(32, false);
    expect(t.fall(100, 100, "enemy").fallT).toBe(1);
    t.end();
    // A down appearing on a later real frame still animates.
    t.begin(48, false);
    t.fall(100, 100, "enemy");
    expect(t.fall(700, 700, "player").fallT).toBe(0);
  });

  it("keeps separate fall progress for downs at the same position", () => {
    const t = new MotionTracker();
    t.begin(0, false);
    t.end();
    t.begin(16, false);
    const first = t.fall(500, 500, "enemy");
    expect(first.fallT).toBe(0);
    t.end();
    // Second down lands on the same spot half a fall later; the other side shares the spot too.
    t.begin(16 + FALL_MS / 2, false);
    const a = t.fall(500, 500, "enemy").fallT;
    const b = t.fall(500, 500, "enemy").fallT;
    const c = t.fall(500, 500, "player").fallT;
    expect(a).toBeCloseTo(0.5, 9);
    expect(b).toBe(0);
    expect(c).toBe(0);
    t.end();
    t.begin(16 + FALL_MS, false);
    expect(t.fall(500, 500, "enemy").fallT).toBe(1);
    expect(t.fall(500, 500, "enemy").fallT).toBeCloseTo(0.5, 9);
    expect(t.fall(500, 500, "player").fallT).toBeCloseTo(0.5, 9);
  });

  it("builds distinct down keys per side and duplicate index", () => {
    const keys = new Set([downKey(10, 20, "enemy"), downKey(10, 20, "player"), downKey(10, 20, "enemy", 1), downKey(10, 21, "enemy")]);
    expect(keys.size).toBe(4);
  });
});
