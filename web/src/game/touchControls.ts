import type { Vec2 } from "../sim/geom";
import type { TouchOverrides } from "./input";
import { stickAim, stickVector, touchFire } from "./touch";

type Stick = {
  readonly el: HTMLElement;
  readonly knob: HTMLElement;
  pointerId: number | null;
  cx: number;
  cy: number;
  radius: number;
  vec: Vec2;
};

const ZERO: Vec2 = { x: 0, y: 0 };

/**
 * On-screen twin-stick controls (left = move, right = aim/fire) plus a hold-to-use DEFUSE button.
 * Each control captures its own pointer, so two fingers can move and aim at the same time.
 */
export class TouchControls {
  private readonly move: Stick;
  private readonly aim: Stick;
  private readonly defuse: HTMLElement;
  private defusePointer: number | null = null;
  private lastAimDir: Vec2 | null = null;

  constructor(private readonly root: HTMLElement) {
    this.move = this.bindStick("move");
    this.aim = this.bindStick("aim");
    const defuse = root.querySelector<HTMLElement>("#touchDefuse");
    if (!defuse) throw new Error("touchControls: #touchDefuse missing");
    this.defuse = defuse;
    defuse.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.defusePointer !== null) return;
      this.defusePointer = e.pointerId;
      capture(defuse, e.pointerId);
      defuse.dataset.held = "true";
    });
    const releaseDefuse = (e: PointerEvent): void => {
      if (e.pointerId === this.defusePointer) this.releaseDefuse();
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) defuse.addEventListener(type, releaseDefuse);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setVisible(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (!on) this.release();
  }

  setDefuseVisible(on: boolean): void {
    if (this.defuse.hidden === !on) return;
    this.defuse.hidden = !on;
    if (!on) this.releaseDefuse();
  }

  /** Let go of every finger (blur, hidden overlay); the last aim direction is kept. */
  release(): void {
    this.releaseStick(this.move);
    this.releaseStick(this.aim);
    this.releaseDefuse();
  }

  /** Full reset for a new round: release fingers and forget the aim direction. */
  reset(): void {
    this.release();
    this.lastAimDir = null;
  }

  /** Touch state for `mapInput`, or undefined when the overlay is hidden or idle (desktop path unchanged). */
  overrides(player: Vec2): TouchOverrides | undefined {
    if (!this.visible) return undefined;
    const moving = this.move.vec.x !== 0 || this.move.vec.y !== 0;
    const use = this.defusePointer !== null && !this.defuse.hidden;
    if (!moving && !this.lastAimDir && !use) return undefined;
    return {
      move: moving ? this.move.vec : undefined,
      aim: this.lastAimDir ? stickAim(player, this.lastAimDir) : undefined,
      fire: touchFire(this.aim.vec, use),
      use,
    };
  }

  private bindStick(name: "move" | "aim"): Stick {
    const el = this.root.querySelector<HTMLElement>(`.stick[data-stick="${name}"]`);
    const knob = el?.querySelector<HTMLElement>(".knob");
    if (!el || !knob) throw new Error(`touchControls: ${name} stick missing`);
    const stick: Stick = { el, knob, pointerId: null, cx: 0, cy: 0, radius: 1, vec: ZERO };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (stick.pointerId !== null) return;
      const r = el.getBoundingClientRect();
      stick.pointerId = e.pointerId;
      stick.cx = r.left + r.width / 2;
      stick.cy = r.top + r.height / 2;
      stick.radius = Math.max(1, (r.width - knob.offsetWidth) / 2);
      capture(el, e.pointerId);
      el.dataset.active = "true";
      this.updateStick(stick, e);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId === stick.pointerId) this.updateStick(stick, e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === stick.pointerId) this.releaseStick(stick);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) el.addEventListener(type, end);
    return stick;
  }

  private updateStick(stick: Stick, e: PointerEvent): void {
    const dx = e.clientX - stick.cx;
    const dy = e.clientY - stick.cy;
    stick.vec = stickVector(dx, dy, stick.radius);
    const l = Math.hypot(dx, dy);
    const k = l > stick.radius ? stick.radius / l : 1;
    stick.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    if (stick === this.aim && (stick.vec.x !== 0 || stick.vec.y !== 0)) this.lastAimDir = stick.vec;
  }

  private releaseStick(stick: Stick): void {
    if (stick.pointerId !== null && stick.el.hasPointerCapture?.(stick.pointerId)) stick.el.releasePointerCapture(stick.pointerId);
    stick.pointerId = null;
    stick.vec = ZERO;
    stick.knob.style.transform = "";
    delete stick.el.dataset.active;
  }

  private releaseDefuse(): void {
    const id = this.defusePointer;
    this.defusePointer = null;
    if (id !== null && this.defuse.hasPointerCapture?.(id)) this.defuse.releasePointerCapture(id);
    delete this.defuse.dataset.held;
  }
}

function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-ended pointers cannot be captured; the element still gets its own events.
  }
}
