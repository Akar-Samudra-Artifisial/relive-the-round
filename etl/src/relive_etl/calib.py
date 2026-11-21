"""Calibration anchors for warping a source map's uv onto the original "Kiln" map.

Usage: STL_DATA_DIR=... uv run relive-calib-anchors --map haven
Writes data/calib/<map>-anchors.json and data/calib/<map>-density.json (git-ignored: derived from
GRID data). Both files hold aggregates only (no player/team/series/game ids).

Anchors:
- callouts: valorant-api callout label positions (cached by `geometry.fetch_api_maps`) -> uv;
- plants: per site (A/B/C, nearest site callout) the component-median uv of every spike plant,
  with the median distance to it (p50 radius, uv units);
- spawns: per side the component-median uv of player positions at the end of the buy phase;
- hotspots: the busiest cells of a coarse grid over all tracked in-round positions (cells at
  least `min_sep` cells apart), each reported as the mean uv of the samples in the cell;
- extent: p1/p99 of the tracked positions per axis (from the density raster).
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .clutch import RoundData
from .config import PROJECT_ROOT, data_dir
from .geometry import (
    MapCalib,
    fetch_api_maps,
    load_calibs,
    load_site_callouts,
    nearest_site,
    to_uv,
)
from .spike import _jobs, parse_series, positions_from_state

CALIB_DATA_DIR = PROJECT_ROOT / "data" / "calib"  # git-ignored (derived from GRID data)
SCHEMA_VERSION = 1
RASTER_SIZE = 100
HOT_GRID = 20
LANDMARK_MAX_RADIUS_UV = (
    0.1  # centroids more spread out than this are not warp landmarks
)

UV = tuple[float, float]
CellAcc = dict[tuple[int, int], list[float]]  # (col, row) -> [count, sum u, sum v]


def _cell(u: float, v: float, size: int) -> tuple[int, int] | None:
    """Raster cell (col, row) of a uv point, or None when outside [0, 1]."""
    if not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0):
        return None
    return min(size - 1, int(u * size)), min(size - 1, int(v * size))


def density_raster(points: list[UV], size: int = RASTER_SIZE) -> list[list[int]]:
    """size x size counts; rows follow v (top -> bottom), columns follow u. Off-map points dropped."""
    grid = [[0] * size for _ in range(size)]
    for u, v in points:
        cell = _cell(u, v, size)
        if cell is not None:
            grid[cell[1]][cell[0]] += 1
    return grid


def merge_rasters(a: list[list[int]], b: list[list[int]]) -> list[list[int]]:
    return [[x + y for x, y in zip(ra, rb)] for ra, rb in zip(a, b)]


def accumulate_cells(
    points: list[UV], grid: int, acc: CellAcc | None = None
) -> CellAcc:
    out: CellAcc = acc if acc is not None else {}
    for u, v in points:
        cell = _cell(u, v, grid)
        if cell is None:
            continue
        slot = out.setdefault(cell, [0.0, 0.0, 0.0])
        slot[0] += 1
        slot[1] += u
        slot[2] += v
    return out


def merge_cells(a: CellAcc, b: CellAcc) -> CellAcc:
    out = {k: list(v) for k, v in a.items()}
    for k, (n, su, sv) in b.items():
        slot = out.setdefault(k, [0.0, 0.0, 0.0])
        slot[0] += n
        slot[1] += su
        slot[2] += sv
    return out


def hotspots(acc: CellAcc, k: int = 8, min_sep: int = 2) -> list[dict[str, float]]:
    """Top-k busiest cells, greedily skipping cells closer than `min_sep` (Chebyshev) to a pick."""
    total = sum(n for n, _, _ in acc.values())
    picked: list[tuple[int, int]] = []
    out: list[dict[str, float]] = []
    for cell, (n, su, sv) in sorted(acc.items(), key=lambda kv: (-kv[1][0], kv[0])):
        if len(out) >= k:
            break
        if any(max(abs(cell[0] - p[0]), abs(cell[1] - p[1])) < min_sep for p in picked):
            continue
        picked.append(cell)
        out.append(
            {
                "u": round(su / n, 4),
                "v": round(sv / n, 4),
                "count": int(n),
                "share": round(n / total, 4),
            }
        )
    return out


def centroid(points: list[UV]) -> dict[str, float] | None:
    """Component-median uv, p50 distance to it (uv units) and sample count."""
    if not points:
        return None
    cu = statistics.median(p[0] for p in points)
    cv = statistics.median(p[1] for p in points)
    radius = statistics.median(
        ((u - cu) ** 2 + (v - cv) ** 2) ** 0.5 for u, v in points
    )
    return {
        "u": round(cu, 4),
        "v": round(cv, 4),
        "p50RadiusUV": round(radius, 4),
        "n": len(points),
    }


def raster_extent(
    raster: list[list[int]], lo: float = 0.01, hi: float = 0.99
) -> dict[str, list[float]]:
    """Approximate p1/p99 of the samples per axis, at raster resolution (cell edges)."""
    size = len(raster)
    cols = [sum(row[i] for row in raster) for i in range(size)]
    rows = [sum(row) for row in raster]

    def bounds(marginal: list[int]) -> list[float]:
        total = sum(marginal)
        if total == 0:
            return [0.0, 1.0]
        run, a, b = 0, 0, size - 1
        found_a = False
        for i, n in enumerate(marginal):
            run += n
            if not found_a and run >= lo * total:
                a, found_a = i, True
            if run >= hi * total:
                b = i
                break
        return [round(a / size, 4), round((b + 1) / size, 4)]

    return {"u": bounds(cols), "v": bounds(rows)}


@dataclass
class AnchorHook:
    """`parse_series` hook: plant positions per site and buy-phase-end positions per side."""

    calib: MapCalib
    sites: dict[str, tuple[float, float]]
    plants: dict[str, list[UV]] = field(default_factory=dict)
    spawns: dict[str, list[UV]] = field(default_factory=dict)
    _planted: set[tuple[str, int]] = field(default_factory=set)

    def __call__(
        self, rd: RoundData, t: int, ev: dict[str, Any], game: dict[str, Any] | None
    ) -> None:
        etype = ev["type"]
        if etype == "round-ended-freezetime" and game is not None:
            side_of = {
                str(p.get("id")): str(tm.get("side"))
                for tm in game.get("teams") or []
                for p in tm.get("players") or []
            }
            for pid, x, y in positions_from_state(game):
                side = side_of.get(pid)
                if side in ("attacker", "defender"):
                    self.spawns.setdefault(side, []).append(to_uv(self.calib, x, y))
        elif etype == "player-completed-plantBomb":
            key = (rd.game_id, rd.number)
            pos = (((ev.get("actor") or {}).get("state") or {}).get("game") or {}).get(
                "position"
            ) or {}
            if key in self._planted or pos.get("x") is None or pos.get("y") is None:
                return
            self._planted.add(key)
            x, y = float(pos["x"]), float(pos["y"])
            site = nearest_site(self.sites, x, y)
            if site is not None:
                self.plants.setdefault(site, []).append(to_uv(self.calib, x, y))


@dataclass
class JobResult:
    rounds: int
    games: int
    plants: dict[str, list[UV]]
    spawns: dict[str, list[UV]]
    raster: list[list[int]]
    cells: CellAcc


def _anchor_job(
    args: tuple[Path, set[str], MapCalib, dict[str, tuple[float, float]]],
) -> JobResult:
    feed, games, calib, sites = args
    hook = AnchorHook(calib, sites)
    rounds, _ = parse_series(feed, games, on_event=hook)
    points = [
        to_uv(calib, x, y)
        for rd in rounds
        for track in rd.tracks.values()
        for _, x, y in track
    ]
    return JobResult(
        rounds=len(rounds),
        games=len({rd.game_id for rd in rounds}),
        plants=hook.plants,
        spawns=hook.spawns,
        raster=density_raster(points),
        cells=accumulate_cells(points, HOT_GRID),
    )


def map_callouts(map_name: str, calib: MapCalib) -> list[dict[str, Any]]:
    """valorant-api callouts of a map as uv (region = superRegionName, name = regionName)."""
    out = []
    for m in fetch_api_maps():
        if str(m.get("displayName", "")).lower() != map_name:
            continue
        for c in m.get("callouts") or []:
            loc = c.get("location") or {}
            if "x" not in loc or "y" not in loc:
                continue
            u, v = to_uv(calib, float(loc["x"]), float(loc["y"]))
            out.append(
                {
                    "region": str(c.get("superRegionName", "")),
                    "name": str(c.get("regionName", "")),
                    "u": round(u, 4),
                    "v": round(v, 4),
                }
            )
        break
    return out


def build_anchors(
    map_name: str, callouts: list[dict[str, Any]], results: list[JobResult]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Combine per-series results into (anchors, density) documents."""
    plants: dict[str, list[UV]] = {}
    spawns: dict[str, list[UV]] = {}
    raster = density_raster([])
    cells: CellAcc = {}
    for r in results:
        for k, pts in r.plants.items():
            plants.setdefault(k, []).extend(pts)
        for k, pts in r.spawns.items():
            spawns.setdefault(k, []).extend(pts)
        raster = merge_rasters(raster, r.raster)
        cells = merge_cells(cells, r.cells)
    plant_c = {s: centroid(plants[s]) for s in sorted(plants)}
    spawn_c = {s: centroid(spawns[s]) for s in sorted(spawns)}
    landmarks: dict[str, list[float]] = {}
    diffuse: dict[str, float] = {}
    named = [(f"{s.lower()}-site", c) for s, c in plant_c.items()]
    named += [
        ("atk-spawn", spawn_c.get("attacker")),
        ("def-spawn", spawn_c.get("defender")),
    ]
    for name, c in named:
        if c is None:
            continue
        if c["p50RadiusUV"] > LANDMARK_MAX_RADIUS_UV:
            diffuse[name] = c["p50RadiusUV"]  # too spread out to pin a warp landmark
        else:
            landmarks[name] = [c["u"], c["v"]]
    total = sum(map(sum, raster))
    anchors = {
        "schemaVersion": SCHEMA_VERSION,
        "map": map_name,
        "uv": "geometry.to_uv (valorant-api minimap calibration), origin top-left",
        "sample": {
            "series": len(results),
            "games": sum(r.games for r in results),
            "rounds": sum(r.rounds for r in results),
            "positions": total,
        },
        "callouts": callouts,
        "plants": plant_c,
        "spawns": spawn_c,
        "hotspots": hotspots(cells),
        "extent": raster_extent(raster),
        "landmarks": landmarks,
        "diffuseAnchors": diffuse,
    }
    density = {
        "schemaVersion": SCHEMA_VERSION,
        "map": map_name,
        "size": RASTER_SIZE,
        "layout": "counts[row][col]; row = floor(v*size) top->bottom, col = floor(u*size)",
        "total": total,
        "max": max(map(max, raster)) if raster else 0,
        "counts": raster,
    }
    return anchors, density


