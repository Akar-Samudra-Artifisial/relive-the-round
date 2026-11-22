import { describe, expect, it } from "vitest";
import type { FallSample, MotionSample } from "../src/render/actorMotion";
import { DOWN_ALPHA, DOWN_DARK, downPose, liftLevels, newPose, OPERATOR_SIZE, operatorSize, scaleColor, SHEET_OPERATOR_SIZE, SPRITE_BOB, SPRITE_CM_PER_PX, SPRITE_FLOOR, standingPose, WALK_MIN_SPEED, walkFrame } from "../src/render/spritePose";

const still: MotionSample = { heading: 1.2, speed01: 0, bob: 0, lean: 0, cycle: 0 };

describe("spritePose", () => {
  it("scales colour channels", () => {
    expect(scaleColor(0xffffff, 0.5)).toBe(0x808080);
    expect(scaleColor(0x22d3ee, 1)).toBe(0x22d3ee);
    expect(scaleColor(0x22d3ee, 0)).toBe(0);
  });

  it("places a standing sprite at the actor, rotated to the heading", () => {
    const out = newPose();
    const p = standingPose(out, 1000, 2000, still, 0x22d3ee);
    expect(p).toBe(out);
    expect(p).toMatchObject({ x: 1000, y: 2000, rotation: 1.2, tint: 0x22d3ee, alpha: 1 });
    expect(p.scale).toBeCloseTo(SPRITE_CM_PER_PX, 9);
  });

  it("bobs the scale ±SPRITE_BOB at a full run", () => {
    const out = newPose();
    const low = standingPose(out, 0, 0, { heading: 0, speed01: 1, bob: 0, lean: 0, cycle: 0 }, 0).scale;
    const high = standingPose(out, 0, 0, { heading: 0, speed01: 1, bob: 1, lean: 0, cycle: 0 }, 0).scale;
    expect(low).toBeCloseTo(SPRITE_CM_PER_PX * (1 - SPRITE_BOB), 9);
    expect(high).toBeCloseTo(SPRITE_CM_PER_PX * (1 + SPRITE_BOB), 9);
  });

  it("fades and darkens a down over the fall", () => {
    const out = newPose();
    const start: FallSample = { fallT: 0, yaw: 2 };
    expect(downPose(out, 5, 6, start, 0xffffff)).toMatchObject({ x: 5, y: 6, rotation: 2, alpha: 1, tint: 0xffffff });
    const end = downPose(out, 5, 6, { fallT: 1, yaw: 2 }, 0xffffff);
    expect(end.alpha).toBeCloseTo(DOWN_ALPHA, 9);
    expect(end.tint).toBe(scaleColor(0xffffff, DOWN_DARK));
  });

  it("applies a size multiplier to standing and downed poses", () => {
    const out = newPose();
    expect(standingPose(out, 0, 0, still, 0, 1.5).scale).toBeCloseTo(SPRITE_CM_PER_PX * 1.5, 9);
    expect(downPose(out, 0, 0, { fallT: 1, yaw: 0 }, 0, 1.5).scale).toBeCloseTo(SPRITE_CM_PER_PX * 1.5, 9);
  });

  it("lifts grey levels of opaque pixels to floor..1 and skips transparent ones", () => {
    // dark, mid, bright opaque pixels and one transparent pixel
    const px = new Uint8ClampedArray([20, 20, 20, 255, 60, 60, 60, 255, 100, 100, 100, 128, 0, 0, 0, 0]);
    liftLevels(px, 0.5);
    expect(px[0]).toBe(128); // darkest -> floor
    expect(px[4]).toBe(Math.round(255 * 0.75)); // midpoint
    expect(px[8]).toBe(255); // brightest -> white
    expect(px[11]).toBe(128); // alpha untouched
    expect([...px.slice(12)]).toEqual([0, 0, 0, 0]);
  });

  it("leaves a fully transparent image unchanged", () => {
    const px = new Uint8ClampedArray([10, 20, 30, 0]);
    liftLevels(px, SPRITE_FLOOR);
    expect([...px]).toEqual([10, 20, 30, 0]);
  });
});

describe("operatorSize", () => {
  it("keeps the static-sprite emphasis and uses the smaller one for a walk sheet", () => {
    expect(operatorSize(1)).toBe(OPERATOR_SIZE);
    expect(operatorSize(9)).toBe(SHEET_OPERATOR_SIZE);
    expect(SHEET_OPERATOR_SIZE).toBeLessThan(OPERATOR_SIZE);
  });
});

describe("walkFrame", () => {
  it("is the idle cell below the walk speed or without walk cells", () => {
    expect(walkFrame(0.5, 0, 8)).toBe(0);
    expect(walkFrame(0.5, WALK_MIN_SPEED / 2, 8)).toBe(0);
    expect(walkFrame(0.5, 1, 0)).toBe(0);
  });

  it("maps the cycle to cells 1..n", () => {
    expect(walkFrame(0, 1, 8)).toBe(1);
    expect(walkFrame(0.124, 0.5, 8)).toBe(1);
    expect(walkFrame(0.125, 0.5, 8)).toBe(2);
    expect(walkFrame(0.999, 1, 8)).toBe(8);
    expect(walkFrame(1, 1, 8)).toBe(8);
  });

  it("drives the standing pose frame and turns the scale bob off with a sheet", () => {
    const out = newPose();
    const m = { heading: 0, speed01: 1, bob: 1, lean: 0, cycle: 0.5 };
    const sheet = standingPose(out, 0, 0, m, 0, 1, 8);
    expect(sheet.frame).toBe(5);
    expect(sheet.scale).toBeCloseTo(SPRITE_CM_PER_PX, 9);
    const plain = standingPose(out, 0, 0, m, 0);
    expect(plain.frame).toBe(0);
    expect(plain.scale).toBeCloseTo(SPRITE_CM_PER_PX * (1 + SPRITE_BOB), 9);
    standingPose(out, 0, 0, m, 0, 1, 8);
    expect(downPose(out, 0, 0, { fallT: 1, yaw: 0 }, 0).frame).toBe(0);
  });
});
