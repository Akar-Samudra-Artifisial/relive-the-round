import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameView } from "../src/render/renderer";
import { type ActorModels, type ActorRig, bakeRig, disposeActorRig, extractRig, RIG_HEIGHT_CM } from "../src/render/three3d/actorModels";
import { ActorLayer, MODEL_SCALE, PLAYER_RIG_SIZE, setWeight } from "../src/render/three3d/actorScene";

/** Walk moves the `leg` bone along x (0 → 100 over the 1 s clip); idle holds it at y = 50. */
function fakeRigScene(): THREE.Object3D {
  const hips = new THREE.Bone();
  hips.name = "hips";
  const leg = new THREE.Bone();
  leg.name = "leg";
  leg.position.set(0, -0.5, 0);
  hips.add(leg);
  // A 1.8 m tall box in metres (glTF units), feet at y = 0.
  const geo = new THREE.BoxGeometry(0.5, 1.8, 0.3).translate(0, 0.9, 0);
  const n = geo.getAttribute("position").count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array<number>(n * 4).fill(0), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
  mesh.name = "Body";
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton([hips, leg]));
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}

function clips(walk = true, idle = true): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  if (walk) out.push(new THREE.AnimationClip("walk", 1, [new THREE.VectorKeyframeTrack("leg.position", [0, 1], [0, 0, 0, 100, 0, 0])]));
  if (idle) out.push(new THREE.AnimationClip("idle", 2, [new THREE.VectorKeyframeTrack("leg.position", [0, 2], [0, 50, 0, 0, 50, 0])]));
  return out;
}

function fakeRig(idle = true): ActorRig {
  const rig = extractRig(fakeRigScene(), clips(true, idle));
  if (!rig) throw new Error("fake rig rejected");
  return rig;
}

function fakeModels(idle = true): ActorModels {
  const geo = (): THREE.BufferGeometry => new THREE.BoxGeometry(50, 180, 100).translate(0, 90, 0);
  return {
    operator: { geometry: geo(), map: new THREE.Texture(), height: 180, back: 50, rig: fakeRig(idle) },
    enemy: { geometry: geo(), map: new THREE.Texture(), height: 180, back: 70, rig: fakeRig(idle) },
  };
}

function named(layer: ActorLayer, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  layer.group.traverse((o) => {
    let shown = true;
    for (let p: THREE.Object3D | null = o; p && p !== layer.group; p = p.parent) shown &&= p.visible;
    if (o.name === name && shown) out.push(o);
  });
  return out;
}

function playerBody(layer: ActorLayer): THREE.SkinnedMesh {
  const all = named(layer, "player-body");
  expect(all).toHaveLength(1);
  return all[0] as THREE.SkinnedMesh;
}

const leg = (m: THREE.SkinnedMesh): THREE.Bone => m.skeleton.bones.find((b) => b.name === "leg")!;

const frame = (px: number): FrameView => ({
  player: { x: px, y: 2000, aim: null },
  enemies: [
    { x: 3000, y: 1000, fx: 0, fy: 1, z: 0 },
    { x: 3500, y: 1200, fx: 1, fy: 0, z: 1 },
  ],
  downs: [{ x: 4000, y: 500, side: "enemy", z: 2 }],
  spike: null,
  tracers: [],
});

/** Runs the player along +x at 7.6 cm per 16 ms frame (475 cm/s) for `frames` frames. */
function runPlayer(layer: ActorLayer, frames: number): void {
  for (let i = 0; i <= frames; i++) layer.update(frame(1000 + 7.6 * i), i * 16);
}

afterEach(() => vi.restoreAllMocks());

