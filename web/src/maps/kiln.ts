import { rect } from "../sim/geom";
import type { MapDef } from "./types";

/**
 * "Kiln" — original map 1. Three sites (A/B/C) with three lanes and two lane
 * connectors; topology loosely follows a 3-site layout, geometry and naming are our own.
 * World units are cm, y grows downward (defenders top, attackers bottom).
 */
export const KILN: MapDef = {
  id: "kiln",
  name: "Kiln",
  sourceMap: "haven",
  width: 8000,
  height: 8000,
  walls: [
    // Outer frame
    rect(0, 0, 8000, 200),
    rect(0, 7800, 8000, 8000),
    rect(0, 0, 400, 8000),
    rect(7600, 0, 8000, 8000),
    // Site chokes (doorways A 1200-2000, B 3600-4400, C 6000-6800)
    rect(400, 3200, 1200, 3600),
    rect(2000, 3200, 3600, 3600),
    rect(4400, 3200, 6000, 3600),
    rect(6800, 3200, 7600, 3600),
    // Site dividers
    rect(2700, 1300, 3100, 3200),
    rect(4900, 1300, 5300, 3200),
    // Lane blocks (west connector at y 4200-4800, east connector at y 4600-5300)
    rect(400, 3600, 1000, 6600),
    rect(2400, 3600, 3300, 4200),
    rect(2400, 4800, 3300, 6600),
    rect(4700, 3600, 5600, 4600),
    rect(4700, 5300, 5600, 6600),
    rect(7000, 3600, 7600, 6600),
    // Attacker spawn corners
    [400, 6600, 1000, 6600, 400, 7200],
    [7600, 6600, 7000, 6600, 7600, 7200],
    // Defender spawn kiln house
    [3500, 500, 4500, 500, 4700, 700, 4500, 900, 3500, 900, 3300, 700],
    // Cover
    rect(3800, 4800, 4200, 5200),
    rect(1500, 5200, 1800, 5500),
    rect(6200, 4300, 6500, 4600),
    rect(1300, 2000, 1600, 2300),
    [2000, 1600, 2400, 1600, 2400, 2000],
    rect(3800, 1900, 4200, 2200),
    rect(6000, 1800, 6400, 2100),
    rect(6900, 2500, 7200, 2800),
  ],
  sites: {
    A: rect(600, 1300, 2600, 3100),
    B: rect(3300, 1500, 4800, 2900),
    C: rect(5500, 1300, 7400, 3100),
  },
  spawns: {
    attack: rect(1200, 6800, 6800, 7700),
    defense: rect(600, 300, 7400, 1150),
  },
  // Calibrated against aggregated real-match data (data/calib/haven-anchors.json, not committed):
  // `src` = median plant point per site, spawn and named-area anchors, and positional hotspots.
  // The source minimap is transposed relative to Kiln (source u → Kiln y, source v → Kiln x), so
  // the warp is a reflection. `dst` was tuned (each landmark constrained to its matching Kiln area,
  // no folded/over-compressed triangles) to maximise walkable coverage of the real position density.
  // Quality is checked by tests/calib.test.ts when the data is present.
  landmarks: [
    { name: "corner-nw", src: [0, 0], dst: [0, 0] },
    { name: "corner-sw", src: [1, 0], dst: [0, 8000] },
    { name: "corner-ne", src: [0, 1], dst: [8000, 0] },
    { name: "corner-se", src: [1, 1], dst: [8000, 8000] },
    { name: "a-site", src: [0.3997, 0.1654], dst: [1822, 2170] },
    { name: "b-site", src: [0.4141, 0.5184], dst: [4100, 2335] },
    { name: "c-site", src: [0.4067, 0.8334], dst: [6923, 1583] },
    { name: "def-spawn", src: [0.1398, 0.4218], dst: [2309, 940] },
    { name: "atk-spawn", src: [0.8952, 0.5121], dst: [3492, 7083] },
    { name: "ab-gap", src: [0.2898, 0.3244], dst: [2308, 1345] },
    { name: "b-rear", src: [0.2936, 0.4953], dst: [3764, 1173] },
    { name: "bc-gap", src: [0.3431, 0.6493], dst: [5448, 1025] },
    { name: "a-rear", src: [0.308, 0.1386], dst: [833, 1443] },
    { name: "a-door", src: [0.472, 0.2305], dst: [1594, 3798] },
    { name: "west-lane-top", src: [0.522, 0.1307], dst: [1401, 3730] },
    { name: "west-lane", src: [0.5759, 0.177], dst: [1265, 4636] },
    { name: "west-lane-low", src: [0.6239, 0.3848], dst: [2754, 4506] },
    { name: "west-staging", src: [0.7241, 0.426], dst: [1351, 6889] },
    { name: "west-connector", src: [0.4998, 0.3838], dst: [4113, 4398] },
    { name: "centre", src: [0.59, 0.5061], dst: [4422, 5533] },
    { name: "centre-low", src: [0.6759, 0.4965], dst: [4126, 5674] },
    { name: "centre-south", src: [0.6237, 0.6314], dst: [4279, 6486] },
    { name: "centre-staging", src: [0.723, 0.5785], dst: [3663, 6730] },
    { name: "c-west", src: [0.419, 0.6435], dst: [5708, 2539] },
    { name: "c-divider", src: [0.4935, 0.6292], dst: [5328, 2813] },
    { name: "c-front", src: [0.424, 0.7748], dst: [6719, 1800] },
    { name: "c-door-west", src: [0.4742, 0.6748], dst: [5969, 2801] },
    { name: "c-door", src: [0.5194, 0.831], dst: [6363, 2976] },
    { name: "east-lane-top", src: [0.6013, 0.8017], dst: [5728, 4824] },
    { name: "east-lane", src: [0.6441, 0.8945], dst: [5890, 4670] },
    { name: "east-lane-low", src: [0.6644, 0.7659], dst: [6441, 6441] },
    { name: "east-staging", src: [0.7193, 0.7711], dst: [6818, 7192] },
  ],
};
