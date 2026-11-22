import { describe, expect, it } from "vitest";
import { createFpsWatchdog, type FpsWatchdog } from "../src/render/fpsWatchdog";

/** Feeds frames every `frameMs` from `startMs` for `durationMs`; returns the clock times of "degrade". */
function run(dog: FpsWatchdog, startMs: number, durationMs: number, frameMs: number): { degrades: number[]; endMs: number } {
  const degrades: number[] = [];
  let now = startMs;
  while (now < startMs + durationMs) {
    now += frameMs;
    if (dog.sample(now) === "degrade") degrades.push(now);
  }
  return { degrades, endMs: now };
}

describe("fps watchdog", () => {
  it("ignores the warm-up after start", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    // 10 fps for the whole 3 s warm-up: nothing counts yet.
    expect(run(dog, 0, 2950, 99).degrades).toEqual([]);
  });

  it("never degrades at a steady 60 fps", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    expect(run(dog, 0, 60_000, 1000 / 60).degrades).toEqual([]);
  });

  it("degrades once after 3 s below 45 fps, then resets (warm-up again)", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    const { degrades } = run(dog, 0, 7_000, 1000 / 30);
    expect(degrades).toHaveLength(1);
    // Warm-up ends at 3000 ms, then 3000 ms of slow frames.
    expect(degrades[0]!).toBeGreaterThanOrEqual(6000);
    expect(degrades[0]!).toBeLessThan(6000 + 2 * (1000 / 30));
    // After the reset: another warm-up plus another 3 s slow before the next degrade.
    const next = run(dog, degrades[0]!, 6_100, 1000 / 30).degrades;
    expect(next).toHaveLength(1);
    expect(next[0]! - degrades[0]!).toBeGreaterThanOrEqual(6000);
  });

  it("degrades at a steady 8 fps (frames longer than the frame loop's 100 ms clamp)", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    const { degrades } = run(dog, 0, 7_000, 125);
    expect(degrades).toHaveLength(1);
    expect(degrades[0]!).toBeGreaterThanOrEqual(6000);
    expect(degrades[0]!).toBeLessThan(6000 + 2 * 125);
  });

  it("a single 5 s gap (tab switch) never degrades and restarts the warm-up", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    // 2 s of slow frames after the warm-up: one second short of a degrade.
    let t = run(dog, 0, 5_000, 1000 / 30).endMs;
    t += 5_000;
    expect(dog.sample(t)).toBe("ok");
    // Without the reset the slow timer would fire within ~1 s; now warm-up + 3 s slow are needed.
    expect(run(dog, t, 5_900, 1000 / 30).degrades).toEqual([]);
    const again = createFpsWatchdog();
    again.sample(0);
    t = run(again, 0, 5_000, 1000 / 30).endMs + 5_000;
    again.sample(t);
    const { degrades } = run(again, t, 7_000, 1000 / 30);
    expect(degrades).toHaveLength(1);
    expect(degrades[0]! - t).toBeGreaterThanOrEqual(6000);
  });

  it("a short dip below the threshold does not degrade", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    let t = run(dog, 0, 5_000, 1000 / 60).endMs;
    t = run(dog, t, 1_500, 1000 / 30).endMs;
    expect(run(dog, t, 10_000, 1000 / 60).degrades).toEqual([]);
  });

  it("is deterministic and reset(nowMs) restarts the warm-up", () => {
    const a = createFpsWatchdog();
    const b = createFpsWatchdog();
    a.sample(0);
    b.sample(0);
    expect(run(a, 0, 9_000, 25).degrades).toEqual(run(b, 0, 9_000, 25).degrades);
    const dog = createFpsWatchdog();
    dog.sample(0);
    run(dog, 0, 5_000, 1000 / 30);
    dog.reset(5_000);
    expect(run(dog, 5_000, 5_900, 1000 / 30).degrades).toEqual([]);
  });

  it("keeps a correct average when the ring buffer is full (very high refresh rate)", () => {
    const dog = createFpsWatchdog();
    dog.sample(0);
    // 1000 fps: more frames in the 2 s span than the buffer holds; must never read as slow.
    expect(run(dog, 0, 10_000, 1).degrades).toEqual([]);
  });
});
