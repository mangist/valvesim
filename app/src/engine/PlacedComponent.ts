import { Circle, Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import { SchematicComponent } from './Component';
import { PIXELS_PER_INCH } from './units';
import { SevenSegDisplay, formatMeterReading } from './SevenSegDisplay';
import { OscilloscopeDisplay, type ScopeYMode } from './OscilloscopeDisplay';
import {
  ComponentType,
  formatEng,
  potentiometerTaperFraction,
  type CapacitorProperties,
  type MeterProperties,
  type PotentiometerProperties,
  type ResistorProperties,
} from '../library/types';
import { getResistorBandColors } from '../library/colorCode';
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
  [ComponentType.Ground]: 'GND',
  [ComponentType.Meter]: 'M',
  [ComponentType.Diode]: 'D',
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

  /** AC-inlet-only: clickable power rocker overlay. */
  private switchView: Graphics | null = null;
  private switchRect = { x: 0, y: 0, w: 0, h: 0 };

  /** 7-seg readout: meter face, or the inlet's current-draw display. */
  private meterDisplay: SevenSegDisplay | null = null;
  /** Oscilloscope-only: live trace + stats fitted to the scope-screen window. */
  private oscilloscopeDisplay: OscilloscopeDisplay | null = null;
  /** Oscilloscope-only: clickable Auto / 1V-div Y-scale toggle overlay. */
  private yScaleSwitchView: Container | null = null;
  private yScaleSwitchBg: Graphics | null = null;
  private yScaleSwitchLabels: [Text, Text] | null = null;
  private yScaleSwitchRect = { x: 0, y: 0, w: 0, h: 0 };
  /** Inlet only: bezel + stem + display, shown/hidden with the rocker. */
  private inletMeterGroup: Container | null = null;

  /** Invoked when the power rocker is toggled (App shows a status update). */
  onSwitchToggle?: (component: PlacedComponent, on: boolean) => void;

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

  /** AC inlet rocker state — defaults to ON. Persists as a user param (0/1). */
  get switchOn(): boolean {
    const stored = this.params.switchOn;
    if (typeof stored === 'number') return stored !== 0;
    return true;
  }

  setSwitchOn(on: boolean): void {
    this.params.switchOn = on ? 1 : 0;
    this.drawPowerSwitch();
    // the current-draw readout only shows while power is on
    if (this.model.type === ComponentType.AcInlet && this.inletMeterGroup) {
      this.inletMeterGroup.visible = on;
      if (on) this.setMeterValue(0);
    }
    this.onSwitchToggle?.(this, on);
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
    this.normalizePinScale(this.scale.x);

    if (this.model.type === ComponentType.Potentiometer) {
      this.buildWiper(svgRoot);
    }
    if (this.model.type === ComponentType.AcInlet) {
      this.buildPowerSwitch(svgRoot);
      this.buildInletMeter(svgRoot, b);
    }
    if (this.model.type === ComponentType.Meter) {
      this.buildMeterFace(svgRoot);
    }

    this.buildLabel(b);
  }

  /** Base unit for this instance's readout ('A' for the inlet's draw display). */
  private get meterBaseUnit(): 'A' | 'V' {
    if (this.model.type === ComponentType.Meter) {
      return (this.model.properties as MeterProperties).meterType === 'voltmeter' ? 'V' : 'A';
    }
    return 'A';
  }

  /** Push a measured value (RMS volts/amps) onto the 7-seg readout. */
  setMeterValue(value: number): void {
    if (!this.meterDisplay) return;
    const { text, unit } = formatMeterReading(value, this.meterBaseUnit);
    this.meterDisplay.setText(text);
    this.meterDisplay.setUnit(unit);
  }

  /** Oscilloscope only: push a fresh solver waveform onto the CRT trace. */
  setWaveform(time: number[], values: number[]): void {
    this.oscilloscopeDisplay?.update(time, values);
  }

  /**
   * Digital current-draw readout attached under the AC inlet (visible when
   * ON): a short stem tabs off the panel underside into a Voltmeter-style
   * bezel — dark body with the cream rounded border — holding the 7-seg.
   */
  private buildInletMeter(
    svgRoot: SVGSVGElement | null,
    b: { x: number; y: number; width: number; height: number },
  ): void {
    this.inletMeterGroup?.destroy();
    const group = new Container();
    group.eventMode = 'none';

    // The symbol's overall bounds equal its full viewBox, not the drawn
    // panel's ink extents (there's blank margin below the panel art) — so
    // anchoring the stem to `b.height` leaves a visible gap. The
    // `panel-body` marker gives the panel's actual visual rectangle.
    const marker = svgRoot?.querySelector('#panel-body');
    const px = Number(marker?.getAttribute('x') ?? b.x);
    const py = Number(marker?.getAttribute('y') ?? b.y);
    const pw = Number(marker?.getAttribute('width') ?? b.width);
    const ph = Number(marker?.getAttribute('height') ?? b.height);

    const display = new SevenSegDisplay(52, 'A');
    const targetW = pw * 0.82; // wide enough to read as part of the same unit
    const s = targetW / display.panelWidth;
    const dw = display.panelWidth * s;
    const dh = display.panelHeight * s;
    const cx = px + pw / 2;
    const pad = 9;
    const stemH = 14;
    const panelBottom = py + ph;
    const bezelY = panelBottom + stemH - 5;

    const chrome = new Graphics();
    // stem: tabs over the panel's bottom edge so the meter reads as attached
    chrome
      .rect(cx - 16, panelBottom - 7, 32, stemH + 7)
      .fill(0x1b1b1e)
      .stroke({ color: 0xcdd6d2, width: 2.5 });
    // bezel matching the Voltmeter face: dark body, cream rounded border
    chrome
      .roundRect(cx - dw / 2 - pad, bezelY, dw + pad * 2, dh + pad * 2, 10)
      .fill(0x1b1b1e)
      .stroke({ color: 0xcdd6d2, width: 3 });
    group.addChild(chrome);

    display.scale.set(s);
    display.position.set(cx - dw / 2, bezelY + pad);
    group.addChild(display);

    group.visible = this.switchOn;
    this.meterDisplay = display;
    this.inletMeterGroup = group;
    this.addChild(group);
    this.setMeterValue(0);
  }

  /** Fit the 7-seg readout (or the oscilloscope trace) into the meter face window. */
  private buildMeterFace(svgRoot: SVGSVGElement | null): void {
    if ((this.model.properties as MeterProperties).meterType === 'oscilloscope') {
      this.buildOscilloscopeFace(svgRoot);
      return;
    }

    const marker = svgRoot?.querySelector('#meter-display');
    if (!marker) return;
    const mx = Number(marker.getAttribute('x') ?? 0);
    const my = Number(marker.getAttribute('y') ?? 0);
    const mw = Number(marker.getAttribute('width') ?? 0);
    const mh = Number(marker.getAttribute('height') ?? 0);

    this.meterDisplay?.destroy();
    const display = new SevenSegDisplay(56, this.meterBaseUnit);
    const s = Math.min((mw * 0.94) / display.panelWidth, (mh * 0.9) / display.panelHeight);
    display.scale.set(s);
    display.position.set(
      mx + (mw - display.panelWidth * s) / 2,
      my + (mh - display.panelHeight * s) / 2,
    );
    this.meterDisplay = display;
    this.addChild(display);
    this.setMeterValue(0);
  }

  /** Oscilloscope Y-scale mode — defaults to auto-fit. Persists as a user param. */
  get yScaleMode(): ScopeYMode {
    return this.params.scopeYMode === 'fixed' ? 'fixed' : 'auto';
  }

  private setYScaleMode(mode: ScopeYMode): void {
    this.params.scopeYMode = mode;
    this.oscilloscopeDisplay?.setYMode(mode);
    this.drawYScaleSwitch();
  }

  /** Fit the live CRT trace + stats into the symbol's id="scope-screen" window. */
  private buildOscilloscopeFace(svgRoot: SVGSVGElement | null): void {
    const marker = svgRoot?.querySelector('#scope-screen');
    if (!marker) return;
    const mx = Number(marker.getAttribute('x') ?? 0);
    const my = Number(marker.getAttribute('y') ?? 0);
    const mw = Number(marker.getAttribute('width') ?? 0);
    const mh = Number(marker.getAttribute('height') ?? 0);

    this.oscilloscopeDisplay?.destroy();
    const display = new OscilloscopeDisplay(mw, mh);
    display.position.set(mx, my);
    display.setYMode(this.yScaleMode);
    this.oscilloscopeDisplay = display;
    this.addChild(display);

    this.buildYScaleSwitch(svgRoot);
  }

  /**
   * Small on-screen toggle (Auto / 1V-div) for the oscilloscope's vertical
   * scale. Geometry comes from the symbol's invisible id="yscale-switch"
   * marker rect, bottom-right of the CRT glass.
   */
  private buildYScaleSwitch(svgRoot: SVGSVGElement | null): void {
    const marker = svgRoot?.querySelector('#yscale-switch');
    if (!marker) return;
    const x = Number(marker.getAttribute('x') ?? 0);
    const y = Number(marker.getAttribute('y') ?? 0);
    const w = Number(marker.getAttribute('width') ?? 0);
    const h = Number(marker.getAttribute('height') ?? 0);
    this.yScaleSwitchRect = { x, y, w, h };

    this.yScaleSwitchView?.destroy();
    const view = new Container();
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.hitArea = new Rectangle(x, y, w, h);
    view.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation(); // never drags the component or pans the canvas
    });
    view.on('pointertap', () => {
      this.setYScaleMode(this.yScaleMode === 'auto' ? 'fixed' : 'auto');
    });

    const bg = new Graphics();
    view.addChild(bg);

    const labelStyle = (size: number) => ({
      fontFamily: "'Consolas', 'Menlo', monospace",
      fontSize: size,
      fontWeight: '700' as const,
    });
    const autoLabel = new Text({
      text: 'AUTO',
      resolution: (window.devicePixelRatio || 1) * 2,
      style: labelStyle(h * 0.34),
    });
    autoLabel.anchor.set(0.5);
    autoLabel.position.set(x + w * 0.25, y + h / 2);
    view.addChild(autoLabel);

    const fixedLabel = new Text({
      text: '1V/DIV',
      resolution: (window.devicePixelRatio || 1) * 2,
      style: labelStyle(h * 0.28),
    });
    fixedLabel.anchor.set(0.5);
    fixedLabel.position.set(x + w * 0.75, y + h / 2);
    view.addChild(fixedLabel);

    this.yScaleSwitchBg = bg;
    this.yScaleSwitchLabels = [autoLabel, fixedLabel];
    this.yScaleSwitchView = view;
    this.addChild(view);
    this.drawYScaleSwitch();
  }

  /** Redraw the switch's active/inactive highlight and label colors. */
  private drawYScaleSwitch(): void {
    if (!this.yScaleSwitchView || !this.yScaleSwitchBg) return;
    const { x, y, w, h } = this.yScaleSwitchRect;
    const auto = this.yScaleMode === 'auto';
    const r = h * 0.2;

    const bg = this.yScaleSwitchBg;
    bg.clear();
    bg.roundRect(x, y, w, h, r).fill(0x081208).stroke({ color: 0x2c5a38, width: 2 });
    const half = w / 2;
    bg.roundRect(x + (auto ? 0 : half), y, half, h, r).fill(0x1c3a24);

    const [autoLabel, fixedLabel] = this.yScaleSwitchLabels ?? [];
    const ON = 0x39ff6a;
    const OFF = 0x2c5a38;
    if (autoLabel) autoLabel.style.fill = auto ? ON : OFF;
    if (fixedLabel) fixedLabel.style.fill = auto ? OFF : ON;
  }

  /**
   * The rocker button is drawn live (not baked into the SVG) so it can be
   * clicked to toggle power. Its geometry comes from the symbol's
   * invisible id="switch-rocker" marker rect.
   */
  private buildPowerSwitch(svgRoot: SVGSVGElement | null): void {
    const marker = svgRoot?.querySelector('#switch-rocker');
    if (!marker) return;
    this.switchRect = {
      x: Number(marker.getAttribute('x') ?? 0),
      y: Number(marker.getAttribute('y') ?? 0),
      w: Number(marker.getAttribute('width') ?? 0),
      h: Number(marker.getAttribute('height') ?? 0),
    };

    this.switchView?.destroy();
    const view = new Graphics();
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation(); // clicking the rocker never drags the component
    });
    view.on('pointertap', () => {
      this.setSwitchOn(!this.switchOn);
    });
    this.switchView = view;
    this.addChild(view);
    this.drawPowerSwitch();
  }

  /** Redraw the rocker in its current state (illuminated red = ON). */
  private drawPowerSwitch(): void {
    if (!this.switchView) return;
    const { x, y, w, h } = this.switchRect;
    const on = this.switchOn;
    const g = this.switchView;
    const midY = y + h / 2;
    const cx = x + w / 2;

    g.clear();
    // amber power-glow halo around the illuminated rocker
    if (on) {
      g.roundRect(x - 4, y - 4, w + 8, h + 8, 12).stroke({ color: 0xff9f1c, width: 2.5 });
    }
    // rocker base: bright illuminated red when ON, dark dead red when OFF
    g.roundRect(x, y, w, h, 9)
      .fill(on ? 0xd6362a : 0x631812)
      .stroke({ color: 0x7a1f18, width: 2.5 });
    // pressed-in half: the active side sits deeper (I-side when ON, O-side when OFF)
    if (on) {
      g.roundRect(x + 5, y + 5, w - 10, h / 2 - 8, 6).fill(0xa8241a);
    } else {
      g.roundRect(x + 5, midY + 3, w - 10, h / 2 - 8, 6).fill(0x3f0f0a);
    }
    // seesaw hinge
    g.moveTo(x, midY).lineTo(x + w, midY).stroke({ color: 0x7a1f18, width: 1.5 });
    // "I" dash (IEC 60417-5007), upper half — lit when ON
    g.moveTo(cx - 8, y + h / 4)
      .lineTo(cx + 8, y + h / 4)
      .stroke({ color: on ? 0xffe9c9 : 0x9a6b60, width: 4, cap: 'round' });
    // "O" circle (IEC 60417-5008), lower half — prominent when OFF
    g.circle(cx, y + (3 * h) / 4, 9).stroke({ color: on ? 0x9a6b60 : 0xedede6, width: 3.5 });

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
    params: Record<string, string | number>;
    pins: Array<{ id: string; net: string | null }>;
  } {
    return {
      guid: this.guid,
      componentId: this.model.id,
      refDes: this.refDes,
      label: this.labelValue,
      x: this.x,
      y: this.y,
      params: this.params,
      pins: this.pins.map((p) => ({ id: p.id, net: p.net })),
    };
  }

  /**
   * R/C/D primitive card from catalog properties — these are native SPICE
   * devices (R<refDes>/C<refDes>/D<refDes> n1 n2 <value-or-model>), not an
   * X-instance subckt call like tubes/transformers.
   */
  private passiveSpice(): string {
    const netFor = (pinNumber: string): string | undefined =>
      this.pins.find((p) => p.id === pinNumber)?.net ?? undefined;
    const n1 = netFor('1');
    const n2 = netFor('2');
    if (!n1 || !n2) {
      return `* ${this.refDes} (${this.model.name}) not fully wired`;
    }
    // refDes already carries the element letter (R1, C3, D4, …)
    if (this.model.type === ComponentType.Resistor) {
      const { resistance } = this.model.properties as ResistorProperties;
      return `${this.refDes} ${n1} ${n2} ${formatEng(resistance)}`;
    }
    if (this.model.type === ComponentType.Diode) {
      // n1 = anode (pin 1), n2 = cathode (pin 2); model name is the .inc
      // file's declared .MODEL name, reusing the "subckt" field even
      // though this isn't a subckt — it's the one thing that names it.
      const modelName = this.model.spice?.subckt ?? 'D';
      return `${this.refDes} ${n1} ${n2} ${modelName}`;
    }
    const { capacitance } = this.model.properties as CapacitorProperties;
    return `${this.refDes} ${n1} ${n2} ${formatEng(capacitance)}`;
  }

  toSpice(): string {
    if (this.model.type === ComponentType.Potentiometer) {
      return this.potentiometerSpice();
    }
    if (
      this.model.type === ComponentType.Resistor ||
      this.model.type === ComponentType.Capacitor ||
      this.model.type === ComponentType.Diode
    ) {
      return this.passiveSpice();
    }
    // Unwired pins get unique dangling nets rather than blocking the whole
    // card — a partially-wired inlet/tube still participates in the live
    // solve (e.g. PE left floating). Each dangling net is tied to ground
    // through 1G so the solver always has a DC path.
    const pinNets: Record<string, string> = {};
    const danglers: string[] = [];
    this.pins.forEach((p, i) => {
      if (p.net) {
        pinNets[p.id] = p.net;
      } else {
        const net = `nc${i}_${this.refDes.toLowerCase()}`;
        pinNets[p.id] = net;
        danglers.push(net);
      }
    });
    try {
      let cards = this.model.toSpiceInstances(this.refDes, pinNets);
      // AC inlet with the rocker off: swap in the dead-input subckt variant
      // (the subckt name is the last token of an X-instance card).
      if (this.model.type === ComponentType.AcInlet && !this.switchOn) {
        cards = cards.map((card) => `${card}_OFF`);
      }
      cards.push(...danglers.map((net, i) => `RNC${i}${this.refDes} ${net} 0 1G`));
      return cards.join('\n');
    } catch {
      return `* ${this.refDes} (${this.model.name}) not fully wired`;
    }
  }
}
