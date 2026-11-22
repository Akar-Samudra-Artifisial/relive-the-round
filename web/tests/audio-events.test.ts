import { describe, expect, it } from "vitest";
import {
  beepHz,
  ENEMY_STEP_RANGE_CM,
  MAX_REPEAT,
  replayEvents,
  STEP_CM,
  track,
  type AudioEvent,
  type PlaySnapshot,
  type Tracker,
} from "../src/audio/events";
import type { SimOutcome, SimState, SimStats } from "../src/sim/sim";

type EnemyLite = { x: number; y: number; alive?: boolean; defuseTicks?: number };
type StateOpts = {
  tick?: number;
  x?: number;
  y?: number;
  hp?: number;
  defuseTicks?: number;
  enemies?: EnemyLite[];
  shots?: { by: string; from: { x: number; y: number } }[];
  stats?: Partial<SimStats>;
  outcome?: SimOutcome | null;
};

function state(o: StateOpts = {}): SimState {
  const s = {
    tick: o.tick ?? 0,
    rng: 1,
    clutcher: { x: o.x ?? 0, y: o.y ?? 0, hp: o.hp ?? 100, fireCd: 0, defuseTicks: o.defuseTicks ?? 0, moving: false },
    enemies: (o.enemies ?? []).map((e, i) => ({ id: `E${i}`, x: e.x, y: e.y, alive: e.alive ?? true, defuseTicks: e.defuseTicks ?? 0 })),
    shots: (o.shots ?? []).map((sh) => ({ by: sh.by, from: sh.from, to: { x: 0, y: 0 }, hit: null })),
    stats: { kills: 0, shotsFired: 0, hits: 0, damageTaken: 0, ...o.stats },
    outcome: o.outcome ?? null,
  };
  return s as unknown as SimState;
}

const SESSION = {};
function snap(o: StateOpts & { session?: object; countdown?: number; secondsLeft?: number; spike?: boolean; nowMs?: number } = {}): PlaySnapshot {
  return {
    session: o.session ?? SESSION,
    countdown: o.countdown ?? 0,
    state: state(o),
    clock: { secondsLeft: o.secondsLeft ?? 60, spikeActive: o.spike ?? false },
    nowMs: o.nowMs ?? 0,
  };
}

/** Runs snapshots in order, returning each frame's events. */
function run(snaps: PlaySnapshot[]): AudioEvent[][] {
  let prev: Tracker | null = null;
  return snaps.map((sn) => {
    const r = track(prev, sn);
    prev = r.next;
    return r.events;
  });
}
const kinds = (evs: AudioEvent[]): string[] => evs.map((e) => e.kind);

describe("audio events: countdown and session reset", () => {
  it("beeps 3-2-1 then go", () => {
    const frames = run([snap({ countdown: 3 }), snap({ countdown: 2 }), snap({ countdown: 2 }), snap({ countdown: 1 }), snap({ countdown: 0 })]);
    expect(frames.map(kinds)).toEqual([["countdown"], ["countdown"], [], ["countdown"], ["countdown"]]);
    expect(frames[4]![0]).toEqual({ kind: "countdown", go: true });
    expect(frames[0]![0]).toEqual({ kind: "countdown", go: false });
  });

  it("a new session object resets the tracker (no deltas against the old round)", () => {
    const frames = run([
      snap({ tick: 50, stats: { shotsFired: 9, kills: 2 } }),
      snap({ session: {}, countdown: 3, tick: 0 }),
    ]);
    expect(kinds(frames[1]!)).toEqual(["countdown"]);
  });
});

describe("audio events: combat", () => {
  it("counts shots, hits and kills over several ticks in one frame", () => {
    const frames = run([snap({ tick: 10 }), snap({ tick: 13, stats: { shotsFired: 2, hits: 1, kills: 1 } })]);
    expect(kinds(frames[1]!)).toEqual(["shot", "shot", "hit", "kill"]);
  });

  it("caps a burst of repeats per frame", () => {
    const frames = run([snap({ tick: 0 }), snap({ tick: 5, stats: { shotsFired: 9 } })]);
    expect(kinds(frames[1]!).filter((k) => k === "shot")).toHaveLength(MAX_REPEAT);
  });

  it("bot shots are panned, quieter with distance and spaced by the minimum gap", () => {
    const shots = [
      { by: "E0", from: { x: 1500, y: 0 } },
      { by: "E1", from: { x: -300, y: 0 } },
      { by: "P0", from: { x: 0, y: 0 } },
    ];
    const frames = run([snap({ tick: 0 }), snap({ tick: 1, shots, nowMs: 1000 }), snap({ tick: 2, shots, nowMs: 1020 }), snap({ tick: 3, shots, nowMs: 1100 })]);
    const f1 = frames[1]!.filter((e) => e.kind === "botShot");
    expect(f1).toHaveLength(1);
    const e = f1[0]!;
    if (e.kind !== "botShot") throw new Error("expected botShot");
    expect(e.gain).toBeCloseTo(0.5);
    expect(e.pan).toBeGreaterThan(0);
    expect(frames[2]!.filter((x) => x.kind === "botShot")).toHaveLength(0);
    expect(frames[3]!.filter((x) => x.kind === "botShot")).toHaveLength(1);
  });

  it("damage plays hurt while alive, the death sweep instead when it kills", () => {
    const alive = run([snap({ tick: 0 }), snap({ tick: 1, hp: 70, stats: { damageTaken: 30 } })]);
    expect(kinds(alive[1]!)).toEqual(["hurt"]);
    const dead = run([
      snap({ tick: 0 }),
      snap({ tick: 1, hp: 0, stats: { damageTaken: 100 }, outcome: { winner: "enemies", reason: "death", t: 1 } }),
    ]);
    expect(kinds(dead[1]!)).toEqual(["death", "lose"]);
  });
});

