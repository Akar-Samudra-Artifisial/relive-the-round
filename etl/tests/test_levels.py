"""Level export + schema validation on synthetic rounds only (no GRID data)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
import zstandard

from relive_etl.clutch import (
    Death,
    RoundData,
    check_level,
    clutch_deaths,
    find_clutch_moments,
)
from relive_etl.geometry import MapCalib, nearest_site
from relive_etl.levels import (
    Collector,
    KillInfo,
    RoundExtra,
    _uv,
    build_level,
    load_validator,
    main_weapon,
    semantic_errors,
    validate_level,
)
from relive_etl.spike import parse_series

CALIB = MapCalib("haven", "Haven", 1e-5, -1e-5, 0.5, 0.5)
SITES = {"A": (5000.0, -9000.0), "B": (2000.0, -9000.0), "C": (-2000.0, -9000.0)}
A = ["a1", "a2", "a3", "a4", "a5"]
B = ["b1", "b2", "b3", "b4", "b5"]
ROSTERS = {**{p: "A" for p in A}, **{p: "B" for p in B}}


def track(start: int, end: int, step: int = 500) -> list[tuple[int, float, float]]:
    return [
        (t, float(t % 7000), -1000.0 - t % 3000) for t in range(start, end + 1, step)
    ]


def synthetic_round() -> tuple[RoundData, RoundExtra]:
    """A loses 4 players -> 1v3 at 70 s; clutcher a5 kills b3, b4, b5; spike planted at 60 s."""
    kills = [
        ("b1", "a1", 1_000),
        ("b1", "a2", 2_000),
        ("b2", "a3", 3_000),
        ("a4", "b1", 4_000),
    ]
    kills += [("a4", "b2", 5_000), ("b3", "a4", 70_000)]
    kills += [("a5", "b3", 75_000), ("a5", "b4", 80_000), ("a5", "b5", 88_000)]
    rd = RoundData(
        number=7,
        rosters=dict(ROSTERS),
        end_t=88_000,
        winner_team="A",
        events=[
            Death(t, v, k, clock_s=30.0 if t == 70_000 else None) for k, v, t in kills
        ],
        tracks={
            "a5": track(60_000, 88_000),
            "b3": track(60_000, 75_000),
            "b4": [(50_000, 100.0, -2000.0)],  # only a start position (relaxed rule)
            "b5": track(60_000, 88_000, 1_000),
        },
        plant_t=60_000,
        game_id="g1",
    )
    ex = RoundExtra(
        side={"A": "attacker", "B": "defender"},
        hp={"a5": [(1_000, 100.0), (65_000, 74.0)], "b3": [(1_000, 100.0)]},
        armor={"a5": [(1_000, 50.0)]},
        weapon={"a5": [(1_000, "vandal")], "b4": [(79_000, "operator")]},
        kills=[
            KillInfo(t, k, v, "vandal", (100.0, -1000.0), (200.0, -1200.0))
            for k, v, t in kills
        ],
        plant_xy=(4800.0, -8800.0),
        win_type="opponentEliminated",
    )
    return rd, ex


@pytest.fixture(scope="module")
def validator() -> Any:
    return load_validator()


@pytest.fixture
def level() -> dict[str, Any]:
    rd, ex = synthetic_round()
    c = find_clutch_moments(rd)[0]
    return build_level(rd, ex, c, CALIB, SITES, "haven")


def test_built_level_is_valid_and_anonymous(
    level: dict[str, Any], validator: Any
) -> None:
    assert validate_level(level, validator) == []
    assert level["clutchSize"] == 3 and level["clutcherSide"] == "attack"
    assert level["clutcherWon"] and level["outcome"] == {
        "winner": "clutcher",
        "t": 18.0,
        "reason": "elimination",
    }
    assert (
        level["startClockS"] == 30.0
        and level["plantedAtStart"]
        and level["durationS"] == 18.0
    )
    assert level["spike"]["site"] == "A" and level["spike"]["plantT"] == -10.0
    text = json.dumps(level)
    assert not any(
        f'"{p}"' in text for p in [*ROSTERS, "g1"]
    )  # no GRID player/game ids
    assert len(level["id"]) == 12 and level["id"] != "g1"


def test_actor_fields(level: dict[str, Any]) -> None:
    p0 = level["clutcher"]
    assert p0["id"] == "P0" and p0["hp"] == 74.0 and p0["armor"] == 50.0
    assert p0["weapon"] == "vandal" and "diedT" not in p0
    assert p0["samples"][0]["t"] == 0 and p0["samples"][-1]["t"] == 18.0
    assert all(0 <= s["u"] <= 1 and 0 <= s["v"] <= 1 for s in p0["samples"])
    e1, e2, e3 = level["enemies"]
    assert [e["id"] for e in level["enemies"]] == ["E1", "E2", "E3"]
    assert e1["diedT"] == 5.0 and e1["samples"][-1]["t"] == 5.0
    assert (
        e2["samples"] == [e2["samples"][0]] and e2["samples"][0]["t"] == 0
    )  # start only
    assert e2["hp"] == 100.0 and e2["weapon"] == "operator"  # first weapon seen later
    assert e3["diedT"] == 18.0


def test_kills_only_between_actors_inside_window(level: dict[str, Any]) -> None:
    # the t=0 kill (victim is the clutcher's teammate) is not an actor kill
    assert [(k["t"], k["killer"], k["victim"]) for k in level["kills"]] == [
        (5.0, "P0", "E1"),
        (10.0, "P0", "E2"),
        (18.0, "P0", "E3"),
    ]
    assert (
        level["kills"][0]["weapon"] == "vandal"
        and len(level["kills"][0]["killerUV"]) == 2
    )


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda lv: lv.pop("outcome"), "'outcome' is a required property"),
        (lambda lv: lv["enemies"][0].update(id="X1"), "does not match"),
        (lambda lv: lv["spike"].pop("site"), "'site' is a required property"),
        (
            lambda lv: lv["clutcher"]["samples"][0].update(u=1.5),
            "greater than the maximum",
        ),
        (lambda lv: lv.update(playerName="nope"), "Additional properties"),
        (lambda lv: lv.update(clutchSize=4), "clutchSize 4 != 3 enemies"),
        (lambda lv: lv["kills"][0].update(t=99.0), "after round end"),
        (lambda lv: lv["clutcher"]["samples"].reverse(), "not sorted"),
    ],
)
def test_invalid_levels_are_rejected(
    level: dict[str, Any], validator: Any, mutate: Any, needle: str
) -> None:
    bad = copy.deepcopy(level)
    mutate(bad)
    errs = validate_level(bad, validator)
    assert any(needle in e for e in errs), errs


def test_unplanted_spike_must_not_carry_site(
    level: dict[str, Any], validator: Any
) -> None:
    lv = copy.deepcopy(level)
    lv["spike"] = {"planted": False}
    assert validate_level(lv, validator) == []
    lv["spike"]["site"] = "B"
    assert validate_level(lv, validator)


def test_contract_build_level_output_matches_schema_and_semantics(
    validator: Any,
) -> None:
    """Contract: build_level output passes docs/level.schema.json and semantic_errors."""
    rd, ex = synthetic_round()
    lv = build_level(rd, ex, find_clutch_moments(rd)[0], CALIB, SITES, "haven")
    assert [e.message for e in validator.iter_errors(lv)] == []
    assert semantic_errors(lv) == []
    roundtrip = json.loads(json.dumps(lv))  # what the web game reads
    assert [e.message for e in validator.iter_errors(roundtrip)] == []


def _with_same_ms_trade(rd: RoundData, ex: RoundExtra) -> None:
    """Clutcher a5 kills b3 in the same millisecond as the clutch kill, logged after it."""
    i = next(i for i, e in enumerate(rd.events) if e.t == 70_000)
    rd.events.insert(i + 1, Death(70_000, "b3", "a5"))
    ex.kills.append(KillInfo(70_000, "a5", "b3", "vandal", (0.0, 0.0), (10.0, 10.0)))


def test_same_ms_trade_after_clutch_sets_died_t(validator: Any) -> None:
    rd, ex = synthetic_round()
    _with_same_ms_trade(rd, ex)
    c = find_clutch_moments(rd)[0]
    assert c.t == 70_000 and rd.events[c.event_index].victim == "a4"
    assert clutch_deaths(rd, c)["b3"] == 70_000
    lv = build_level(rd, ex, c, CALIB, SITES, "haven")
    e1 = lv["enemies"][0]
    assert e1["diedT"] == 0.0 and [s["t"] for s in e1["samples"]] == [0.0]
    assert (0.0, "P0", "E1") in [
        (k["t"], k["killer"], k["victim"]) for k in lv["kills"]
    ]
    assert validate_level(lv, validator) == []
    # the clutch criterion uses the same death time: E1's window is [t0, t0]
    assert check_level(rd, c).max_gap_ms["b3"] == 0


def test_same_ms_event_before_clutch_is_not_a_clutch_death() -> None:
    rd, _ = synthetic_round()
    rd.events = [e for e in rd.events if e.victim != "b5"]
    i = next(i for i, e in enumerate(rd.events) if e.t == 70_000)
    rd.events.insert(
        i, Death(70_000, "b5", "a4")
    )  # before the clutch kill in feed order
    c = find_clutch_moments(rd)[0]
    assert c.opponents == ("b3", "b4")  # b5 was already dead at the clutch kill
    assert "b5" not in clutch_deaths(rd, c)


def test_uv_is_clamped_and_counted(validator: Any) -> None:
    n = [0]
    assert _uv(CALIB, -60_000.0, -2_000.0, n) == (0.48, 1.0) and n == [1]
    assert _uv(CALIB, 100.0, 70_000.0, n) == (1.0, 0.499) and n == [2]
    assert _uv(CALIB, 100.0, -2_000.0, n) == (0.48, 0.499) and n == [2]
    rd, ex = synthetic_round()
    rd.tracks["b4"] = [(50_000, -60_000.0, -2_000.0)]  # off the minimap
    clamped = [0]
    lv = build_level(rd, ex, find_clutch_moments(rd)[0], CALIB, SITES, "haven", clamped)
    assert clamped == [1] and lv["enemies"][1]["samples"][0]["v"] == 1.0
    assert validate_level(lv, validator) == []


@pytest.mark.parametrize(
    "breakage, needle",
    [
        (lambda rd, ex: rd.tracks.pop("a5"), "P0 has no position"),
        (lambda rd, ex: rd.tracks.pop("b4"), "E2 has no position"),
        (lambda rd, ex: ex.side.clear(), "side"),
        (lambda rd, ex: setattr(ex, "plant_xy", None), "plant position is missing"),
    ],
)
def test_build_level_failure_paths(breakage: Any, needle: str) -> None:
    rd, ex = synthetic_round()
    c = find_clutch_moments(rd)[0]
    breakage(rd, ex)
    with pytest.raises(ValueError, match=needle):
        build_level(rd, ex, c, CALIB, SITES, "haven")


def test_helpers() -> None:
    assert nearest_site(SITES, 1900.0, -8000.0) == "B"
    assert nearest_site({}, 0.0, 0.0) is None
    assert (
        main_weapon([{"name": "Classic"}, {"name": "Phantom"}, {"name": "heavyShield"}])
        == "phantom"
    )
    assert main_weapon([{"name": "Ghost"}, {"name": "lightShield"}]) == "ghost"
    assert main_weapon([{"name": "spike"}]) is None


def _write_feed(path: Path, events: list[tuple[int, dict[str, Any]]]) -> None:
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


def _game(full: bool) -> dict[str, Any]:
    teams = []
    for tid, side in (("A", "attacker"), ("B", "defender")):
        players = []
        for i in range(1, 6):
            p: dict[str, Any] = {
                "id": f"{tid.lower()}{i}",
                "position": {"x": i * 10, "y": 0},
            }
            if full:
                p |= {
                    "currentHealth": 100,
                    "currentArmor": 25,
                    "inventory": {"items": [{"name": "Classic"}, {"name": "Spectre"}]},
                }
            players.append(p)
        teams.append({"id": tid, "side": side, "players": players})
    return {
        "games": [
            {
                "id": "g1",
                "clock": {"currentSeconds": 40, "ticksBackwards": True},
                "teams": teams,
            }
        ]
    }


def _ev(
    etype: str, actor: dict[str, Any], target: dict[str, Any], full: bool = False
) -> dict[str, Any]:
    return {
        "type": etype,
        "action": etype.split("-")[1],
        "includesFullState": full,
        "actor": actor,
        "target": target,
        "seriesStateDelta": {"games": [{"id": "g1"}]},
        "seriesState": _game(full),
    }


def test_collector_reads_side_hp_weapon_kills_and_win_type(tmp_path: Path) -> None:
    game = {"type": "game", "id": "g1"}
    pos = {"game": {"position": {"x": 1.0, "y": 2.0}}}
    events = [
        (
            0,
            _ev(
                "game-started-round",
                game,
                {"type": "round", "id": "round-2"},
                full=True,
            ),
        ),
        (1, _ev("round-ended-freezetime", game, {"type": "round"}, full=True)),
        (
            5,
            _ev(
                "player-damaged-player",
                {
                    "type": "player",
                    "id": "b1",
                    "stateDelta": {
                        "game": {"damageDealtSources": [{"source": {"name": "vandal"}}]}
                    },
                },
                {
                    "type": "player",
                    "id": "a1",
                    "state": {"game": {"currentHealth": 60, "currentArmor": 0}},
                },
            ),
        ),
        (
            6,
            _ev(
                "player-killed-player",
                {
                    "type": "player",
                    "id": "b1",
                    "state": pos,
                    "stateDelta": {"game": {"weaponKills": {"vandal": 1}}},
                },
                {"type": "player", "id": "a1", "state": pos},
            ),
        ),
        (
            7,
            _ev(
                "player-completed-plantBomb",
                {"type": "player", "id": "a2", "state": pos},
                {},
            ),
        ),
        (
            9,
            _ev(
                "team-won-round",
                {
                    "type": "team",
                    "id": "A",
                    "stateDelta": {"round": {"winType": "bombExploded"}},
                },
                {"type": "round", "id": "round-2"},
            ),
        ),
        (10, _ev("game-ended-round", game, {"type": "round", "id": "round-2"})),
    ]
    feed = tmp_path / "feed.jsonl.zst"
    _write_feed(feed, events)
    col = Collector({("g1", 2)})
    rounds, _ = parse_series(feed, {"g1"}, on_event=col)
    assert len(rounds) == 1 and rounds[0].game_id == "g1"
    ex = col.rounds[("g1", 2)]
    assert ex.side == {"A": "attacker", "B": "defender"}
    assert ex.hp["a1"][-1][1] == 60.0 and ex.armor["a1"][-1][1] == 0.0
    assert ex.weapon["a3"][-1][1] == "spectre" and ex.weapon["b1"][-1][1] == "vandal"
    assert [(k.killer, k.victim, k.weapon, k.victim_xy) for k in ex.kills] == [
        ("b1", "a1", "vandal", (1.0, 2.0))
    ]
    assert ex.plant_xy == (1.0, 2.0) and ex.win_type == "bombExploded"
