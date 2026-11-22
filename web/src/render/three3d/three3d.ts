import * as THREE from "three";
import type { MapDef } from "../../maps/types";
import type { Vec2 } from "../../sim/geom";
import { THEME_NUM } from "../../ui/theme";
import { fieldRect, glViewport, panelAt, type Rect } from "../panelLayout";
import { pixelRatioFor, QUALITY, type QualityTier } from "../quality";
import type { FrameView, GameRenderer, PanelSpec } from "../renderer";
import { CONTEXT_LOST } from "../switchable";
import { ActorLayer } from "./actorScene";
import { type CameraFit, fitCamera, groundPoint, ndcFromClient } from "./camMath";
import { makeCanvasLabel } from "./labels";
import { createLights, placeLights } from "./lights";
import { buildMapScene, disposeMapScene } from "./mapScene";
import { PanelHud } from "./panelHud";

/** Shadow-receiving plane: above the floor (Y 0), below the grid (Y 1). */
const SHADOW_Y = 0.5;
const SHADOW_OPACITY = 0.35;

export type Three3dOptions = { width: number; height: number; tier?: QualityTier };

/**
 * Optional three.js renderer, loaded lazily via `import()` when `pickRenderer` returns "3d".
 * Quality tiers: the pixel ratio and shadows can change at runtime (`setQuality`); antialias is
 * fixed when the WebGL context is created and does not change afterwards.
 */
export class Three3dRenderer implements GameRenderer {
  readonly kind = "3d" as const;
  readonly canvas: HTMLCanvasElement;
  onFail?: (reason: string) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly shadowPlane: THREE.Mesh<THREE.BufferGeometry, THREE.ShadowMaterial>;
  private tier: QualityTier;
  private failed = false;
  private readonly onContextLost = (): void => this.fail(CONTEXT_LOST);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly layers: ActorLayer[] = [new ActorLayer()];
  private readonly lights = createLights();
  private readonly hud = new PanelHud();
  private map: MapDef | null = null;
  private group: THREE.Group | null = null;
  private fits: CameraFit[] = [];
  private viewports: Rect[] = [];
  private panels: readonly PanelSpec[] = [];
  private cssW: number;
  private cssH: number;

