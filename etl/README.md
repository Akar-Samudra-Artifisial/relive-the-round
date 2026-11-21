# relive-etl

Python ETL for Relive the Round. Reads GRID VALORANT feeds from `STL_DATA_DIR` (never copied into the repo).

```sh
uv run pytest
STL_DATA_DIR=../../grid-starter uv run relive-spike --maps haven lotus   # -> data/levels/candidates.json
STL_DATA_DIR=../../grid-starter uv run relive-export-levels --map haven --top 12  # -> data/levels/haven/
STL_DATA_DIR=../../grid-starter uv run relive-calib-anchors --map haven  # -> data/calib/haven-{anchors,density}.json
```

Level files follow [`docs/level-schema.md`](../docs/level-schema.md) and are validated against
`docs/level.schema.json`. Everything under `data/` is git-ignored.
