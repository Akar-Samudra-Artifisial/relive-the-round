import { Container, Graphics, Text } from "pixi.js";
import type { MapDef } from "../maps/types";
import { polygonCentroid, type Polygon } from "../sim/geom";

export function drawPoly(g: Graphics, poly: Polygon): Graphics {
  return g.poly([...poly]);
}

/** Static map layer: floor, sites, spawns, walls and site letters (world units). */
export function drawMap(map: MapDef): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(0, 0, map.width, map.height).fill({ color: 0x2b2420 });
  for (const site of Object.values(map.sites)) drawPoly(g, site).fill({ color: 0x5c4a2e, alpha: 0.55 });
  drawPoly(g, map.spawns.attack).fill({ color: 0x2e4a5c, alpha: 0.5 });
  drawPoly(g, map.spawns.defense).fill({ color: 0x5c2e34, alpha: 0.5 });
  for (const w of map.walls) drawPoly(g, w).fill({ color: 0x8a7a66 }).stroke({ width: 12, color: 0xc9b79c });
  c.addChild(g);
  for (const [name, site] of Object.entries(map.sites)) {
    const p = polygonCentroid(site);
    const t = new Text({ text: name, style: { fill: 0xf4e4c1, fontSize: 320, fontWeight: "bold" } });
    t.anchor.set(0.5);
    t.alpha = 0.6;
    t.position.set(p.x, p.y);
    c.addChild(t);
  }
  return c;
}