def render_doc(anchors: dict[str, Any]) -> str:
    """Aggregate summary without callout names (regions and counts only)."""
    regions = Counter(c["region"] for c in anchors["callouts"])
    s = anchors["sample"]
    plants = ", ".join(f"{k} n={v['n']}" for k, v in anchors["plants"].items() if v)
    spawns = ", ".join(f"{k} n={v['n']}" for k, v in anchors["spawns"].items() if v)
    radii = ", ".join(
        f"{k} {v['p50RadiusUV']:.3f}" for k, v in anchors["plants"].items() if v
    )
    return "\n".join(
        [
            f"# Calibration anchors: {anchors['map']} -> Kiln",
            "",
            "Generated by `uv run relive-calib-anchors --map "
            f"{anchors['map']}`. The anchor files live in the git-ignored `data/calib/` "
            "(derived from GRID data); this page holds counts and method only.",
            "",
            "## Method",
            "",
            "- uv = `geometry.to_uv` (valorant-api minimap calibration, origin top-left), the same "
            "space the level files use; the web warp maps it to Kiln (`web/src/maps/kiln.ts`).",
            "- Callout anchors: valorant-api callout label positions converted to uv.",
            "- Plant anchors: every first spike plant per round, site = nearest site callout; "
            "component-median uv + p50 radius.",
            "- Spawn anchors: player positions at the end of the buy phase, per side; "
            "component-median uv.",
            f"- Hotspots: busiest cells of a {HOT_GRID}x{HOT_GRID} grid over all in-round "
            "position samples (cells >= 2 apart), mean uv per cell.",
            f"- Density raster: {RASTER_SIZE}x{RASTER_SIZE} counts of the same samples "
            "(`<map>-density.json`) for the debug overlay; extent = p1/p99 per axis.",
            "",
            "## Result",
            "",
            f"- Sample: {s['series']} series, {s['games']} games, {s['rounds']} rounds, "
            f"{s['positions']} position samples.",
            f"- Callout anchors: {len(anchors['callouts'])} "
            f"({', '.join(f'{k} {v}' for k, v in sorted(regions.items()))}).",
            f"- Plant anchors: {len(anchors['plants'])} sites ({plants}); p50 radius uv: {radii}.",
            f"- Spawn anchors: {len(anchors['spawns'])} ({spawns}).",
            f"- Hotspots: {len(anchors['hotspots'])}; extent u {anchors['extent']['u']}, "
            f"v {anchors['extent']['v']}.",
            f"- Ready-made landmarks for the Kiln warp (p50 radius <= {LANDMARK_MAX_RADIUS_UV} uv): "
            f"{', '.join(sorted(anchors['landmarks'])) or 'none'}.",
            "- Diffuse anchors left out of the landmarks: "
            + (
                ", ".join(
                    f"{k} (p50 radius {v:.3f})"
                    for k, v in anchors["diffuseAnchors"].items()
                )
                or "none"
            )
            + ".",
            "",
            "## Caveats",
            "",
            "- The buy-phase-end snapshot does not pin spawns tightly: position samples only refresh "
            "on events, so some players still show where they stood earlier. Treat spawn anchors "
            "with a large p50 radius as hints only; place those Kiln landmarks from callouts.",
            "- Callouts are label anchors, not area centres; plant medians are the most precise "
            "site anchors.",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", default="haven", choices=["haven", "lotus"])
    ap.add_argument("--out-dir", type=Path, default=CALIB_DATA_DIR)
    ap.add_argument(
        "--doc", type=Path, default=None, help="default docs/calibration-<map>.md"
    )
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="max series (0 = all)")
    a = ap.parse_args(argv)
    calib = load_calibs().get(a.map)
    if calib is None:
        raise SystemExit(f"no valorant-api calibration for map {a.map!r}")
    sites = load_site_callouts().get(a.map, {})
    jobs = [
        (feed, set(games), calib, sites)
        for _, feed, games, _ in _jobs(data_dir(), [a.map])
    ]
    if a.limit:
        jobs = jobs[: a.limit]
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        results = list(pool.map(_anchor_job, jobs))
    anchors, density = build_anchors(a.map, map_callouts(a.map, calib), results)
    a.out_dir.mkdir(parents=True, exist_ok=True)
    (a.out_dir / f"{a.map}-anchors.json").write_text(
        json.dumps(anchors, indent=1), encoding="utf-8"
    )
    (a.out_dir / f"{a.map}-density.json").write_text(
        json.dumps(density), encoding="utf-8"
    )
    doc = a.doc or PROJECT_ROOT / "docs" / f"calibration-{a.map}.md"
    doc.write_text(render_doc(anchors), encoding="utf-8")
    print(
        f"[calib] {len(results)} series, {anchors['sample']['positions']} positions -> "
        f"{a.out_dir}; doc -> {doc}",
        flush=True,
    )


if __name__ == "__main__":
    main()
