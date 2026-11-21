"""Export ranked clutch candidates as level JSON files (schema v1, see docs/level-schema.md).

Usage: STL_DATA_DIR=... uv run relive-export-levels --map haven --top 12
Output goes to the git-ignored data/levels/<map>/ (derived from GRID data, never committed).
Level files carry no player/team/series names or ids; the level id is a short hash.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .clutch import Clutch, RoundData, clutch_deaths, find_clutch_moments
from .config import DOCS_DIR, LEVELS_DATA_DIR, data_dir
from .geometry import MapCalib, load_calibs, load_site_callouts, nearest_site, to_uv
from .grid_io import series_feed
from .spike import parse_series

SCHEMA_VERSION = 1
SCHEMA_PATH = DOCS_DIR / "level.schema.json"
DEFAULT_HP = 100.0

WIN_REASON = {
    "opponentEliminated": "elimination",
    "bombDefused": "defuse",
    "bombExploded": "detonate",
    "timeExpired": "time",
}
SIDE = {"attacker": "attack", "defender": "defense"}
SIDEARMS = ("classic", "shorty", "frenzy", "ghost", "sheriff", "bandit")
PRIMARIES = (
    "stinger", "spectre", "bucky", "judge", "bulldog", "guardian", "phantom", "vandal",
    "marshal", "outlaw", "operator", "ares", "odin",
)  # fmt: skip
WEAPONS = frozenset(SIDEARMS + PRIMARIES + ("knife", "melee"))

XY = tuple[float, float]


@dataclass
class KillInfo:
    t: int
    killer: str
    victim: str
    weapon: str | None
    killer_xy: XY | None
    victim_xy: XY | None


@dataclass
class RoundExtra:
    """Per-round details the spike walker does not keep (hp, armor, weapons, kill positions)."""

    side: dict[str, str] = field(default_factory=dict)  # team id -> attacker/defender
    hp: dict[str, list[tuple[int, float]]] = field(default_factory=dict)
    armor: dict[str, list[tuple[int, float]]] = field(default_factory=dict)
    weapon: dict[str, list[tuple[int, str]]] = field(default_factory=dict)
    kills: list[KillInfo] = field(default_factory=list)
    plant_xy: XY | None = None
    win_type: str | None = None


def _xy(state: dict[str, Any] | None) -> XY | None:
    pos = ((state or {}).get("game") or {}).get("position") or {}
    if pos.get("x") is None or pos.get("y") is None:
        return None
    return float(pos["x"]), float(pos["y"])


def weapon_name(raw: object) -> str | None:
    name = str(raw or "").strip().lower()
    return name if name in WEAPONS else None


def main_weapon(items: list[dict[str, Any]]) -> str | None:
    """Best weapon of an inventory: a primary if carried, otherwise a sidearm."""
    names = [weapon_name(it.get("name") or it.get("id")) for it in items]
    owned = [n for n in names if n]
    for n in owned:
        if n in PRIMARIES:
            return n
    return next((n for n in owned if n in SIDEARMS), None)


class Collector:
    """`parse_series` hook that gathers `RoundExtra` for the rounds in `wanted`."""

    def __init__(self, wanted: set[tuple[str, int]]) -> None:
        self.wanted = wanted
        self.rounds: dict[tuple[str, int], RoundExtra] = {}

    def __call__(
        self, rd: RoundData, t: int, ev: dict[str, Any], game: dict[str, Any] | None
    ) -> None:
        key = (rd.game_id, rd.number)
        if key not in self.wanted:
            return
        etype = ev["type"]
        if etype == "round-ended-freezetime" or key not in self.rounds:
            self.rounds[key] = RoundExtra()
        ex = self.rounds[key]
        actor, target = ev.get("actor") or {}, ev.get("target") or {}
        if game is not None:
            for tm in game.get("teams") or []:
                if tm.get("id") and tm.get("side"):
                    ex.side[str(tm["id"])] = str(tm["side"])
                if not ev.get("includesFullState"):
                    continue
                for p in tm.get("players") or []:
                    pid = str(p.get("id"))
                    if isinstance(p.get("currentHealth"), (int, float)):
                        ex.hp.setdefault(pid, []).append((t, float(p["currentHealth"])))
                    if isinstance(p.get("currentArmor"), (int, float)):
                        ex.armor.setdefault(pid, []).append(
                            (t, float(p["currentArmor"]))
                        )
                    w = main_weapon((p.get("inventory") or {}).get("items") or [])
                    if w:
                        ex.weapon.setdefault(pid, []).append((t, w))
        if target.get("type") == "player":
            tg = (target.get("state") or {}).get("game") or {}
            tid = str(target.get("id"))
            if isinstance(tg.get("currentHealth"), (int, float)):
                ex.hp.setdefault(tid, []).append((t, float(tg["currentHealth"])))
            if isinstance(tg.get("currentArmor"), (int, float)):
                ex.armor.setdefault(tid, []).append((t, float(tg["currentArmor"])))
        delta = (actor.get("stateDelta") or {}).get("game") or {}
        if etype == "player-damaged-player":
            for src in delta.get("damageDealtSources") or []:
                w = weapon_name((src.get("source") or {}).get("name"))
                if w:
                    ex.weapon.setdefault(str(actor.get("id")), []).append((t, w))
        elif etype in ("player-killed-player", "player-selfkilled-player"):
            w = next((weapon_name(k) for k in (delta.get("weaponKills") or {})), None)
            killer = str(actor.get("id"))
            victim = str(target.get("id") or killer)
            if w and etype == "player-killed-player":
                ex.weapon.setdefault(killer, []).append((t, w))
            vxy = _xy(target.get("state")) or (
                _xy(actor.get("state")) if victim == killer else None
            )
            ex.kills.append(
                KillInfo(t, killer, victim, w, _xy(actor.get("state")), vxy)
            )
        elif etype == "player-!killed-player":
            victim, killer = str(target.get("id")), str(actor.get("id"))
            for i in range(len(ex.kills) - 1, -1, -1):
                if ex.kills[i].victim == victim and ex.kills[i].killer == killer:
                    del ex.kills[i]
                    break
        elif etype == "player-completed-plantBomb" and ex.plant_xy is None:
            ex.plant_xy = _xy(actor.get("state"))
        elif etype == "team-won-round":
            ex.win_type = ((actor.get("stateDelta") or {}).get("round") or {}).get(
                "winType"
            )


def _value_at[T](series: list[tuple[int, T]], t: int) -> T | None:
    """Last value at or before `t` (series is in feed order)."""
    out: T | None = None
    for ts, v in series:
        if ts > t:
            break
        out = v
    return out


def level_id(game_id: str, round_number: int, clutch_t: int) -> str:
    return hashlib.sha256(f"{game_id}:{round_number}:{clutch_t}".encode()).hexdigest()[
        :12
    ]


def _uv(
    calib: MapCalib, x: float, y: float, clamped: list[int] | None = None
) -> tuple[float, float]:
    """Minimap u/v rounded to 5 dp and clamped to [0, 1]; counts clamped points in `clamped[0]`."""
    u, v = to_uv(calib, x, y)
    cu, cv = min(1.0, max(0.0, u)), min(1.0, max(0.0, v))
    if clamped is not None and (cu, cv) != (u, v):
        clamped[0] += 1
    return round(cu, 5), round(cv, 5)


def build_level(
    rd: RoundData,
    ex: RoundExtra,
    c: Clutch,
    calib: MapCalib,
    sites: dict[str, XY],
    map_name: str,
    uv_clamped: list[int] | None = None,
) -> dict[str, Any]:
    """Turn one clutch into a schema-v1 level dict (relative seconds, actor aliases).

    `uv_clamped[0]`, if given, is incremented for every u/v point clamped into [0, 1].
    Raises ValueError when the round cannot make a level (missing position, side, plant).
    """
    t0, end = c.t, rd.end_t
    clamped = uv_clamped if uv_clamped is not None else [0]

    def rel(t: int) -> float:
        return round((t - t0) / 1000.0, 3)

    def uv(x: float, y: float) -> tuple[float, float]:
        return _uv(calib, x, y, clamped)

    alias = {c.clutcher: "P0", **{p: f"E{i}" for i, p in enumerate(c.opponents, 1)}}
    deaths = clutch_deaths(rd, c)

    def actor(pid: str) -> dict[str, Any]:
        stop = min(deaths.get(pid, end), end)
        track = rd.tracks.get(pid, [])
        before = [s for s in track if s[0] <= t0]
        start = before[-1] if before else next((s for s in track if s[0] <= stop), None)
        if start is None:
            raise ValueError(
                f"{alias[pid]} has no position at or before its window end"
            )
        # t=0 holds the last known position (or the first one, if only seen after t0)
        pts = [(t0, start[1], start[2])] + [s for s in track if t0 < s[0] <= stop]
        samples = []
        for t, x, y in pts:
            u, v = uv(x, y)
            samples.append(
                {"t": rel(t), "x": round(x, 1), "y": round(y, 1), "u": u, "v": v}
            )
        hp = _value_at(ex.hp.get(pid, []), t0)
        out: dict[str, Any] = {
            "id": alias[pid],
            "hp": hp if hp and hp > 0 else DEFAULT_HP,
        }
        armor = _value_at(ex.armor.get(pid, []), t0)
        if armor is not None:
            out["armor"] = max(0.0, armor)
        weapon = _value_at(ex.weapon.get(pid, []), t0) or next(
            (w for t, w in ex.weapon.get(pid, []) if t0 < t <= stop), None
        )
        if weapon:
            out["weapon"] = weapon
        out["samples"] = samples
        if pid in deaths and deaths[pid] <= end:
            out["diedT"] = rel(deaths[pid])
        return out

    kills = []
    for k in ex.kills:
        if not (t0 <= k.t <= end) or k.killer not in alias or k.victim not in alias:
            continue
        if k.killer_xy is None or k.victim_xy is None:
            continue
        kill: dict[str, Any] = {
            "t": rel(k.t),
            "killer": alias[k.killer],
            "victim": alias[k.victim],
        }
        if k.weapon:
            kill["weapon"] = k.weapon
        kill["killerUV"] = list(uv(*k.killer_xy))
        kill["victimUV"] = list(uv(*k.victim_xy))
        kills.append(kill)

    planted = rd.plant_t is not None and rd.plant_t <= end
    spike: dict[str, Any] = {"planted": planted}
    if planted and rd.plant_t is not None:
        spike["plantT"] = rel(rd.plant_t)
        if ex.plant_xy is None:
            raise ValueError("spike planted but the plant position is missing")
        site = nearest_site(sites, *ex.plant_xy)
        if site not in ("A", "B", "C"):
            raise ValueError(f"no A/B/C site callout near the plant (got {site!r})")
        spike["site"] = site
        spike["u"], spike["v"] = uv(*ex.plant_xy)

    side = SIDE.get(ex.side.get(c.team, ""))
    if side is None:
        raise ValueError("clutcher team side (attacker/defender) not found in the feed")
    won = rd.winner_team == c.team
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": level_id(rd.game_id, rd.number, t0),
        "map": map_name,
        "clutchSize": len(c.opponents),
        "clutcherSide": side,
        "clutcherWon": won,
        "startClockS": c.remaining_s,
        "plantedAtStart": rd.plant_t is not None and rd.plant_t <= t0,
        "durationS": rel(end),
        "spike": spike,
        "clutcher": actor(c.clutcher),
        "enemies": [actor(p) for p in c.opponents],
        "kills": kills,
        "outcome": {
            "winner": "clutcher" if won else "enemies",
            "t": rel(end),
            "reason": WIN_REASON.get(ex.win_type or "", "unknown"),
        },
    }


def load_validator(path: Path = SCHEMA_PATH) -> Draft202012Validator:
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def semantic_errors(level: dict[str, Any]) -> list[str]:
    """Rules JSON Schema cannot express (sizes, ordering, references, time bounds)."""
    errs: list[str] = []
    dur = level.get("durationS", 0)
    enemies = level.get("enemies", [])
    if len(enemies) != level.get("clutchSize"):
        errs.append(f"clutchSize {level.get('clutchSize')} != {len(enemies)} enemies")
    want = [f"E{i}" for i in range(1, len(enemies) + 1)]
    if [e.get("id") for e in enemies] != want:
        errs.append(f"enemy ids must be {want}")
    ids = {"P0", *want}
    for a in [level.get("clutcher", {}), *enemies]:
        ts = [s["t"] for s in a.get("samples", [])]
        if ts and ts[0] != 0:
            errs.append(f"{a.get('id')}: first sample must be at t=0")
        if ts != sorted(ts):
            errs.append(f"{a.get('id')}: samples not sorted by t")
        limit = a.get("diedT", dur)
        if ts and ts[-1] > limit:
            errs.append(
                f"{a.get('id')}: sample after death/round end ({ts[-1]} > {limit})"
            )
        if a.get("diedT", 0) > dur:
            errs.append(f"{a.get('id')}: diedT after round end")
    for k in level.get("kills", []):
        if k.get("killer") not in ids or k.get("victim") not in ids:
            errs.append(f"kill at t={k.get('t')} references an unknown actor")
        if k.get("t", 0) > dur:
            errs.append(f"kill at t={k.get('t')} after round end")
    if level.get("outcome", {}).get("t") != dur:
        errs.append("outcome.t must equal durationS")
    if (level.get("outcome", {}).get("winner") == "clutcher") != level.get(
        "clutcherWon"
    ):
        errs.append("outcome.winner disagrees with clutcherWon")
    return errs


def validate_level(level: dict[str, Any], validator: Draft202012Validator) -> list[str]:
    errs = [
        f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
        for e in validator.iter_errors(level)
    ]
    return errs + semantic_errors(level)


def _export_series(
    args: tuple[Path, list[dict[str, Any]], MapCalib, dict[str, XY], str],
) -> list[tuple[int, dict[str, Any] | None, str, int]]:
    """Build levels for one series' candidates: [(rank, level | None, error, uv clamped)]."""
    feed, cands, calib, sites, map_name = args
    wanted = {(c["game_id"], int(c["round"])) for c in cands}
    collector = Collector(wanted)
    rounds, _ = parse_series(feed, {g for g, _ in wanted}, on_event=collector)
    by_key = {(rd.game_id, rd.number): rd for rd in rounds}
    out: list[tuple[int, dict[str, Any] | None, str, int]] = []
    for c in cands:
        key = (c["game_id"], int(c["round"]))
        rd, ex = by_key.get(key), collector.rounds.get(key)
        clutch = (
            next((m for m in find_clutch_moments(rd) if m.t == c["clutch_t_ms"]), None)
            if rd
            else None
        )
        if rd is None or ex is None or clutch is None:
            out.append(
                (c["_rank"], None, "round or clutch moment not found in the feed", 0)
            )
            continue
        clamped = [0]
        try:
            level = build_level(rd, ex, clutch, calib, sites, map_name, clamped)
        except ValueError as e:
            out.append((c["_rank"], None, str(e), 0))
            continue
        out.append((c["_rank"], level, "", clamped[0]))
    return out


