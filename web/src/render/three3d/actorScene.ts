import * as THREE from "three";
import { DEFUSE_RADIUS } from "../../sim/constants";
import { THEME_NUM } from "../../ui/theme";
import {
  AIM_HALF,
  AIM_LEN,
  BODY_EDGE,
  ENEMY_COLOR,
  ENEMY_R,
  ENEMY_TRACER,
  PLAYER_COLOR,
  PLAYER_R,
  PLAYER_TRACER,
  VIEW_HALF,
  VIEW_LEN,
} from "../actorStyle";
import type { ActorView, DownView, FrameView, SpikeView, TracerView } from "../renderer";

/**
 * Dynamic three.js layer (phase 5): draws one `FrameView` with pooled meshes. World (x, y) maps to
 * (X = x, Y, Z = y) like `mapScene.ts`. A world heading a = atan2(dy, dx) is `rotation.y = -a`:
 * rotating about Y by θ sends local +X to (cos θ, 0, -sin θ), so θ = -a gives (cos a, 0, sin a).
 * All geometries and materials are created in the constructor (or when a pool grows past its
 * largest size); `update` only toggles visibility and sets transforms, opacity and colour.
 */

/** Base heights (cm) of the flat ground decals, above the map layers (Y 0-3). */
export const DECAL_Y = { spike: 4, down: 4.8, enemy: 5, player: 5.6 } as const;
/** Chest height of tracers and hit flashes. */
export const TRACER_Y = 120;
export const PLAYER_HEIGHT = 160;
export const ENEMY_HEIGHT = 150;
const SPIKE_HOVER = 130;
const SPIKE_SIZE = 95;
const RING_SEGMENTS = 64;
const TRACK_R = DEFUSE_RADIUS + 110;
const TRACK_W = 46;
const PULSE_W = 16;
const PULSE_GROW = 420;
const PULSE_PERIOD = 1.2;
const POOL = { enemies: 5, downs: 6, tracers: 24 } as const;
/** renderOrder per layer; the map uses up to 5. */
const ORDER = { spike: 6, actor: 7, player: 8, tracer: 9 } as const;

type Owned = THREE.BufferGeometry | THREE.Material;
type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

type EnemySlot = { group: THREE.Group; cone: THREE.Mesh; tick: THREE.Mesh };
type DownSlot = { group: THREE.Group; ring: THREE.Mesh; x: THREE.Mesh };
type TracerSlot = { group: THREE.Group; halo: BasicMesh; core: BasicMesh; hitOuter: BasicMesh; hitInner: BasicMesh };

const NO_ENEMIES: readonly ActorView[] = [];
const NO_DOWNS: readonly DownView[] = [];
const NO_TRACERS: readonly TracerView[] = [];

