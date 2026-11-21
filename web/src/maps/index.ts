import type { MapName } from "../level/types";
import { CISTERN } from "./cistern";
import { KILN } from "./kiln";
import type { MapDef } from "./types";

/** Original map that stands in for each level `map` value. */
export function mapFor(name: MapName): MapDef {
  switch (name) {
    case "haven":
      return KILN;
    case "lotus":
      return CISTERN;
  }
}
