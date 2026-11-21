// Level schema v2 — contract with the ETL (see docs/level-schema.md).

/** Original map a level is played on (public ids only). */
export type MapName = "kiln" | "cistern";
export type Side = "attack" | "defense";
export type SiteName = "A" | "B" | "C";
export type ActorId = "P0" | "E1" | "E2" | "E3" | "E4" | "E5";

export type Sample = { t: number; u: number; v: number };

export type Actor = {
  id: ActorId;
  hp: number;
  samples: Sample[];
  diedT?: number;
};

export type Spike = {
  planted: boolean;
  plantT?: number;
  site?: SiteName;
  u?: number;
  v?: number;
};

export type Kill = {
  t: number;
  killer: ActorId;
  victim: ActorId;
  victimUV: [number, number];
};

export type Outcome = {
  winner: "clutcher" | "enemies";
  t: number;
  reason: "elimination" | "defuse" | "detonate" | "time" | "unknown";
};

export type Level = {
  schemaVersion: 2;
  id: string;
  map: MapName;
  clutchSize: 2 | 3 | 4 | 5;
  clutcherSide: Side;
  clutcherWon: boolean;
  startClockS: number;
  plantedAtStart: boolean;
  durationS: number;
  spike: Spike;
  clutcher: Actor;
  enemies: Actor[];
  kills: Kill[];
  outcome: Outcome;
};
