import { describe, expect, it } from "vitest";
import { proFrame, youFrame } from "../src/game/frameView";
import { buildYouTimeline, PANEL_CHROME, PANEL_GAP, replaySpan } from "../src/game/replayModel";
import { ReplayPlayer } from "../src/game/replayPlayer";
import { Session } from "../src/game/session";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import { KILN } from "../src/maps/kiln";
import { buildWorld } from "../src/sim/world";
import { THEME_NUM } from "../src/ui/theme";

const world = buildWorld(KILN, SYNTHETIC_1V3);
const session = new Session(world, 42, 0);
for (let i = 0; i < 900; i++) session.advance(1000 / 60, { move: { x: 0, y: -1 }, aim: { x: 1500, y: 2400 }, fire: i % 9 < 3, use: false });
const timeline = buildYouTimeline(world, 42, session.recording);
const span = replaySpan(world, timeline);

function player(): { p: ReplayPlayer; times: [number, number, number][]; ends: () => number } {
  const times: [number, number, number][] = [];
  let ends = 0;
  const p = new ReplayPlayer({ world, timeline, onTime: (t, a, b) => times.push([t, a, b]), onEnd: () => ends++ });
  return { p, times, ends: () => ends };
}

describe("ReplayPlayer", () => {
  it("starts paused at startT and reports it once", () => {
    const { p, times } = player();
    expect(p.startT).toBe(span.startT);
    expect(p.endT).toBe(span.endT);
    expect(p.time).toBe(span.startT);
    expect(p.isPlaying).toBe(false);
    expect(times).toEqual([[span.startT, span.startT, span.endT]]);
  });

  it("advances by deltaMS / 1000 × speed while playing", () => {
    const { p, times } = player();
    p.update(500);
    expect(p.time).toBe(span.startT);
    p.play();
    p.update(500);
    expect(p.time).toBeCloseTo(span.startT + 0.5);
    p.setSpeed(2);
    p.update(500);
    expect(p.time).toBeCloseTo(span.startT + 1.5);
    p.setSpeed(4);
    p.update(250);
    expect(p.time).toBeCloseTo(span.startT + 2.5);
    expect(times.at(-1)).toEqual([p.time, span.startT, span.endT]);
  });

  it("stops time on pause", () => {
    const { p } = player();
    p.play();
    p.update(100);
    p.pause();
    const t = p.time;
    p.update(1000);
    expect(p.time).toBe(t);
    expect(p.isPlaying).toBe(false);
  });

  it("clamps setTime to the span", () => {
    const { p, times } = player();
    p.setTime(-1e6);
    expect(p.time).toBe(span.startT);
    p.setTime(1e6);
    expect(p.time).toBe(span.endT);
    expect(times.at(-1)).toEqual([span.endT, span.startT, span.endT]);
  });

  it("fires onEnd exactly once at the end and restarts from startT on play", () => {
    const { p, ends } = player();
    p.setSpeed(4);
    p.play();
    for (let i = 0; i < 2000 && p.isPlaying; i++) p.update(100);
    expect(ends()).toBe(1);
    expect(p.isPlaying).toBe(false);
    expect(p.time).toBe(span.endT);
    p.update(100);
    expect(ends()).toBe(1);
    p.play();
    expect(p.time).toBe(span.startT);
    expect(p.isPlaying).toBe(true);
  });

  it("builds [youFrame, proFrame] for the current time", () => {
    const { p } = player();
    for (const t of [span.startT, (span.startT + span.endT) / 2, span.endT]) {
      p.setTime(t);
      expect(p.frames()).toEqual([youFrame(world, timeline, t), proFrame(world, t)]);
    }
  });

  it("lays the panels out side by side or stacked, with YOU/PRO headers", () => {
    const { p } = player();
    const row = p.panels(2 * 500 + PANEL_GAP, 500 + PANEL_CHROME, "row");
    expect(row).toEqual([
      { x: 0, y: 0, size: 500, title: "YOU", note: "your round", accent: THEME_NUM.cyan },
      { x: 500 + PANEL_GAP, y: 0, size: 500, title: "PRO", note: "rebuilt from event data", accent: THEME_NUM.amber },
    ]);
    expect(p.panels(2 * 500 + PANEL_GAP, 500 + PANEL_CHROME)).toEqual(row);
    const col = p.panels(300, 2 * (300 + PANEL_CHROME) + PANEL_GAP, "column");
    expect(col.map(({ x, y, size }) => ({ x, y, size }))).toEqual([
      { x: 0, y: 0, size: 300 },
      { x: 0, y: 300 + PANEL_CHROME + PANEL_GAP, size: 300 },
    ]);
  });
});
