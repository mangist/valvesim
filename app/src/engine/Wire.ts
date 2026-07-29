import { Graphics, Ticker, type FederatedPointerEvent } from 'pixi.js';
import Vector from 'verlyjs/src/Vector.js';
import Point from 'verlyjs/src/Point.js';
import Stick from 'verlyjs/src/Stick.js';
import { DEFAULT_WIRE_GAUGE_AWG, DEFAULT_WIRE_KIND, gaugeStrokeWidth, type WireKind } from './wireGauges';
import { PIXELS_PER_INCH } from './units';

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

/** Rigid-wire corner fillet radius: a 1/4" bend, same physical scale as component symbols. */
const CORNER_RADIUS = 0.25 * PIXELS_PER_INCH;

/** Live position provider for a locked endpoint (e.g. a moving component pin). */
export type EndpointFollowFn = () => { x: number; y: number } | null;

/** A fixed waypoint along the wire's path, in world coordinates. */
export interface WireAnchor {
  x: number;
  y: number;
}

/**
 * A dynamic schematic wire simulated with Verlet physics (Verly.js).
 *
 * A fixed chain of WIRE_POINTS verlet points; both endpoints are pinned
 * and follow component pins / the mouse. Segment rest-lengths adapt to
 * the endpoint distance each frame (always ~6% slack), so the wire
 * follows a drag smoothly, wobbling and sagging under gravity — unless
 * `kind` is 'rigid', in which case physics is skipped entirely and the
 * wire renders as straight segments with rounded (1/4") corners at any
 * anchors, bus-wire style.
 */
export class Wire extends Graphics {
  /** Net name this wire belongs to (used by netlist generation). */
  net: string | null = null;

  /** Carries current → rendered in full filament glow. */
  live = true;

  /** AWG gauge — purely cosmetic for now, drives the rendered stroke width. */
  gaugeAwg: number = DEFAULT_WIRE_GAUGE_AWG;

  /** Loose (draping, physics-sagged) or rigid (straight bus wire, rounded corners). */
  kind: WireKind = DEFAULT_WIRE_KIND;

  /** Right-click on the wire body — set by the owner once the wire is placed. */
  onContextMenu?: (wire: Wire, clientX: number, clientY: number) => void;

  protected points: Point[] = [];
  protected sticks: Stick[] = [];
  /**
   * Fixed bend points along the wire. For a rigid wire these are ordered
   * waypoints the straight path routes through (rounded-corner fillets).
   * For a loose wire this only tracks pinned-point positions for the
   * anchor markers — the "stickiness" itself lives in `points[i].pin()`.
   */
  protected anchors: WireAnchor[] = [];
  private ticker: Ticker | null = null;
  /** Per-endpoint live-position providers — locked pins move with their component. */
  private followers: [EndpointFollowFn | null, EndpointFollowFn | null] = [null, null];