/** Flat XY geometry onto the ground: rotateX(+π/2) maps (x, y, 0) to (x, 0, y), keeping world angles. */
function toGround<T extends THREE.BufferGeometry>(g: T): T {
  g.rotateX(Math.PI / 2);
  return g;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class ActorLayer {
  readonly group = new THREE.Group();
  private readonly owned = new Set<Owned>();
  private readonly geo;
  private readonly mat;
  private readonly player;
  private readonly spike;
  private readonly enemies: EnemySlot[] = [];
  private readonly downs: DownSlot[] = [];
  private readonly tracers: TracerSlot[] = [];
  private readonly makeEnemyFn = (): EnemySlot => this.makeEnemy();
  private readonly setEnemyFn = (slot: EnemySlot, view: ActorView): void => this.setEnemy(slot, view);
  private readonly makeDownFn = (): DownSlot => this.makeDown();
  private readonly setDownFn = (slot: DownSlot, view: DownView): void => this.setDown(slot, view);
  private readonly makeTracerFn = (): TracerSlot => this.makeTracer();
  private readonly setTracerFn = (slot: TracerSlot, view: TracerView): void => this.setTracer(slot, view);
  private readonly ringCos = new Float32Array(RING_SEGMENTS + 1);
  private readonly ringSin = new Float32Array(RING_SEGMENTS + 1);

  constructor() {
    this.group.name = "actors";
    const g = <T extends THREE.BufferGeometry>(x: T): T => this.own(x);
    const cylinder = g(new THREE.CylinderGeometry(1, 1, 1, 24));
    cylinder.translate(0, 0.5, 0);
    const strip = g(toGround(new THREE.PlaneGeometry(1, 1)));
    strip.translate(0.5, 0, 0);
    const box = g(new THREE.BoxGeometry(1, 1, 1));
    box.translate(0.5, 0, 0);
    const octa = g(new THREE.OctahedronGeometry(SPIKE_SIZE));
    this.geo = {
      cylinder,
      disc: g(toGround(new THREE.CircleGeometry(1, 48))),
      strip,
      box,
      aimCone: g(fanGeometry(AIM_HALF, AIM_LEN)),
      viewCone: g(fanGeometry(VIEW_HALF, VIEW_LEN)),
      nose: g(noseGeometry()),
      cross: g(segmentsGeometry([-70, -70, 70, 70, 70, -70, -70, 70], 22)),
      downRing: g(ringGeometry(100, 10)),
      outline: g(ringGeometry(DEFUSE_RADIUS, 12)),
      still: g(ringGeometry(DEFUSE_RADIUS + 200, 10)),
      pulse: g(ringGeometry(DEFUSE_RADIUS, PULSE_W)),
      track: g(ringGeometry(TRACK_R, TRACK_W)),
      progress: g(ringGeometry(TRACK_R, TRACK_W, -Math.PI / 2)),
      octa,
      octaEdges: g(new THREE.EdgesGeometry(octa)),
    };
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const t = (i / RING_SEGMENTS) * Math.PI * 2;
      this.ringCos[i] = Math.cos(t);
      this.ringSin[i] = Math.sin(t);
    }

    const d = (color: number, opacity: number): THREE.MeshBasicMaterial => this.decalMaterial(color, opacity);
    this.mat = {
      playerBody: this.own(new THREE.MeshLambertMaterial({ color: PLAYER_COLOR })),
      playerGlow: d(PLAYER_COLOR, 0.1),
      aimCone: d(PLAYER_COLOR, 0.12),
      aimLine: d(PLAYER_COLOR, 0.35),
      nose: d(BODY_EDGE, 1),
      enemyBody: this.own(new THREE.MeshLambertMaterial({ color: ENEMY_COLOR })),
      enemyGlow: d(ENEMY_COLOR, 0.12),
      viewCone: d(ENEMY_COLOR, 0.1),
      tick: d(BODY_EDGE, 0.9),
      downRing: { player: d(PLAYER_COLOR, 0.3), enemy: d(ENEMY_COLOR, 0.3) },
      downX: { player: d(PLAYER_COLOR, 0.55), enemy: d(ENEMY_COLOR, 0.55) },
    };

    // Player (drawn last in 2D: highest decals).
    const pg = new THREE.Group();
    pg.name = "player";
    const py = DECAL_Y.player;
    const body = this.mesh("player-body", this.geo.cylinder, this.mat.playerBody, 0, 0);
    body.scale.set(PLAYER_R, PLAYER_HEIGHT, PLAYER_R);
    body.castShadow = true;
    const glow = this.mesh("player-glow", this.geo.disc, this.mat.playerGlow, py, ORDER.player);
    glow.scale.set(PLAYER_R * 1.9, 1, PLAYER_R * 1.9);
    const aimCone = this.mesh("player-aim-cone", this.geo.aimCone, this.mat.aimCone, py + 0.1, ORDER.player);
    const aimLine = this.mesh("player-aim-line", this.geo.strip, this.mat.aimLine, py + 0.2, ORDER.player);
    aimLine.scale.set(AIM_LEN, 1, 10);
    const nose = this.mesh("player-nose", this.geo.nose, this.mat.nose, py + 0.4, ORDER.player);
    pg.add(body, glow, aimCone, aimLine, nose);
    this.player = { group: pg, aimCone, aimLine, nose };

    // Spike (drawn first in 2D: lowest decals).
    const sg = new THREE.Group();
    sg.name = "spike";
    const sy = DECAL_Y.spike;
    const zone = this.mesh("spike-zone", this.geo.disc, d(THEME_NUM.red, 0.1), sy, ORDER.spike);
    zone.scale.set(DEFUSE_RADIUS, 1, DEFUSE_RADIUS);
    const outline = this.mesh("spike-outline", this.geo.outline, d(THEME_NUM.red, 0.7), sy + 0.1, ORDER.spike);
    const pulseMat = d(THEME_NUM.red, 0.45);
    const pulse = this.mesh("spike-pulse", this.geo.pulse, pulseMat, sy + 0.2, ORDER.spike);
    pulse.frustumCulled = false; // vertices move every frame; the bounding sphere is stale
    const still = this.mesh("spike-still", this.geo.still, d(THEME_NUM.red, 0.25), sy + 0.2, ORDER.spike);
    const track = this.mesh("spike-track", this.geo.track, d(THEME_NUM.surfaceHi, 0.85), sy + 0.3, ORDER.spike);
    const own = this.mesh("spike-progress-own", this.geo.progress, d(THEME_NUM.green, 1), sy + 0.4, ORDER.spike);
    const enemy = this.mesh("spike-progress-enemy", this.geo.progress, d(THEME_NUM.red, 1), sy + 0.4, ORDER.spike);
    const diamond = this.mesh("spike-diamond", this.geo.octa, this.own(new THREE.MeshLambertMaterial({ color: THEME_NUM.red })), SPIKE_HOVER, 0);
    const edges = new THREE.LineSegments(this.geo.octaEdges, this.own(new THREE.LineBasicMaterial({ color: THEME_NUM.amber })));
    edges.name = "spike-diamond-edges";
    diamond.add(edges);
    sg.add(zone, outline, pulse, still, track, own, enemy, diamond);
    this.spike = { group: sg, pulse, pulseMat, still, track, own, enemy };

    this.group.add(sg, pg);
    for (let i = 0; i < POOL.enemies; i++) this.enemies.push(this.makeEnemy());
    for (let i = 0; i < POOL.downs; i++) this.downs.push(this.makeDown());
    for (let i = 0; i < POOL.tracers; i++) this.tracers.push(this.makeTracer());
    this.update(null, 0);
  }

  /** Shows `frame` (or nothing for null). `_nowMs` is reserved: pulse and fade come from the frame. */
  update(frame: FrameView | null, _nowMs: number): void {
    this.updatePlayer(frame?.player ?? null);
    this.updateSpike(frame?.spike ?? null);
    fill(this.enemies, frame?.enemies ?? NO_ENEMIES, this.makeEnemyFn, this.setEnemyFn);
    fill(this.downs, frame?.downs ?? NO_DOWNS, this.makeDownFn, this.setDownFn);
    fill(this.tracers, frame?.tracers ?? NO_TRACERS, this.makeTracerFn, this.setTracerFn);
  }

  /** Disposes every geometry and material this layer created. */
  dispose(): void {
    for (const x of this.owned) x.dispose();
    this.owned.clear();
  }

  private own<T extends Owned>(x: T): T {
    this.owned.add(x);
    return x;
  }

  private decalMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return this.own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  }

  private mesh<M extends THREE.Material>(name: string, geo: THREE.BufferGeometry, mat: M, y: number, order: number): THREE.Mesh<THREE.BufferGeometry, M> {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.y = y;
    m.renderOrder = order;
    return m;
  }

  private makeEnemy(): EnemySlot {
    const group = new THREE.Group();
    group.name = "enemy";
    const ey = DECAL_Y.enemy;
    const body = this.mesh("enemy-body", this.geo.cylinder, this.mat.enemyBody, 0, 0);
    body.scale.set(ENEMY_R, ENEMY_HEIGHT, ENEMY_R);
    body.castShadow = true;
    const glow = this.mesh("enemy-glow", this.geo.disc, this.mat.enemyGlow, ey, ORDER.actor);
    glow.scale.set(ENEMY_R * 1.8, 1, ENEMY_R * 1.8);
    const cone = this.mesh("enemy-cone", this.geo.viewCone, this.mat.viewCone, ey + 0.2, ORDER.actor);
    const tick = this.mesh("enemy-tick", this.geo.strip, this.mat.tick, ey + 0.4, ORDER.actor);
    tick.scale.set(ENEMY_R + 110, 1, 22);
    group.add(body, glow, cone, tick);
    this.group.add(group);
    return { group, cone, tick };
  }

  private makeDown(): DownSlot {
    const group = new THREE.Group();
    group.name = "down";
    const ring = this.mesh("down-ring", this.geo.downRing, this.mat.downRing.enemy, DECAL_Y.down, ORDER.actor);
    const x = this.mesh("down-x", this.geo.cross, this.mat.downX.enemy, DECAL_Y.down + 0.05, ORDER.actor);
    group.add(ring, x);
    this.group.add(group);
    return { group, ring, x };
  }

  private makeTracer(): TracerSlot {
    const group = new THREE.Group();
    group.name = "tracer";
    const m = (): THREE.MeshBasicMaterial =>
      this.own(new THREE.MeshBasicMaterial({ color: PLAYER_TRACER, transparent: true, opacity: 1, depthWrite: false }));
    const flat = (): THREE.MeshBasicMaterial => this.decalMaterial(0xffffff, 1);
    const halo = this.mesh("tracer-halo", this.geo.box, m(), TRACER_Y, ORDER.tracer);
    const core = this.mesh("tracer-core", this.geo.box, m(), TRACER_Y, ORDER.tracer);
    const hitOuter = this.mesh("tracer-hit-outer", this.geo.disc, flat(), TRACER_Y, ORDER.tracer);
    hitOuter.scale.set(150, 1, 150);
    const hitInner = this.mesh("tracer-hit-inner", this.geo.disc, flat(), TRACER_Y + 1, ORDER.tracer);
    hitInner.scale.set(70, 1, 70);
    group.add(halo, core, hitOuter, hitInner);
    this.group.add(group);
    return { group, halo, core, hitOuter, hitInner };
  }

  private updatePlayer(p: FrameView["player"]): void {
    const { group, aimCone, aimLine, nose } = this.player;
    group.visible = p !== null;
    if (!p) return;
    group.position.set(p.x, 0, p.y);
    const dx = p.aim ? p.aim.x - p.x : 0;
    const dy = p.aim ? p.aim.y - p.y : 0;
    const hasDir = p.aim !== null && dx * dx + dy * dy > PLAYER_R * PLAYER_R;
    aimCone.visible = aimLine.visible = nose.visible = hasDir;
    if (!hasDir) return;
    const r = -Math.atan2(dy, dx);
    aimCone.rotation.y = r;
    aimLine.rotation.y = r;
    nose.rotation.y = r;
  }

  private setEnemy(s: EnemySlot, e: ActorView): void {
    s.group.position.set(e.x, 0, e.y);
    const hasFacing = e.fx !== undefined && e.fy !== undefined && (e.fx !== 0 || e.fy !== 0);
    s.cone.visible = s.tick.visible = hasFacing;
    if (!hasFacing) return;
    const r = -Math.atan2(e.fy!, e.fx!);
    s.cone.rotation.y = r;
    s.tick.rotation.y = r;
    s.tick.scale.x = Math.hypot(e.fx!, e.fy!) * (ENEMY_R + 110);
  }

  private setDown(s: DownSlot, v: DownView): void {
    s.group.position.set(v.x, 0, v.y);
    s.ring.material = this.mat.downRing[v.side];
    s.x.material = this.mat.downX[v.side];
  }

  private setTracer(s: TracerSlot, t: TracerView): void {
    const { from, to } = t.shot;
    const a = clamp01(t.fade);
    const color = t.shot.by === "P0" ? PLAYER_TRACER : ENEMY_TRACER;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(Math.hypot(dx, dy), 1e-3);
    const r = -Math.atan2(dy, dx);
    s.halo.position.set(from.x, TRACER_Y, from.y);
    s.halo.rotation.y = r;
    s.halo.scale.set(len, 44, 44);
    s.halo.material.color.setHex(color);
    s.halo.material.opacity = 0.14 * a;
    s.core.position.set(from.x, TRACER_Y, from.y);
    s.core.rotation.y = r;
    s.core.scale.set(len, 12, 12);
    s.core.material.color.setHex(color);
    s.core.material.opacity = 0.9 * a;
    const hit = t.shot.hit !== null;
    s.hitOuter.visible = s.hitInner.visible = hit;
    if (!hit) return;
    s.hitOuter.position.set(to.x, TRACER_Y, to.y);
    s.hitOuter.material.opacity = 0.18 * a;
    s.hitInner.position.set(to.x, TRACER_Y + 1, to.y);
    s.hitInner.material.color.setHex(color);
    s.hitInner.material.opacity = 0.75 * a;
  }

  private updateSpike(sp: FrameView["spike"]): void {
    const s = this.spike;
    s.group.visible = sp !== null;
    if (!sp) return;
    s.group.position.set(sp.x, 0, sp.y);
    const pulsing = sp.pulseT !== null;
    s.pulse.visible = pulsing;
    s.still.visible = !pulsing;
    if (sp.pulseT !== null) {
      const k = (sp.pulseT % PULSE_PERIOD) / PULSE_PERIOD;
      this.setPulseRadius(DEFUSE_RADIUS + k * PULSE_GROW);
      s.pulseMat.opacity = 0.45 * (1 - k);
    }
    this.setProgress(sp);
  }

  private setProgress(sp: SpikeView): void {
    const s = this.spike;
    const enemy = sp.enemyDefuse ?? 0;
    const own = sp.defuse > 0;
    s.track.visible = own || enemy > 0;
    s.own.visible = own;
    s.enemy.visible = !own && enemy > 0;
    const frac = clamp01(own ? sp.defuse : enemy);
    const segments = frac > 0 ? Math.max(1, Math.round(frac * RING_SEGMENTS)) : 0;
    this.geo.progress.setDrawRange(0, 6 * segments);
  }

  /** Rewrites the pulse ring rows in place (constant stroke width, no allocation). */
  private setPulseRadius(r: number): void {
    const pos = this.geo.pulse.getAttribute("position") as THREE.BufferAttribute;
    const inner = r - PULSE_W / 2;
    const outer = r + PULSE_W / 2;
    const n = RING_SEGMENTS + 1;
    for (let i = 0; i < n; i++) {
      const c = this.ringCos[i]!;
      const s = this.ringSin[i]!;
      pos.setXYZ(i, inner * c, 0, inner * s);
      pos.setXYZ(n + i, outer * c, 0, outer * s);
    }
    pos.needsUpdate = true;
  }
}

