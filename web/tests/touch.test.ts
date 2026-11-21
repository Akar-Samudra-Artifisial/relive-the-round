import { describe, expect, it } from "vitest";
import { mapInput } from "../src/game/input";
import {
  AIM_REACH,
  controlsHint,
  defuseAvailable,
  FIRE_THRESHOLD,
  goalText,
  nextTouchActive,
  STICK_DEAD_ZONE,
  stickAim,
  stickVector,
  touchFire,
} from "../src/game/touch";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import type { Level } from "../src/level/types";
import { KILN } from "../src/maps/kiln";
import { DEFUSE_RADIUS } from "../src/sim/constants";
import { initState, type SimState } from "../src/sim/sim";
import { buildWorld } from "../src/sim/world";

const len = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

describe("stickVector", () => {
  it("reads zero inside the dead zone", () => {
    expect(stickVector(0, 0, 50)).toEqual({ x: 0, y: 0 });
    expect(stickVector(50 * STICK_DEAD_ZONE * 0.9, 0, 50)).toEqual({ x: 0, y: 0 });
  });

  it("reaches unit length at the radius and clamps beyond it", () => {
    expect(len(stickVector(50, 0, 50))).toBeCloseTo(1, 9);
    expect(stickVector(0, -50, 50).y).toBeCloseTo(-1, 9);
    const far = stickVector(300, 400, 50);
    expect(len(far)).toBeCloseTo(1, 9);
    expect(far.x / far.y).toBeCloseTo(0.75, 9);
  });

  it("keeps diagonals inside the unit circle", () => {
    const d = stickVector(50, 50, 50);
    expect(len(d)).toBeLessThanOrEqual(1 + 1e-12);
    expect(d.x).toBeCloseTo(d.y, 12);
  });

  it("rescales so movement starts near zero just outside the dead zone", () => {
    const v = stickVector(50 * (STICK_DEAD_ZONE + 0.01), 0, 50);
    expect(v.x).toBeGreaterThan(0);
    expect(v.x).toBeLessThan(0.05);
    expect(stickVector(25, 0, 50).x).toBeCloseTo((0.5 - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE), 9);
  });

  it("handles a degenerate radius", () => {
    expect(stickVector(10, 10, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("stickAim", () => {
  it("projects a unit direction from the player by the reach", () => {
    expect(AIM_REACH).toBeGreaterThan(0);
    expect(FIRE_THRESHOLD).toBeGreaterThan(STICK_DEAD_ZONE);
    const p = stickAim({ x: 100, y: 200 }, { x: 3, y: 4 });
    expect(p.x).toBeCloseTo(100 + 0.6 * AIM_REACH, 9);
    expect(p.y).toBeCloseTo(200 + 0.8 * AIM_REACH, 9);
    expect(stickAim({ x: 0, y: 0 }, { x: 0, y: -0.2 }, 500)).toEqual({ x: 0, y: -500 });
  });
});

describe("touchFire", () => {
  it("fires past the threshold only while DEFUSE is not held", () => {
    expect(touchFire({ x: 0, y: -1 }, false)).toBe(true);
    expect(touchFire({ x: FIRE_THRESHOLD * 0.9, y: 0 }, false)).toBe(false);
    expect(touchFire({ x: 0, y: -1 }, true)).toBe(false);
  });

  it("keeps keyboard and mouse fire while DEFUSE is held", () => {
    const touch = { fire: touchFire({ x: 1, y: 0 }, true), use: true };
    const base = { keys: new Set<string>(), aimPx: { x: 0, y: 0 }, pointerDown: false, touch };
    expect(mapInput(base, 0.1)).toMatchObject({ fire: false, use: true });
    expect(mapInput({ ...base, keys: new Set(["Space"]) }, 0.1).fire).toBe(true);
    expect(mapInput({ ...base, pointerDown: true }, 0.1).fire).toBe(true);
  });
});

describe("mapInput with touch overrides", () => {
  const base = { keys: new Set<string>(), aimPx: { x: 30, y: 60 }, pointerDown: false };

  it("is unchanged without overrides", () => {
    expect(mapInput(base, 0.1)).toEqual({ move: { x: 0, y: 0 }, aim: { x: 300, y: 600 }, fire: false, use: false });
    expect(mapInput({ ...base, touch: {} }, 0.1)).toEqual(mapInput(base, 0.1));
  });

  it("uses touch move when no keys are held, keyboard wins otherwise", () => {
    const touch = { move: { x: 0.3, y: -0.4 } };
    expect(mapInput({ ...base, touch }, 0.1).move).toEqual({ x: 0.3, y: -0.4 });
    expect(mapInput({ ...base, keys: new Set(["KeyD"]), touch }, 0.1).move).toEqual({ x: 1, y: 0 });
    // Opposite keys cancel to zero, so touch takes over.
    expect(mapInput({ ...base, keys: new Set(["KeyA", "KeyD"]), touch }, 0.1).move).toEqual({ x: 0.3, y: -0.4 });
  });

  it("lets touch aim override the pointer aim", () => {
    expect(mapInput({ ...base, touch: { aim: { x: 1234, y: 567 } } }, 0.1).aim).toEqual({ x: 1234, y: 567 });
  });

  it("ORs fire and use", () => {
    expect(mapInput({ ...base, touch: { fire: true } }, 0.1).fire).toBe(true);
    expect(mapInput({ ...base, pointerDown: true, touch: { fire: false } }, 0.1).fire).toBe(true);
    expect(mapInput({ ...base, touch: { use: true } }, 0.1).use).toBe(true);
    expect(mapInput({ ...base, keys: new Set(["KeyE"]), touch: { use: false } }, 0.1).use).toBe(true);
  });
});

describe("nextTouchActive", () => {
  it("turns on with touch and off with mouse or keyboard", () => {
    expect(nextTouchActive(false, "touch", false)).toBe(true);
    expect(nextTouchActive(true, "mouse", false)).toBe(false);
    expect(nextTouchActive(true, "key", false)).toBe(false);
    expect(nextTouchActive(true, "pen", false)).toBe(true);
    expect(nextTouchActive(false, "pen", false)).toBe(false);
  });

  it("stays on when forced", () => {
    expect(nextTouchActive(true, "mouse", true)).toBe(true);
    expect(nextTouchActive(false, "key", true)).toBe(true);
  });
});

describe("defuseAvailable", () => {
  const planted = { spike: { planted: true, plantT: -10, site: "A" as const, u: 0.383, v: 0.278 }, plantedAtStart: true };
  const worldOf = (patch: Partial<Level>) => buildWorld(KILN, { ...SYNTHETIC_1V3, ...patch });
  const at = (s: SimState, x: number, y: number): SimState => ({ ...s, clutcher: { ...s.clutcher, x, y } });

  it("is true on defense with the spike active and the clutcher in range", () => {
    const w = worldOf({ ...planted, clutcherSide: "defense" });
    const s = initState(w, 1);
    const sp = w.spike!;
    expect(defuseAvailable(w, at(s, sp.x, sp.y))).toBe(true);
    expect(defuseAvailable(w, at(s, sp.x + DEFUSE_RADIUS * 0.99, sp.y))).toBe(true);
  });

  it("is false out of range, on attack, before the plant or once dead", () => {
    const def = worldOf({ ...planted, clutcherSide: "defense" });
    const s = initState(def, 1);
    const sp = def.spike!;
    expect(defuseAvailable(def, at(s, sp.x + DEFUSE_RADIUS + 1, sp.y))).toBe(false);
    expect(defuseAvailable(def, { ...at(s, sp.x, sp.y), clutcher: { ...s.clutcher, x: sp.x, y: sp.y, hp: 0 } })).toBe(false);

    const att = worldOf({ ...planted, clutcherSide: "attack" });
    expect(defuseAvailable(att, at(initState(att, 1), att.spike!.x, att.spike!.y))).toBe(false);

    const later = worldOf({ clutcherSide: "defense", plantedAtStart: false });
    const sl = initState(later, 1);
    expect(defuseAvailable(later, at(sl, later.spike!.x, later.spike!.y))).toBe(false);
  });
});

describe("hint texts", () => {
  it("keeps the desktop texts verbatim", () => {
    expect(controlsHint(false)).toBe("WASD move · mouse aim · click shoot · hold E on the spike to defuse");
    expect(goalText("defense", false)).toBe("Defend: hold E on the spike for 5 s, or win the fight");
    expect(goalText("attack", false)).toBe("Attack: survive until the spike blows, or win the fight");
  });

  it("mentions DEFUSE and sticks on touch", () => {
    expect(controlsHint(true)).toBe("Left stick move · Right stick aim/fire · Hold DEFUSE");
    expect(goalText("defense", true)).toContain("DEFUSE");
    expect(goalText("defense", true)).not.toContain("hold E");
    expect(goalText("attack", true)).toBe(goalText("attack", false));
  });
});
