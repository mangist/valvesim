import { Circle, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { SVGScene } from '@pixi-essentials/svg';
import type { Viewport } from './Viewport';

const COLOR_PIN = 0xff9f1c; // Amber / Filament Glow
const COLOR_PIN_IDLE = 0x8a8f9a; // unwired terminal
const COLOR_SELECT = 0xeaf2ef; // Off-White Cream

/**
 * A named electrical terminal on a component.
 *
 * Mirrors the pin-view / netlist-mapping style of the reference symbol
 * sheets (e.g. 5U4G: pin 4 → PLATE_1 → net HV_P1) — each pin carries
 * both its physical position on the symbol and the SPICE net it maps to.
 */
export interface Pin {
  /** Physical pin identifier, e.g. "4" on a 5U4G octal base. */
  id: string;
  /** Electrical role, e.g. "PLATE_1", "HEATER+". */
  name: string;
  /** Position in local (symbol) coordinates. */
  x: number;
  y: number;
  /** SPICE netlist node this pin is currently connected to (null = unconnected). */
  net: string | null;
}

/**
 * Base class for every interactive schematic symbol on the canvas.
 *
 * Concrete components (tubes, transformers, passives) provide:
 *  - an SVG symbol (flat 2D labeled-pin illustration style),
 *  - a pin map, and
 *  - their SPICE card(s) via `toSpice()`.
 */
export abstract class SchematicComponent extends Container {
  /** Reference designator, e.g. "V1", "T1", "R2". */
  readonly refDes: string;

  readonly pins: Pin[] = [];

  /** User-editable parameters (values, models) serialized with the design. */
  params: Record<string, string | number> = {};

  selected = false;

  /** Invoked when the user presses a pin (start/finish wiring). */
  onPinDown?: (component: SchematicComponent, pin: Pin) => void;

  protected symbol: Container | null = null;
  protected pinLayer = new Graphics();
  private pinViews: PinView[] = [];
  /** Pin-name callouts, shown while any pin of this component is hovered. */
  private labelLayer: Container | null = null;
  private dragOffset: { x: number; y: number } | null = null;
  private viewport: Viewport | null = null;

  constructor(refDes: string) {
    super();
    this.refDes = refDes;
    this.addChild(this.pinLayer);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', this.onDragStart);
    this.on('globalpointermove', this.onDragMove);
    this.on('pointerup', this.onDragEnd);
    this.on('pointerupoutside', this.onDragEnd);
  }

  /** Emit this component's SPICE netlist card(s), e.g. "R1 in out 1k". */
  abstract toSpice(): string;

  /** Attach to a viewport so dragging can snap to its grid. */
  mount(viewport: Viewport): this {
    this.viewport = viewport;
    viewport.world.addChild(this);
    return this;
  }

  /**
   * Load the component's vector symbol.
   *
   * Symbols are authored as flat 2D SVG illustrations with labeled pins
   * (see the Hammond 372HX / 5U4G reference sheets) and parsed into
   * retained Pixi geometry by @pixi-essentials/svg.
   *
   * Returns the parsed SVG root so callers can read pin element
   * coordinates (circle[id="pin-N"]) for wire attachment points.
   *
   * `elementFills`, if given, maps element id -> fill color and is applied
   * to the DOM before it's handed to SVGScene — e.g. recoloring a
   * resistor's `id="band-N"` rects from its resistance value.
   */
  async loadSymbol(
    url: string,
    elementFills?: Record<string, string>,
  ): Promise<SVGSVGElement | null> {
    const source = await fetch(url).then((r) => r.text());
    const dom = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = dom.documentElement as unknown as SVGSVGElement;

    if (elementFills) {
      for (const [id, fill] of Object.entries(elementFills)) {
        root.querySelector(`#${id}`)?.setAttribute('fill', fill);
      }
    }

    // SVGScene mutates the DOM it renders — snapshot first so callers can
    // still read authored attributes (pin cx/cy) afterwards.
    const snapshot = root.cloneNode(true) as SVGSVGElement;

    if (this.symbol) this.symbol.destroy();
    try {
      this.symbol = new SVGScene(root);
    } catch (err) {
      console.warn(`[valvesim] SVG symbol failed to parse (${url}):`, err);
      // Fallback so the component is still visible and draggable
      this.symbol = new Graphics()
        .roundRect(0, 0, 120, 80, 8)
        .stroke({ color: COLOR_SELECT, width: 2 });
    }
    this.addChildAt(this.symbol, 0);
    this.drawPins();
    return snapshot;
  }

  /** Register a pin: interactive terminal dot (hover highlight, wire start). */
  protected addPin(pin: Pin): void {
    this.pins.push(pin);
    const view = new PinView(
      pin,
      (p, e) => {
        e.stopPropagation(); // don't drag the component or pan the canvas
        this.onPinDown?.(this, p);
      },
      (hovered) => this.setPinLabelsVisible(hovered),
    );
    this.pinViews.push(view);
    this.addChild(view);
  }

  /** Redraw pin terminal dots — call after a wire changes a pin's net. */
  refreshPins(): void {
    this.drawPins();
  }

  /** Show/hide name callouts for every pin (hover any pin to identify all). */
  setPinLabelsVisible(visible: boolean): void {
    if (visible && !this.labelLayer) {
      this.labelLayer = this.buildPinLabels();
      this.addChild(this.labelLayer);
    }
    if (this.labelLayer) this.labelLayer.visible = visible;

    // Labels keep a constant on-screen size: counter-scale against the
    // viewport zoom every frame while they're shown.
    const ticker = this.viewport?.app.ticker;
    if (ticker) {
      ticker.remove(this.updateLabelScale);
      if (visible) {
        this.updateLabelScale();
        ticker.add(this.updateLabelScale);
      }
    } else if (visible) {
      this.updateLabelScale();
    }
  }

  private updateLabelScale = (): void => {
    if (!this.labelLayer?.visible) return;
    // Constant on-screen size: cancel both viewport zoom and the
    // component's own physical-size scale.
    const zoom = (this.viewport?.world.scale.x ?? 1) * (this.scale.x || 1);
    const inv = 1 / zoom;
    for (const label of this.labelLayer.children) {
      label.scale.set(inv);
    }
  };

  private buildPinLabels(): Container {
    const layer = new Container();
    layer.eventMode = 'none'; // never intercept the pointer

    // Push each label radially outward from the pin cluster's centroid
    // so neighboring callouts don't pile on top of each other.
    const cx = this.pins.reduce((s, p) => s + p.x, 0) / this.pins.length;
    const cy = this.pins.reduce((s, p) => s + p.y, 0) / this.pins.length;

    for (const pin of this.pins) {
      const dx = pin.x - cx;
      const dy = pin.y - cy;
      const len = Math.hypot(dx, dy);
      const ux = len > 0.01 ? dx / len : 0;
      const uy = len > 0.01 ? dy / len : -1;

      const label = new Container();
      const text = new Text({
        text: `${pin.id} · ${pin.name}`,
        // Rasterize sharper than 1:1 so the glyphs stay crisp on any display
        resolution: (window.devicePixelRatio || 1) * 2,
        style: {
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          fontSize: 11,
          fontWeight: '600',
          fill: 0xeaf2ef,
        },
      });
      text.anchor.set(0.5);

      const w = text.width + 10;
      const h = text.height + 6;
      const chip = new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 4)
        .fill({ color: 0x17171c, alpha: 0.92 })
        .stroke({ color: 0xff9f1c, width: 1 });

      label.addChild(chip, text);
      label.position.set(pin.x + ux * (28 + w / 4), pin.y + uy * 28);
      layer.addChild(label);
    }
    return layer;
  }

  protected drawPins(): void {
    for (const view of this.pinViews) view.refresh();
    const g = this.pinLayer;
    g.clear();
    if (this.selected) {
      const b = this.getLocalBounds();
      g.rect(b.x - 4, b.y - 4, b.width + 8, b.height + 8).stroke({
        color: COLOR_SELECT,
        width: 1,
      });
    }
  }

  // ---------- dragging ----------

  private onDragStart = (e: FederatedPointerEvent) => {
    if (!this.parent) return;
    e.stopPropagation(); // don't pan the viewport underneath
    const local = this.parent.toLocal(e.global);
    this.dragOffset = { x: local.x - this.x, y: local.y - this.y };
  };

  private onDragMove = (e: FederatedPointerEvent) => {
    if (!this.dragOffset || !this.parent) return;
    const local = this.parent.toLocal(e.global);
    const x = local.x - this.dragOffset.x;
    const y = local.y - this.dragOffset.y;
    this.position.set(
      this.viewport ? this.viewport.snap(x) : x,
      this.viewport ? this.viewport.snap(y) : y,
    );
  };

  private onDragEnd = () => {
    this.dragOffset = null;
  };

  override destroy(...args: Parameters<Container['destroy']>): void {
    this.viewport?.app.ticker?.remove(this.updateLabelScale);
    super.destroy(...args);
  }
}

