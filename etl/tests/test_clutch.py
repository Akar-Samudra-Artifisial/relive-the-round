"""Synthetic rounds only (no GRID data)."""

from __future__ import annotations

from relive_etl.clutch import (
    Death,
    RoundData,
    check_level,
    find_clutch_moments,
    is_late_clutch,
    median_p90,
    rank_score,
)
from relive_etl.spike import decide

A = ["a1", "a2", "a3", "a4", "a5"]
B = ["b1", "b2", "b3", "b4", "b5"]
ROSTERS = {**{p: "A" for p in A}, **{p: "B" for p in B}}


def dense_track(
    start: int, end: int, step: int = 500
) -> list[tuple[int, float, float]]:
    return [(t, float(t), 0.0) for t in range(start, end + 1, step)]


def make_round(
    events: list[Death], end_t: int = 100_000, winner: str = "A"
) -> RoundData:
    return RoundData(1, dict(ROSTERS), end_t, winner, events=events)


def kill(t: int, victim: str, clock: float | None = None) -> Death:
    return Death(t, victim, "x", clock)


def test_detects_1v3_at_the_kill_that_leaves_one_alive() -> None:
    ev = [
        kill(10_000, "b1"),
        kill(20_000, "a1"),
        kill(30_000, "a2"),
        kill(40_000, "a3"),
        kill(50_000, "b2"),
        kill(60_000, "a4", clock=30),
    ]
    clutches = find_clutch_moments(make_round(ev))
    assert len(clutches) == 1
    c = clutches[0]
    assert (c.team, c.clutcher, c.size, c.t) == ("A", "a5", "1v3", 60_000)
    assert c.opponents == ("b3", "b4", "b5")
    assert c.time_source == "clock" and c.remaining_s == 30


def test_1v1_is_not_a_clutch_and_one_moment_per_team() -> None:
    rd = RoundData(
        1, {"a4": "A", "a5": "A", "b5": "B"}, 10_000, "A", [kill(1_000, "a4")]
    )
    assert find_clutch_moments(rd) == []  # 2v1 -> 1v1 is not a clutch
    ev2 = [kill(1_000, p) for p in ("a1", "a2", "a3", "a4", "b1", "b2")]
    cl = find_clutch_moments(make_round(ev2))
    assert [c.size for c in cl] == ["1v5"]  # later 1v4/1v3 states are the same clutch


def test_opponent_reaching_1v1_is_not_a_second_clutch() -> None:
    ev = [kill(1_000, p) for p in ("a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4")]
    sizes = sorted(c.size for c in find_clutch_moments(make_round(ev)))
    # A: 1v5 after a4; B: after b4 B has 1 vs A's 1 -> not a clutch
    assert sizes == ["1v5"]


def test_revive_restores_player() -> None:
    ev = [
        kill(1_000, "a1"),
        kill(2_000, "a2"),
        kill(3_000, "a3"),
        Death(3_500, "a3", alive=True),
        kill(4_000, "a4"),
    ]
    cl = find_clutch_moments(make_round(ev))
    assert cl == []  # a3 + a5 still alive -> 2v5


def test_late_window_uses_clock_then_round_end_fallback() -> None:
    ev = [kill(1_000, p) for p in ("a1", "a2", "a3")] + [kill(70_000, "a4")]
    c = find_clutch_moments(make_round(ev, end_t=100_000))[0]
    assert c.time_source == "round_end" and c.remaining_s == 30.0 and is_late_clutch(c)
    ev[-1] = kill(70_000, "a4", clock=46)
    c = find_clutch_moments(make_round(ev, end_t=100_000))[0]
    assert c.time_source == "clock" and not is_late_clutch(c)


def _clutch_round(tracks: dict[str, list[tuple[int, float, float]]]) -> RoundData:
    ev = [kill(1_000, p) for p in ("a1", "a2", "a3", "b1", "b2")] + [
        kill(70_000, "a4", clock=30)
    ]
    ev += [kill(80_000, "b3"), kill(90_000, "b4"), kill(95_000, "b5")]
    rd = make_round(ev, end_t=95_000)
    rd.tracks = tracks
    return rd


