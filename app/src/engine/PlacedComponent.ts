import { Text } from 'pixi.js';
import { SchematicComponent } from './Component';
import { PIXELS_PER_INCH } from './units';
import { ComponentType, type ResistorProperties } from '../library/types';
import { getResistorBandColors } from '../library/colorCode';
import type { ComponentModel } from '../library';

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
  [ComponentType.Ground]: 'GND',
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

  constructor(model: ComponentModel, refDes: string, guid: string = crypto.randomUUID()) {
    super(refDes);
    this.model = model;
    this.guid = guid;
    this.labelValue = model.name;
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
      svgRoot = await this.loadSymbol(this.model.symbolUrl, this.bandFills());
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

    this.buildLabel(b);
  }

  /** Resistor band colors (svg ids "band-1".."band-4") from this instance's value. */
  private bandFills(): Record<string, string> | undefined {
    if (this.model.type !== ComponentType.Resistor) return undefined;
    const { resistance, tolerance } = this.model.properties as ResistorProperties;
    const [d1, d2, mult, tol] = getResistorBandColors(resistance, tolerance);
    return { 'band-1': d1, 'band-2': d2, 'band-3': mult, 'band-4': tol };
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