  constructor(opts: Three3dOptions) {
    this.tier = opts.tier ?? "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: QUALITY[this.tier].antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatioFor(this.tier, globalThis.devicePixelRatio));
    this.renderer.setClearColor(THEME_NUM.bg);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // three r187 still exports PCFSoftShadowMap, but WebGLShadowMap warns and falls back to PCF;
    // plain PCF with `shadow.radius` gives the soft edge without the warning.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    // No preventDefault: a lost context is never restored, the owner swaps to 2D instead.
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.cssW = opts.width;
    this.cssH = opts.height;
    this.renderer.setSize(opts.width, opts.height);

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);
    planeGeo.translate(0.5, 0, 0.5);
    this.shadowPlane = new THREE.Mesh(planeGeo, new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, depthWrite: false }));
    this.shadowPlane.name = "shadow-plane";
    this.shadowPlane.position.y = SHADOW_Y;
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.visible = false;

    this.scene.add(this.lights.hemi, this.lights.sun, this.lights.sun.target, this.shadowPlane);
    this.scene.add(this.layers[0]!.group);
    this.applyShadows(QUALITY[this.tier].shadows, false);
  }

  get quality(): QualityTier {
    return this.tier;
  }

  /** Pixel ratio, size, HUD textures and shadows for `tier`. Not for per-frame use. */
  setQuality(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.renderer.setPixelRatio(pixelRatioFor(tier, globalThis.devicePixelRatio));
    this.renderer.setSize(this.cssW, this.cssH);
    this.applyShadows(QUALITY[tier].shadows, true);
    this.rebuildHud();
  }

  /** Panels last passed to `setPanels`. */
  get panelSpecs(): readonly PanelSpec[] {
    return this.panels;
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.renderer.setSize(cssW, cssH);
    this.updateFits();
    this.rebuildHud();
  }

  loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void {
    this.dropMap();
    this.map = map;
    this.group = buildMapScene(map, { makeLabel: makeCanvasLabel, cssPxPerUnit: opts.cssPxPerUnit });
    placeLights(this.lights, map.width, map.height);
    this.shadowPlane.scale.set(map.width, 1, map.height);
    this.scene.add(this.group);
    this.updateFits();
  }

  setPanels(panels: readonly PanelSpec[]): void {
    this.panels = [...panels];
    const count = Math.max(1, this.panels.length);
    while (this.layers.length < count) {
      const layer = new ActorLayer();
      this.layers.push(layer);
      this.scene.add(layer.group);
    }
    while (this.layers.length > count) {
      const layer = this.layers.pop()!;
      this.scene.remove(layer.group);
      layer.dispose();
    }
    this.updateFits();
    this.rebuildHud();
  }

  draw(frames: readonly FrameView[]): void {
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.cssW, this.cssH);
    this.renderer.clear();
    for (const layer of this.layers) layer.group.visible = false;
    const now = performance.now();
    try {
      for (let i = 0; i < this.viewports.length; i++) {
        const layer = this.layers[i];
        const fit = this.fits[i];
        if (!layer || !fit) continue;
        const viewport = this.viewports[i]!;
        layer.group.visible = true;
        layer.update(frames[i] ?? null, now);
        this.applyFit(this.camera, fit);
        this.renderer.setViewport(viewport.x, viewport.y, viewport.w, viewport.h);
        this.renderer.setScissor(viewport.x, viewport.y, viewport.w, viewport.h);
        this.renderer.setScissorTest(true);
        this.renderer.render(this.scene, this.camera);
        layer.group.visible = false;
      }
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.cssW, this.cssH);
      if (!this.hud.isEmpty) this.renderer.render(this.hud.scene, this.hud.camera);
    } finally {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.cssW, this.cssH);
      for (const layer of this.layers) layer.group.visible = true;
    }
  }

  screenToWorld(clientX: number, clientY: number): Vec2 | null {
    const { map } = this;
    if (!map || !(this.cssW > 0) || !(this.cssH > 0)) return null;
    const canvasRect = this.canvas.getBoundingClientRect();
    if (!(canvasRect.width > 0) || !(canvasRect.height > 0)) return null;
    const scaleX = this.cssW / canvasRect.width;
    const scaleY = this.cssH / canvasRect.height;
    const px = (clientX - canvasRect.left) * scaleX;
    const py = (clientY - canvasRect.top) * scaleY;
    const i = panelAt(this.panels, px, py);
    if (i < 0) return null;
    const fit = this.fits[i];
    if (!fit) return null;
    const field = fieldRect(this.panels[i]!);
    const ndc = ndcFromClient(clientX, clientY, {
      left: canvasRect.left + field.x / scaleX,
      top: canvasRect.top + field.y / scaleY,
      width: field.w / scaleX,
      height: field.h / scaleY,
    });
    const p = groundPoint(fit, ndc.x, ndc.y);
    if (!p || p.x < 0 || p.y < 0 || p.x > map.width || p.y > map.height) return null;
    return p;
  }

  destroy(): void {
    // Our own forceContextLoss below must not report a failure.
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.failed = true;
    this.dropMap();
    this.hud.dispose();
    this.scene.remove(this.lights.hemi, this.lights.sun, this.lights.sun.target, this.shadowPlane);
    this.shadowPlane.geometry.dispose();
    this.shadowPlane.material.dispose();
    this.lights.sun.shadow.dispose();
    for (const layer of this.layers) {
      this.scene.remove(layer.group);
      layer.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.onFail?.(reason);
  }

  /**
   * Shadows on the high tier only: the sun and walls/bodies cast, a ShadowMaterial plane above the
   * unlit floor receives (the floor colour itself never changes). Lit and shadow materials are
   * flagged for a recompile once when toggled at runtime.
   */
  private applyShadows(on: boolean, recompile: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.lights.sun.castShadow = on;
    this.shadowPlane.visible = on;
    if (!on && this.lights.sun.shadow.map) {
      // Free the 2048² depth target; three recreates it if shadows come back on.
      this.lights.sun.shadow.map.dispose();
      this.lights.sun.shadow.map = null;
    }
    if (!recompile) return;
    this.scene.traverse((o) => {
      const m = (o as Partial<THREE.Mesh>).material;
      if (m instanceof THREE.MeshLambertMaterial || m instanceof THREE.ShadowMaterial) m.needsUpdate = true;
    });
  }

  private dropMap(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    disposeMapScene(this.group);
    this.group = null;
  }

  private updateFits(): void {
    this.fits = [];
    this.viewports = [];
    if (this.panels.length > 0) {
      for (const spec of this.panels) this.viewports.push(glViewport(fieldRect(spec), this.cssH));
    } else {
      this.viewports.push({ x: 0, y: 0, w: this.cssW, h: this.cssH });
    }
    const { map } = this;
    if (!map || !(this.cssW > 0) || !(this.cssH > 0)) return;
    const bounds = { minX: 0, minY: 0, maxX: map.width, maxY: map.height };
    if (this.panels.length > 0) {
      for (const _spec of this.panels) this.fits.push(fitCamera(bounds, 1));
    } else {
      this.fits.push(fitCamera(bounds, this.cssW / this.cssH));
    }
  }

  private applyFit(cam: THREE.PerspectiveCamera, fit: CameraFit): void {
    cam.position.set(...fit.position);
    cam.lookAt(...fit.target);
    cam.fov = fit.fovDeg;
    cam.aspect = fit.aspect;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
  }

  private rebuildHud(): void {
    this.hud.rebuild(this.panels, this.cssW, this.cssH, this.renderer.getPixelRatio());
  }
}

export async function createThree3dRenderer(opts: Three3dOptions): Promise<Three3dRenderer> {
  return new Three3dRenderer(opts);
}
