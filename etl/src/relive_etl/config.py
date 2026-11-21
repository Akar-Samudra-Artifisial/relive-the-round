"""Paths shared by ETL commands. Data is read from STL_DATA_DIR and never copied into the repo.

Adapted from utility-fingerprint (etl/src/utility_fingerprint_etl/config.py), MIT.
"""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DOCS_DIR = PROJECT_ROOT / "docs"
CACHE_DIR = PROJECT_ROOT / "etl" / ".cache"  # git-ignored
LEVELS_DATA_DIR = (
    PROJECT_ROOT / "data" / "levels"
)  # git-ignored (derived from GRID data)

DEFAULT_DATA_DIR = PROJECT_ROOT.parent / "stl-hackathon-2026-grid-starter"

# Source map key (GRID / calibration, internal only) -> original map id used in public files
# (level JSON, data/levels/<id>/, the web client). Source keys never reach players.
PUBLIC_MAP_IDS = {"haven": "kiln", "lotus": "cistern"}


def data_dir() -> Path:
    """Return the GRID starter data directory, validating that it looks right."""
    raw = os.environ.get("STL_DATA_DIR")
    path = Path(raw).expanduser() if raw else DEFAULT_DATA_DIR
    if (
        not (path / "val" / "series.csv").is_file()
        or not (path / "meta" / "games.csv").is_file()
    ):
        raise SystemExit(
            f"STL_DATA_DIR={path} is not a GRID starter checkout "
            "(expected val/series.csv and meta/games.csv). Set STL_DATA_DIR to the data repo path."
        )
    return path
