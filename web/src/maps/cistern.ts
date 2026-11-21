import { rect } from "../sim/geom";
import type { MapDef } from "./types";

/**
 * "Cistern" — original map 2. Three flooded basins (sites A/B/C) along the north wall, fed by
 * three channels from the attacker side; sluices link neighbouring basins and two reservoirs
 * split the channels. Geometry and naming are our own.
 * World units are cm, y grows downward (defenders top, attackers bottom).
 */
export const CISTERN: MapDef = {
  id: "cistern",
  name: "Cistern",
  width: 8000,
  height: 8000,
  walls: [
    // Outer frame
    rect(0, 0, 8000, 200),
    rect(0, 7800, 8000, 8000),
    rect(0, 0, 200, 8000),
    rect(7800, 0, 8000, 8000),
    // Storage tanks in the north corners
    [200, 200, 2400, 200, 2400, 700, 1900, 1200, 200, 1200],
    [5800, 200, 7800, 200, 7800, 1500, 6400, 1500, 5800, 1000],
    // Dam between basins A and B, and the wall behind basin B
    rect(2500, 2100, 3000, 3300),
    rect(3900, 2100, 4800, 2500),
    // West bank and the southern reservoirs
    rect(200, 4000, 1000, 7800),
    [1000, 5500, 1700, 5500, 2200, 6000, 2200, 7800, 1000, 7800],
    [6600, 5400, 7800, 5400, 7800, 7800, 6800, 7800, 6600, 7500],
    // Central reservoir (octagon) between the west and middle channels
    [3200, 4300, 3500, 4300, 3700, 4500, 3700, 5000, 3500, 5200, 3200, 5200, 3000, 5000, 3000, 4500],
    // Channel heads
    rect(3050, 4050, 3900, 4250),
    rect(4700, 4900, 5200, 5400),
    // Columns and pump housings
    rect(2200, 1650, 2500, 1800),
    rect(5050, 3150, 5250, 3350),
    rect(6700, 1700, 7200, 2100),
  ],
  sites: {
    A: rect(400, 1700, 2300, 3300),
    B: rect(3200, 2600, 4800, 3900),
    C: rect(5800, 2400, 7600, 4100),
  },
  spawns: {
    attack: rect(2800, 6700, 5600, 7600),
    defense: rect(2600, 300, 5000, 1100),
  },
  // Calibrated against aggregated real-match data (data/calib/ anchors, not committed):
  // `src` = median plant point per site and named-area anchors. The source minimap is mirrored
  // left↔right relative to Cistern (source u → Cistern -x), so the warp is a reflection. `dst` starts
  // from one affine fit of the occupied uv extent; the walls were then placed so the real position
  // density lands on floor. Quality is checked by tests/calib.test.ts when the data is present.
  landmarks: [
    { name: "corner-nw", src: [1, 0], dst: [0, 0] },
    { name: "corner-ne", src: [0, 0], dst: [8000, 0] },
    { name: "corner-sw", src: [1, 1], dst: [0, 8000] },
    { name: "corner-se", src: [0, 1], dst: [8000, 8000] },
    { name: "a-plant", src: [0.8862, 0.3736], dst: [916, 2741] },
    { name: "b-plant", src: [0.4878, 0.4456], dst: [4139, 3406] },
    { name: "c-plant", src: [0.1046, 0.4642], dst: [7239, 3577] },
    { name: "a-upper", src: [0.8181, 0.251], dst: [1467, 1609] },
    { name: "a-ledge", src: [0.8935, 0.2326], dst: [857, 1439] },
    { name: "a-basin", src: [0.8549, 0.3608], dst: [1169, 2623] },
    { name: "a-pumphouse", src: [0.8549, 0.3477], dst: [1169, 2502] },
    { name: "a-front", src: [0.8549, 0.475], dst: [1169, 3677] },
    { name: "a-gate", src: [0.8295, 0.5139], dst: [1375, 4036] },
    { name: "a-channel", src: [0.7543, 0.537], dst: [1983, 4249] },
    { name: "a-channel-bend", src: [0.8089, 0.6009], dst: [1541, 4839] },
    { name: "a-channel-low", src: [0.692, 0.6009], dst: [2487, 4839] },
    { name: "a-staging", src: [0.6655, 0.7244], dst: [2702, 5979] },
    { name: "c-staging", src: [0.3413, 0.8167], dst: [5324, 6831] },
    { name: "mid-colonnade", src: [0.5029, 0.661], dst: [4017, 5394] },
    { name: "b-channel", src: [0.4513, 0.5666], dst: [4434, 4522] },
    { name: "c-gate-low", src: [0.3286, 0.5708], dst: [5427, 4561] },
    { name: "b-basin", src: [0.5029, 0.4593], dst: [4017, 3532] },
    { name: "ab-sluice", src: [0.6051, 0.485], dst: [3190, 3769] },
    { name: "b-upper", src: [0.564, 0.3646], dst: [3523, 2658] },
    { name: "c-spillway", src: [0.3112, 0.4339], dst: [5568, 3298] },
    { name: "bc-sluice", src: [0.3556, 0.3775], dst: [5209, 2777] },
    { name: "a-steps", src: [0.7328, 0.3232], dst: [2157, 2276] },
    { name: "c-channel-low", src: [0.3413, 0.6396], dst: [5324, 5196] },
    { name: "c-channel", src: [0.2281, 0.5353], dst: [6240, 4234] },
    { name: "c-far-bend", src: [0.0745, 0.5104], dst: [7483, 4004] },
    { name: "c-basin", src: [0.1476, 0.437], dst: [6891, 3326] },
    { name: "c-hall", src: [0.1476, 0.3488], dst: [6891, 2512] },
    { name: "c-upper", src: [0.3286, 0.2743], dst: [5427, 1824] },
    { name: "def-spawn", src: [0.577, 0.2203], dst: [3418, 1326] },
    { name: "atk-spawn", src: [0.5108, 0.8169], dst: [3953, 6833] },
  ],
};
