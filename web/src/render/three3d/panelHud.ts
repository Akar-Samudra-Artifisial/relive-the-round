import * as THREE from "three";
import { DISPLAY_FONT, MONO_FONT } from "../../ui/fonts";
import { THEME_NUM } from "../../ui/theme";
import { HEADER_H } from "../panelLayout";
import type { PanelSpec } from "../renderer";

type DisposableResource = { dispose: () => void };

export type PanelTextFactory = (spec: PanelSpec, pixelRatio: number) => THREE.Texture | null;

const HEADER_BEVEL = 10;

function colorCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  const chars = [...text];
  return chars.reduce((width, char) => width + ctx.measureText(char).width, 0) + spacing * Math.max(0, chars.length - 1);
}

function fillSpacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  for (const char of [...text]) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
}

const makeTextTexture: PanelTextFactory = (spec, pixelRatio) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(spec.size * pixelRatio);
  canvas.height = Math.ceil(HEADER_H * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.textBaseline = "top";

  const title = spec.title ?? "";
  ctx.font = `700 18px ${DISPLAY_FONT}`;
  ctx.fillStyle = colorCss(spec.accent ?? THEME_NUM.cyan);
  fillSpacedText(ctx, title, 16, 5, 3);

  if (spec.note !== undefined) {
    const note = spec.note.toUpperCase();
    const noteX = 16 + spacedWidth(ctx, title, 3) + 12;
    ctx.font = `11px ${MONO_FONT}`;
    const noteWidth = spacedWidth(ctx, note, 1);
    if (noteX + noteWidth <= spec.size - 8) {
      ctx.fillStyle = colorCss(THEME_NUM.textDim);
      fillSpacedText(ctx, note, noteX, 10, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

function pointsGeometry(points: THREE.Vector3[]): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setFromPoints(points);
}

function basicMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
}

export class PanelHud {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly owned = new Set<DisposableResource>();
  private empty = true;

  constructor(private readonly textFactory: PanelTextFactory = makeTextTexture) {
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 500);
    this.camera.position.z = 100;
    this.camera.lookAt(0, 0, 0);
  }

  get isEmpty(): boolean {
    return this.empty;
  }

  rebuild(specs: readonly PanelSpec[], cssW: number, cssH: number, pixelRatio: number): void {
    this.clear();
    this.camera.left = 0;
    this.camera.right = Math.max(1, cssW);
    this.camera.top = 0;
    this.camera.bottom = -Math.max(1, cssH);
    this.camera.updateProjectionMatrix();

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      if (spec.title === undefined) continue;
      this.empty = false;
      const group = new THREE.Group();
      group.name = `panel-hud-${i}`;
      group.position.set(spec.x, -spec.y, 0);
      this.scene.add(group);

      const plateH = HEADER_H - 4;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(spec.size - HEADER_BEVEL, 0);
      shape.lineTo(spec.size, -HEADER_BEVEL);
      shape.lineTo(spec.size, -plateH);
      shape.lineTo(0, -plateH);
      shape.closePath();
      const plate = new THREE.Mesh(
        this.own(new THREE.ShapeGeometry(shape)),
        this.own(basicMaterial(THEME_NUM.surface)),
      );
      plate.name = "panel-hud-plate";
      plate.renderOrder = 10;
      group.add(plate);

      const borderGeometry = this.own(pointsGeometry([
        new THREE.Vector3(0, 0, 0.1),
        new THREE.Vector3(spec.size - HEADER_BEVEL, 0, 0.1),
        new THREE.Vector3(spec.size, -HEADER_BEVEL, 0.1),
        new THREE.Vector3(spec.size, -plateH, 0.1),
        new THREE.Vector3(0, -plateH, 0.1),
      ]));
      const border = new THREE.LineLoop(
        borderGeometry,
        this.own(new THREE.LineBasicMaterial({ color: THEME_NUM.line, depthTest: false, depthWrite: false, toneMapped: false })),
      );
      border.name = "panel-hud-border";
      border.renderOrder = 11;
      group.add(border);

      const accent = new THREE.Mesh(
        this.own(new THREE.PlaneGeometry(4, plateH)),
        this.own(basicMaterial(spec.accent ?? THEME_NUM.cyan)),
      );
      accent.name = "panel-hud-accent";
      accent.position.set(2, -plateH / 2, 0.2);
      accent.renderOrder = 12;
      group.add(accent);

      const frameTop = -(HEADER_H + 0.5);
      const frameBottom = -(HEADER_H + spec.size - 0.5);
      const frameLeft = 0.5;
      const frameRight = spec.size - 0.5;
      const frame = new THREE.LineLoop(
        this.own(pointsGeometry([
          new THREE.Vector3(frameLeft, frameTop, 0.2),
          new THREE.Vector3(frameRight, frameTop, 0.2),
          new THREE.Vector3(frameRight, frameBottom, 0.2),
          new THREE.Vector3(frameLeft, frameBottom, 0.2),
        ])),
        this.own(new THREE.LineBasicMaterial({ color: THEME_NUM.lineHi, depthTest: false, depthWrite: false, toneMapped: false })),
      );
      frame.name = "panel-hud-frame";
      frame.renderOrder = 13;
      group.add(frame);

      const tick = new THREE.LineSegments(
        this.own(pointsGeometry([
          new THREE.Vector3(0.5, -(HEADER_H + 18), 0.3),
          new THREE.Vector3(0.5, -(HEADER_H + 0.5), 0.3),
          new THREE.Vector3(0.5, -(HEADER_H + 0.5), 0.3),
          new THREE.Vector3(18, -(HEADER_H + 0.5), 0.3),
        ])),
        this.own(new THREE.LineBasicMaterial({ color: spec.accent ?? THEME_NUM.cyan, depthTest: false, depthWrite: false, toneMapped: false })),
      );
      tick.name = "panel-hud-tick";
      tick.renderOrder = 14;
      group.add(tick);

      const texture = this.textFactory(spec, pixelRatio);
      if (texture) {
        const text = new THREE.Mesh(
          this.own(new THREE.PlaneGeometry(spec.size, HEADER_H)),
          this.own(new THREE.MeshBasicMaterial({ map: this.own(texture), transparent: true, depthTest: false, depthWrite: false, toneMapped: false })),
        );
        text.name = "panel-hud-text";
        text.position.set(spec.size / 2, -HEADER_H / 2, 0.4);
        text.renderOrder = 15;
        group.add(text);
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  private own<T extends DisposableResource>(resource: T): T {
    this.owned.add(resource);
    return resource;
  }

  private clear(): void {
    this.scene.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.clear();
    this.empty = true;
  }
}