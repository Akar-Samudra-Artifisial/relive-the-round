"""Calibration anchor math on synthetic points only (no GRID data)."""

from __future__ import annotations

import pytest

from relive_etl.calib import (
    AnchorHook,
    JobResult,
    accumulate_cells,
    build_anchors,
    centroid,
    density_raster,
    hotspots,
    merge_cells,
    merge_rasters,
    raster_extent,
    render_doc,
)
from relive_etl.clutch import RoundData
from relive_etl.geometry import MapCalib

CALIB = MapCalib("haven", "Haven", 1e-5, -1e-5, 0.5, 0.5)


def test_centroid_is_component_median_with_p50_radius() -> None:
    pts = [(0.1, 0.2), (0.3, 0.2), (0.2, 0.4), (0.2, 0.0), (0.9, 0.9)]
    c = centroid(pts)
    assert c is not None
    assert (c["u"], c["v"], c["n"]) == (0.2, 0.2, 5)
    assert c["p50RadiusUV"] == pytest.approx(0.2)  # distances 0.1, 0.1, 0.2, 0.2, 0.99
    assert centroid([]) is None


def test_density_raster_layout_and_off_map_points() -> None:
    r = density_raster(
        [(0.05, 0.95), (0.05, 0.95), (1.0, 0.0), (1.2, 0.5), (-0.1, 0.5)], 10
    )
    assert r[9][0] == 2  # row = v (bottom), col = u (left)
    assert r[0][9] == 1  # u = 1.0 lands in the last column
    assert sum(map(sum, r)) == 3  # off-map points dropped
    assert merge_rasters(r, r)[9][0] == 4


def test_hotspots_pick_busiest_separated_cells() -> None:
    pts = (
        [(0.51, 0.51)] * 10
        + [(0.56, 0.56)] * 8
        + [(0.11, 0.11)] * 5
        + [(0.91, 0.11)] * 3
    )
    acc = accumulate_cells(pts, 10)
    hs = hotspots(acc, k=3, min_sep=2)
    # (0.56, 0.56) shares the busiest cell -> merged; the next ones are far away
    assert [h["count"] for h in hs] == [18, 5, 3]
    assert hs[0]["u"] == pytest.approx((10 * 0.51 + 8 * 0.56) / 18, abs=1e-4)
    assert hs[0]["share"] == pytest.approx(18 / 26, abs=1e-4)
    near = accumulate_cells([(0.55, 0.55)] * 9 + [(0.65, 0.55)] * 8, 10)
    assert [h["count"] for h in hotspots(near, k=2, min_sep=2)] == [
        9
    ]  # neighbour skipped
    assert merge_cells(acc, acc)[(5, 5)][0] == 36


def test_diffuse_centroids_are_not_landmarks() -> None:
    spread = [(0.1, 0.1), (0.9, 0.9), (0.1, 0.9), (0.9, 0.1), (0.5, 0.5)]
    tight = [(0.3, 0.3), (0.31, 0.3), (0.3, 0.31)]
    res = JobResult(1, 1, {"B": tight}, {"defender": spread}, density_raster([]), {})
    anchors, _ = build_anchors("haven", [], [res])
    assert anchors["landmarks"] == {"b-site": [0.3, 0.3]}
    assert set(anchors["diffuseAnchors"]) == {"def-spawn"}
    assert "def-spawn (p50 radius" in render_doc(anchors)


def test_raster_extent_trims_outliers() -> None:
    pts = [(0.3 + 0.004 * i, 0.6) for i in range(100)] + [(0.95, 0.6)]
    ext = raster_extent(density_raster(pts, 100), lo=0.01, hi=0.99)
    assert ext["u"] == [0.3, 0.7] and ext["v"] == [0.6, 0.61]
    assert raster_extent(density_raster([], 10)) == {"u": [0.0, 1.0], "v": [0.0, 1.0]}


def _game(side_a: str) -> dict:
    return {
        "teams": [
            {
                "id": "A",
                "side": side_a,
                "players": [{"id": "a1", "position": {"x": 0, "y": 0}}],
            },
            {
                "id": "B",
                "side": "defender",
                "players": [{"id": "b1", "position": {"x": 1000, "y": 0}}],
            },
        ]
    }


def test_anchor_hook_and_build_anchors_are_aggregate_only() -> None:
    hook = AnchorHook(CALIB, {"A": (0.0, 0.0), "B": (50_000.0, 0.0)})
    rd = RoundData(1, {}, 0, None, game_id="g-secret")
    hook(rd, 0, {"type": "round-ended-freezetime"}, _game("attacker"))
    plant = {
        "type": "player-completed-plantBomb",
        "actor": {"id": "a1", "state": {"game": {"position": {"x": 100.0, "y": 0.0}}}},
    }
    hook(rd, 1, plant, None)
    hook(rd, 2, plant, None)  # second plant event in the same round ignored
    assert hook.spawns["attacker"] == [(0.5, 0.5)] and hook.spawns["defender"] == [
        (0.5, 0.49)
    ]
    assert hook.plants == {"A": [(0.5, 0.499)]}
    res = JobResult(1, 1, hook.plants, hook.spawns, density_raster([(0.5, 0.5)]), {})
    callouts = [{"region": "A", "name": "SecretCallout", "u": 0.1, "v": 0.2}]
    anchors, density = build_anchors("haven", callouts, [res])
    assert anchors["landmarks"] == {
        "a-site": [0.5, 0.499],
        "atk-spawn": [0.5, 0.5],
        "def-spawn": [0.5, 0.49],
    }
    assert anchors["diffuseAnchors"] == {}
    assert density["total"] == 1 and density["counts"][50][50] == 1
    text = str(anchors) + str(density)
    assert "g-secret" not in text and "a1" not in text and "b1" not in text
    doc = render_doc(anchors)
    assert "Callout anchors: 1 (A 1)" in doc and "SecretCallout" not in doc
