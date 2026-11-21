"""Pure clutch logic: detect 1vN moments in a round and check whether the data can drive a level.

No I/O here so it can be tested with small synthetic rounds.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

CLUTCH_MAX_REMAINING_S = 45.0
LEVEL_MAX_GAP_MS = 6_000
LEVEL_MIN_DISTINCT_POSITIONS = 6
COMBAT_HALF_WINDOW_MS = 3_000


@dataclass(frozen=True)
class Death:
    """A player leaving the round (kill, self-kill) or coming back (revive, alive=True)."""

    t: int
    victim: str
    killer: str | None = None
    clock_s: float | None = (
        None  # round clock (seconds remaining) at the event, if known
    )
    alive: bool = False


@dataclass
class RoundData:
    number: int
    rosters: dict[str, str]  # player_id -> team_id, players alive at round start
    end_t: int  # epoch ms of round end
    winner_team: str | None
    events: list[Death] = field(default_factory=list)  # in feed order
    # player_id -> [(t, x, y)] samples where the position changed vs the previous sample
    tracks: dict[str, list[tuple[int, float, float]]] = field(default_factory=dict)
    plant_t: int | None = None
    game_id: str = ""


@dataclass(frozen=True)
class Clutch:
    round_number: int
    t: int
    team: str
    clutcher: str
    opponents: tuple[str, ...]
    remaining_s: float
    time_source: str  # "clock" | "round_end"
    event_index: int = -1  # index of the clutch-creating kill in `RoundData.events`

    @property
    def size(self) -> str:
        return f"1v{len(self.opponents)}"


def remaining_seconds(rd: RoundData, ev: Death) -> tuple[float, str]:
    """Round time left at `ev`: the game clock if present, otherwise time until round end."""
    if ev.clock_s is not None:
        return float(ev.clock_s), "clock"
    return (rd.end_t - ev.t) / 1000.0, "round_end"


def find_clutch_moments(rd: RoundData) -> list[Clutch]:
    """Every kill that first leaves a team with exactly 1 alive player vs >= 2 alive opponents.

    One moment per team per round (the first). Time is not filtered here; see `is_late_clutch`.
    """
    alive = set(rd.rosters)
    teams = set(rd.rosters.values())
    seen: set[str] = set()
    out: list[Clutch] = []
    for i, ev in enumerate(rd.events):
        if ev.alive:
            if ev.victim in rd.rosters:
                alive.add(ev.victim)
            continue
        if ev.victim not in alive:
            continue
        alive.discard(ev.victim)
        for team in teams:
            if team in seen:
                continue
            mine = [p for p in alive if rd.rosters[p] == team]
            theirs = tuple(sorted(p for p in alive if rd.rosters[p] != team))
            if len(mine) == 1 and len(theirs) >= 2:
                seen.add(team)
                rem, src = remaining_seconds(rd, ev)
                out.append(Clutch(rd.number, ev.t, team, mine[0], theirs, rem, src, i))
    return out


def is_late_clutch(c: Clutch) -> bool:
    return c.remaining_s <= CLUTCH_MAX_REMAINING_S


def death_times(rd: RoundData, start: int, after_index: int = -1) -> dict[str, int]:
    """First death at/after `start` per player, counting only events after `after_index`.

    `after_index` is a position in `rd.events` (feed order): a trade logged in the same
    millisecond as the clutch kill but after it still counts, while earlier events in that
    millisecond do not. Revives before the death are ignored for simplicity.
    """
    out: dict[str, int] = {}
    for i, ev in enumerate(rd.events):
        if i <= after_index or ev.alive or ev.t < start or ev.victim in out:
            continue
        out[ev.victim] = ev.t
    return out


def clutch_deaths(rd: RoundData, c: Clutch) -> dict[str, int]:
    """Deaths after the clutch-creating kill (same-millisecond trades included)."""
    if (
        c.event_index < 0
    ):  # Clutch built by hand: fall back to strictly later timestamps
        return death_times(rd, c.t + 1)
    return death_times(rd, c.t, c.event_index)


@dataclass
class LevelCheck:
    passed: bool  # the rule requested by `check_level(strict=...)`
    max_gap_ms: dict[str, int]
    distinct_positions: dict[str, int]
    gaps_ms: list[int]  # every gap between position changes in the window, all players
    combat_gaps_ms: list[int]  # gaps overlapping +-3 s around a kill in the window
    strict_passed: bool = False  # every alive player meets the gap + distinct rule
    relaxed_passed: bool = (
        False  # clutcher meets it; opponents only need a start position
    )


def _player_gaps(
    track: list[tuple[int, float, float]], start: int, end: int
) -> tuple[list[int], list[tuple[int, int]], int]:
    """Gaps between position changes inside [start, end], window edges included as bounds.

    Returns (gap lengths, gap intervals, distinct positions in the window).
    """
    times = [t for t, _, _ in track if start <= t <= end]
    distinct = len({(x, y) for t, x, y in track if start <= t <= end})
    bounds = [start, *times, end]
    intervals = [(a, b) for a, b in zip(bounds, bounds[1:]) if b >= a]
    return [b - a for a, b in intervals], intervals, distinct


def _meets_density(max_gap_ms: int, distinct: int) -> bool:
    return max_gap_ms <= LEVEL_MAX_GAP_MS and distinct >= LEVEL_MIN_DISTINCT_POSITIONS


def check_level(rd: RoundData, c: Clutch, strict: bool = False) -> LevelCheck:
    """Check whether the data can drive a level from the clutch moment to round end.

    Relaxed (default): the clutcher, until death or round end, has a max position gap <= 6 s and
    >= 6 distinct positions; each opponent only needs >= 1 known position at or before its own
    window end (bots move them in the game).
    Strict (`strict=True`): every player alive at the clutch moment meets the clutcher rule.
    """
    deaths = clutch_deaths(rd, c)
    has_start: dict[str, bool] = {}
    kill_times = [ev.t for ev in rd.events if not ev.alive and c.t <= ev.t <= rd.end_t]
    max_gap: dict[str, int] = {}
    distinct: dict[str, int] = {}
    gaps: list[int] = []
    combat: list[int] = []
    for pid in (c.clutcher, *c.opponents):
        end = min(deaths.get(pid, rd.end_t), rd.end_t)
        track = rd.tracks.get(pid, [])
        has_start[pid] = any(t <= end for t, _, _ in track)
        g, intervals, d = _player_gaps(track, c.t, end)
        max_gap[pid] = max(g) if g else 0
        distinct[pid] = d
        gaps.extend(g)
        for (a, b), length in zip(intervals, g):
            if any(
                a <= k + COMBAT_HALF_WINDOW_MS and b >= k - COMBAT_HALF_WINDOW_MS
                for k in kill_times
            ):
                combat.append(length)
    strict_ok = all(_meets_density(max_gap[p], distinct[p]) for p in max_gap)
    relaxed_ok = _meets_density(max_gap[c.clutcher], distinct[c.clutcher]) and all(
        has_start[p] for p in c.opponents
    )
    passed = strict_ok if strict else relaxed_ok
    return LevelCheck(passed, max_gap, distinct, gaps, combat, strict_ok, relaxed_ok)


def rank_score(won: bool, n_opponents: int, clutcher_max_gap_ms: int) -> float:
    """Candidate ranking: a win dominates, then a bigger 1vN, then a denser clutcher track.

    win +100; each opponent beyond 2 +20; density 0..10 (10 at 0 s max gap, 0 at the 6 s limit).
    """
    density = max(0.0, 1.0 - clutcher_max_gap_ms / LEVEL_MAX_GAP_MS) * 10.0
    return round(100.0 * won + 20.0 * max(0, n_opponents - 2) + density, 2)


def median_p90(values: list[int]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    s = sorted(values)
    p90 = s[min(len(s) - 1, int(round(0.9 * (len(s) - 1))))]
    return float(statistics.median(s)), float(p90)
