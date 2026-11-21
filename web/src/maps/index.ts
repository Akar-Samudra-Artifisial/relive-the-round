import type { MapName } from "../level/types";
import { KILN } from "./kiln";
import type { MapDef } from "./types";

/** Original map that stands in for each level `map` value. */
export function mapFor(name: MapName): MapDef {
  switch (name) {
    case "haven":
      return KILN;
    case "lotus":
      throw new Error("maps: original stand-in for 'lotus' not built yet");
  }
}
