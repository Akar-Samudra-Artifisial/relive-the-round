import { describe, expect, it } from "vitest";
import { pickRenderer } from "../src/render/select";

const D = (reason: string) => ({ kind: "2d", reason });
const THREE_D = { kind: "3d", reason: "requested" };

describe("pickRenderer", () => {
  const cases: [string, object, object][] = [
    ["", D("default"), D("default")],
    ["?3d", THREE_D, D("no webgl2")],
    ["?3d=1", THREE_D, D("no webgl2")],
    ["?3d=0", D("default"), D("default")],
    ["?2d=1", D("forced"), D("forced")],
    ["?3d=1&2d=1", D("forced"), D("forced")],
    ["?kiosk=1&3d=1", THREE_D, D("no webgl2")],
  ];

  it.each(cases)("%j", (search, withWebgl2, withoutWebgl2) => {
    expect(pickRenderer(search, { webgl2: true })).toEqual(withWebgl2);
    expect(pickRenderer(search, { webgl2: false })).toEqual(withoutWebgl2);
  });
});
