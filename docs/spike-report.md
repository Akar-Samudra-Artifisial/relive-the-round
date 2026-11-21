# Spike report: are GRID positions dense enough for clutch levels?

Maps: haven, lotus. Series scanned: 757. Rounds parsed: 15609.
Aggregates only; no player or team names, no raw positions.

## Definitions

- **Clutch moment**: the first kill in a round that leaves a team with exactly 1 alive player against >= 2 alive opponents, with <= 45 s of round time left.
- **Time left**: the GRID game clock (`seriesState.games[].clock.currentSeconds`, counts down; it is reset to the spike timer after a plant) at the kill event. Fallback when the clock is missing: time until round end.
- **Level passes** (rule in use: **relaxed**). Relaxed (default): from the clutch moment until their death or round end, the clutcher has a max gap between position changes <= 6 s (window edges count) and >= 6 distinct positions; each opponent only needs >= 1 known position (opponents are driven by bots in the game). Strict (`--strict`): every player alive at the clutch moment meets the clutcher rule.
- **Combat gaps**: gaps between position changes whose interval overlaps +-3 s around any kill inside the clutch window.

## Results

| Map | 1vN moments (any time) | Clutches (<= 45 s) | Passed | Passed & won by clutcher |
|---|---:|---:|---:|---:|
| haven | 8145 | 5816 | 370 | 84 |
| lotus | 6701 | 4960 | 340 | 77 |
| **total** | 14846 | 10776 | 710 | 161 |

| Size | Clutches (<= 45 s) | Passed | Passed & won |
|---|---:|---:|---:|
| 1v2 | 3250 | 247 | 111 |
| 1v3 | 3491 | 260 | 43 |
| 1v4 | 2682 | 130 | 6 |
| 1v5 | 1339 | 73 | 1 |

Why clutches fail (not exclusive, clutcher): max gap > 6 s: 2564; < 6 distinct positions: 9328.

Clutch window length (clutch moment -> round decided), clutches <= 45 s: median 8.56 s, p90 23.12 s; windows >= 10 s: 4785.

Comparison (not used for the decision): strict rule: 132 pass, 6 won by the clutcher.

| Position-change gap (s) | median | p90 |
|---|---:|---:|
| all clutch windows | 1.10 | 4.81 |
| combat (+-3 s around kills), all clutches | 1.00 | 4.54 |
| passed levels only | 1.31 | 3.60 |
| combat, passed levels only | 1.24 | 3.60 |

Post-plant clutches (<= 45 s): 7960 of 10776. Time-left source: clock 10776, round-end fallback 0.

## Fields available

- Round clock on kill events: 108549/108549 (100.0%).
- Weapon on kill events (`actor.stateDelta.game.weaponKills`): 104532/108549 (96.3%).
- Inventory (current weapons) in full snapshots: 76416/78080 (97.9%); trimmed per-event snapshots carry positions but no inventory/alive/health.
- Positions are 2D `{x, y}` cm, refreshed per event (no fixed tick).

## Decision

Rule (week 2, relaxed level rule): GO (2 maps) if >= 30 passed and >= 12 won by the clutcher; GO (1 map) if >= 10 passed but the 2-map bar is missed; Plan B if < 10 passed (start positions + kill locations as keyframes, full bot FSM). The week-1 combat-density bar (median <= 1.0 s) is now informational only, because opponents are bot-driven and only the clutcher track replays data.

**Decision: GO (2 maps)**

2-map bar check: passed 710 >= 30: yes; won 161 >= 12: yes. Info: combat median gap 1.001 s (all clutches), 1.24 s (passed levels).

## Level candidates (top 12 per map)

Score = 100 if the clutcher won + 20 per opponent beyond 2 + 0..10 for clutcher track density (10 at 0 s max gap, 0 at 6 s). Ties: more clutcher positions, then longer window. The full list with ids is written to the git-ignored `data/levels/candidates.json`; this table is anonymous.

### haven

| Rank | Size | Result | Window (s) | Post-plant | Clutcher positions | Clutcher max gap (s) | Score |
|---:|---|---|---:|---|---:|---:|---:|
| 1 | 1v4 | won | 23.6 | yes | 15 | 2.67 | 145.56 |
| 2 | 1v4 | won | 25.9 | yes | 7 | 5.96 | 140.07 |
| 3 | 1v3 | won | 6.0 | yes | 7 | 1.96 | 126.73 |
| 4 | 1v3 | won | 7.1 | yes | 7 | 2.13 | 126.44 |
| 5 | 1v3 | won | 8.0 | no | 6 | 2.47 | 125.89 |
| 6 | 1v3 | won | 9.2 | yes | 6 | 2.54 | 125.77 |
| 7 | 1v3 | won | 9.1 | yes | 7 | 2.94 | 125.10 |
| 8 | 1v3 | won | 12.8 | yes | 9 | 2.99 | 125.02 |
| 9 | 1v3 | won | 10.1 | yes | 7 | 3.47 | 124.22 |
| 10 | 1v3 | won | 14.0 | yes | 8 | 3.50 | 124.17 |
| 11 | 1v3 | won | 15.3 | yes | 6 | 3.57 | 124.04 |
| 12 | 1v3 | won | 11.5 | yes | 8 | 3.62 | 123.97 |

### lotus

| Rank | Size | Result | Window (s) | Post-plant | Clutcher positions | Clutcher max gap (s) | Score |
|---:|---|---|---:|---|---:|---:|---:|
| 1 | 1v5 | won | 19.7 | yes | 8 | 3.90 | 163.49 |
| 2 | 1v4 | won | 8.9 | yes | 6 | 1.54 | 147.44 |
| 3 | 1v4 | won | 17.4 | yes | 7 | 4.19 | 143.02 |
| 4 | 1v4 | won | 29.1 | yes | 13 | 4.82 | 141.96 |
| 5 | 1v4 | won | 22.4 | yes | 11 | 5.65 | 140.58 |
| 6 | 1v3 | won | 5.3 | yes | 6 | 1.72 | 127.14 |
| 7 | 1v3 | won | 6.5 | yes | 6 | 1.81 | 126.98 |
| 8 | 1v3 | won | 6.5 | yes | 7 | 1.81 | 126.97 |
| 9 | 1v3 | won | 8.0 | yes | 6 | 3.00 | 125.00 |
| 10 | 1v3 | won | 13.6 | yes | 6 | 3.17 | 124.72 |
| 11 | 1v3 | won | 21.7 | yes | 8 | 3.53 | 124.12 |
| 12 | 1v3 | won | 15.5 | yes | 7 | 3.54 | 124.11 |
