import * as THREE from "three";
import type { MapDef } from "../../maps/types";
import { polygonCentroid, type Polygon } from "../../sim/geom";
import { DISPLAY_FONT, MONO_FONT } from "../../ui/fonts";
import { THEME_NUM } from "../../ui/theme";
import {
  ATTACK_TINT,
  DEFENSE_TINT,
  FLOOR,
  GRID_MAJOR,
  GRID_MINOR,
  SITE_LABEL_SIZE,
  spawnLabelSize,
  WALL_FILL,
} from "../palette";

/**
 * Static three.js map scene (phase 4). World (x, y) in cm maps to (X = x, Y = 0, Z = y), Y up,
 * matching `camMath.toGround`. No renderer and no DOM here: labels come from an injected factory.
 */

/** Wall height in world units (cm). */
export const WALL_HEIGHT = 240;

/** Layer heights (cm) that keep the flat layers from z-fighting with the floor. */
const GRID_Y = 1;
const ZONE_Y = 2;
const LABEL_Y = 3;

export type LabelStyle = {
  readonly font: string;
  /** Font size in world units. */
  readonly sizeWorld: number;
  readonly color: number;
  readonly alpha: number;
  readonly letterSpacing?: number;
};

/** Returns a plane in the XY plane (text up = +Y), sized in world units, or null to skip it. */
export type MakeLabel = (text: string, style: LabelStyle) => THREE.Object3D | null;

export type MapSceneOptions = {
  readonly makeLabel?: MakeLabel;
  /** On-screen CSS px per world unit (keeps spawn labels readable, like the 2D map). */
  readonly cssPxPerUnit?: number;
};

/**
 * Shape for a flat world polygon. Built from (x, -y) so that `rotateX(-π/2)`, which maps
 * (x, y, z) to (x, z, -y), lands each point at (x, 0, y) and turns extrusion depth into +Y.
 */
export function shapeFromPolygon(poly: Polygon): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) pts.push(new THREE.Vector2(poly[i]!, -poly[i + 1]!));
  return new THREE.Shape(pts);
}

/** Pairs of world points (x0, y0, x1, y1) -> LineSegments positions at height `y`. */
function segmentsGeometry(segs: readonly number[], y: number): THREE.BufferGeometry {
  const pos = new Float32Array((segs.length / 4) * 6);
  for (let i = 0, j = 0; i + 3 < segs.length; i += 4, j += 6) {
    pos[j] = segs[i]!;
    pos[j + 1] = y;
    pos[j + 2] = segs[i + 1]!;
    pos[j + 3] = segs[i + 2]!;
    pos[j + 4] = y;
    pos[j + 5] = segs[i + 3]!;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Dashed outline of a closed polygon as segments (world units); same pattern as the 2D map. */
export function dashedSegments(poly: Polygon, dash: number, gap: number): number[] {
  const out: number[] = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[2 * i]!;
    const ay = poly[2 * i + 1]!;
    const bx = poly[2 * ((i + 1) % n)]!;
    const by = poly[2 * ((i + 1) % n) + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash);
      out.push(ax + ux * s, ay + uy * s, ax + ux * e, ay + uy * e);
    }
  }
  return out;
}