  constructor(x1: number, y1: number, x2: number, y2: number) {
    super();
    this.eventMode = 'static';
    this.cursor = 'pointer';
    // Wires render/hit-test behind components, so a wire attached right at
    // a pin never steals that pin's hover/click.
    this.zIndex = -1;
    this.rebuild(x1, y1, x2, y2);
    this.on('pointerdown', this.handlePointerDown);
    // A custom, generous hit region (rather than the exact rendered stroke)
    // so a right-click can land near the wire — not pixel-perfectly on the
    // thin line — both for opening the menu and for placing a rigid-wire
    // anchor somewhere off the straight path (that's what makes a corner).
    this.hitArea = { contains: (x: number, y: number) => this.distanceToPath(x, y) <= this.hitTolerance() };
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

  /**
   * Add a bend point near a canvas location (world coordinates).
   *
   * Loose wire: pins the nearest interior Verlet point in place — a
   * sticky kink in the rope that no longer sags at that spot.
   * Rigid wire: inserts an ordered waypoint into the straight-segment
   * path, at whichever existing segment the point is closest to, so the
   * bus wire bends there with a rounded 1/4" corner.
   */
  addAnchor(worldX: number, worldY: number): void {
    if (this.kind === 'rigid') {
      const path: WireAnchor[] = [this.points[0].pos, ...this.anchors, this.points[WIRE_POINTS - 1].pos];
      let bestSeg = 0;
      let bestDist = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((worldX - a.x) * dx + (worldY - a.y) * dy) / lenSq)) : 0;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const dist = Math.hypot(worldX - px, worldY - py);
        if (dist < bestDist) {
          bestDist = dist;
          bestSeg = i;
        }
      }
      this.anchors.splice(bestSeg, 0, { x: worldX, y: worldY });
    } else {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 1; i < this.points.length - 1; i++) {
        const p = this.points[i].pos;
        const dist = Math.hypot(p.x - worldX, p.y - worldY);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        this.points[bestIdx].pin();
        this.anchors.push({ x: this.points[bestIdx].pos.x, y: this.points[bestIdx].pos.y });
      }
    }
  }

  /** Anchors currently on this wire, for persistence. */
  getAnchors(): WireAnchor[] {
    return this.anchors.map((a) => ({ ...a }));
  }

  /** Restore anchors from a saved design (see `addAnchor` for how each kind interprets them). */
  restoreAnchors(list: WireAnchor[]): void {
    if (this.kind === 'rigid') {
      this.anchors = list.map((a) => ({ ...a }));
    } else {
      for (const a of list) this.addAnchor(a.x, a.y);
    }
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

  /** How close (world units) a point needs to be to count as "on" the wire. */
  private hitTolerance(): number {
    return Math.max(12, gaugeStrokeWidth(this.gaugeAwg) / 2 + 8);
  }

  /** Shortest distance from (x, y) to the wire's current path. */
  private distanceToPath(x: number, y: number): number {
    const path: WireAnchor[] =
      this.kind === 'rigid'
        ? [this.points[0].pos, ...this.anchors, this.points[WIRE_POINTS - 1].pos]
        : this.points.map((p) => p.pos);
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq)) : 0;
      const cx = a.x + dx * t;
      const cy = a.y + dy * t;
      best = Math.min(best, Math.hypot(x - cx, y - cy));
    }
    return best;
  }

  private segmentLength(): number {
    const [a, b] = this.endpoints;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(MIN_SEGMENT, (dist * SLACK) / SEGMENTS);
  }

  /**
   * Right-click on the wire body. Only acts once an owner has registered
   * `onContextMenu` (i.e. the wire has been placed) — while a wire is
   * still dangling from the mouse, nothing is bound yet, so the event
   * falls through to the stage, where WireTool treats a stage right-click
   * as "cancel the wire in hand".
   */
  private handlePointerDown = (e: FederatedPointerEvent) => {
    if (e.button !== 2 || !this.onContextMenu) return;
    e.stopPropagation();
    e.preventDefault();
    this.onContextMenu(this, e.clientX, e.clientY);
  };

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

    if (this.kind === 'loose') {
      // Rest length tracks the endpoint distance so the wire keeps a
      // constant slack while an end is being dragged around.
      const seg = this.segmentLength();
      for (const s of this.sticks) s.setLength(seg);

      for (const p of this.points) p.update(WORLD);
      for (let i = 0; i < CONSTRAINT_ITERATIONS; i++) {
        for (const s of this.sticks) s.update();
      }
    }
    this.draw();
  };

  private draw(): void {
    this.clear();
    const color = this.live ? COLOR_WIRE : COLOR_WIRE_IDLE;
    const width = gaugeStrokeWidth(this.gaugeAwg);

    if (this.kind === 'rigid') {
      this.drawRigid();
    } else {
      this.drawLoose();
    }
    this.stroke({ color, width, cap: 'round', join: 'round' });

    // Anchor markers: only meaningful for loose wires — a rigid wire's
    // bend points are already visible as the rounded corner itself.
    if (this.kind === 'loose') {
      for (const a of this.anchors) {
        this.circle(a.x, a.y, Math.max(3, width * 0.9)).fill(color);
      }
    }
  }

  /** Quadratic-smoothed polyline through the sagging verlet chain. */
  private drawLoose(): void {
    const pts = this.points;
    this.moveTo(pts[0].pos.x, pts[0].pos.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].pos.x + pts[i + 1].pos.x) / 2;
      const my = (pts[i].pos.y + pts[i + 1].pos.y) / 2;
      this.quadraticCurveTo(pts[i].pos.x, pts[i].pos.y, mx, my);
    }
    const last = pts[pts.length - 1];
    this.lineTo(last.pos.x, last.pos.y);
  }

  /** Straight segments through the endpoints and any anchors, with rounded corners. */
  private drawRigid(): void {
    const path: WireAnchor[] = [this.points[0].pos, ...this.anchors, this.points[WIRE_POINTS - 1].pos];
    this.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const next = path[i + 1];
      const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
      const radius = Math.max(0, Math.min(CORNER_RADIUS, d1 / 2, d2 / 2));
      this.arcTo(curr.x, curr.y, next.x, next.y, radius);
    }
    const last = path[path.length - 1];
    this.lineTo(last.x, last.y);
  }
}
