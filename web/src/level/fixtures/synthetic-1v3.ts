import type { Actor, Level, Sample } from "../types";

// Synthetic level for dev/tests only (hand-made, not derived from any match data).
// x/y are fake source-world coords; u/v drive the warp (same orientation as real haven data:
// u grows defender → attacker side, v grows from the A side to the C side).

function track(points: readonly (readonly [number, number, number])[]): Sample[] {
  return points.map(([t, u, v]) => ({ t, x: Math.round(u * 10000), y: Math.round(v * 10000), u, v }));
}

const clutcher: Actor = {
  id: "P0",
  hp: 100,
  armor: 50,
  weapon: "rifle",
  samples: track([
    [0, 0.839, 0.561],
    [3, 0.561, 0.435],
    [6, 0.608, 0.385],
    [9, 0.603, 0.259],
    [13, 0.467, 0.191],
    [16, 0.402, 0.25],
    [22, 0.383, 0.278],
    [28, 0.407, 0.156],
  ]),
};

const enemies: Actor[] = [
  {
    id: "E1",
    hp: 100,
    armor: 50,
    weapon: "rifle",
    samples: track([
      [0, 0.3, 0.23],
      [4, 0.408, 0.193],
      [10, 0.435, 0.192],
      [14, 0.402, 0.25],
    ]),
    diedT: 14,
  },
  {
    id: "E2",
    hp: 100,
    weapon: "smg",
    samples: track([
      [0, 0.376, 0.512],
      [5, 0.284, 0.526],
      [9, 0.134, 0.433],
      [14, 0.362, 0.152],
      [20, 0.386, 0.287],
    ]),
    diedT: 20,
  },
  {
    id: "E3",
    hp: 100,
    armor: 25,
    weapon: "rifle",
    samples: track([
      [0, 0.47, 0.791],
      [2, 0.502, 0.9],
      [6, 0.572, 0.686],
      [10, 0.508, 0.383],
      [16, 0.615, 0.385],
      [24, 0.467, 0.191],
      [28, 0.431, 0.192],
    ]),
    diedT: 28,
  },
];

export const SYNTHETIC_1V3: Level = {
  schemaVersion: 1,
  id: "synthetic-1v3",
  map: "haven",
  clutchSize: 3,
  clutcherSide: "attack",
  clutcherWon: true,
  startClockS: 45,
  plantedAtStart: false,
  durationS: 28,
  spike: { planted: true, plantT: 22, site: "A", u: 0.383, v: 0.278 },
  clutcher,
  enemies,
  kills: [
    { t: 14, killer: "P0", victim: "E1", weapon: "rifle", killerUV: [0.467, 0.191], victimUV: [0.402, 0.25] },
    { t: 20, killer: "P0", victim: "E2", weapon: "rifle", killerUV: [0.399, 0.251], victimUV: [0.386, 0.287] },
    { t: 28, killer: "P0", victim: "E3", weapon: "rifle", killerUV: [0.419, 0.158], victimUV: [0.431, 0.192] },
  ],
  outcome: { winner: "clutcher", t: 28, reason: "elimination" },
};
