import { Circle, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { SchematicComponent } from './Component';
import { PIXELS_PER_INCH } from './units';
import {
  ComponentType,
  formatEng,
  potentiometerTaperFraction,
  type PotentiometerProperties,
} from '../library/types';
import type { ComponentModel } from '../library';

/** Wiper indicator mechanical sweep: 300 degrees, centered on "up". */
const WIPER_MIN_ANGLE_DEG = -150;
const WIPER_MAX_ANGLE_DEG = 150;
/** Floor so an end-of-travel wiper never emits a literal 0-ohm SPICE card. */
const MIN_POT_SECTION_OHMS = 0.01;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Reference designator prefix per component type (V1, R2, T1…). */
export const REFDES_PREFIX: Record<string, string> = {
  [ComponentType.Tube]: 'V',
  [ComponentType.Resistor]: 'R',
  [ComponentType.Capacitor]: 'C',
  [ComponentType.Inductor]: 'L',
  [ComponentType.Potentiometer]: 'P',
  [ComponentType.Transformer]: 'T',
  [ComponentType.Wire]: 'W',
  [ComponentType.Switch]: 'S',
  [ComponentType.Jack]: 'J',
  [ComponentType.SolderLugStrip]: 'TS',
  [ComponentType.AcInlet]: 'AC',
};

/**
 * A library component instanced onto the canvas.
 *
 * Carries a persistent GUID from the moment of creation — this is the
 * primary key the design JSON will use when schematics are saved to
 * PostgreSQL (designs.schematic JSONB).
 */
export class PlacedComponent extends SchematicComponent {
  /** Stable instance identity (survives refDes renumbering). */
  readonly guid: string;

  readonly model: ComponentModel;

  /** Invoked when the user clicks the name label (App opens the editor). */
  onLabelEdit?: (component: PlacedComponent) => void;

  /** User-customizable display name, e.g. "Primary Rectifier". */
  private labelValue: string;
  private labelDisplay: Text | null = null;

  /** Potentiometer-only: wiper drag state and indicator visual. */
  private wiperView: Graphics | null = null;
  private wiperPivot = { x: 0, y: 0 };
  private wiperRadius = 34;
  private wiperDragging = false;

  constructor(model: ComponentModel, refDes: string, guid: string = crypto.randomUUID()) {
    super(refDes);
    this.model = model;
    this.guid = guid;
    this.labelValue = model.name;

    if (model.type === ComponentType.Potentiometer) {
      this.on('globalpointermove', this.onWiperDragMove);
      this.on('pointerup', this.onWiperDragEnd);
      this.on('pointerupoutside', this.onWiperDragEnd);
    }
  }

  /** Wiper rotation, 0 (full CCW) .. 1 (full CW). Persists as a user param. */
  get wiperPosition(): number {
    const stored = this.params.wiperPosition;
    if (typeof stored === 'number') return clamp01(stored);
    const fallback = (this.model.properties as PotentiometerProperties).wiperPosition;
    return clamp01(fallback ?? 0.5);
  }

  setWiperPosition(position: number): void {
    this.params.wiperPosition = clamp01(position);
    this.drawWiper();
  }

  get label(): string {
    return this.labelValue;
  }

  /** Rename the instance (empty/whitespace reverts to the catalog name). */
  setLabel(text: string): void {
    this.labelValue = text.trim() || this.model.name;
    if (this.labelDisplay) this.labelDisplay.text = this.labelValue;
  }

  /** Hide the canvas label while the HTML editor overlays it. */
  setLabelEditing(editing: boolean): void {
    if (this.labelDisplay) this.labelDisplay.visible = !editing;
  }

  /** Label anchor point in canvas (CSS) coordinates, for the edit overlay. */
  getLabelScreenPosition(): { x: number; y: number } | null {
    if (!this.labelDisplay) return null;
    const p = this.labelDisplay.getGlobalPosition();
    return { x: p.x, y: p.y };
  }

  /**
   * Load the symbol SVG and register wire-attachment pins.
   * Pin positions come from the symbol's `id="pin-N"` circles; only pins
   * mapped to a SPICE terminal are connectable (NC pins get no attachment).
   */
  async load(): Promise<void> {
    let svgRoot: SVGSVGElement | null = null;
    if (this.model.symbolUrl) {
      svgRoot = await this.loadSymbol(this.model.symbolUrl);
    }

    for (const pin of this.model.connectablePins) {
      let x = 0;
      let y = 0;
      if (pin.svgId && svgRoot) {
        const el = svgRoot.querySelector(`#${pin.svgId}`);
        if (el) {
          x = Number(el.getAttribute('cx') ?? 0);
          y = Number(el.getAttribute('cy') ?? 0);
        }
      }
      this.addPin({ id: pin.number, name: pin.name, x, y, net: null });
    }

    // Rotate/position about the symbol's visual center
    const b = this.getLocalBounds();
    this.pivot.set(b.x + b.width / 2, b.y + b.height / 2);

    // Scale to real-world size (uniform, fitted to the physical height so
    // the artwork isn't distorted — symbol art may be proportionally wider
    // than the part, e.g. the tube's bottom-view socket).
    if (b.height > 0) {
      this.scale.set((this.model.heightIn * PIXELS_PER_INCH) / b.height);
    }

    if (this.model.type === ComponentType.Potentiometer) {
      this.buildWiper(svgRoot);
    }

    this.buildLabel(b);
  }

  /** Read the pivot/radius from the symbol and add the draggable wiper dot. */
  private buildWiper(svgRoot: SVGSVGElement | null): void {
    const pivotEl = svgRoot?.querySelector('#wiper-pivot');
    this.wiperPivot = {
      x: Number(pivotEl?.getAttribute('cx') ?? 0),
      y: Number(pivotEl?.getAttribute('cy') ?? 0),
    };
    this.wiperRadius = Number(pivotEl?.getAttribute('data-radius') ?? 34);

    this.wiperView?.destroy();
    const view = new Graphics();
    view.eventMode = 'static';
    view.cursor = 'grab';
    view.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation(); // don't drag the whole component
      this.wiperDragging = true;
      view.cursor = 'grabbing';
    });
    this.wiperView = view;
    this.addChild(view);
    this.drawWiper();
  }

  private angleForPosition(position: number): number {
    return WIPER_MIN_ANGLE_DEG + position * (WIPER_MAX_ANGLE_DEG - WIPER_MIN_ANGLE_DEG);
  }

  private positionForAngle(angleDeg: number): number {
    const clamped = Math.min(WIPER_MAX_ANGLE_DEG, Math.max(WIPER_MIN_ANGLE_DEG, angleDeg));
    return clamp01((clamped - WIPER_MIN_ANGLE_DEG) / (WIPER_MAX_ANGLE_DEG - WIPER_MIN_ANGLE_DEG));
  }

  private drawWiper(): void {
    if (!this.wiperView) return;
    const angleRad = (this.angleForPosition(this.wiperPosition) * Math.PI) / 180;
    const dx = this.wiperRadius * Math.sin(angleRad);
    const dy = -this.wiperRadius * Math.cos(angleRad);
    const { x: px, y: py } = this.wiperPivot;

    this.wiperView.clear();
    this.wiperView
      .moveTo(px, py)
      .lineTo(px + dx, py + dy)
      .stroke({ color: 0xff9f1c, width: 4, cap: 'round' });
    this.wiperView.circle(px + dx, py + dy, 7).fill(0xff9f1c);
    // Generous hit area covering the whole knob — the tip dot alone (at
    // small canvas zoom) is too small a drag target to find reliably.
    this.wiperView.hitArea = new Circle(px, py, this.wiperRadius + 22);
  }

  private onWiperDragMove = (e: FederatedPointerEvent): void => {
    if (!this.wiperDragging) return;
    const local = this.toLocal(e.global);
    const dx = local.x - this.wiperPivot.x;
    const dy = local.y - this.wiperPivot.y;
    const angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    this.setWiperPosition(this.positionForAngle(angleDeg));
  };

  private onWiperDragEnd = (): void => {
    this.wiperDragging = false;
    if (this.wiperView) this.wiperView.cursor = 'grab';
  };

  /** Emit the two resistor primitives (CCW-to-wiper, wiper-to-CW). */
  private potentiometerSpice(): string {
    const props = this.model.properties as PotentiometerProperties;
    const frac = potentiometerTaperFraction(this.wiperPosition, props.taper);
    const ra = Math.max(props.resistance * frac, MIN_POT_SECTION_OHMS);
    const rb = Math.max(props.resistance * (1 - frac), MIN_POT_SECTION_OHMS);

    const netFor = (pinNumber: string): string | undefined =>
      this.pins.find((p) => p.id === pinNumber)?.net ?? undefined;
    const n1 = netFor('1');
    const n2 = netFor('2');
    const n3 = netFor('3');
    if (!n1 || !n2 || !n3) {
      return `* ${this.refDes} (${this.model.name}) not fully wired`;
    }

    return [
      `R${this.refDes}A ${n1} ${n2} ${formatEng(ra)}`,
      `R${this.refDes}B ${n2} ${n3} ${formatEng(rb)}`,
    ].join('\n');
  }

  /** Editable name label centered above the symbol. */
  private buildLabel(b: { x: number; y: number; width: number; height: number }): void {
    const s = this.scale.x || 1;
    const text = new Text({
      text: this.labelValue,
      resolution: (window.devicePixelRatio || 1) * 2,
      style: {
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: 26,
        fontWeight: '600',
        fill: 0xeaf2ef,
      },
    });
    text.anchor.set(0.5, 1);
    // Cancel the physical-size scale so the label is 26px at zoom 1
    text.scale.set(1 / s);
    text.position.set(b.x + b.width / 2, b.y - 10 / s);

    text.eventMode = 'static';
    text.cursor = 'text';
    text.on('pointerover', () => {
      text.style.fill = 0xff9f1c;
    });
    text.on('pointerout', () => {
      text.style.fill = 0xeaf2ef;
    });
    text.on('pointerdown', (e) => {
      e.stopPropagation(); // not a component drag
      // Block the browser's default focus shift — it would land after the
      // editor input mounts and immediately blur (= close) it.
      e.preventDefault();
    });
    // Open on tap (pointerup) — past the mousedown focus side-effects
    text.on('pointertap', () => {
      this.onLabelEdit?.(this);
    });

    this.labelDisplay?.destroy();
    this.labelDisplay = text;
    this.addChild(text);
  }

  /** Serializable placement state (schematic JSONB shape for save/load). */
  toJSON(): {
    guid: string;
    componentId: string;
    refDes: string;
    label: string;
    x: number;
    y: number;
    pins: Array<{ id: string; net: string | null }>;
  } {
    return {
      guid: this.guid,
      componentId: this.model.id,
      refDes: this.refDes,
      label: this.labelValue,
      x: this.x,
      y: this.y,
      pins: this.pins.map((p) => ({ id: p.id, net: p.net })),
    };
  }

  toSpice(): string {
    if (this.model.type === ComponentType.Potentiometer) {
      return this.potentiometerSpice();
    }
    const pinNets: Record<string, string> = {};
    for (const p of this.pins) {
      if (p.net) pinNets[p.id] = p.net;
    }
    try {
      return this.model.toSpiceInstances(this.refDes, pinNets).join('\n');
    } catch {
      return `* ${this.refDes} (${this.model.name}) not fully wired`;
    }
  }
}
