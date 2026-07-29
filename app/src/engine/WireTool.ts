import type { FederatedPointerEvent } from 'pixi.js';
import { PlacedWire } from './PlacedWire';
import { Wire } from './Wire';
import { SchematicComponent, type Pin } from './Component';
import type { Viewport } from './Viewport';
import type { PlacedComponent } from './PlacedComponent';
import type { ComponentModel } from '../library';
import { DEFAULT_WIRE_GAUGE_AWG, DEFAULT_WIRE_KIND, type WireKind } from './wireGauges';

/** Wire type/gauge chosen from the pin context menu (or the left-click default). */
export interface WireChoice {
  kind?: WireKind;
  gaugeAwg?: number;
}

/**
 * Interactive wiring tool.
 *
 * Click a pin → a Verlet wire is created, locked to that pin (it follows
 * the pin if the component is later dragged), with the other end
 * following the mouse. Click a second pin → that end locks too and both
 * pins are merged onto the same SPICE net. Click empty canvas instead →
 * the free end simply drops in place, unattached. Panning/zooming is
 * locked while a wire is in hand.
 */
export class WireTool {
  private wire: PlacedWire | null = null;
  private fromComponent: PlacedComponent | null = null;
  private fromPin: Pin | null = null;
  private netCounter = 0;

  constructor(
    private viewport: Viewport,
    private wireModel: ComponentModel,
    private onPlaced?: (wire: PlacedWire) => void,
  ) {}

  get isActive(): boolean {
    return this.wire !== null;
  }

  /**
   * Ensure future minted nets start above `min` — called after loading a
   * design so new wires can't reuse a net name already in the file.
   */
  seedNetCounter(min: number): void {
    this.netCounter = Math.max(this.netCounter, min);
  }

  /**
   * Begin a wire at a component pin (its world position); locks endpoint 0.
   * `choice` picks the wire type/gauge (from the right-click pin menu) —
   * defaults to loose 22 AWG, matching a plain left-click start.
   */
  startFromPin(component: PlacedComponent, pin: Pin, choice?: WireChoice): void {
    if (this.wire) return;

    const pos = this.pinWorldPos(component, pin);
    const wire = new PlacedWire(this.wireModel, pos.x, pos.y, pos.x, pos.y);
    wire.kind = choice?.kind ?? DEFAULT_WIRE_KIND;
    wire.gaugeAwg = choice?.gaugeAwg ?? DEFAULT_WIRE_GAUGE_AWG;
    this.viewport.world.addChild(wire);
    wire.attach(this.viewport.app.ticker);
    this.wire = wire;
    this.fromComponent = component;
    this.fromPin = pin;

    this.lockEndpoint(0, component, pin);

    this.viewport.setInteractionLocked(true);
    const stage = this.viewport.app.stage;
    stage.on('globalpointermove', this.onMove);
    stage.on('pointerdown', this.onStageDown);
  }

  /**
   * Lock the free end onto a second pin — merges both pins onto the same
   * net and drops the wire in place. Returns the finished wire.
   */
  finishOnPin(component: PlacedComponent, pin: Pin): PlacedWire | null {
    if (!this.wire) return null;
    this.lockEndpoint(1, component, pin);
    return this.place();
  }

  /** Drop the wire where it is; returns it (or null if none in hand). */
  place(): PlacedWire | null {
    const wire = this.wire;
    if (!wire) return null;
    this.teardown();
    this.onPlaced?.(wire);
    return wire;
  }

  /** Abort wiring and remove the in-hand wire. */
  cancel(): void {
    const wire = this.wire;
    if (!wire) return;
    this.teardown();
    wire.destroy();
  }

  /** Release listeners (component unmount). */
  dispose(): void {
    this.cancel();
  }

  /** A pin's current position in world (viewport) coordinates. */
  private pinWorldPos(component: PlacedComponent, pin: Pin): { x: number; y: number } {
    const global = component.toGlobal({ x: pin.x, y: pin.y });
    return this.viewport.world.toLocal(global);
  }

  /**
   * Attach a wire endpoint to a component pin: records the attachment,
   * snaps to the pin's current position, keeps following it every frame
   * (so dragging the component drags the wire along), and assigns/merges
   * the electrical net so the connection is netlist-valid.
   */
  private lockEndpoint(which: 0 | 1, component: PlacedComponent, pin: Pin): void {
    const wire = this.wire;
    if (!wire) return;

    const attachment = { componentGuid: component.guid, pinId: pin.id };
    if (which === 0) wire.from = attachment;
    else wire.to = attachment;

    const pos = this.pinWorldPos(component, pin);
    wire.setEndpoint(which, pos.x, pos.y);
    wire.setFollow(which, () => this.pinWorldPos(component, pin));

    const net =
      which === 0 || !this.fromPin
        ? (pin.net ??= `N${++this.netCounter}`)
        : this.mergeNets(this.fromPin, pin);
    wire.net = net;
    component.refreshPins();
    // The merge may also have just assigned the *other* end's pin a net
    // for the first time (e.g. it had none before) — repaint it too.
    if (which === 1) this.fromComponent?.refreshPins();
  }

  /**
   * Merge two pins onto the same net. When both pins already belong to
   * different nets, the merge must propagate: every pin and wire in the
   * whole circuit carrying the obsolete net is renamed onto the surviving
   * one — otherwise previously-joined connections silently break apart.
   */
  private mergeNets(a: Pin, b: Pin): string {
    const net = a.net ?? b.net ?? `N${++this.netCounter}`;
    const obsolete = new Set(
      [a.net, b.net].filter((n): n is string => n !== null && n !== net),
    );
    a.net = net;
    b.net = net;

    if (obsolete.size > 0) {
      for (const child of this.viewport.world.children) {
        if (child instanceof SchematicComponent) {
          let touched = false;
          for (const pin of child.pins) {
            if (pin.net && obsolete.has(pin.net)) {
              pin.net = net;
              touched = true;
            }
          }
          if (touched) child.refreshPins();
        } else if (child instanceof Wire && child.net && obsolete.has(child.net)) {
          child.net = net;
        }
      }
    }
    return net;
  }

  private onMove = (e: FederatedPointerEvent) => {
    const wire = this.wire;
    if (!wire) return;
    const world = this.viewport.world.toLocal(e.global);
    wire.setEndpoint(1, world.x, world.y);
  };

  private onStageDown = () => {
    this.place();
  };

  private teardown(): void {
    const stage = this.viewport.app.stage;
    stage.off('globalpointermove', this.onMove);
    stage.off('pointerdown', this.onStageDown);
    this.viewport.setInteractionLocked(false);
    this.wire = null;
    this.fromComponent = null;
    this.fromPin = null;
  }
}
