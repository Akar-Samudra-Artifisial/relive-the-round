"""Feed parser on a tiny synthetic feed written to tmp_path (no GRID data)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import zstandard

from relive_etl.spike import parse_series

GID = "g1"


def _state(t_pos: float, clock: int) -> dict[str, Any]:
    teams = [
        {
            "id": tid,
            "players": [
                {"id": f"{tid.lower()}{i}", "position": {"x": t_pos + i, "y": 0}}
                for i in range(1, 6)
            ],
        }
        for tid in ("A", "B")
    ]
    return {
        "games": [
            {
                "id": GID,
                "clock": {"currentSeconds": clock, "ticksBackwards": True},
                "teams": teams,
            }
        ]
    }


def _ev(
    etype: str, actor: dict[str, Any], target: dict[str, Any], pos: float, clock: int
) -> dict[str, Any]:
    return {
        "type": etype,
        "action": etype.split("-")[1],
        "actor": actor,
        "target": target,
        "seriesStateDelta": {"games": [{"id": GID}]},
        "seriesState": _state(pos, clock),
    }


def _kill(killer: str, victim: str, pos: float, clock: int) -> dict[str, Any]:
    return _ev(
        "player-killed-player",
        {
            "type": "player",
            "id": killer,
            "stateDelta": {"game": {"weaponKills": {"vandal": 1}}},
        },
        {"type": "player", "id": victim},
        pos,
        clock,
    )


def _write(path: Path, events: list[tuple[int, dict[str, Any]]]) -> None:
    lines = [
        json.dumps(
            {
                "occurredAt": f"2025-01-01T00:{s // 60:02d}:{s % 60:02d}.000Z",
                "events": [e],
            }
        )
        for s, e in events
    ]
    path.write_bytes(
        zstandard.ZstdCompressor().compress(("\n".join(lines) + "\n").encode())
    )


def test_parse_series_round_kills_tracks_and_post_round_cutoff(tmp_path: Path) -> None:
    game = {"type": "game", "id": GID}
    events = [
        (
            0,
            _ev("game-started-round", game, {"type": "round", "id": "round-3"}, 0, 100),
        ),
        (1, _ev("round-ended-freezetime", game, {"type": "round"}, 0, 100)),
        (10, _kill("b1", "a1", 10, 90)),
        (12, _kill("b1", "a2", 12, 88)),
        (
            14,
            _ev(
                "player-!killed-player",
                {"type": "player", "id": "b1"},
                {"type": "player", "id": "a2"},
                14,
                86,
            ),
        ),
        (
            20,
            _ev(
                "team-won-round",
                {"type": "team", "id": "B", "state": {"side": "attacker"}},
                {"type": "round", "id": "round-3"},
                20,
                80,
            ),
        ),
        (22, _kill("b1", "a3", 22, 78)),  # post-round: must be ignored
        (25, _ev("game-ended-round", game, {"type": "round", "id": "round-3"}, 25, 75)),
    ]
    feed = tmp_path / "feed.jsonl.zst"
    _write(feed, events)
    rounds, stats = parse_series(feed, {GID})
    assert len(rounds) == 1
    rd = rounds[0]
    assert rd.number == 3 and rd.winner_team == "B" and len(rd.rosters) == 10
    assert [e.victim for e in rd.events] == [
        "a1"
    ]  # reversal removed a2, post-round a3 ignored
    assert rd.events[0].clock_s == 90
    assert rd.end_t - rd.events[0].t == 10_000  # round end = team-won-round
    assert [t for t, _, _ in rd.tracks["a1"]][-1] == rd.end_t
    assert stats.kills == 2 and stats.kills_with_weapon == 2
