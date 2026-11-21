import { describe, expect, it } from "vitest";
import { buildYouTimeline, proFrameAt, replayLayout, replaySpan, tickAtTime, timeOfTick, youStateAt } from "../src/game/replayModel";
import { Session } from "../src/game/session";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import { KILN } from "../src/maps/kiln";
import { hashState } from "../src/sim/hash";
import { NO_INPUT, replay, type Input } from "../src/sim/sim";
import { buildWorld } from "../src/sim/world";

const world = buildWorld(KILN, SYNTHETIC_1V3);
const level = world.level;

function scripted(frame: number): Input {
  const dirs = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
  ];
  return { move: dirs[Math.floor(frame / 45) % dirs.length]!, aim: { x: 1500 + frame * 3, y: 2400 }, fire: frame % 9 < 3, use: false };
}

function recorded(seed: number, frames: number): Session {
  const s = new Session(world, seed, 0);
  for (let f = 0; f < frames; f++) s.advance(1000 / 60, scripted(f));
  return s;
}

describe("you timeline", () => {
  const session = recorded(42, 900);
  const timeline = buildYouTimeline(world, 42, session.recording);

  it("ends in the same state as replay() and has one state per tick", () => {
    const last = timeline[timeline.length - 1]!;
    expect(hashState(last)).toBe(hashState(replay(world, 42, session.recording)));
    expect(hashState(last)).toBe(hashState(session.state));
    expect(timeline.length).toBe(last.tick + 1);
    timeline.forEach((s, i) => expect(s.tick).toBe(i));
  });

  it("maps time ↔ tick on the shared clock and clamps outside the round", () => {
    expect(timeOfTick(world, 0)).toBe(world.clutcherRail.keys[0]!.t);
    for (const tick of [0, 1, 17, timeline.length - 1]) expect(tickAtTime(world, timeOfTick(world, tick), timeline.length)).toBe(tick);
    expect(tickAtTime(world, -1e6, timeline.length)).toBe(0);
    expect(youStateAt(world, timeline, 1e6)).toBe(timeline[timeline.length - 1]);
    const span = replaySpan(world, timeline);
    expect(span.startT).toBe(timeOfTick(world, 0));
    expect(span.endT).toBeGreaterThanOrEqual(level.outcome.t);
  });

  it("rejects gaps like replay()", () => {
    expect(() => buildYouTimeline(world, 1, [{ ...NO_INPUT, tick: 2 }])).toThrow(/tick 2 at state tick 0/);
  });
});

describe("pro frame", () => {
  it("starts at the first clutcher rail key with every enemy alive and no kills", () => {
    const k0 = world.clutcherRail.keys[0]!;
    const f = proFrameAt(world, level, k0.t);
    expect(f.clutcher).toEqual({ x: k0.x, y: k0.y });
    expect(f.clutcherAlive).toBe(true);
    expect(f.enemies.map((e) => e.id)).toEqual(level.enemies.map((e) => e.id));
    expect(f.kills).toEqual([]);
  });

  it("drops an enemy from its diedT on and shows kill events up to t", () => {
    const first = level.enemies.find((e) => e.diedT !== undefined)!;
    const diedT = first.diedT!;
    expect(proFrameAt(world, level, diedT - 0.01).enemies.some((e) => e.id === first.id)).toBe(true);
    const at = proFrameAt(world, level, diedT);
    expect(at.enemies.some((e) => e.id === first.id)).toBe(false);
    expect(proFrameAt(world, level, diedT + 5).enemies.some((e) => e.id === first.id)).toBe(false);
    expect(at.kills.map((k) => k.victim)).toEqual(level.kills.filter((k) => k.t <= diedT).map((k) => k.victim));
    for (const k of at.kills) expect(Number.isFinite(k.at.x) && Number.isFinite(k.at.y)).toBe(true);
  });
});

describe("replayLayout", () => {
  it("puts the panels side by side on landscape screens and fits the area", () => {
    for (const [w, h] of [[1176, 540], [1896, 940]] as const) {
      const fit = replayLayout(w, h);
      expect(fit.layout).toBe("row");
      expect(fit.width).toBeLessThanOrEqual(w);
      expect(fit.height).toBeLessThanOrEqual(h);
    }
  });

  it("stacks the panels on portrait phones when that gives a bigger map", () => {
    const fit = replayLayout(366, 600);
    expect(fit.layout).toBe("column");
    expect(fit.width).toBeLessThanOrEqual(366);
    expect(fit.height).toBeLessThanOrEqual(600);
    // Stacked map square (= canvas width) beats the side-by-side one, (366 - 16) / 2.
    expect(fit.width).toBeGreaterThan((366 - 16) / 2);
  });
});
