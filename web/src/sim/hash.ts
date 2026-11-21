import type { SimState } from "./sim";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over the JSON form of the whole state. JSON numbers use the shortest round-trip
 * representation, so distinct float64 values always hash differently; key order is the
 * (fixed) construction order of the sim.
 */
export function hashState(s: SimState): string {
  const text = JSON.stringify(s);
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  return h.toString(16).padStart(8, "0");
}
