import { Container, Graphics, Text } from 'pixi.js';

/**
 * Red 7-segment digital readout (4 digits + decimal points + unit
 * suffix), drawn with Pixi Graphics in the style of a classic LED panel
 * meter: dark window, bright-red lit segments, faint ghost segments.
 * Used by PlacedComponent for the AC inlet's current display and the
 * Voltmeter/Ammeter faces.
 */

const SEG_ON = 0xff3b2b;
const SEG_OFF = 0x33100c; // ghost of unlit segments, like a real LED display
const PANEL_BG = 0x100f0f;
const PANEL_BORDER = 0x3a3a42;

/** Segment bits: a=1 b=2 c=4 d=8 e=16 f=32 g=64 (standard layout). */
const SEG_BITS: Record<string, number> = {
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
  '-': 0b1000000,
  ' ': 0,
};

const DIGITS = 4;

/** Auto-ranged meter reading: "123.4" + "mA", "49.98" + "V", etc. */
export function formatMeterReading(value: number, baseUnit: 'A' | 'V'): { text: string; unit: string } {
  if (!Number.isFinite(value)) return { text: '----', unit: baseUnit };
  let v = Math.abs(value);
  let unit: string = baseUnit;
  if (baseUnit === 'A' && v < 1) {
    v *= 1000;
    unit = 'mA';
  }
  let text: string;
  if (v >= 10000) text = '9999';
  else if (v >= 1000) text = String(Math.round(v));
  else if (v >= 100) text = v.toFixed(1);
  else if (v >= 10) text = v.toFixed(2);
  else text = v.toFixed(3);
  return { text, unit };
}

export class SevenSegDisplay extends Container {
  private g = new Graphics();
  private unitText: Text;
  private currentText = '';

  /** Cell metrics, all derived from the digit height. */
  private readonly digitH: number;
  private readonly digitW: number;
  private readonly seg: number; // segment thickness
  private readonly dpW: number; // decimal-point slot after each digit
  private readonly pad: number;

  constructor(digitH = 56, unit = 'A') {
    super();
    this.digitH = digitH;
    this.digitW = digitH * 0.56;
    this.seg = digitH * 0.13;
    this.dpW = digitH * 0.18;
    this.pad = digitH * 0.22;

    this.eventMode = 'none'; // display only — never intercepts the pointer
    this.addChild(this.g);

    this.unitText = new Text({
      text: unit,
      resolution: (window.devicePixelRatio || 1) * 2,
      style: {
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: digitH * 0.45,
        fontWeight: '700',
        fill: SEG_ON,
      },
    });
    this.unitText.anchor.set(0, 1);
    this.unitText.position.set(
      this.pad + DIGITS * (this.digitW + this.dpW) + digitH * 0.08,
      this.pad + digitH,
    );
    this.addChild(this.unitText);

    this.setText('0.000');
  }

  setUnit(unit: string): void {
    if (this.unitText.text !== unit) this.unitText.text = unit;
  }

  /** Total panel size (for callers fitting the display into a window). */
  get panelWidth(): number {
    return this.pad * 2 + DIGITS * (this.digitW + this.dpW) + this.digitH * 0.08 + this.unitText.width;
  }

  get panelHeight(): number {
    return this.digitH + this.pad * 2;
  }

  /**
   * Show a numeric string, e.g. "50.00" / "123.4" / "----". Digits are
   * right-aligned into 4 cells; a '.' lights the decimal point of the
   * digit before it.
   */
  setText(text: string): void {
    if (text === this.currentText) return;
    this.currentText = text;

    // split into digit cells + dp flags, right-aligned
    const cells: Array<{ ch: string; dp: boolean }> = [];
    for (const ch of text) {
      if (ch === '.') {
        if (cells.length > 0) cells[cells.length - 1].dp = true;
      } else {
        cells.push({ ch, dp: false });
      }
    }
    while (cells.length < DIGITS) cells.unshift({ ch: ' ', dp: false });
    const shown = cells.slice(-DIGITS);

    const { g, digitW, digitH, seg, dpW, pad } = this;
    g.clear();
    g.roundRect(0, 0, this.panelWidth, this.panelHeight, digitH * 0.12)
      .fill(PANEL_BG)
      .stroke({ color: PANEL_BORDER, width: Math.max(1.5, digitH * 0.04) });

    for (let i = 0; i < DIGITS; i++) {
      const x = pad + i * (digitW + dpW);
      const y = pad;
      const bits = SEG_BITS[shown[i].ch] ?? 0;
      const half = (digitH - 3 * seg) / 2;
      const on = (bit: number) => ((bits & bit) !== 0 ? SEG_ON : SEG_OFF);

      // horizontals: a (top), g (middle), d (bottom)
      g.rect(x + seg * 0.8, y, digitW - seg * 1.6, seg).fill(on(1));
      g.rect(x + seg * 0.8, y + seg + half, digitW - seg * 1.6, seg).fill(on(64));
      g.rect(x + seg * 0.8, y + digitH - seg, digitW - seg * 1.6, seg).fill(on(8));
      // verticals: f (top-left), b (top-right), e (bottom-left), c (bottom-right)
      g.rect(x, y + seg * 0.9, seg, half).fill(on(32));
      g.rect(x + digitW - seg, y + seg * 0.9, seg, half).fill(on(2));
      g.rect(x, y + seg * 2.1 + half, seg, half).fill(on(16));
      g.rect(x + digitW - seg, y + seg * 2.1 + half, seg, half).fill(on(4));
      // decimal point in the slot after this digit
      g.circle(x + digitW + dpW * 0.5, y + digitH - seg * 0.5, seg * 0.5).fill(
        shown[i].dp ? SEG_ON : SEG_OFF,
      );
    }
  }
}