describe("audio events: outcome order", () => {
  it("the last kill comes before the win stinger", () => {
    const frames = run([snap({ tick: 0 }), snap({ tick: 2, stats: { shotsFired: 1, hits: 1, kills: 1 }, outcome: { winner: "clutcher", reason: "elimination", t: 1 } })]);
    expect(kinds(frames[1]!)).toEqual(["shot", "hit", "kill", "win"]);
  });

  it("defuse completes before the win; detonation explodes before the loss; stingers fire once", () => {
    const won = run([
      snap({ tick: 0, defuseTicks: 149 }),
      snap({ tick: 1, defuseTicks: 150, outcome: { winner: "clutcher", reason: "defuse", t: 1 } }),
      snap({ tick: 1, defuseTicks: 150, outcome: { winner: "clutcher", reason: "defuse", t: 1 } }),
    ]);
    expect(kinds(won[1]!).slice(-2)).toEqual(["defuseDone", "win"]);
    expect(won[2]).toEqual([]);
    const lost = run([snap({ tick: 0, spike: true }), snap({ tick: 1, spike: true, secondsLeft: 0, outcome: { winner: "enemies", reason: "detonate", t: 1 } })]);
    expect(kinds(lost[1]!)).toEqual(["explosion", "lose"]);
  });
});

describe("audio events: footsteps", () => {
  it("one footstep per STEP_CM walked", () => {
    // 18 cm per tick (540 cm/s at 30 Hz), two ticks per frame.
    const snaps = Array.from({ length: 31 }, (_, i) => snap({ tick: i * 2, x: i * 36 }));
    const steps = run(snaps)
      .flat()
      .filter((e) => e.kind === "step");
    expect(steps).toHaveLength(Math.floor((30 * 36) / STEP_CM));
  });

  it("standing still or jumping far makes no footstep", () => {
    expect(run([snap({ tick: 0 }), snap({ tick: 1 }), snap({ tick: 2, x: 5000 })]).flat()).toEqual([]);
  });

  it("enemy footsteps within range are quieter and panned; far ones are silent", () => {
    const near = (i: number): EnemyLite => ({ x: 600 + i * 40, y: 0 });
    const far = (i: number): EnemyLite => ({ x: ENEMY_STEP_RANGE_CM + 500, y: i * 40 });
    const snaps = Array.from({ length: 12 }, (_, i) => snap({ tick: i * 2, enemies: [near(i), far(i)] }));
    const steps = run(snaps)
      .flat()
      .filter((e) => e.kind === "step");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      if (s.kind !== "step") continue;
      expect(s.enemy).toBe(true);
      expect(s.gain).toBeLessThan(1);
      expect(s.pan).toBeGreaterThan(0);
    }
    // Only the near enemy (walked 440 cm → 2 steps with its staggered start of 0).
    expect(steps).toHaveLength(2);
  });
});

describe("audio events: spike and defuse", () => {
  it("beep rate follows the time left", () => {
    expect([30, 15, 7, 3].map(beepHz)).toEqual([1, 2, 4, 8]);
  });

  it("beeps at the rate for the time left (one tick per frame)", () => {
    const count = (secondsLeft: number): number => {
      const snaps = Array.from({ length: 61 }, (_, i) => snap({ tick: i, spike: true, secondsLeft }));
      return run(snaps)
        .flat()
        .filter((e) => e.kind === "beep").length;
    };
    // 60 ticks = 2 s; the first beep sounds right after the plant.
    expect(count(30)).toBe(2);
    expect(count(15)).toBe(4);
    expect(count(3)).toBeGreaterThanOrEqual(14);
  });

  it("defuse: start, a tick every 15 ticks, enemy defuse warning once", () => {
    const snaps = Array.from({ length: 32 }, (_, i) => snap({ tick: i, defuseTicks: i }));
    const evs = run(snaps).flat();
    expect(kinds(evs)).toEqual(["defuseStart", "defuseTick", "defuseTick"]);
    const enemy = run([
      snap({ tick: 0, enemies: [{ x: 9000, y: 0 }] }),
      snap({ tick: 1, enemies: [{ x: 9000, y: 0, defuseTicks: 1 }] }),
      snap({ tick: 2, enemies: [{ x: 9000, y: 0, defuseTicks: 2 }] }),
    ]).flat();
    expect(kinds(enemy)).toEqual(["enemyDefuse"]);
  });
});

describe("audio events: replay", () => {
  it("only your shots and kills", () => {
    const a: SimStats = { kills: 0, shotsFired: 3, hits: 1, damageTaken: 0 };
    expect(kinds(replayEvents(a, { kills: 1, shotsFired: 4, hits: 2, damageTaken: 20 }))).toEqual(["shot", "kill"]);
    expect(replayEvents(a, a)).toEqual([]);
  });
});
