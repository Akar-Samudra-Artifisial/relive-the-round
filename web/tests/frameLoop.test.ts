import { describe, expect, it } from "vitest";
import { createFrameLoop, frameDelta, type FrameLoopDeps } from "../src/game/frameLoop";

describe("frameDelta", () => {
  it("is 0 on the first frame", () => {
    expect(frameDelta(null, 1234)).toBe(0);
  });

  it("returns the elapsed ms between frames", () => {
    expect(frameDelta(1000, 1016.7)).toBeCloseTo(16.7);
  });

  it("clamps long frames to 100 ms (or a custom max)", () => {
    expect(frameDelta(1000, 1250)).toBe(100);
    expect(frameDelta(1000, 1250, 50)).toBe(50);
  });

  it("is 0 when the clock went backwards", () => {
    expect(frameDelta(1000, 990)).toBe(0);
  });
});

/** Fake animation frames: `flush()` runs everything queued so far, once. */
function fakeDeps(): FrameLoopDeps & { clock: number; queued: () => number; flush: () => void; cancelled: number[] } {
  let nextId = 1;
  let queue = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  const deps = {
    clock: 0,
    cancelled,
    raf(cb: (time: number) => void): number {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf(id: number): void {
      cancelled.push(id);
    },
    now: (): number => deps.clock,
    queued: (): number => queue.size,
    flush(): void {
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) cb(deps.clock);
    },
  };
  return deps;
}

describe("createFrameLoop", () => {
  it("schedules once, also when started twice", () => {
    const deps = fakeDeps();
    const loop = createFrameLoop(() => {}, deps);
    expect(loop.running).toBe(false);
    loop.start();
    loop.start();
    expect(loop.running).toBe(true);
    expect(deps.queued()).toBe(1);
  });

  it("passes delta 0 first, then elapsed (clamped) ms with the frame time", () => {
    const deps = fakeDeps();
    const calls: [number, number][] = [];
    const loop = createFrameLoop((d, now) => calls.push([d, now]), deps);
    loop.start();
    for (const t of [1000, 1016, 1050, 1400]) {
      deps.clock = t;
      deps.flush();
    }
    expect(calls).toEqual([
      [0, 1000],
      [16, 1016],
      [34, 1050],
      [100, 1400],
    ]);
    expect(deps.queued()).toBe(1);
  });

  it("runs no callback after stop, even for an already queued frame", () => {
    const deps = fakeDeps();
    let n = 0;
    const loop = createFrameLoop(() => n++, deps);
    loop.start();
    deps.flush();
    expect(n).toBe(1);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(deps.cancelled).toHaveLength(1);
    deps.flush();
    expect(n).toBe(1);
    expect(deps.queued()).toBe(0);
  });

  it("can stop from inside the callback", () => {
    const deps = fakeDeps();
    let n = 0;
    const loop = createFrameLoop(() => {
      n++;
      loop.stop();
    }, deps);
    loop.start();
    deps.flush();
    deps.flush();
    expect(n).toBe(1);
    expect(deps.queued()).toBe(0);
  });

  it("starts again with delta 0 after a restart", () => {
    const deps = fakeDeps();
    const deltas: number[] = [];
    const loop = createFrameLoop((d) => deltas.push(d), deps);
    loop.start();
    deps.clock = 100;
    deps.flush();
    deps.clock = 116;
    deps.flush();
    loop.stop();
    loop.start();
    deps.clock = 5000;
    deps.flush();
    deps.clock = 5010;
    deps.flush();
    expect(deltas).toEqual([0, 16, 0, 10]);
  });
});
