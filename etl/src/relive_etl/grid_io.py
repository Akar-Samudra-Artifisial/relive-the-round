"""Streaming readers for zstd-compressed JSON Lines files.

Adapted from utility-fingerprint (etl/src/utility_fingerprint_etl/grid_io.py), MIT.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import zstandard


def iter_lines(path: Path) -> Iterator[str]:
    with zstandard.open(path, "rt", encoding="utf-8") as f:
        yield from f


def iter_jsonl_zst(path: Path) -> Iterator[dict[str, Any]]:
    for line in iter_lines(path):
        yield json.loads(line)


def series_feed(data_dir: Path, series_id: str) -> Path:
    return data_dir / "val" / f"events_{series_id}_grid.jsonl.zst"
