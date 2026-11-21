// Level schema v1 — contract with the ETL (see docs/level-schema.md).

export type MapName = "haven" | "lotus";
export type Side = "attack" | "defense";
export type SiteName = "A" | "B" | "C";
export type ActorId = "P0" | "E1" | "E2" | "E3" | "E4" | "E5";

export type Sample = { t: number; x: number; y: number; u: number; v: number };

export type Actor = {
  id: ActorId;
  hp: number;
  armor?: number;
  weapon?: string;
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
  weapon?: string;
  killerUV: [number, number];
  victimUV: [number, number];
};

export type Outcome = {
  winner: "clutcher" | "enemies";
  t: number;
  reason: "elimination" | "defuse" | "detonate" | "time" | "unknown";
};

export type Level = {
  schemaVersion: 1;
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
