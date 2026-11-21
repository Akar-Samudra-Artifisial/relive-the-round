"""Map calibration (valorant-api.com coefficients) and coordinate helpers.

Adapted from utility-fingerprint (etl/src/utility_fingerprint_etl/geometry.py), MIT.
Only the calibration coefficients are fetched; no Riot map images are downloaded
(levels are drawn on original 2D maps).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from .config import CACHE_DIR

VALORANT_API_MAPS = "https://valorant-api.com/v1/maps"


@dataclass(frozen=True)
class MapCalib:
    name: str  # lowercase, matches GRID map.name / meta games.csv
    display_name: str
    x_mult: float
    y_mult: float
    x_add: float
    y_add: float


def to_uv(calib: MapCalib, x: float, y: float) -> tuple[float, float]:
    """Game cm -> normalized map coords (0..1, origin top-left). Axes are swapped."""
    return y * calib.x_mult + calib.x_add, x * calib.y_mult + calib.y_add


def fetch_api_maps() -> list[dict[str, Any]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / "valorant-api-maps.json"
    if not cache.is_file():
        resp = httpx.get(VALORANT_API_MAPS, timeout=30)
        resp.raise_for_status()
        cache.write_text(resp.text, encoding="utf-8")
    data = json.loads(cache.read_text(encoding="utf-8")).get("data")
    if not isinstance(data, list):
        raise SystemExit(
            f"Unexpected valorant-api.com response in {cache}: missing 'data' list"
        )
    return data


def load_site_callouts() -> dict[str, dict[str, tuple[float, float]]]:
    """map name -> {"A"|"B"|"C": (x, y) game cm} from valorant-api `regionName == "Site"` callouts.

    Callouts are label anchors, good for nearest-site classification (see utility-fingerprint
    docs/calibration.md), not exact site centres.
    """
    out: dict[str, dict[str, tuple[float, float]]] = {}
    for m in fetch_api_maps():
        name = str(m.get("displayName", "")).lower()
        for c in m.get("callouts") or []:
            loc = c.get("location") or {}
            if c.get("regionName") == "Site" and "x" in loc and "y" in loc:
                site = str(c.get("superRegionName", ""))
                out.setdefault(name, {}).setdefault(
                    site, (float(loc["x"]), float(loc["y"]))
                )
    return out


def nearest_site(
    sites: dict[str, tuple[float, float]], x: float, y: float
) -> str | None:
    if not sites:
        return None
    return min(sites, key=lambda s: (sites[s][0] - x) ** 2 + (sites[s][1] - y) ** 2)


def load_calibs() -> dict[str, MapCalib]:
    out: dict[str, MapCalib] = {}
    for m in fetch_api_maps():
        name = str(m.get("displayName", "")).lower()
        if not m.get("xMultiplier") or name in out:
            continue
        out[name] = MapCalib(
            name=name,
            display_name=m["displayName"],
            x_mult=float(m["xMultiplier"]),
            y_mult=float(m["yMultiplier"]),
            x_add=float(m["xScalarToAdd"]),
            y_add=float(m["yScalarToAdd"]),
        )
    return out
