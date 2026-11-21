"""Go/no-go spike: is GRID VALORANT position data dense enough to rebuild late-round clutches?

Usage: STL_DATA_DIR=... uv run relive-spike --maps haven lotus
Writes only aggregates (no player/team names, no raw positions) to docs/spike-report.md.

The feed walk is adapted from utility-fingerprint `extract.parse_feed` (MIT): round boundaries,
kill events, reversal handling and `positions_from_state`.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .clutch import (
    CLUTCH_MAX_REMAINING_S,
    LEVEL_MAX_GAP_MS,
    LEVEL_MIN_DISTINCT_POSITIONS,
    Death,
    RoundData,
    check_level,
    find_clutch_moments,
    is_late_clutch,
    median_p90,
    rank_score,
)
from .config import DOCS_DIR, LEVELS_DATA_DIR, data_dir
from .grid_io import iter_lines, series_feed

SIZES = ("1v2", "1v3", "1v4", "1v5")


def ts_ms(value: str) -> int:
    """ISO-8601 UTC timestamp ('...Z') -> epoch milliseconds."""
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def round_no(target_id: str | None) -> int | None:
    if target_id and target_id.startswith("round-"):
        try:
            return int(target_id.split("-", 1)[1])
        except ValueError:
            return None
    return None


def event_game_id(ev: dict[str, Any]) -> str | None:
    games = (ev.get("seriesStateDelta") or {}).get("games") or []
    if games and games[0].get("id"):
        return str(games[0]["id"])
    actor = ev.get("actor") or {}
    return str(actor["id"]) if actor.get("type") == "game" else None


def state_game(ev: dict[str, Any], gid: str) -> dict[str, Any] | None:
    for g in (ev.get("seriesState") or {}).get("games") or []:
        if g.get("id") == gid:
            return g
    return None


def positions_from_state(game: dict[str, Any] | None) -> list[tuple[str, float, float]]:
    """(player_id, x, y) of every player of the game snapshot that has a position."""
    out = []
    for tm in (game or {}).get("teams") or []:
        for p in tm.get("players") or []:
            pos = p.get("position")
            if pos and pos.get("x") is not None and pos.get("y") is not None:
                out.append((str(p["id"]), float(pos["x"]), float(pos["y"])))
    return out


def rosters_from_state(game: dict[str, Any] | None) -> dict[str, str]:
    return {
        str(p["id"]): str(tm["id"])
        for tm in (game or {}).get("teams") or []
        for p in tm.get("players") or []
        if tm.get("id") and p.get("id")
    }


def clock_seconds(game: dict[str, Any] | None) -> float | None:
    clock = (game or {}).get("clock") or {}
    v = clock.get("currentSeconds")
    return (
        float(v)
        if isinstance(v, (int, float)) and clock.get("ticksBackwards", True)
        else None
    )


@dataclass
class _Live:
    rd: RoundData
    freeze_end: int | None = None
    last_pos: dict[str, tuple[float, float]] = field(default_factory=dict)


@dataclass
class FieldStats:
    kills: int = 0
    kills_with_clock: int = 0
    kills_with_weapon: int = 0
    full_snapshots: int = 0
    full_snapshots_with_inventory: int = 0
    rounds: int = 0


EventHook = Callable[[RoundData, int, dict[str, Any], dict[str, Any] | None], None]


def parse_series(
    feed: Path, games: set[str], on_event: EventHook | None = None
) -> tuple[list[RoundData], FieldStats]:
    """Walk one feed and return completed rounds (with kills + position tracks) of `games`.

    `on_event(round, t_ms, event, game_state)` is called for every event of a live round up to and
    including `team-won-round` (used by the level exporter to collect hp/weapons/kill positions).
    """
    stats = FieldStats()
    live: dict[str, _Live] = {}
    done: list[RoundData] = []
    for line in iter_lines(feed):
        env = json.loads(line)
        t = ts_ms(env["occurredAt"])
        for ev in env["events"]:
            gid = event_game_id(ev)
            if gid not in games:
                continue
            etype = ev["type"]
            actor, target = ev.get("actor") or {}, ev.get("target") or {}
            game = state_game(ev, gid)
            cur = live.get(gid)
            if ev.get("includesFullState") and game is not None:
                stats.full_snapshots += 1
                if any(
                    (p.get("inventory") or {}).get("items")
                    for tm in game.get("teams") or []
                    for p in tm.get("players") or []
                ):
                    stats.full_snapshots_with_inventory += 1
            if etype == "game-started-round":
                rn = round_no(target.get("id"))
                if rn is not None:
                    live[gid] = _Live(
                        RoundData(rn, rosters_from_state(game), 0, None, game_id=gid)
                    )
                continue
            if cur is None:
                continue
            rd = cur.rd
            if etype == "game-!started-round":
                live.pop(gid, None)
                continue
            if etype == "round-ended-freezetime":
                cur.freeze_end = t
                rosters = rosters_from_state(game)
                if rosters:
                    rd.rosters = rosters
            # after team-won-round (post-round phase) kills/movement don't belong to the clutch
            decided = rd.winner_team is not None
            if decided and etype not in ("team-!won-round", "game-ended-round"):
                continue
            if on_event is not None and not decided:
                on_event(rd, t, ev, game)
            if cur.freeze_end is not None and game is not None and not decided:
                for pid, x, y in positions_from_state(game):
                    if cur.last_pos.get(pid) != (x, y):
                        cur.last_pos[pid] = (x, y)
                        rd.tracks.setdefault(pid, []).append((t, x, y))
            if etype == "player-killed-player" or etype == "player-selfkilled-player":
                stats.kills += 1
                clock = clock_seconds(game)
                stats.kills_with_clock += clock is not None
                delta = (actor.get("stateDelta") or {}).get("game") or {}
                stats.kills_with_weapon += bool(delta.get("weaponKills"))
                victim = str(target.get("id") or actor.get("id"))
                rd.events.append(Death(t, victim, str(actor.get("id")), clock))
            elif etype == "player-!killed-player":
                victim, killer = str(target.get("id")), str(actor.get("id"))
                for i in range(len(rd.events) - 1, -1, -1):
                    if rd.events[i].victim == victim and rd.events[i].killer == killer:
                        del rd.events[i]
                        break
            elif target.get("type") == "player" and ev.get("action") in (
                "revived",
                "respawned",
            ):
                rd.events.append(Death(t, str(target.get("id")), alive=True))
            elif etype == "player-completed-plantBomb" and rd.plant_t is None:
                rd.plant_t = t
            elif etype == "team-won-round":
                rd.winner_team = str(actor.get("id"))
                rd.end_t = t
            elif etype == "team-!won-round":
                rd.winner_team = None
            elif etype == "game-ended-round":
                if rd.winner_team is not None:
                    done.append(rd)
                    stats.rounds += 1
                live.pop(gid, None)
    return done, stats


@dataclass
class ClutchRow:
    map: str
    size: str
    remaining_s: float
    time_source: str
    late: bool
    passed: bool
    won: bool
    planted_before: bool
    gaps_ms: list[int]
    combat_gaps_ms: list[int]
    min_distinct: int
    max_gap_ms: int
    duration_s: float  # clutch moment -> round decided
    strict_passed: bool  # every alive player meets the density rule
    relaxed_passed: bool  # clutcher meets it, opponents only need a start position
    # identifiers + clutcher stats for the git-ignored candidates file (never in the report)
    series_id: str = ""
    game_id: str = ""
    round_number: int = 0
    clutch_t: int = 0
    end_t: int = 0
    clutcher_id: str = ""
    opponent_ids: tuple[str, ...] = ()
    clutcher_distinct: int = 0
    clutcher_max_gap_ms: int = 0

    @property
    def n_opponents(self) -> int:
        return int(self.size[2:])

    @property
    def score(self) -> float:
        return rank_score(self.won, self.n_opponents, self.clutcher_max_gap_ms)


def analyse_series(
    args: tuple[str, Path, dict[str, str], bool],
) -> tuple[list[ClutchRow], FieldStats]:
    series_id, feed, game_maps, strict = args
    rounds, stats = parse_series(feed, set(game_maps))
    rows: list[ClutchRow] = []
    map_name = next(iter(game_maps.values()))  # jobs are split per (series, map)
    for rd in rounds:
        for c in find_clutch_moments(rd):
            chk = check_level(rd, c, strict=strict)
            rows.append(
                ClutchRow(
                    map=map_name,
                    size=c.size,
                    remaining_s=c.remaining_s,
                    time_source=c.time_source,
                    late=is_late_clutch(c),
                    passed=chk.passed,
                    won=rd.winner_team == c.team,
                    planted_before=rd.plant_t is not None and rd.plant_t <= c.t,
                    gaps_ms=chk.gaps_ms,
                    combat_gaps_ms=chk.combat_gaps_ms,
                    min_distinct=min(chk.distinct_positions.values()),
                    max_gap_ms=max(chk.max_gap_ms.values()),
                    duration_s=(rd.end_t - c.t) / 1000,
                    strict_passed=chk.strict_passed,
                    relaxed_passed=chk.relaxed_passed,
                    series_id=series_id,
                    game_id=rd.game_id,
                    round_number=rd.number,
                    clutch_t=c.t,
                    end_t=rd.end_t,
                    clutcher_id=c.clutcher,
                    opponent_ids=c.opponents,
                    clutcher_distinct=chk.distinct_positions[c.clutcher],
                    clutcher_max_gap_ms=chk.max_gap_ms[c.clutcher],
                )
            )
    return rows, stats


def candidates(rows: list[ClutchRow]) -> list[dict[str, Any]]:
    """Passed late clutches, best first (score desc, then more clutcher positions)."""
    passed = [r for r in rows if r.late and r.passed]
    passed.sort(key=lambda r: (-r.score, -r.clutcher_distinct, -r.duration_s))
    return [
        {
            "id": f"{r.game_id}:r{r.round_number}",
            "series_id": r.series_id,
            "game_id": r.game_id,
            "round": r.round_number,
            "map": r.map,
            "size": r.size,
            "won": r.won,
            "duration_s": round(r.duration_s, 2),
            "remaining_s": r.remaining_s,
            "post_plant": r.planted_before,
            "clutch_t_ms": r.clutch_t,
            "end_t_ms": r.end_t,
            "clutcher_id": r.clutcher_id,
            "opponent_ids": list(r.opponent_ids),
            "clutcher_positions": r.clutcher_distinct,
            "clutcher_max_gap_s": round(r.clutcher_max_gap_ms / 1000, 2),
            "strict_passed": r.strict_passed,
            "score": r.score,
        }
        for r in passed
    ]


def _jobs(
    root: Path, maps: list[str], strict: bool = False
) -> list[tuple[str, Path, dict[str, str], bool]]:
    """One job per (series, map) so every row has a single known map."""
    by: dict[tuple[str, str], dict[str, str]] = defaultdict(dict)
    with (root / "meta" / "games.csv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            m = r["map"].lower()
            if r["title"] == "val" and m in maps:
                by[(r["series_id"], m)][r["game_id"]] = m
    out = []
    for (sid, _), games in sorted(by.items()):
        feed = series_feed(root, sid)
        if feed.is_file():
            out.append((sid, feed, games, strict))
    return out


def _fmt(v: float | None, scale: float = 1000.0) -> str:
    return "n/a" if v is None else f"{v / scale:.2f}"


def decide(passed: int, won: int) -> str:
    """Week-2 rule: GO (2 maps) if >= 30 passed and >= 12 won; combat density is reported only."""
    if passed >= 30 and won >= 12:
        return "GO (2 maps)"
    if passed >= 10:
        return "GO (1 map)"
    return "Plan B"


def render_report(
    maps: list[str],
    rows: list[ClutchRow],
    stats: FieldStats,
    n_series: int,
    strict: bool = False,
) -> str:
    late = [r for r in rows if r.late]
    passed = [r for r in late if r.passed]
    won = [r for r in passed if r.won]
    all_gaps = [g for r in late for g in r.gaps_ms]
    combat_gaps = [g for r in late for g in r.combat_gaps_ms]
    gm, gp = median_p90(all_gaps)
    cm, cp = median_p90(combat_gaps)
    pgm, pgp = median_p90([g for r in passed for g in r.gaps_ms])
    pcm, pcp = median_p90([g for r in passed for g in r.combat_gaps_ms])
    cm_s = None if cm is None else cm / 1000
    decision = decide(len(passed), len(won))
    src = Counter(r.time_source for r in late)
    other = [r for r in late if (r.relaxed_passed if strict else r.strict_passed)]
    other_name = "relaxed" if strict else "strict"
    dm, dp = median_p90([round(r.duration_s * 1000) for r in late])
    dm, dp = (None, None) if dm is None else (dm / 1000, (dp or 0) / 1000)
    pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "n/a"  # noqa: E731

    lines = [
        "# Spike report: are GRID positions dense enough for clutch levels?",
        "",
        f"Maps: {', '.join(maps)}. Series scanned: {n_series}. Rounds parsed: {stats.rounds}.",
        "Aggregates only; no player or team names, no raw positions.",
        "",
        "## Definitions",
        "",
        "- **Clutch moment**: the first kill in a round that leaves a team with exactly 1 alive player "
        f"against >= 2 alive opponents, with <= {CLUTCH_MAX_REMAINING_S:.0f} s of round time left.",
        "- **Time left**: the GRID game clock (`seriesState.games[].clock.currentSeconds`, counts down; "
        "it is reset to the spike timer after a plant) at the kill event. Fallback when the clock is "
        "missing: time until round end.",
        f"- **Level passes** (rule in use: **{'strict' if strict else 'relaxed'}**). Relaxed (default): "
        "from the clutch moment until their death or round end, the clutcher has a max gap between "
        "position changes <= 6 s (window edges count) and >= 6 distinct positions; each opponent only "
        "needs >= 1 known position (opponents are driven by bots in the game). Strict (`--strict`): "
        "every player alive at the clutch moment meets the clutcher rule.",
        "- **Combat gaps**: gaps between position changes whose interval overlaps +-3 s around any kill "
        "inside the clutch window.",
        "",
        "## Results",
        "",
        "| Map | 1vN moments (any time) | Clutches (<= 45 s) | Passed | Passed & won by clutcher |",
        "|---|---:|---:|---:|---:|",
    ]
    for m in maps:
        mr = [r for r in rows if r.map == m]
        ml = [r for r in mr if r.late]
        mp = [r for r in ml if r.passed]
        lines.append(
            f"| {m} | {len(mr)} | {len(ml)} | {len(mp)} | {sum(r.won for r in mp)} |"
        )
    lines.append(
        f"| **total** | {len(rows)} | {len(late)} | {len(passed)} | {len(won)} |"
    )
    lines += [
        "",
        "| Size | Clutches (<= 45 s) | Passed | Passed & won |",
        "|---|---:|---:|---:|",
    ]
    for s in SIZES:
        sl = [r for r in late if r.size == s]
        sp = [r for r in sl if r.passed]
        lines.append(f"| {s} | {len(sl)} | {len(sp)} | {sum(r.won for r in sp)} |")
    if strict:
        fail_gap = sum(1 for r in late if r.max_gap_ms > LEVEL_MAX_GAP_MS)
        fail_distinct = sum(
            1 for r in late if r.min_distinct < LEVEL_MIN_DISTINCT_POSITIONS
        )
        who = "any alive player"
    else:
        fail_gap = sum(1 for r in late if r.clutcher_max_gap_ms > LEVEL_MAX_GAP_MS)
        fail_distinct = sum(
            1 for r in late if r.clutcher_distinct < LEVEL_MIN_DISTINCT_POSITIONS
        )
        who = "clutcher"
    lines += [
        "",
        f"Why clutches fail (not exclusive, {who}): "
        f"max gap > 6 s: {fail_gap}; < 6 distinct positions: {fail_distinct}.",
        "",
        "Clutch window length (clutch moment -> round decided), clutches <= 45 s: "
        f"median {_fmt(dm, 1)} s, p90 {_fmt(dp, 1)} s; windows >= 10 s: "
        f"{sum(r.duration_s >= 10 for r in late)}.",
        "",
        f"Comparison (not used for the decision): {other_name} rule: {len(other)} pass, "
        f"{sum(r.won for r in other)} won by the clutcher.",
        "",
        "| Position-change gap (s) | median | p90 |",
        "|---|---:|---:|",
        f"| all clutch windows | {_fmt(gm)} | {_fmt(gp)} |",
        f"| combat (+-3 s around kills), all clutches | {_fmt(cm)} | {_fmt(cp)} |",
        f"| passed levels only | {_fmt(pgm)} | {_fmt(pgp)} |",
        f"| combat, passed levels only | {_fmt(pcm)} | {_fmt(pcp)} |",
        "",
        f"Post-plant clutches (<= 45 s): {sum(r.planted_before for r in late)} of {len(late)}. "
        f"Time-left source: clock {src.get('clock', 0)}, round-end fallback {src.get('round_end', 0)}.",
        "",
        "## Fields available",
        "",
        f"- Round clock on kill events: {stats.kills_with_clock}/{stats.kills} ({pct(stats.kills_with_clock, stats.kills)}).",
        f"- Weapon on kill events (`actor.stateDelta.game.weaponKills`): {stats.kills_with_weapon}/{stats.kills} "
        f"({pct(stats.kills_with_weapon, stats.kills)}).",
        f"- Inventory (current weapons) in full snapshots: {stats.full_snapshots_with_inventory}/{stats.full_snapshots} "
        f"({pct(stats.full_snapshots_with_inventory, stats.full_snapshots)}); trimmed per-event snapshots carry "
        "positions but no inventory/alive/health.",
        "- Positions are 2D `{x, y}` cm, refreshed per event (no fixed tick).",
        "",
        "## Decision",
        "",
        "Rule (week 2, relaxed level rule): GO (2 maps) if >= 30 passed and >= 12 won by the "
        "clutcher; GO (1 map) if >= 10 passed but the 2-map bar is missed; "
        "Plan B if < 10 passed (start positions + kill locations as keyframes, full bot FSM). "
        "The week-1 combat-density bar (median <= 1.0 s) is now informational only, because "
        "opponents are bot-driven and only the clutcher track replays data.",
        "",
        f"**Decision: {decision}**",
        "",
        "2-map bar check: "
        f"passed {len(passed)} >= 30: {'yes' if len(passed) >= 30 else 'no'}; "
        f"won {len(won)} >= 12: {'yes' if len(won) >= 12 else 'no'}. "
        f"Info: combat median gap {'n/a' if cm_s is None else f'{cm_s:.3f}'} s (all clutches), "
        f"{_fmt(pcm)} s (passed levels).",
        "",
        "## Level candidates (top 12 per map)",
        "",
        "Score = 100 if the clutcher won + 20 per opponent beyond 2 + 0..10 for clutcher track "
        "density (10 at 0 s max gap, 0 at 6 s). Ties: more clutcher positions, then longer window. "
        "The full list with ids is written to the git-ignored `data/levels/candidates.json`; "
        "this table is anonymous.",
        "",
    ]
    cands = candidates(rows)
    for m in maps:
        top = [c for c in cands if c["map"] == m][:12]
        lines += [
            f"### {m}",
            "",
            "| Rank | Size | Result | Window (s) | Post-plant | Clutcher positions | Clutcher max gap (s) | Score |",
            "|---:|---|---|---:|---|---:|---:|---:|",
        ]
        for i, c in enumerate(top, 1):
            lines.append(
                f"| {i} | {c['size']} | {'won' if c['won'] else 'lost'} | {c['duration_s']:.1f} | "
                f"{'yes' if c['post_plant'] else 'no'} | {c['clutcher_positions']} | "
                f"{c['clutcher_max_gap_s']:.2f} | {c['score']:.2f} |"
            )
        lines.append("")
    return "\n".join(lines)


def write_candidates(rows: list[ClutchRow], path: Path) -> int:
    """Write ranked candidates (with GRID ids) to a git-ignored file; returns the count."""
    cands = candidates(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cands, indent=1), encoding="utf-8")
    return len(cands)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--maps", nargs="+", default=["haven", "lotus"])
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="max series jobs (0 = all)")
    ap.add_argument("--out", type=Path, default=DOCS_DIR / "spike-report.md")
    ap.add_argument(
        "--candidates",
        type=Path,
        default=LEVELS_DATA_DIR / "candidates.json",
        help="ranked candidates with GRID ids (keep this path git-ignored)",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="every alive player must meet the density rule (default: clutcher only)",
    )
    a = ap.parse_args(argv)
    maps = [m.lower() for m in a.maps]
    jobs = _jobs(data_dir(), maps, strict=a.strict)
    if a.limit:
        jobs = jobs[: a.limit]
    rows: list[ClutchRow] = []
    total = FieldStats()
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for i, (r, s) in enumerate(pool.map(analyse_series, jobs), 1):
            rows.extend(r)
            for k in vars(total):
                setattr(total, k, getattr(total, k) + getattr(s, k))
            if i % 50 == 0:
                print(f"[spike] {i}/{len(jobs)} series", flush=True)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(
        render_report(maps, rows, total, len(jobs), strict=a.strict), encoding="utf-8"
    )
    n_cands = write_candidates(rows, a.candidates)
    late = [r for r in rows if r.late]
    print(
        f"[spike] clutches<=45s={len(late)} passed={sum(r.passed for r in late)} "
        f"won={sum(r.passed and r.won for r in late)} -> {a.out}; "
        f"{n_cands} candidates -> {a.candidates}",
        flush=True,
    )


if __name__ == "__main__":
    main()
