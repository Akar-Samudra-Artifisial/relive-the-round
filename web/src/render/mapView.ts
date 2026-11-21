import { Container, Graphics, Text } from "pixi.js";
import type { MapDef } from "../maps/types";
import { polygonCentroid, type Polygon } from "../sim/geom";
import { DISPLAY_FONT, MONO_FONT } from "../ui/fonts";
import { THEME_NUM } from "../ui/theme";

/** Map palette (Tactical HUD): dark floor, raised walls with a thin cyan edge, amber sites. */
const FLOOR = 0x070b10;
const GRID_MINOR = 400;
const GRID_MAJOR = 2000;
const WALL_FILL = 0x111b25;
const ATTACK_TINT = THEME_NUM.red;
const DEFENSE_TINT = THEME_NUM.green;

export function drawPoly(g: Graphics, poly: Polygon): Graphics {
  return g.poly([...poly]);
}

/** Dashed outline of a closed polygon (world units). */
function dashedPoly(g: Graphics, poly: Polygon, dash: number, gap: number): void {
  const n = poly.length / 2;
  const pt = (i: number): { x: number; y: number } => ({ x: poly[2 * (i % n)]!, y: poly[2 * (i % n) + 1]! });
  for (let i = 0; i < n; i++) {
    const a = pt(i);
    const b = pt(i + 1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash);
      g.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * e, a.y + uy * e);
    }
  }
}

/** Corner brackets on the polygon's bounding box. */
function brackets(g: Graphics, poly: Polygon, arm: number): void {
  const xs = poly.filter((_, i) => i % 2 === 0);
  const ys = poly.filter((_, i) => i % 2 === 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const a = Math.min(arm, (x1 - x0) / 3, (y1 - y0) / 3);
  g.moveTo(x0, y0 + a).lineTo(x0, y0).lineTo(x0 + a, y0);
  g.moveTo(x1 - a, y0).lineTo(x1, y0).lineTo(x1, y0 + a);
  g.moveTo(x1, y1 - a).lineTo(x1, y1).lineTo(x1 - a, y1);
  g.moveTo(x0 + a, y1).lineTo(x0, y1).lineTo(x0, y1 - a);
}

/** Spawn area: faint side tint with a dashed outline. */
function spawnZone(g: Graphics, poly: Polygon, color: number): void {
  drawPoly(g, poly).fill({ color, alpha: 0.07 });
  dashedPoly(g, poly, 120, 90);
  g.stroke({ width: 14, color, alpha: 0.45 });
}

export type DrawMapOptions = {
  /** On-screen CSS px per world unit; lets labels keep a readable minimum size on small screens. */
  readonly cssPxPerUnit?: number;
};

/** Spawn labels never render below this many CSS px. */
const MIN_LABEL_CSS_PX = 10;
const SPAWN_LABEL_SIZE = 150;

/** Spawn label font size (world units): the design size, raised so it is ≥ MIN_LABEL_CSS_PX on screen. */
export function spawnLabelSize(cssPxPerUnit: number | undefined): number {
  if (!(cssPxPerUnit !== undefined && cssPxPerUnit > 0)) return SPAWN_LABEL_SIZE;
  return Math.max(SPAWN_LABEL_SIZE, Math.ceil(MIN_LABEL_CSS_PX / cssPxPerUnit));
}

/** Static map layer: floor + grid, spawns, sites, walls and labels (world units). */
export function drawMap(map: MapDef, opts: DrawMapOptions = {}): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(0, 0, map.width, map.height).fill({ color: FLOOR });

  // Tactical grid: faint minor cells, brighter major lines.
  for (let x = GRID_MINOR; x < map.width; x += GRID_MINOR) g.moveTo(x, 0).lineTo(x, map.height);
  for (let y = GRID_MINOR; y < map.height; y += GRID_MINOR) g.moveTo(0, y).lineTo(map.width, y);
  g.stroke({ width: 8, color: THEME_NUM.line, alpha: 0.45 });
  for (let x = GRID_MAJOR; x < map.width; x += GRID_MAJOR) g.moveTo(x, 0).lineTo(x, map.height);
  for (let y = GRID_MAJOR; y < map.height; y += GRID_MAJOR) g.moveTo(0, y).lineTo(map.width, y);
  g.stroke({ width: 12, color: THEME_NUM.lineHi, alpha: 0.4 });

  spawnZone(g, map.spawns.attack, ATTACK_TINT);
  spawnZone(g, map.spawns.defense, DEFENSE_TINT);

  for (const site of Object.values(map.sites)) {
    drawPoly(g, site).fill({ color: THEME_NUM.amber, alpha: 0.08 });
    dashedPoly(g, site, 160, 110);
    g.stroke({ width: 14, color: THEME_NUM.amber, alpha: 0.5 });
    brackets(g, site, 420);
    g.stroke({ width: 34, color: THEME_NUM.amber, alpha: 0.9 });
  }

  // Walls: a soft cyan halo first (under every wall), then solid fill + crisp edge.
  for (const w of map.walls) drawPoly(g, w).stroke({ width: 70, color: THEME_NUM.cyan, alpha: 0.06 });
  for (const w of map.walls) drawPoly(g, w).fill({ color: WALL_FILL }).stroke({ width: 16, color: THEME_NUM.cyan, alpha: 0.55 });
  c.addChild(g);

  for (const [name, site] of Object.entries(map.sites)) {
    const p = polygonCentroid(site);
    const t = new Text({
      text: name,
      style: { fill: THEME_NUM.amber, fontFamily: DISPLAY_FONT, fontSize: 380, fontWeight: "700" },
    });
    t.anchor.set(0.5);
    t.alpha = 0.55;
    t.position.set(p.x, p.y);
    c.addChild(t);
  }
  const spawnLabels: [Polygon, string, number][] = [
    [map.spawns.attack, "ATK SPAWN", ATTACK_TINT],
    [map.spawns.defense, "DEF SPAWN", DEFENSE_TINT],
  ];
  const labelSize = spawnLabelSize(opts.cssPxPerUnit);
  for (const [poly, label, color] of spawnLabels) {
    const p = polygonCentroid(poly);
    const t = new Text({
      text: label,
      style: { fill: color, fontFamily: MONO_FONT, fontSize: labelSize, fontWeight: "700", letterSpacing: labelSize * 0.12 },
    });
    t.anchor.set(0.5);
    t.alpha = 0.7;
    t.position.set(p.x, p.y);
    c.addChild(t);
  }
  return c;
}
