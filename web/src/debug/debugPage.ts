import { Application, Container, Graphics, Text } from "pixi.js";
import { SYNTHETIC_1V3 } from "../level/fixtures/synthetic-1v3";
import { loadLevel } from "../level/loader";
import type { Level, MapName } from "../level/types";
import { renderResolution } from "../game/input";
import { mapFor } from "../maps";
import { drawMap } from "../render/mapView";
import type { DensityRaster } from "../calib/metrics";
import { cellCenter, isWalkable } from "../sim/nav";
import { railPosition, type Rail } from "../sim/rail";
import { warpUV } from "../sim/warp";
import { buildWorld, type World } from "../sim/world";

const VIEW_PX = 820;
const ENEMY_COLORS = [0xff6b5a, 0xffa94d, 0xf783ac, 0xc77dff, 0xff4d6d];
const CLUTCHER_COLOR = 0x5ad1ff;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`debug: missing #${id}`);
  return e as T;
}

const MAP_NAMES: readonly MapName[] = ["kiln", "cistern"];

/** `?level=<file>` loads a real level (its own map wins); otherwise `?map=<kiln|cistern>` picks the map for the synthetic fixture. */
async function pickLevel(): Promise<Level> {
  const params = new URLSearchParams(location.search);
  const file = params.get("level");
  if (file) return loadLevel(file);
  const map = params.get("map") ?? "kiln";
  if (!MAP_NAMES.includes(map as MapName)) throw new Error(`debug: unknown ?map=${map} (expected ${MAP_NAMES.join(" | ")})`);
  // The fixture's uv tracks were drawn for Kiln; on another map they only demo the warp.
  return map === SYNTHETIC_1V3.map ? SYNTHETIC_1V3 : { ...SYNTHETIC_1V3, id: `${SYNTHETIC_1V3.id}-${map}`, map: map as MapName };
}

function drawNav(world: World): Graphics {
  const g = new Graphics();
  const { nav } = world;
  for (let i = 0; i < nav.walkable.length; i++) {
    if (nav.walkable[i] !== 1) continue;
    const p = cellCenter(nav, i);
    g.rect(p.x - nav.cell / 2 + 8, p.y - nav.cell / 2 + 8, nav.cell - 16, nav.cell - 16);
  }
  g.fill({ color: 0x6bff95, alpha: 0.18 });
  return g;
}

function drawWarp(world: World): Container {
  const c = new Container();
  const g = new Graphics();
  const lm = world.warp.landmarks;
  for (const [i, j, k] of world.warp.triangles) {
    g.poly([lm[i]!.dst[0], lm[i]!.dst[1], lm[j]!.dst[0], lm[j]!.dst[1], lm[k]!.dst[0], lm[k]!.dst[1]]);
  }
  g.stroke({ width: 10, color: 0xffe066, alpha: 0.5 });
  for (const l of lm) g.circle(l.dst[0], l.dst[1], 60).fill({ color: 0xffe066 });
  c.addChild(g);
  for (const l of lm) {
    const t = new Text({ text: l.name, style: { fill: 0xffe066, fontSize: 110 } });
    t.position.set(l.dst[0] + 70, l.dst[1] - 60);
    c.addChild(t);
  }
  return c;
}

