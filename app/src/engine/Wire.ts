import { Graphics, Ticker } from 'pixi.js';
import Vector from 'verlyjs/src/Vector.js';
import Point from 'verlyjs/src/Point.js';
import Stick from 'verlyjs/src/Stick.js';

// Verly.js source modules reference `Vector` as a global (its bundle entry
// assigns the classes to `window`). Provide it before any Point/Stick math.
(globalThis as { Vector?: typeof Vector }).Vector = Vector;

/** Theme: Amber / Filament Glow for live wires. */
const COLOR_WIRE = 0xff9f1c;
const COLOR_WIRE_IDLE = 0x8a6a35;

/** World bounds handed to Verly's integrator (large: wires are unconstrained). */
const WORLD = { WIDTH: 1_000_000, HEIGHT: 1_000_000 };

/** Verlet points per wire — 20 keeps the curve smooth without costing much. */
const WIRE_POINTS = 20;
const SEGMENTS = WIRE_POINTS - 1;
/** Extra length beyond the endpoint distance so the wire drapes, not stretches taut. */
const SLACK = 1.06;
const MIN_SEGMENT = 4;
const CONSTRAINT_ITERATIONS = 6;
const GRAVITY = new Vector(0, 0.35); // gentle sag, cloth-like drape

/** Live position provider for a locked endpoint (e.g. a moving component pin). */
export type EndpointFollowFn = () => { x: number; y: number } | null;

/**
 * A dynamic schematic wire simulated with Verlet physics (Verly.js).
 *
 * A fixed chain of WIRE_POINTS verlet points; both endpoints are pinned
 * and follow component pins / the mouse. Segment rest-lengths adapt to
 * the endpoint distance each frame (always ~6% slack), so the wire
 * follows a drag smoothly, wobbling and sagging under gravity.
 */
export class Wire extends Graphics {
  /** Net name this wire belongs to (used by netlist generation). */
  net: string | null = null;

  /** Carries current → rendered in full filament glow. */
  live = true;

  protected points: Point[] = [];
  protected sticks: Stick[] = [];
  private ticker: Ticker | null = null;
  /** Per-endpoint live-position providers — locked pins move with their component. */
  private followers: [EndpointFollowFn | null, EndpointFollowFn | null] = [null, null];

  constructor(x1: number, y1: number, x2: number, y2: number) {
    super();
    this.eventMode = 'none'; // purely visual — never blocks pin hover/click
    this.rebuild(x1, y1, x2, y2);
  }

  /** (Re)create the verlet chain between two endpoints. */
  rebuild(x1: number, y1: number, x2: number, y2: number): void {
    this.points = [];
    this.sticks = [];

    for (let i = 0; i < WIRE_POINTS; i++) {
      const t = i / SEGMENTS;
      const p = new Point(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      p.setGravity(GRAVITY);
      p.setFriction(0.98);
      this.points.push(p);
    }

    this.points[0].pin();
    this.points[WIRE_POINTS - 1].pin();

    const seg = this.segmentLength();
    for (let i = 0; i < SEGMENTS; i++) {
      this.sticks.push(new Stick(this.points[i], this.points[i + 1], seg, 1));
    }
  }

  /** Wire endpoints in local (world-container) coordinates. */
  get endpoints(): [{ x: number; y: number }, { x: number; y: number }] {
    const a = this.points[0].pos;
    const b = this.points[WIRE_POINTS - 1].pos;
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ];
  }

  /** Move an endpoint (0 = start, 1 = end), e.g. while wiring from a pin to the mouse. */
  setEndpoint(which: 0 | 1, x: number, y: number): void {
    const p = which === 0 ? this.points[0] : this.points[WIRE_POINTS - 1];
    p.pos.setXY(x, y);
    p.resetVelocity();
  }

  /**
   * Lock an endpoint to a live position provider — called every physics
   * tick so the wire tracks a component pin as it's dragged around.
   * Pass null to release (endpoint stays wherever it last was).
   */
  setFollow(which: 0 | 1, fn: EndpointFollowFn | null): void {
    this.followers[which] = fn;
  }

  /** Attach to a Pixi ticker to animate; call `detach()` (or destroy) to stop. */
  attach(ticker: Ticker): this {
    this.detach();
    this.ticker = ticker;
    ticker.add(this.step);
    return this;
  }

  detach(): void {
    try {
      this.ticker?.remove(this.step);
    } catch {
      // ticker may already be destroyed during teardown
    }
    this.ticker = null;
  }

  override destroy(...args: Parameters<Graphics['destroy']>): void {
    this.detach();
    super.destroy(...args);
  }

  private segmentLength(): number {
    const [a, b] = this.endpoints;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(MIN_SEGMENT, (dist * SLACK) / SEGMENTS);
  }

  /** One physics + render step (Verlet integrate, relax constraints, redraw). */
  private step = () => {
    // Locked endpoints track their component pin's current world position
    // first, so a dragged component drags its wires along with it.
    for (const which of [0, 1] as const) {
      const follow = this.followers[which];
      if (!follow) continue;
      const pos = follow();
      if (pos) this.setEndpoint(which, pos.x, pos.y);
    }

    // Rest length tracks the endpoint distance so the wire keeps a
    // constant slack while an end is being dragged around.
    const seg = this.segmentLength();
    for (const s of this.sticks) s.setLength(seg);

    for (const p of this.points) p.update(WORLD);
    for (let i = 0; i < CONSTRAINT_ITERATIONS; i++) {
      for (const s of this.sticks) s.update();
    }
    this.draw();
  };

  private draw(): void {
    this.clear();
    const pts = this.points;
    this.moveTo(pts[0].pos.x, pts[0].pos.y);
    // Quadratic smoothing through segment midpoints keeps the polyline fluid
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].pos.x + pts[i + 1].pos.x) / 2;
      const my = (pts[i].pos.y + pts[i + 1].pos.y) / 2;
      this.quadraticCurveTo(pts[i].pos.x, pts[i].pos.y, mx, my);
    }
    const last = pts[pts.length - 1];
    this.lineTo(last.pos.x, last.pos.y);
    this.stroke({
      color: this.live ? COLOR_WIRE : COLOR_WIRE_IDLE,
      width: 3,
      cap: 'round',
      join: 'round',
    });
  }
}