describe("extractRig", () => {
  it("scales the rig to RIG_HEIGHT_CM with its feet on y = 0", () => {
    const rig = fakeRig();
    expect(rig.unit * 1.8).toBeCloseTo(RIG_HEIGHT_CM, 3);
    expect(rig.offset.y).toBeCloseTo(0, 6);
    expect(rig.walk.name).toBe("walk");
    expect(rig.idle?.name).toBe("idle");
    expect(rig.map).toBeInstanceOf(THREE.Texture);
  });

  it("bakes the rig in its idle pose into a static model with the rig texture", () => {
    const rig = fakeRig();
    const model = bakeRig(rig);
    expect(model.rig).toBe(rig);
    expect(model.map).toBe(rig.map);
    expect(model.geometry.getAttribute("skinIndex")).toBeUndefined();
    expect(model.geometry.getAttribute("uv")).toBeDefined();
    expect(model.geometry.getAttribute("normal")).toBeDefined();
    expect(model.height).toBeCloseTo(RIG_HEIGHT_CM, 3);
    // The 0.3 m deep box centred on z = 0: 15 cm behind the origin.
    expect(model.back).toBeCloseTo(15, 3);
    expect(model.geometry.boundingBox!.min.y).toBeCloseTo(0, 3);
    // The template keeps its own skeleton state.
    expect((rig.scene.children[0] as THREE.SkinnedMesh).skeleton.bones[1]!.position.y).toBeCloseTo(-0.5, 6);
    model.geometry.dispose();
  });

  it("draws downs of a rigged role with the baked rig, standing bodies with the skinned clone", () => {
    const op = bakeRig(fakeRig());
    const en = bakeRig(fakeRig());
    const layer = new ActorLayer();
    layer.setModels({ operator: op, enemy: en });
    layer.update({ ...frame(1000), downs: [{ x: 4000, y: 500, side: "enemy", z: 2 }, { x: 4500, y: 500, side: "player" }] }, 0);
    const downs = named(layer, "down-body") as THREE.Mesh[];
    expect(downs.map((d) => d.geometry)).toEqual([en.geometry, op.geometry]);
    expect((downs[0]!.material as THREE.MeshLambertMaterial).map).toBe(en.rig!.map);
    expect(named(layer, "enemy-body")[0]).toBeInstanceOf(THREE.SkinnedMesh);
    layer.dispose();
  });

  it("rejects (and disposes) a model without a walk clip or without a SkinnedMesh", () => {
    const scene = fakeRigScene();
    const geo = (scene.children[0] as THREE.SkinnedMesh).geometry;
    const spy = vi.spyOn(geo, "dispose");
    expect(extractRig(scene, clips(false, true))).toBeNull();
    expect(spy).toHaveBeenCalled();
    const plain = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect(extractRig(plain, clips())).toBeNull();
  });
});

