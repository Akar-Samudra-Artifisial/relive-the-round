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
import { facing, MotionTracker, type MotionSample } from "../actorMotion";
import { CENTRE, modelMuzzle, type MuzzleSet, muzzlePoint, muzzleRole } from "../muzzle";
import type { ActorView, DownView, FrameView, SpikeView, TracerView } from "../renderer";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { ActorModel, ActorModels, ActorRig } from "./actorModels";

/**
 * Dynamic three.js layer (phase 5): draws one `FrameView` with pooled meshes. World (x, y) maps to
 * (X = x, Y, Z = y) like `mapScene.ts`. A world heading a = atan2(dy, dx) is `rotation.y = -a`:
 * rotating about Y by θ sends local +X to (cos θ, 0, -sin θ), so θ = -a gives (cos a, 0, sin a).
 * All geometries and materials are created in the constructor (or when a pool grows past its
 * largest size); `update` only toggles visibility and sets transforms, opacity and colour.
 *
 * Bodies sit under a per-actor pivot: slot group (position) → pivot (yaw) → body. Until
 * `setModels` is called the body is the primitive cylinder; afterwards the same mesh swaps to the
 * shared character geometry with a per-layer tinted material, and procedural motion (yaw from the
 * heading, footstep bob, forward lean, fall when downed) comes from `MotionTracker`.
 */

/** Base heights (cm) of the flat ground decals, above the map layers (Y 0-3). */
export const DECAL_Y = { spike: 4, down: 4.8, enemy: 5, player: 5.6 } as const;
/** Height of tracers and hit flashes on the cylinders; the models use their muzzle height. */
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
/** Uniform scale of the character models (authored ~180 cm tall). Tuned in the browser against the rings/glow. */
export const MODEL_SCALE = 2.6;
/** Extra size for the clutcher (YOU/PRO) model: the operator mesh reads smaller than the enemy's. */
export const PLAYER_MODEL_SIZE = 1.3;
/** The same for a rigged clutcher: both rigs share one body, so only a slight emphasis. */
export const PLAYER_RIG_SIZE = 1.1;
/** Clutcher size for `model` (standing and down). */
const playerSize = (model: ActorModel): number => (model.rig ? PLAYER_RIG_SIZE : PLAYER_MODEL_SIZE);
/** Footstep bob amplitude (cm, in pivot space). */
const MODEL_BOB = 6;
/** Rigged bodies: speed01 at which the walk clip fully replaces the idle clip. */
const WALK_BLEND = 0.3;
/** Longest wall-clock step (ms) the idle clip advances in one frame (tab switches, hitches). */
const IDLE_MAX_DT = 100;
/** Downed bodies: tint multiplier. */
const DOWN_DARK = 0.38;
/** Emissive share of the tint so the textured models stay readable in the dim scene. */
const MODEL_EMISSIVE = 0.22;
/** renderOrder per layer; the map uses up to 5. */
const ORDER = { spike: 6, actor: 7, player: 8, tracer: 9 } as const;

type Owned = THREE.BufferGeometry | THREE.Material;
type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

type BodyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
/**
 * A standing body drawn by a rig clone: pivot → wrapper (bob, lean, model scale) → root (rig
 * unit and offset) → skinned meshes. Both clips are played with manually set times; `still` marks
 * the reduced-motion pose (idle at t = 0, applied once).
 */