def _stats(values: list[float]) -> str:
    if not values:
        return "n/a"
    return f"min {min(values):g}, median {statistics.median(values):g}, max {max(values):g}"


def render_export_report(
    map_name: str,
    levels: list[dict[str, Any]],
    failed: int,
    uv_clamped: int = 0,
    levels_clamped: int = 0,
) -> str:
    """Aggregate-only summary (no ids) of the exported levels."""
    clutcher_n = [len(lv["clutcher"]["samples"]) for lv in levels]
    enemy_n = [len(e["samples"]) for lv in levels for e in lv["enemies"]]
    actors = [a for lv in levels for a in (lv["clutcher"], *lv["enemies"])]
    sizes = Counter(f"1v{lv['clutchSize']}" for lv in levels)
    reasons = Counter(lv["outcome"]["reason"] for lv in levels)
    sides = Counter(lv["clutcherSide"] for lv in levels)
    sites = Counter(lv["spike"].get("site", "-") for lv in levels)
    return "\n".join(
        [
            f"# Level export report: {map_name}",
            "",
            "Generated by `relive-export-levels`. Aggregates only; the level files live in the "
            f"git-ignored `data/levels/{map_name}/`.",
            "",
            f"- Exported and valid (JSON Schema + semantic checks): {len(levels)}; failed: {failed}.",
            f"- Sizes: {', '.join(f'{k} {v}' for k, v in sorted(sizes.items()))}; "
            f"won by the clutcher: {sum(lv['clutcherWon'] for lv in levels)}.",
            f"- Clutcher side: {', '.join(f'{k} {v}' for k, v in sorted(sides.items()))}; "
            f"outcome reason: {', '.join(f'{k} {v}' for k, v in sorted(reasons.items()))}; "
            f"spike site: {', '.join(f'{k} {v}' for k, v in sorted(sites.items()))}.",
            f"- Duration (s): {_stats([lv['durationS'] for lv in levels])}.",
            f"- Clutcher samples per level: {_stats([float(n) for n in clutcher_n])}.",
            f"- Enemy samples per enemy: {_stats([float(n) for n in enemy_n])}; "
            f"enemies with a single (start) sample: {sum(n == 1 for n in enemy_n)} of {len(enemy_n)}.",
            f"- Kills inside the clutch windows: {sum(len(lv['kills']) for lv in levels)}.",
            f"- Actors with hp from the feed vs default {DEFAULT_HP:g}: "
            f"{sum(a['hp'] != DEFAULT_HP for a in actors)} non-default of {len(actors)}; "
            f"armor known: {sum('armor' in a for a in actors)}; weapon known: "
            f"{sum('weapon' in a for a in actors)}.",
            f"- Actors with diedT: {sum('diedT' in a for a in actors)} of {len(actors)}.",
            f"- u/v points clamped into [0, 1]: {uv_clamped} (in {levels_clamped} levels).",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", required=True, choices=["haven", "lotus"])
    ap.add_argument(
        "--top", type=int, default=12, help="number of ranked candidates to export"
    )
    ap.add_argument(
        "--candidates", type=Path, default=LEVELS_DATA_DIR / "candidates.json"
    )
    ap.add_argument("--out-dir", type=Path, default=LEVELS_DATA_DIR)
    ap.add_argument(
        "--report", type=Path, default=None, help="default docs/level-export-<map>.md"
    )
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    if a.top < 1:
        raise SystemExit("--top must be >= 1")
    if not a.candidates.is_file():
        raise SystemExit(f"{a.candidates} not found: run `uv run relive-spike` first")
    ranked = [
        c
        for c in json.loads(a.candidates.read_text(encoding="utf-8"))
        if c["map"] == a.map
    ]
    chosen = [{**c, "_rank": i} for i, c in enumerate(ranked[: a.top])]
    calib = load_calibs().get(a.map)
    sites = load_site_callouts().get(a.map, {})
    if calib is None:
        raise SystemExit(f"no valorant-api calibration for map {a.map!r}")
    root = data_dir()
    by_series: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in chosen:
        by_series[c["series_id"]].append(c)
    jobs = [
        (series_feed(root, sid), cs, calib, sites, a.map)
        for sid, cs in by_series.items()
    ]

    validator = load_validator()
    results: list[tuple[int, dict[str, Any] | None, str, int]] = []
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for part in pool.map(_export_series, jobs):
            results.extend(part)
    results.sort(key=lambda r: r[0])

    out_dir = a.out_dir / a.map
    out_dir.mkdir(parents=True, exist_ok=True)
    old_index = out_dir / "index.json"
    if old_index.is_file():  # drop files of the previous export only
        for entry in json.loads(old_index.read_text(encoding="utf-8")).get(
            "levels", []
        ):
            (out_dir / str(entry.get("file", ""))).unlink(missing_ok=True)
    levels: list[dict[str, Any]] = []
    failed = uv_clamped = levels_clamped = 0
    for rank, level, err, n_clamped in results:
        errs = [err] if level is None else validate_level(level, validator)
        if errs:
            failed += 1
            print(
                f"[export] rank {rank + 1}: skipped: {'; '.join(errs[:3])}", flush=True
            )
            continue
        assert level is not None
        (out_dir / f"{level['id']}.json").write_text(
            json.dumps(level), encoding="utf-8"
        )
        levels.append(level)
        uv_clamped += n_clamped
        levels_clamped += n_clamped > 0
    index = {
        "schemaVersion": SCHEMA_VERSION,
        "map": a.map,
        "levels": [
            {
                "id": lv["id"],
                "file": f"{lv['id']}.json",
                "clutchSize": lv["clutchSize"],
                "won": lv["clutcherWon"],
                "durationS": lv["durationS"],
            }
            for lv in levels
        ],
    }
    old_index.write_text(json.dumps(index, indent=1), encoding="utf-8")
    report = a.report or DOCS_DIR / f"level-export-{a.map}.md"
    report.write_text(
        render_export_report(a.map, levels, failed, uv_clamped, levels_clamped),
        encoding="utf-8",
    )
    print(
        f"[export] {len(levels)} valid levels, {failed} failed, {uv_clamped} uv clamped "
        f"-> {out_dir}; report -> {report}",
        flush=True,
    )


if __name__ == "__main__":
    main()