describe("ActorLayer rigged bodies", () => {
  it("clones the rig per standing slot, keeps the mesh names and the role material", () => {
    const models = fakeModels();
    const layer = new ActorLayer();
    layer.setModels(models);
    layer.update(frame(1000), 0);
    const body = playerBody(layer);
    expect(body.isSkinnedMesh).toBe(true);
    expect(body.frustumCulled).toBe(false);
    expect(body.castShadow).toBe(true);
    const mat = body.material as THREE.MeshLambertMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(mat.map).toBe(models.operator.rig!.map);
    // Shared template geometry, scaled to the static model size.
    expect(body.geometry).toBe((models.operator.rig!.scene.children[0] as THREE.SkinnedMesh).geometry);
    const wrapper = named(layer, "player-body-rig")[0]!;
    expect(wrapper.scale.x).toBeCloseTo(MODEL_SCALE * PLAYER_RIG_SIZE, 6);
    const enemies = named(layer, "enemy-body") as THREE.SkinnedMesh[];
    expect(enemies).toHaveLength(2);
    const skeletons = new Set([body, ...enemies].map((m) => m.skeleton));
    expect(skeletons.size).toBe(3);
    expect(leg(enemies[0]!)).not.toBe(leg(enemies[1]!));
    // Downs keep the static geometry.
    const downs = named(layer, "down-body") as THREE.Mesh[];
    expect(downs).toHaveLength(1);
    expect(downs[0]!.geometry).toBe(models.enemy.geometry);
    layer.dispose();
  });

  it("drives the walk clip by the distance walked and idles at rest", () => {
    const layer = new ActorLayer();
    layer.setModels(fakeModels());
    layer.update(frame(1000), 0);
    // Standing: idle pose.
    expect(leg(playerBody(layer)).position.y).toBeCloseTo(50, 3);
    runPlayer(layer, 10);
    // 76 cm walked = 0.2 cycle → walk time 0.2 s → leg x = 20, at full walk weight.
    const p = leg(playerBody(layer)).position;
    expect(p.x).toBeCloseTo(20, 3);
    expect(p.y).toBeCloseTo(0, 3);
    layer.dispose();
  });

  it("disables an action at weight 0 and re-enables it with weight", () => {
    const rig = fakeRig();
    const a = new THREE.AnimationMixer(rig.scene).clipAction(rig.walk);
    setWeight(a, 0);
    expect(a.enabled).toBe(false);
    expect(a.getEffectiveWeight()).toBe(0);
    setWeight(a, 0.5);
    expect(a.enabled).toBe(true);
    expect(a.getEffectiveWeight()).toBe(0.5);
  });

  it("skips the walk clip at rest and the idle clip at a full walk", () => {
    const layer = new ActorLayer();
    layer.setModels(fakeModels());
    layer.update(frame(1000), 0);
    const slot = (layer as unknown as { player: { rig: { walk: THREE.AnimationAction; idle: THREE.AnimationAction } } }).player.rig;
    expect(slot.walk.enabled).toBe(false);
    expect(slot.idle.enabled).toBe(true);
    runPlayer(layer, 10);
    expect(slot.walk.enabled).toBe(true);
    expect(slot.idle.enabled).toBe(false);
    layer.dispose();
  });

  it("holds idle at t = 0 with reduced motion", () => {
    const layer = new ActorLayer();
    layer.reducedMotion = true;
    layer.setModels(fakeModels());
    runPlayer(layer, 10);
    const p = leg(playerBody(layer)).position;
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(50, 6);
    layer.dispose();
  });

  it("keeps the walk clip at full weight without an idle clip", () => {
    const layer = new ActorLayer();
    layer.setModels(fakeModels(false));
    runPlayer(layer, 10);
    expect(leg(playerBody(layer)).position.x).toBeCloseTo(20, 3);
    layer.dispose();
  });

  it("allocates no objects per frame", () => {
    const layer = new ActorLayer();
    layer.setModels(fakeModels());
    runPlayer(layer, 3);
    const count = (): number => {
      let n = 0;
      layer.group.traverse(() => n++);
      return n;
    };
    const before = count();
    const body = playerBody(layer);
    const clone = vi.spyOn(THREE.Object3D.prototype, "clone");
    const action = vi.spyOn(THREE.AnimationMixer.prototype, "clipAction");
    for (let i = 4; i < 20; i++) layer.update(frame(1000 + 7.6 * i), i * 16);
    expect(count()).toBe(before);
    expect(playerBody(layer)).toBe(body);
    expect(clone).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    layer.dispose();
  });

  it("uses the static body when the model has no rig", () => {
    const models = fakeModels();
    const layer = new ActorLayer();
    layer.setModels({ operator: { ...models.operator, rig: undefined }, enemy: models.enemy });
    layer.update(frame(1000), 0);
    const body = playerBody(layer) as unknown as THREE.Mesh;
    expect((body as Partial<THREE.SkinnedMesh>).isSkinnedMesh).toBeUndefined();
    expect(body.geometry).toBe(models.operator.geometry);
    expect(named(layer, "enemy-body")[0]).toBeInstanceOf(THREE.SkinnedMesh);
    layer.dispose();
  });

  it("stops and uncaches every mixer on dispose without touching the shared rig", () => {
    const models = fakeModels();
    const layer = new ActorLayer();
    layer.setModels(models);
    layer.update(frame(1000), 0);
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction");
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, "uncacheRoot");
    const shared = (models.operator.rig!.scene.children[0] as THREE.SkinnedMesh).geometry;
    const geoDispose = vi.spyOn(shared, "dispose");
    layer.dispose();
    // 1 player + 5 pooled enemy slots.
    expect(stop).toHaveBeenCalledTimes(6);
    expect(uncache).toHaveBeenCalledTimes(6);
    expect(geoDispose).not.toHaveBeenCalled();
    disposeActorRig(models.operator.rig!);
    expect(geoDispose).toHaveBeenCalled();
  });
});