type RigSlot = {
  wrapper: THREE.Group;
  root: THREE.Object3D;
  meshes: THREE.SkinnedMesh[];
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction | null;
  still: boolean;
};
type EnemySlot = { group: THREE.Group; pivot: THREE.Group; body: BodyMesh; rig: RigSlot | null; cone: THREE.Mesh; tick: THREE.Mesh };
type DownSlot = { group: THREE.Group; pivot: THREE.Group; body: BodyMesh; ring: THREE.Mesh; x: THREE.Mesh };
type ModelMats = {
  player: THREE.MeshLambertMaterial;
  enemy: THREE.MeshLambertMaterial;
  playerDown: THREE.MeshLambertMaterial;
  enemyDown: THREE.MeshLambertMaterial;
};
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
/** MotionTracker key of the clutcher (enemies use their `z`, which is ≥ 0). */
const PLAYER_KEY = -1;

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
  private readonly motion = new MotionTracker();
  private models: ActorModels | null = null;
  private modelMat: ModelMats | null = null;
  /** Gun tips of the character models (world cm); null on the cylinders. */
  private muzzles: MuzzleSet | null = null;
  private readonly tracerStart = { x: 0, y: 0 };
  private playerColor: number = PLAYER_COLOR;
  /** Every rig clone this layer made (player + enemy slots), for dispose. */
  private readonly rigs: RigSlot[] = [];
  private lastNowMs: number | null = null;
  /** Wall-clock seconds since the previous update, for the idle clip. */
  private dtSec = 0;
  /** Set by the renderer; snaps the motion (no bob, lean or fall animation). */
  reducedMotion = false;
  private readonly makeEnemyFn = (): EnemySlot => this.makeEnemy();
  private readonly setEnemyFn = (slot: EnemySlot, view: ActorView, i: number): void => this.setEnemy(slot, view, i);
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
    const pivot = new THREE.Group();
    pivot.name = "player-pivot";
    const body = this.mesh("player-body", this.geo.cylinder, this.mat.playerBody, 0, 0);
    body.scale.set(PLAYER_R, PLAYER_HEIGHT, PLAYER_R);
    body.castShadow = true;
    pivot.add(body);
    const glow = this.mesh("player-glow", this.geo.disc, this.mat.playerGlow, py, ORDER.player);
    glow.scale.set(PLAYER_R * 1.9, 1, PLAYER_R * 1.9);
    const aimCone = this.mesh("player-aim-cone", this.geo.aimCone, this.mat.aimCone, py + 0.1, ORDER.player);
    const aimLine = this.mesh("player-aim-line", this.geo.strip, this.mat.aimLine, py + 0.2, ORDER.player);
    aimLine.scale.set(AIM_LEN, 1, 10);
    const nose = this.mesh("player-nose", this.geo.nose, this.mat.nose, py + 0.4, ORDER.player);
    pg.add(pivot, glow, aimCone, aimLine, nose);
    this.player = { group: pg, pivot, body, rig: null as RigSlot | null, aimCone, aimLine, nose };

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

  /**
   * Shows `frame` (or nothing for null). Pulse and fade come from the frame; `nowMs` (wall clock)
   * only drives the procedural body motion.
   */
  update(frame: FrameView | null, nowMs: number): void {
    // A null frame shows nothing and must not count as the panel's first real frame.
    this.motion.begin(nowMs, this.reducedMotion, frame !== null);
    this.dtSec = this.lastNowMs === null ? 0 : Math.min(IDLE_MAX_DT, Math.max(0, nowMs - this.lastNowMs)) / 1000;
    this.lastNowMs = nowMs;
    this.updatePlayer(frame?.player ?? null);
    this.updateSpike(frame?.spike ?? null);
    fill(this.enemies, frame?.enemies ?? NO_ENEMIES, this.makeEnemyFn, this.setEnemyFn);
    fill(this.downs, frame?.downs ?? NO_DOWNS, this.makeDownFn, this.setDownFn);
    fill(this.tracers, frame?.tracers ?? NO_TRACERS, this.makeTracerFn, this.setTracerFn);
    this.motion.end();
  }

  /** True once `setModels` swapped the bodies to the character models. */
  get hasModels(): boolean {
    return this.models !== null;
  }

  /**
   * Swaps every body to the character models. The geometry and texture stay owned by the caller
   * (shared across layers); the tinted materials are created here once and owned by this layer.
   */
  setModels(models: ActorModels): void {
    if (this.models) return;
    this.models = models;
    const lambert = (map: THREE.Texture | null): THREE.MeshLambertMaterial => this.own(new THREE.MeshLambertMaterial({ map }));
    // Standing bodies use the rig when there is one; downs draw `geometry` (the baked rig for a
    // rigged role, see bakeRig, so both share the rig texture).
    const standingMap = (model: ActorModel): THREE.Texture | null => (model.rig ? model.rig.map : model.map);
    this.modelMat = {
      player: lambert(standingMap(models.operator)),
      enemy: lambert(standingMap(models.enemy)),
      playerDown: lambert(models.operator.map),
      enemyDown: lambert(models.enemy.map),
    };
    this.applyColors();
    const { body } = this.player;
    body.geometry = models.operator.geometry;
    body.material = this.modelMat.player;
    const size = MODEL_SCALE * playerSize(models.operator);
    body.scale.setScalar(size);
    if (models.operator.rig) {
      this.player.rig = this.attachRig(this.player.pivot, body, models.operator.rig, "player-body", this.modelMat.player, size);
    }
    for (const s of this.enemies) this.modelEnemy(s);
    for (const s of this.downs) s.body.scale.setScalar(MODEL_SCALE);
    // An enemy without its own art draws the operator's (see loadActorModels).
    const enemyArt = models.enemy === models.operator ? "player" : "enemy";
    this.muzzles = {
      player: modelMuzzle("player", models.operator.rig !== undefined, size),
      enemy: modelMuzzle(enemyArt, models.enemy.rig !== undefined, MODEL_SCALE),
    };
  }

  /** Clutcher colour (body, glow, aim and player-side downs): cyan for YOU, amber for PRO. */
  setPlayerColor(color: number): void {
    if (color === this.playerColor) return;
    this.playerColor = color;
    this.applyColors();
  }

  /** Disposes every geometry and material this layer created (not the shared model geometry). */
  dispose(): void {
    for (const r of this.rigs) {
      r.mixer.stopAllAction();
      r.mixer.uncacheRoot(r.root);
      // Per-clone bone textures; the shared rig geometry belongs to the renderer.
      for (const m of r.meshes) m.skeleton.dispose();
    }
    this.rigs.length = 0;
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

  private applyColors(): void {
    const c = this.playerColor;
    this.mat.playerBody.color.setHex(c);
    for (const m of [this.mat.playerGlow, this.mat.aimCone, this.mat.aimLine, this.mat.downRing.player, this.mat.downX.player]) m.color.setHex(c);
    const mm = this.modelMat;
    if (!mm) return;
    tint(mm.player, c, false);
    tint(mm.playerDown, c, true);
    tint(mm.enemy, ENEMY_COLOR, false);
    tint(mm.enemyDown, ENEMY_COLOR, true);
  }

  private modelEnemy(s: EnemySlot): void {
    if (!this.models || !this.modelMat) return;
    s.body.geometry = this.models.enemy.geometry;
    s.body.material = this.modelMat.enemy;
    s.body.scale.setScalar(MODEL_SCALE);
    const rig = this.models.enemy.rig;
    if (rig && !s.rig) s.rig = this.attachRig(s.pivot, s.body, rig, "enemy-body", this.modelMat.enemy, MODEL_SCALE);
  }

  /**
   * Replaces the static `body` under `pivot` with a clone of `rig` (own skeleton and mixer). The
   * skinned meshes take the role material; the cloned geometry stays shared with the template.
   */
  private attachRig(pivot: THREE.Group, body: BodyMesh, rig: ActorRig, name: string, mat: THREE.MeshLambertMaterial, scale: number): RigSlot {
    const root = cloneSkinned(rig.scene);
    root.scale.setScalar(rig.unit);
    root.position.copy(rig.offset).multiplyScalar(rig.unit);
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = mat;
      m.castShadow = true;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        // Skinned vertices leave the bind-pose bounds.
        m.frustumCulled = false;
        m.name = meshes.length === 0 ? name : `${name}-part`;
        meshes.push(m as THREE.SkinnedMesh);
      }
    });
    const wrapper = new THREE.Group();
    wrapper.name = `${name}-rig`;
    wrapper.scale.setScalar(scale);
    wrapper.add(root);
    pivot.remove(body);
    pivot.add(wrapper);
    const mixer = new THREE.AnimationMixer(root);
    const walk = mixer.clipAction(rig.walk);
    const idle = rig.idle ? mixer.clipAction(rig.idle) : null;
    walk.play();
    idle?.play();
    const slot: RigSlot = { wrapper, root, meshes, mixer, walk, idle, still: false };
    this.rigs.push(slot);
    this.animate(slot, null);
    return slot;
  }

  /**
   * Poses a rig from the motion sample: walk time = cycle × duration (legs follow the distance
   * walked), idle advances by wall-clock time, weights from speed01. Reduced motion (or no sample)
   * holds idle at t = 0, applied once.
   */
  private animate(r: RigSlot, m: MotionSample | null): void {
    const { walk, idle } = r;
    if (!m || this.reducedMotion) {
      if (r.still) return;
      r.still = true;
      walk.time = 0;
      setWeight(walk, idle ? 0 : 1);
      if (idle) {
        idle.time = 0;
        setWeight(idle, 1);
      }
      r.mixer.update(0);
      return;
    }
    r.still = false;
    // Without an idle clip the walk clip holds its pose (weight < 1 would blend towards the bind pose).
    const w = idle ? clamp01(m.speed01 / WALK_BLEND) : 1;
    walk.time = m.cycle * walk.getClip().duration;
    setWeight(walk, w);
    if (idle) {
      const d = idle.getClip().duration;
      idle.time = d > 0 ? (idle.time + this.dtSec) % d : 0;
      setWeight(idle, 1 - w);
    }
    r.mixer.update(0);
  }

  /** Yaw, bob and lean of a standing model (on the rig wrapper if any); a no-op for the cylinders. */
  private pose(pivot: THREE.Group, body: BodyMesh, rig: RigSlot | null, m: MotionSample): void {
    if (!this.models) return;
    // Models face +Z; rotation.y = θ sends +Z to (sin θ, 0, cos θ) = (cos a, 0, sin a) for θ = π/2 - a.
    pivot.rotation.y = Math.PI / 2 - m.heading;
    const target = rig ? rig.wrapper : body;
    target.position.y = m.bob * MODEL_BOB;
    // +rotation.x tips the top towards +Z (forward).
    target.rotation.x = m.lean;
    if (rig) this.animate(rig, m);
  }

  private makeEnemy(): EnemySlot {
    const group = new THREE.Group();
    group.name = "enemy";
    const ey = DECAL_Y.enemy;
    const pivot = new THREE.Group();
    pivot.name = "enemy-pivot";
    const body = this.mesh("enemy-body", this.geo.cylinder, this.mat.enemyBody, 0, 0);
    body.scale.set(ENEMY_R, ENEMY_HEIGHT, ENEMY_R);
    body.castShadow = true;
    pivot.add(body);
    const glow = this.mesh("enemy-glow", this.geo.disc, this.mat.enemyGlow, ey, ORDER.actor);
    glow.scale.set(ENEMY_R * 1.8, 1, ENEMY_R * 1.8);
    const cone = this.mesh("enemy-cone", this.geo.viewCone, this.mat.viewCone, ey + 0.2, ORDER.actor);
    const tick = this.mesh("enemy-tick", this.geo.strip, this.mat.tick, ey + 0.4, ORDER.actor);
    tick.scale.set(ENEMY_R + 110, 1, 22);
    group.add(pivot, glow, cone, tick);
    this.group.add(group);
    const slot: EnemySlot = { group, pivot, body, rig: null, cone, tick };
    this.modelEnemy(slot);
    return slot;
  }

  private makeDown(): DownSlot {
    const group = new THREE.Group();
    group.name = "down";
    const ring = this.mesh("down-ring", this.geo.downRing, this.mat.downRing.enemy, DECAL_Y.down, ORDER.actor);
    const x = this.mesh("down-x", this.geo.cross, this.mat.downX.enemy, DECAL_Y.down + 0.05, ORDER.actor);
    // Lying body: only with the character models (the cylinders never had a downed body).
    const pivot = new THREE.Group();
    pivot.name = "down-pivot";
    const body = this.mesh("down-body", this.geo.cylinder, this.mat.enemyBody, 0, 0);
    body.castShadow = true;
    body.visible = false;
    if (this.models) body.scale.setScalar(MODEL_SCALE);
    pivot.add(body);
    group.add(pivot, ring, x);
    this.group.add(group);
    return { group, pivot, body, ring, x };
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
    const { group, pivot, body, rig, aimCone, aimLine, nose } = this.player;
    group.visible = p !== null;
    if (!p) return;
    group.position.set(p.x, 0, p.y);
    const dx = p.aim ? p.aim.x - p.x : 0;
    const dy = p.aim ? p.aim.y - p.y : 0;
    const hasDir = p.aim !== null && dx * dx + dy * dy > PLAYER_R * PLAYER_R;
    const face = facing(p, hasDir, dx, dy);
    this.pose(pivot, body, rig, this.motion.actor(PLAYER_KEY, p.x, p.y, face?.x, face?.y));
    aimCone.visible = aimLine.visible = hasDir;
    // The model shows its own facing: the nose is only needed on the cylinder.
    nose.visible = hasDir && !this.models;
    if (!hasDir) return;
    const r = -Math.atan2(dy, dx);
    aimCone.rotation.y = r;
    aimLine.rotation.y = r;
    nose.rotation.y = r;
  }

  private setEnemy(s: EnemySlot, e: ActorView, i: number): void {
    s.group.position.set(e.x, 0, e.y);
    const hasFacing = e.fx !== undefined && e.fy !== undefined && (e.fx !== 0 || e.fy !== 0);
    this.pose(s.pivot, s.body, s.rig, this.motion.actor(e.z ?? i, e.x, e.y, e.fx, e.fy));
    s.cone.visible = hasFacing;
    // The model shows its own facing: the tick is only needed on the cylinder.
    s.tick.visible = hasFacing && !this.models;
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
    const { models, modelMat } = this;
    s.body.visible = models !== null;
    if (!models || !modelMat) return;
    const player = v.side === "player";
    const model = player ? models.operator : models.enemy;
    s.body.geometry = model.geometry;
    s.body.material = player ? modelMat.playerDown : modelMat.enemyDown;
    const scale = player ? MODEL_SCALE * playerSize(model) : MODEL_SCALE;
    s.body.scale.setScalar(scale);
    const { fallT, yaw } = this.motion.fall(v.x, v.y, v.side);
    // Tips over backwards about local X (top towards -Z), sliding +Z so the lying body centres on
    // the down spot, and lifting so its back rests on the floor.
    s.pivot.rotation.y = yaw;
    s.body.rotation.x = (-Math.PI / 2) * fallT;
    s.body.position.set(0, model.back * scale * fallT, (model.height * scale * fallT) / 2);
  }

  private setTracer(s: TracerSlot, t: TracerView): void {
    const { to } = t.shot;
    const a = clamp01(t.fade);
    const color = t.shot.by === "P0" ? PLAYER_TRACER : ENEMY_TRACER;
    // From the gun tip of the character model (the body centre on the cylinders), level.
    const muzzle = this.muzzles ? this.muzzles[muzzleRole(t.shot.by)] : null;
    const from = muzzlePoint(t.shot.from, to, muzzle ?? CENTRE, this.tracerStart);
    const y = muzzle ? muzzle.height : TRACER_Y;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(Math.hypot(dx, dy), 1e-3);
    const r = -Math.atan2(dy, dx);
    s.halo.position.set(from.x, y, from.y);
    s.halo.rotation.y = r;
    s.halo.scale.set(len, 44, 44);
    s.halo.material.color.setHex(color);
    s.halo.material.opacity = 0.14 * a;
    s.core.position.set(from.x, y, from.y);
    s.core.rotation.y = r;
    s.core.scale.set(len, 12, 12);
    s.core.material.color.setHex(color);
    s.core.material.opacity = 0.9 * a;
    const hit = t.shot.hit !== null;
    s.hitOuter.visible = s.hitInner.visible = hit;
    if (!hit) return;
    s.hitOuter.position.set(to.x, y, to.y);
    s.hitOuter.material.opacity = 0.18 * a;
    s.hitInner.position.set(to.x, y + 1, to.y);
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
function fill<S extends { group: THREE.Group }, V>(pool: S[], items: readonly V[], make: () => S, set: (s: S, v: V, i: number) => void): void {
  while (pool.length < items.length) pool.push(make());
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    s.group.visible = i < items.length;
    if (i < items.length) set(s, items[i]!, i);
  }
}

/**
 * Sets an action's weight and disables it at weight 0, so `mixer.update` skips evaluating a clip
 * that contributes nothing (an idle body skips walk, a full walk skips idle). `enabled` is set
 * first: `setEffectiveWeight` stores 0 for a disabled action. No allocation.
 */
export function setWeight(a: THREE.AnimationAction, w: number): void {
  a.enabled = w > 0;
  a.setEffectiveWeight(w);
}

/** Model material tint: light-grey albedo × colour, plus a little emissive (none when downed). */
function tint(m: THREE.MeshLambertMaterial, color: number, downed: boolean): void {
  m.color.setHex(color);
  if (downed) m.color.multiplyScalar(DOWN_DARK);
  m.emissive.setHex(color).multiplyScalar(downed ? 0 : MODEL_EMISSIVE);
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
