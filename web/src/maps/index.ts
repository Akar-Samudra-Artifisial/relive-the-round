import type { MapName } from "../level/types";
import { CISTERN } from "./cistern";
import { KILN } from "./kiln";
import type { MapDef } from "./types";

/** Original map for each level `map` id. */
export function mapFor(name: MapName): MapDef {
  switch (name) {
    case "kiln":
      return KILN;
    case "cistern":
      return CISTERN;
  }
}
