# Relive the Round

A web mini game for the Sky's The Limit 2026 (Cloud9 x JetBrains) hackathon. Each level is a real
1vN clutch from pro VALORANT (2025-2026), rebuilt on an original 2D map: you take over the clutcher
while 2-3 enemies move on rails derived from GRID data plus a bot state machine.

## Layout

- `etl/` - Python (uv) pipeline: reads GRID feeds, finds clutches, builds levels.
- `docs/` - notes and reports (aggregates only).
- `web/` - game client (PixiJS): playable levels, side-by-side replay, shareable score card.

## Maps

- Kiln - haven levels.
- Cistern (`web/src/maps/cistern.ts`) - lotus levels. Cistern is an original map: original
  geometry, with the layout warped from aggregate player position density. No Riot map art or
  geometry is used.

## Data

GRID data is licensed for the hackathon only and must never be committed. Point `STL_DATA_DIR` at a
local clone of the data repo; derived output goes to ignored folders (`data/`, `levels/`). Enable the
guard hook once per clone:

```sh
git config core.hooksPath .githooks
```

## ETL

```sh
cd etl
uv run pytest
STL_DATA_DIR=/path/to/grid-starter uv run relive-spike --maps haven lotus
```

## License

Code: MIT (see `LICENSE`). GRID data and anything derived from it: see the data repo license.
