import { describe, expect, it } from "vitest";
import { ReplayPlayer } from "../src/game/replayPlayer";
import { buildYouTimeline, replayLayout } from "../src/game/replayModel";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import { KILN } from "../src/maps/kiln";
import { buildWorld } from "../src/sim/world";
import { fieldRect, glViewport, HEADER_H, panelAt } from "../src/render/panelLayout";
import pixiSource from "../src/render/pixi2d.ts?raw";

describe("panelLayout", () => {
  it("places titled fields below the header and leaves untitled fields at the panel origin", () => {
    expect(HEADER_H).toBe(32);
    expect(fieldRect({ x: 12, y: 20, size: 100, title: "YOU" })).toEqual({ x: 12, y: 52, w: 100, h: 100 });
    expect(fieldRect({ x: 12, y: 20, size: 100 })).toEqual({ x: 12, y: 20, w: 100, h: 100 });
  });

  it("flips a CSS rectangle into GL viewport coordinates", () => {
    expect(glViewport({ x: 12, y: 40, w: 180, h: 200 }, 600)).toEqual({ x: 12, y: 360, w: 180, h: 200 });
  });

  it("finds fields in real row and column replay layouts but not headers, gaps, or outside", () => {
    const world = buildWorld(KILN, SYNTHETIC_1V3);
    const player = new ReplayPlayer({ world, timeline: buildYouTimeline(world, 42, []) });

    const rowLayout = replayLayout(1280, 800);
    const row = player.panels(rowLayout.width, rowLayout.height, rowLayout.layout);
    for (const [i, spec] of row.entries()) {
      const field = fieldRect(spec);
      expect(panelAt(row, field.x + field.w / 2, field.y + field.h / 2)).toBe(i);
      expect(panelAt(row, spec.x + 1, spec.y + 1)).toBe(-1);
    }
    const rowGapX = (fieldRect(row[0]!).x + fieldRect(row[0]!).w + fieldRect(row[1]!).x) / 2;
    expect(panelAt(row, rowGapX, fieldRect(row[0]!).y + 10)).toBe(-1);
    expect(panelAt(row, -1, 0)).toBe(-1);

    const columnLayout = replayLayout(800, 1200);
    const column = player.panels(columnLayout.width, columnLayout.height, columnLayout.layout);
    for (const [i, spec] of column.entries()) {
      const field = fieldRect(spec);
      expect(panelAt(column, field.x + field.w / 2, field.y + field.h / 2)).toBe(i);
      expect(panelAt(column, spec.x + 1, spec.y + 1)).toBe(-1);
    }
    const columnGapY = fieldRect(column[0]!).y + fieldRect(column[0]!).h + 8;
    expect(panelAt(column, fieldRect(column[0]!).x + 10, columnGapY)).toBe(-1);
    expect(panelAt(column, columnLayout.width + 1, columnGapY)).toBe(-1);
  });

  it("shares the header height and field geometry with the Pixi renderer", () => {
    expect(pixiSource).toContain('import { fieldRect, HEADER_H } from "./panelLayout";');
    expect(pixiSource).not.toMatch(/const\s+HEADER_H\s*=/);
    expect(pixiSource).not.toMatch(/function\s+fieldOrigin\s*\(/);
  });
});