/** Dev-only: real-data position density, copied temporarily to public/calib/ (git-ignored). */
async function loadDensity(map: MapName): Promise<DensityRaster> {
  // The name goes into a URL path: only the known maps (`?level=` files carry their own map field).
  if (!MAP_NAMES.includes(map)) throw new Error(`density: unknown map "${map}" (expected ${MAP_NAMES.join(" | ")})`);
  const url = `${import.meta.env.BASE_URL}calib/${map}-density.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`density: ${url} → HTTP ${res.status} (copy data/calib/${map}-density.json to web/public/calib/)`);
  const raw: unknown = await res.json();
  const r = raw as Partial<DensityRaster> | null;
  if (!r || typeof r.size !== "number" || !Array.isArray(r.counts) || r.counts.length !== r.size) {
    throw new Error(`density: ${url} is not a {size, counts[size][size]} raster`);
  }
  return { size: r.size, counts: r.counts };
}

/** Each raster cell warped onto the map; teal = lands on walkable nav, red = lands in a wall. */
function drawDensity(world: World, d: DensityRaster): Graphics {
  const g = new Graphics();
  let max = 0;
  for (const row of d.counts) for (const c of row) max = Math.max(max, c);
  const n = d.size;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const count = d.counts[r]?.[c] ?? 0;
      if (count <= 0) continue;
      const corners = [
        [c, r],
        [c + 1, r],
        [c + 1, r + 1],
        [c, r + 1],
      ].flatMap(([cu, rv]) => {
        const p = warpUV(world.warp, cu! / n, rv! / n);
        return [p.x, p.y];
      });
      const centre = warpUV(world.warp, (c + 0.5) / n, (r + 0.5) / n);
      const alpha = 0.15 + 0.6 * (Math.log1p(count) / Math.log1p(max));
      g.poly(corners).fill({ color: isWalkable(world.nav, centre) ? 0x38d9a9 : 0xff3b3b, alpha });
    }
  }
  return g;
}

function drawRail(g: Graphics, rail: Rail, color: number): void {
  const k = rail.keys;
  g.moveTo(k[0]!.x, k[0]!.y);
  for (const p of k.slice(1)) g.lineTo(p.x, p.y);
  g.stroke({ width: 18, color, alpha: 0.55 });
  for (const a of rail.anchors) g.circle(a.x, a.y, 45).fill({ color, alpha: 0.9 });
}

export async function startDebugPage(): Promise<void> {
  const level = await pickLevel();
  const world = buildWorld(mapFor(level.map), level);

  const app = new Application();
  await app.init({
    width: VIEW_PX,
    height: VIEW_PX,
    background: 0x14110f,
    antialias: true,
    resolution: renderResolution(window.devicePixelRatio),
    autoDensity: true,
  });
  el<HTMLDivElement>("stage").appendChild(app.canvas);

  const root = new Container();
  root.scale.set(VIEW_PX / Math.max(world.map.width, world.map.height));
  app.stage.addChild(root);

  root.addChild(drawMap(world.map));
  const navLayer = drawNav(world);
  const warpLayer = drawWarp(world);
  const railLayer = new Graphics();
  world.enemyRails.forEach(({ rail }, i) => drawRail(railLayer, rail, ENEMY_COLORS[i % ENEMY_COLORS.length]!));
  drawRail(railLayer, world.clutcherRail, CLUTCHER_COLOR);
  // Raw clutcher samples (warped, unsnapped) as small rings.
  for (const s of level.clutcher.samples) {
    const p = warpUV(world.warp, s.u, s.v);
    railLayer.circle(p.x, p.y, 70).stroke({ width: 10, color: 0xffffff, alpha: 0.7 });
  }
  const densityLayer = new Container();
  root.addChild(densityLayer, navLayer, warpLayer, railLayer);

  const actors = new Graphics();
  root.addChild(actors);

  if (import.meta.env.DEV) {
    const showDensity = el<HTMLInputElement>("showDensity");
    el<HTMLLabelElement>("densityToggle").hidden = false;
    let loaded = false;
    showDensity.addEventListener("change", () => {
      densityLayer.visible = showDensity.checked;
      if (!showDensity.checked || loaded) return;
      loaded = true;
      loadDensity(level.map)
        .then((d) => densityLayer.addChild(drawDensity(world, d)))
        .catch((e: unknown) => {
          loaded = false;
          showDensity.checked = false;
          el<HTMLDivElement>("error").textContent = e instanceof Error ? e.message : String(e);
        });
    });
    if (new URLSearchParams(location.search).has("density")) {
      showDensity.checked = true;
      showDensity.dispatchEvent(new Event("change"));
    }
  }

  const showNav = el<HTMLInputElement>("showNav");
  const showWarp = el<HTMLInputElement>("showWarp");
  const showRails = el<HTMLInputElement>("showRails");
  const slider = el<HTMLInputElement>("time");
  const clock = el<HTMLSpanElement>("clock");
  const play = el<HTMLButtonElement>("play");
  el<HTMLSpanElement>("levelName").textContent = `${level.id} · ${world.map.name} (${level.map}) · 1v${level.enemies.length}`;

  const t0 = world.clutcherRail.keys[0]!.t;
  const tEnd = Math.max(t0 + level.durationS, world.clutcherRail.endT, ...world.enemyRails.map((r) => r.rail.endT));
  slider.min = String(t0);
  slider.max = String(tEnd);
  slider.value = String(t0);

  let playing = false;
  let t = t0;

  const syncLayers = (): void => {
    navLayer.visible = showNav.checked;
    warpLayer.visible = showWarp.checked;
    railLayer.visible = showRails.checked;
  };
  const render = (): void => {
    actors.clear();
    world.enemyRails.forEach(({ rail }, i) => {
      const p = railPosition(rail, t);
      const diedT = level.enemies[i]!.diedT;
      const dead = diedT !== undefined && t >= diedT;
      actors.circle(p.x, p.y, 110).fill({ color: ENEMY_COLORS[i % ENEMY_COLORS.length]!, alpha: dead ? 0.3 : 1 });
    });
    const c = railPosition(world.clutcherRail, t);
    actors.circle(c.x, c.y, 120).fill({ color: CLUTCHER_COLOR }).stroke({ width: 16, color: 0xffffff });
    clock.textContent = `${t.toFixed(2)} s`;
    slider.value = String(t);
  };

  for (const box of [showNav, showWarp, showRails]) box.addEventListener("change", syncLayers);
  slider.addEventListener("input", () => {
    t = Number(slider.value);
    render();
  });
  play.addEventListener("click", () => {
    playing = !playing;
    if (playing && t >= tEnd) t = t0;
    play.textContent = playing ? "Pause" : "Play";
  });
  app.ticker.add((ticker) => {
    if (!playing) return;
    t = Math.min(tEnd, t + ticker.deltaMS / 1000);
    if (t >= tEnd) {
      playing = false;
      play.textContent = "Play";
    }
    render();
  });

  syncLayers();
  render();
}