/**
 * Interactive terminal dot: crosshair cursor + amber highlight on hover,
 * reports pointerdown to the owning component for wiring.
 */
class PinView extends Graphics {
  readonly pin: Pin;
  private hovered = false;

  constructor(
    pin: Pin,
    onDown: (pin: Pin, e: FederatedPointerEvent) => void,
    onHover?: (hovered: boolean) => void,
  ) {
    super();
    this.pin = pin;
    this.position.set(pin.x, pin.y);
    this.eventMode = 'static';
    this.cursor = 'crosshair';
    this.hitArea = new Circle(0, 0, 10);
    this.on('pointerover', () => {
      this.hovered = true;
      this.refresh();
      onHover?.(true);
    });
    this.on('pointerout', () => {
      this.hovered = false;
      this.refresh();
      onHover?.(false);
    });
    this.on('pointerdown', (e: FederatedPointerEvent) => onDown(pin, e));
    this.refresh();
  }

  refresh(): void {
    this.clear();
    if (this.hovered) {
      this.circle(0, 0, 9).stroke({ color: COLOR_PIN, width: 2 });
      this.circle(0, 0, 5).fill(COLOR_PIN);
    } else {
      this.circle(0, 0, 4.5).fill(this.pin.net ? COLOR_PIN : COLOR_PIN_IDLE);
    }
  }
}
