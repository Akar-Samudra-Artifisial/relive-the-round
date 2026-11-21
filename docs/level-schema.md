# Level schema v2

Contract between the ETL (`relive-export-levels`) and the web game. Machine-readable version:
[`level.schema.json`](level.schema.json) (JSON Schema draft 2020-12). Every exported file is
validated against it plus the semantic checks listed below; invalid levels are not written.

Level files are derived from GRID data, so they live only in the git-ignored
`data/levels/<map>/` directory (`<map>` = `kiln` or `cistern`) and are never committed. They are
public-facing (the featured ones ship with the web build), so they carry only what the web client
reads: no player, team or series names or ids, no weapon names, no armor, no raw GRID positions
and no killer positions. `map` is the original map id; the source map key used by the ETL
(`--map haven|lotus`) never appears in a level file.

v2 replaced v1 (source map names, weapon/armor fields, raw `x`/`y`, `killerUV`). The web loader
accepts v2 only; convert old exports with `uv run relive-migrate-levels` (rewrites
`data/levels/haven|lotus/` into `data/levels/kiln|cistern/`, no GRID feeds needed).

## Conventions

- `t`: seconds since the clutch moment; `t = 0` is the kill that created the 1vN.
- `u`, `v`: `to_uv(x, y)` of the raw GRID position (cm, 2D) with the valorant-api calibration of the map, normalised 0..1, origin
  top-left. The game draws an original 2D map in the same normalised frame.
- Actor ids: `P0` = the clutcher (controlled by the player), `E1`..`E5` = enemies alive at `t = 0`.

## Shape

```
{ schemaVersion: 2, id: string (short hash, not a GRID id), map: "kiln"|"cistern",
  clutchSize: 2..5, clutcherSide: "attack"|"defense", clutcherWon: boolean,
  startClockS: number, plantedAtStart: boolean, durationS: number,
  spike: { planted: boolean, plantT?: number, site?: "A"|"B"|"C", u?: number, v?: number },
  clutcher: Actor, enemies: Actor[],
  kills: [{ t, killer: actorId, victim: actorId, victimUV:[u,v] }],
  outcome: { winner: "clutcher"|"enemies", t: number, reason: "elimination"|"defuse"|"detonate"|"time"|"unknown" } }
Actor = { id: "P0" | "E1".."E5", hp: number,
  samples: [{ t: number, u: number, v: number }], diedT?: number }
```

## Fields

| Field | Meaning / source |
|---|---|
| `map` | Original map id: `kiln` for levels from the ETL source key `haven`, `cistern` for `lotus` (`relive_etl.config.PUBLIC_MAP_IDS`). |
| `id` | First 12 hex chars of SHA-256 over the GRID game id, round number and clutch time. Not reversible without the data. |
| `clutchSize` | Number of enemies alive at `t = 0` (= `enemies.length`). |
| `clutcherSide` | Side of the clutcher's team in the round (`seriesState.games[].teams[].side`). |
| `startClockS` | GRID round clock (seconds left) at `t = 0`. After a plant the clock is the spike timer. |
| `plantedAtStart` | Spike planted at or before `t = 0`. |
| `durationS` | `t` of the round decision (`team-won-round`). Equals `outcome.t`. |
| `spike` | `plantT` is relative and negative when planted before `t = 0`. `site` = nearest valorant-api site callout to the plant position. `plantT`, `site`, `u`, `v` are present only when `planted` is true. |
| `Actor.hp` | Last value at or before `t = 0` from the round's full snapshot (freeze-time end) updated by damage events. Falls back to 100 if unknown. |
| `Actor.samples` | Change-only positions. The first sample is always `t = 0` (the last known position; for an actor first seen after `t = 0`, that first position). Samples stop at `diedT` or `durationS`. Enemies may have a single sample (relaxed rule: only the clutcher track has to be dense, enemies are bot-driven). |
| `Actor.diedT` | First death after `t = 0`, if before the round decision. |
| `kills` | Kills with `0 <= t <= durationS` where both killer and victim are actors. A self-kill has `killer == victim`. `victimUV` is the victim's position at the kill. |
| `outcome.reason` | GRID `winType`: `opponentEliminated` -> `elimination`, `bombDefused` -> `defuse`, `bombExploded` -> `detonate`, `timeExpired` -> `time`, otherwise `unknown`. |

## Semantic checks (beyond JSON Schema)

- `enemies.length == clutchSize` and enemy ids are exactly `E1..En` in order.
- Every actor's samples start at `t = 0`, are sorted by `t` and end at or before `diedT`/`durationS`.
- `diedT`, kill `t` <= `durationS`; kill actor ids exist.
- `outcome.t == durationS`; `outcome.winner == "clutcher"` iff `clutcherWon`.

## Index file

`data/levels/<map>/index.json` lists the exported levels in ranking order:

```
{ schemaVersion: 2, map: "kiln"|"cistern",
  levels: [{ id: string, file: "<id>.json", clutchSize: number, won: boolean, durationS: number }] }
```
