import type { Actor, ActorId, Level, Sample } from "./types";

type Obj = Record<string, unknown>;

function fail(path: string, why: string): never {
  throw new Error(`level: ${path} ${why}`);
}
function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "must be an object");
  return v as Obj;
}
function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "must be a finite number");
  return v;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, "must be an array");
  return v;
}
function oneOf<T extends string | number | boolean>(v: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(v as T)) fail(path, `must be one of ${allowed.join("|")}`);
  return v as T;
}
function uv(v: unknown, path: string): [number, number] {
  const a = arr(v, path);
  if (a.length !== 2) fail(path, "must be [u, v]");
  return [unit(a[0], `${path}[0]`), unit(a[1], `${path}[1]`)];
}

function unit(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0 || n > 1) fail(path, `must be within [0, 1], got ${n}`);
  return n;
}

const ACTOR_IDS: readonly ActorId[] = ["P0", "E1", "E2", "E3", "E4", "E5"];

function sample(v: unknown, path: string): Sample {
  const o = obj(v, path);
  return { t: num(o.t, `${path}.t`), x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`), u: unit(o.u, `${path}.u`), v: unit(o.v, `${path}.v`) };
}

function actor(v: unknown, path: string, ids: readonly ActorId[]): Actor {
  const o = obj(v, path);
  const samples = arr(o.samples, `${path}.samples`).map((s, i) => sample(s, `${path}.samples[${i}]`));
  if (samples.length === 0) fail(`${path}.samples`, "must not be empty");
  const hp = num(o.hp, `${path}.hp`);
  if (hp <= 0) fail(`${path}.hp`, `must be > 0, got ${hp}`);
  const a: Actor = { id: oneOf(o.id, ids, `${path}.id`), hp, samples };
  if (o.armor !== undefined) a.armor = num(o.armor, `${path}.armor`);
  if (o.weapon !== undefined) a.weapon = String(o.weapon);
  if (o.diedT !== undefined) a.diedT = num(o.diedT, `${path}.diedT`);
  return a;
}

/** Validate untrusted level JSON against schema v1. Throws with the failing field path. */
export function parseLevel(raw: unknown): Level {
  const o = obj(raw, "root");
  oneOf(o.schemaVersion, [1] as const, "schemaVersion");
  if (typeof o.id !== "string" || o.id === "") fail("id", "must be a non-empty string");
  const spikeO = obj(o.spike, "spike");
  const outcomeO = obj(o.outcome, "outcome");
  const enemies = arr(o.enemies, "enemies").map((e, i) => actor(e, `enemies[${i}]`, ["E1", "E2", "E3", "E4", "E5"]));
  const clutchSize = oneOf(o.clutchSize, [2, 3, 4, 5] as const, "clutchSize");
  const level: Level = {
    schemaVersion: 1,
    id: o.id,
    map: oneOf(o.map, ["haven", "lotus"] as const, "map"),
    clutchSize,
    clutcherSide: oneOf(o.clutcherSide, ["attack", "defense"] as const, "clutcherSide"),
    clutcherWon: oneOf(o.clutcherWon, [true, false] as const, "clutcherWon"),
    startClockS: num(o.startClockS, "startClockS"),
    plantedAtStart: oneOf(o.plantedAtStart, [true, false] as const, "plantedAtStart"),
    durationS: num(o.durationS, "durationS"),
    spike: { planted: oneOf(spikeO.planted, [true, false] as const, "spike.planted") },
    clutcher: actor(o.clutcher, "clutcher", ["P0"]),
    enemies,
    kills: arr(o.kills, "kills").map((k, i) => {
      const ko = obj(k, `kills[${i}]`);
      const kill: Level["kills"][number] = {
        t: num(ko.t, `kills[${i}].t`),
        killer: oneOf(ko.killer, ACTOR_IDS, `kills[${i}].killer`),
        victim: oneOf(ko.victim, ACTOR_IDS, `kills[${i}].victim`),
        killerUV: uv(ko.killerUV, `kills[${i}].killerUV`),
        victimUV: uv(ko.victimUV, `kills[${i}].victimUV`),
      };
      if (ko.weapon !== undefined) kill.weapon = String(ko.weapon);
      return kill;
    }),
    outcome: {
      winner: oneOf(outcomeO.winner, ["clutcher", "enemies"] as const, "outcome.winner"),
      t: num(outcomeO.t, "outcome.t"),
      reason: oneOf(outcomeO.reason, ["elimination", "defuse", "detonate", "time", "unknown"] as const, "outcome.reason"),
    },
  };
  if (spikeO.plantT !== undefined) level.spike.plantT = num(spikeO.plantT, "spike.plantT");
  if (spikeO.site !== undefined) level.spike.site = oneOf(spikeO.site, ["A", "B", "C"] as const, "spike.site");
  if (spikeO.u !== undefined) level.spike.u = unit(spikeO.u, "spike.u");
  if (spikeO.v !== undefined) level.spike.v = unit(spikeO.v, "spike.v");
  checkLevelSemantics(level);
  return level;
}

/** Semantic rules from docs/level-schema.md ("Semantic checks"). Throws on the first violation. */
export function checkLevelSemantics(level: Level): void {
  const n = level.enemies.length;
  if (n !== level.clutchSize) fail("enemies", `length ${n} != clutchSize ${level.clutchSize}`);
  level.enemies.forEach((e, i) => {
    if (e.id !== `E${i + 1}`) fail(`enemies[${i}].id`, `must be E${i + 1} (ids E1..En in order), got ${e.id}`);
  });
  const actors: readonly [string, Actor][] = [["clutcher", level.clutcher], ...level.enemies.map((e, i): [string, Actor] => [`enemies[${i}]`, e])];
  for (const [path, a] of actors) {
    if (a.samples[0]!.t !== 0) fail(`${path}.samples[0].t`, `must be 0, got ${a.samples[0]!.t}`);
    a.samples.forEach((s, i) => {
      if (i > 0 && s.t < a.samples[i - 1]!.t) fail(`${path}.samples[${i}].t`, "samples must be sorted by t");
    });
    const end = a.diedT ?? level.durationS;
    const lastT = a.samples[a.samples.length - 1]!.t;
    if (lastT > end) fail(`${path}.samples`, `last t ${lastT} is after ${a.diedT !== undefined ? "diedT" : "durationS"} ${end}`);
    if (a.diedT !== undefined && a.diedT > level.durationS) fail(`${path}.diedT`, `${a.diedT} > durationS ${level.durationS}`);
  }
  const ids = new Set<string>(actors.map(([, a]) => a.id));
  level.kills.forEach((k, i) => {
    if (k.t > level.durationS) fail(`kills[${i}].t`, `${k.t} > durationS ${level.durationS}`);
    if (!ids.has(k.killer)) fail(`kills[${i}].killer`, `unknown actor ${k.killer}`);
    if (!ids.has(k.victim)) fail(`kills[${i}].victim`, `unknown actor ${k.victim}`);
  });
  if (level.outcome.t !== level.durationS) fail("outcome.t", `${level.outcome.t} != durationS ${level.durationS}`);
  if ((level.outcome.winner === "clutcher") !== level.clutcherWon) fail("outcome.winner", `${level.outcome.winner} contradicts clutcherWon ${level.clutcherWon}`);
}

/** Fetch a real level from `public/levels/<file>` (gitignored, produced by the ETL). */
export async function loadLevel(file: string): Promise<Level> {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error(`level: invalid file name '${file}'`);
  const res = await fetch(`${import.meta.env.BASE_URL}levels/${file}`);
  if (!res.ok) throw new Error(`level: fetch ${file} failed with HTTP ${res.status}`);
  return parseLevel(await res.json());
}
