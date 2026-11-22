import { describe, expect, it } from "vitest";
import { pickRenderer } from "../src/render/select";

const D = (reason: string) => ({ kind: "2d", reason });
const THREE_D = { kind: "3d", reason: "requested" };
const DEFAULT_3D = { kind: "3d", reason: "default" };
const NO_WEBGL2 = D("no webgl2");

describe("pickRenderer", () => {
  const cases: [string, object, object][] = [
    ["", DEFAULT_3D, NO_WEBGL2],
    ["?kiosk=1", DEFAULT_3D, NO_WEBGL2],
    ["?3d", THREE_D, NO_WEBGL2],
    ["?3d=1", THREE_D, NO_WEBGL2],
    ["?3d=0", D("forced"), D("forced")],
    ["?2d=1", D("forced"), D("forced")],
    ["?2d=0", DEFAULT_3D, NO_WEBGL2],
    ["?3d=1&2d=1", D("forced"), D("forced")],
    ["?kiosk=1&3d=1", THREE_D, NO_WEBGL2],
    ["?kiosk=1&2d=1", D("forced"), D("forced")],
  ];

  it.each(cases)("%j", (search, withWebgl2, withoutWebgl2) => {
    expect(pickRenderer(search, { webgl2: true })).toEqual(withWebgl2);
    expect(pickRenderer(search, { webgl2: false })).toEqual(withoutWebgl2);
  });
});