/** Corner brackets on the polygon's bounding box as segments; same shape as the 2D map. */
function bracketSegments(poly: Polygon, arm: number): number[] {
  const xs = poly.filter((_, i) => i % 2 === 0);
  const ys = poly.filter((_, i) => i % 2 === 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const a = Math.min(arm, (x1 - x0) / 3, (y1 - y0) / 3);
  return [
    x0, y0 + a, x0, y0, x0, y0, x0 + a, y0,
    x1 - a, y0, x1, y0, x1, y0, x1, y0 + a,
    x1, y1 - a, x1, y1, x1, y1, x1 - a, y1,
    x0 + a, y1, x0, y1, x0, y1, x0, y1 - a,
  ];
}

function lineMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

function lines(name: string, segs: readonly number[], y: number, mat: THREE.Material, order: number): THREE.LineSegments {
  const l = new THREE.LineSegments(segmentsGeometry(segs, y), mat);
  l.name = name;
  l.renderOrder = order;
  return l;
}

/** Flat tinted zone fill at ZONE_Y. */
function zoneFill(name: string, poly: Polygon, color: number, opacity: number): THREE.Mesh {
  const g = new THREE.ShapeGeometry(shapeFromPolygon(poly));
  g.rotateX(-Math.PI / 2);
  g.translate(0, ZONE_Y, 0);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = name;
  mesh.renderOrder = 2;
  return mesh;
}

/** Static map: floor, grid, spawns, sites, extruded walls and (optional) labels. */
export function buildMapScene(map: MapDef, opts: MapSceneOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "map";
  const { width: w, height: h } = map;

  const floorGeo = new THREE.PlaneGeometry(w, h);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(w / 2, 0, h / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: FLOOR }));
  floor.name = "floor";
  root.add(floor);

  // Tactical grid: faint minor cells, brighter major lines.
  const grid = (step: number): number[] => {
    const s: number[] = [];
    for (let x = step; x < w; x += step) s.push(x, 0, x, h);
    for (let y = step; y < h; y += step) s.push(0, y, w, y);
    return s;
  };
  root.add(lines("grid-minor", grid(GRID_MINOR), GRID_Y, lineMaterial(THEME_NUM.line, 0.45), 1));
  root.add(lines("grid-major", grid(GRID_MAJOR), GRID_Y, lineMaterial(THEME_NUM.lineHi, 0.4), 1));

  const spawns: [string, Polygon, number][] = [
    ["attack", map.spawns.attack, ATTACK_TINT],
    ["defense", map.spawns.defense, DEFENSE_TINT],
  ];
  for (const [side, poly, color] of spawns) {
    root.add(zoneFill(`spawn-${side}-fill`, poly, color, 0.07));
    root.add(lines(`spawn-${side}-outline`, dashedSegments(poly, 120, 90), ZONE_Y, lineMaterial(color, 0.45), 3));
  }

  const siteOutline = lineMaterial(THEME_NUM.amber, 0.5);
  const siteBrackets = lineMaterial(THEME_NUM.amber, 0.9);
  for (const [name, site] of Object.entries(map.sites)) {
    root.add(zoneFill(`site-${name}-fill`, site, THEME_NUM.amber, 0.08));
    root.add(lines(`site-${name}-outline`, dashedSegments(site, 160, 110), ZONE_Y, siteOutline, 3));
    root.add(lines(`site-${name}-brackets`, bracketSegments(site, 420), ZONE_Y, siteBrackets, 3));
  }

  // Walls: one extruded mesh per polygon (shared lit material) plus cyan edge lines.
  const walls = new THREE.Group();
  walls.name = "walls";
  const wallMat = new THREE.MeshLambertMaterial({ color: WALL_FILL });
  const edgeMat = lineMaterial(THEME_NUM.cyan, 0.55);
  for (const poly of map.walls) {
    const g = new THREE.ExtrudeGeometry(shapeFromPolygon(poly), { depth: WALL_HEIGHT, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, wallMat);
    mesh.name = "wall";
    walls.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    edges.name = "wall-edges";
    edges.renderOrder = 4;
    walls.add(edges);
  }
  root.add(walls);

  if (opts.makeLabel) {
    const place = (obj: THREE.Object3D | null, poly: Polygon, name: string): void => {
      if (!obj) return;
      const p = polygonCentroid(poly);
      obj.name = name;
      // Factory plane faces +Z with text up = +Y; lay it flat so text up points to -Z (screen up).
      obj.rotateX(-Math.PI / 2);
      obj.position.set(p.x, LABEL_Y, p.y);
      obj.renderOrder = 5;
      root.add(obj);
    };
    for (const [name, site] of Object.entries(map.sites)) {
      const style = { font: DISPLAY_FONT, sizeWorld: SITE_LABEL_SIZE, color: THEME_NUM.amber, alpha: 0.55 };
      place(opts.makeLabel(name, style), site, `label-site-${name}`);
    }
    const size = spawnLabelSize(opts.cssPxPerUnit);
    const spawnLabels: [Polygon, string, number][] = [
      [map.spawns.attack, "ATK SPAWN", ATTACK_TINT],
      [map.spawns.defense, "DEF SPAWN", DEFENSE_TINT],
    ];
    for (const [poly, text, color] of spawnLabels) {
      const style = { font: MONO_FONT, sizeWorld: size, color, alpha: 0.7, letterSpacing: size * 0.12 };
      place(opts.makeLabel(text, style), poly, `label-${text === "ATK SPAWN" ? "attack" : "defense"}`);
    }
  }
  return root;
}

/** Disposes every geometry, material and material texture under `group` (each once). */
export function disposeMapScene(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    const node = o as Partial<THREE.Mesh>;
    if (node.geometry instanceof THREE.BufferGeometry) geometries.add(node.geometry);
    const m = node.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x));
    else if (m instanceof THREE.Material) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
    if (map) map.dispose();
    m.dispose();
  }
}
