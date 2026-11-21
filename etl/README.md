# relive-etl

Python ETL for Relive the Round. Reads GRID VALORANT feeds from `STL_DATA_DIR` (never copied into the repo).

```sh
uv run pytest
STL_DATA_DIR=../../grid-starter uv run relive-spike --maps haven lotus   # -> data/levels/candidates.json
STL_DATA_DIR=../../grid-starter uv run relive-export-levels --map haven --top 12  # -> data/levels/kiln/
STL_DATA_DIR=../../grid-starter uv run relive-calib-anchors --map haven  # -> data/calib/haven-anchors.json, kiln-density.json
uv run relive-migrate-levels   # schema-v1 data/levels/{haven,lotus}/ -> v2 data/levels/{kiln,cistern}/
```

`--map` takes the source map key (`haven`, `lotus`); public outputs use the original map id
(`kiln`, `cistern`, see `relive_etl.config.PUBLIC_MAP_IDS`). Level files follow
[`docs/level-schema.md`](../docs/level-schema.md) (schema v2: only fields the web client uses, no
weapon names) and are validated against `docs/level.schema.json`. Everything under `data/` is
git-ignored.