def test_level_passes_with_dense_tracks_until_death() -> None:
    tracks = {
        "a5": dense_track(70_000, 95_000),
        "b3": dense_track(70_000, 80_000),  # dies at 80 s: nothing needed after
        "b4": dense_track(70_000, 90_000),
        "b5": dense_track(70_000, 95_000),
    }
    rd = _clutch_round(tracks)
    c = find_clutch_moments(rd)[0]
    chk = check_level(rd, c)
    assert c.size == "1v3" and chk.passed
    assert chk.max_gap_ms["b3"] <= 500
    assert chk.combat_gaps_ms and max(chk.combat_gaps_ms) <= 500


def test_level_fails_on_gap_over_6s() -> None:
    gappy = dense_track(70_000, 80_000) + dense_track(86_500, 95_000)  # 6.5 s hole
    tracks = {
        "a5": gappy,
        "b3": dense_track(70_000, 80_000),
        "b4": dense_track(70_000, 90_000),
        "b5": dense_track(70_000, 95_000),
    }
    rd = _clutch_round(tracks)
    chk = check_level(rd, find_clutch_moments(rd)[0])
    assert not chk.passed and chk.max_gap_ms["a5"] == 6_500


def test_opponent_with_few_positions_passes_relaxed_but_not_strict() -> None:
    still = [
        (t, 1.0, 1.0) for t in range(70_000, 95_001, 500)
    ]  # sampled but never moves
    tracks = {
        "a5": dense_track(70_000, 95_000),
        "b3": still[:5],
        "b4": [(1_000, 5.0, 5.0)],  # only a start position, long before the clutch
        "b5": dense_track(70_000, 95_000),
    }
    rd = _clutch_round(tracks)
    c = find_clutch_moments(rd)[0]
    chk = check_level(rd, c)
    assert chk.distinct_positions["b3"] == 1 and chk.distinct_positions["b4"] == 0
    assert chk.passed and chk.relaxed_passed and not chk.strict_passed
    assert not check_level(rd, c, strict=True).passed


def test_clutcher_with_few_positions_fails() -> None:
    tracks = {
        "a5": [
            (t, float(t % 3), 0.0) for t in range(70_000, 95_001, 500)
        ],  # 3 distinct
        "b3": dense_track(70_000, 80_000),
        "b4": dense_track(70_000, 90_000),
        "b5": dense_track(70_000, 95_000),
    }
    rd = _clutch_round(tracks)
    chk = check_level(rd, find_clutch_moments(rd)[0])
    assert chk.distinct_positions["a5"] == 3 and chk.max_gap_ms["a5"] <= 500
    assert not chk.passed and not chk.relaxed_passed


def test_opponent_without_any_position_fails_relaxed() -> None:
    tracks = {
        "a5": dense_track(70_000, 95_000),
        "b3": dense_track(70_000, 80_000),
        "b5": dense_track(70_000, 95_000),
    }  # b4 never seen
    rd = _clutch_round(tracks)
    assert not check_level(rd, find_clutch_moments(rd)[0]).passed


def test_rank_score_prefers_win_then_size_then_density() -> None:
    assert rank_score(True, 2, 6_000) > rank_score(False, 5, 0)
    assert rank_score(False, 3, 6_000) > rank_score(False, 2, 0)
    assert rank_score(True, 2, 1_000) > rank_score(True, 2, 3_000)
    assert rank_score(True, 3, 0) == 130.0


def test_window_edges_count_as_gaps() -> None:
    tracks = {
        "a5": dense_track(77_000, 95_000),
        "b3": dense_track(70_000, 80_000),
        "b4": dense_track(70_000, 90_000),
        "b5": dense_track(70_000, 95_000),
    }
    rd = _clutch_round(tracks)
    chk = check_level(rd, find_clutch_moments(rd)[0])
    assert chk.max_gap_ms["a5"] == 7_000 and not chk.passed


def test_median_p90_and_decision() -> None:
    assert median_p90([]) == (None, None)
    assert median_p90(list(range(1, 11))) == (5.5, 9.0)
    assert decide(30, 12) == "GO (2 maps)"
    assert decide(40, 11) == "GO (1 map)"
    assert decide(29, 20) == "GO (1 map)"
    assert decide(10, 0) == "GO (1 map)"
    assert decide(9, 9) == "Plan B"
