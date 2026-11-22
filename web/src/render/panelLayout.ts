import type { PanelSpec } from "./renderer";

export const HEADER_H = 32;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fieldRect(spec: PanelSpec): Rect {
  return {
    x: spec.x,
    y: spec.y + (spec.title !== undefined ? HEADER_H : 0),
    w: spec.size,
    h: spec.size,
  };
}

export function glViewport(rect: Rect, cssH: number): Rect {
  return { x: rect.x, y: cssH - rect.y - rect.h, w: rect.w, h: rect.h };
}

export function panelAt(specs: readonly PanelSpec[], px: number, py: number): number {
  for (let i = 0; i < specs.length; i++) {
    const field = fieldRect(specs[i]!);
    if (px >= field.x && px < field.x + field.w && py >= field.y && py < field.y + field.h) return i;
  }
  return -1;
}