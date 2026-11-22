import * as THREE from "three";
import { renderResolution } from "../../game/input";
import type { MapDef } from "../../maps/types";
import type { Vec2 } from "../../sim/geom";
import { THEME_NUM } from "../../ui/theme";
import type { FrameView, GameRenderer, PanelSpec } from "../renderer";
import { ActorLayer } from "./actorScene";
import { type CameraFit, fitCamera, groundPoint, ndcFromClient } from "./camMath";
import { makeCanvasLabel } from "./labels";
import { buildMapScene, disposeMapScene } from "./mapScene";

/**
 * Optional three.js renderer (phase 4 map, phase 5 actors). Loaded lazily via `import()` when
 * `pickRenderer` returns "3d". Renders panels[0] into the whole canvas with frames[0] drawn by one
 * pooled `ActorLayer` that survives `loadMap`; multi-panel replay comes in phase 6.
 */
export class Three3dRenderer implements GameRenderer {
  readonly kind = "3d" as const;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly actors = new ActorLayer();
  private map: MapDef | null = null;
  private group: THREE.Group | null = null;
  private fit: CameraFit | null = null;
  private panels: readonly PanelSpec[] = [];
  private cssW: number;
  private cssH: number;

  constructor(opts: { width: number; height: number }) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(renderResolution(globalThis.devicePixelRatio));
    this.renderer.setClearColor(THEME_NUM.bg);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.cssW = opts.width;
    this.cssH = opts.height;
    this.renderer.setSize(opts.width, opts.height);
    this.scene.add(this.actors.group);
  }

  /** Panels last passed to `setPanels` (only panels[0] is drawn this phase). */
  get panelSpecs(): readonly PanelSpec[] {
    return this.panels;
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.renderer.setSize(cssW, cssH);
    this.updateCamera();
  }

  loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void {
    this.dropMap();
    this.map = map;
    this.group = buildMapScene(map, { makeLabel: makeCanvasLabel, cssPxPerUnit: opts.cssPxPerUnit });
    this.scene.add(this.group);
    this.updateCamera();
  }

  setPanels(panels: readonly PanelSpec[]): void {
    this.panels = panels;
  }

  draw(frames: readonly FrameView[]): void {
    this.actors.update(frames[0] ?? null, performance.now());
    this.renderer.render(this.scene, this.camera);
  }

  screenToWorld(clientX: number, clientY: number): Vec2 | null {
    const { fit, map } = this;
    if (!fit || !map) return null;
    const ndc = ndcFromClient(clientX, clientY, this.canvas.getBoundingClientRect());
    const p = groundPoint(fit, ndc.x, ndc.y);
    if (!p || p.x < 0 || p.y < 0 || p.x > map.width || p.y > map.height) return null;
    return p;
  }

  destroy(): void {
    this.dropMap();
    this.scene.remove(this.actors.group);
    this.actors.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private dropMap(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    disposeMapScene(this.group);
    this.group = null;
  }

  private updateCamera(): void {
    const { map } = this;
    if (!map || !(this.cssW > 0) || !(this.cssH > 0)) return;
    const fit = fitCamera({ minX: 0, minY: 0, maxX: map.width, maxY: map.height }, this.cssW / this.cssH);
    this.fit = fit;
    const cam = this.camera;
    cam.position.set(...fit.position);
    cam.lookAt(...fit.target);
    cam.fov = fit.fovDeg;
    cam.aspect = fit.aspect;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
  }
}

export async function createThree3dRenderer(opts: { width: number; height: number }): Promise<Three3dRenderer> {
  return new Three3dRenderer(opts);
}