/** Shows the first `items.length` slots (growing the pool if needed) and hides the rest. */
function fill<S extends { group: THREE.Group }, V>(pool: S[], items: readonly V[], make: () => S, set: (s: S, v: V) => void): void {
  while (pool.length < items.length) pool.push(make());
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    s.group.visible = i < items.length;
    if (i < items.length) set(s, items[i]!);
  }
}

/** Ground ring of radius `r` and stroke `w`; theta grows with the world angle from `start`. */
function ringGeometry(r: number, w: number, start = 0): THREE.RingGeometry {
  return toGround(new THREE.RingGeometry(r - w / 2, r + w / 2, RING_SEGMENTS, 1, start, Math.PI * 2));
}

/** Filled sector on the ground pointing at local +X (6 steps, like the 2D cone). */
function fanGeometry(half: number, len: number): THREE.BufferGeometry {
  const steps = 6;
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -half + (2 * half * i) / steps;
    pos.push(Math.cos(t) * len, 0, Math.sin(t) * len);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** The player's nose triangle pointing at local +X (tip R + 90, base R + 10 at ±0.5 rad). */
function noseGeometry(): THREE.BufferGeometry {
  const tip = PLAYER_R + 90;
  const base = PLAYER_R + 10;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([tip, 0, 0, Math.cos(0.5) * base, 0, Math.sin(0.5) * base, Math.cos(-0.5) * base, 0, Math.sin(-0.5) * base], 3),
  );
  return g;
}

/** Ground quads of width `w` along world segments (x0, y0, x1, y1, ...). */
function segmentsGeometry(segs: readonly number[], w: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const [ax, ay, bx, by] = [segs[i]!, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (-(by - ay) / len) * (w / 2);
    const ny = ((bx - ax) / len) * (w / 2);
    const v = pos.length / 3;
    pos.push(ax + nx, 0, ay + ny, ax - nx, 0, ay - ny, bx - nx, 0, by - ny, bx + nx, 0, by + ny);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
