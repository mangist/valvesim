import { Container, Graphics, Text } from 'pixi.js';

/**
 * Live CRT-style trace + stats readout for the Oscilloscope component,
 * fitted into its symbol's `id="scope-screen"` window by PlacedComponent.
 * Fed raw (time, voltage) samples from the background solver each tick —
 * see `readWaveforms` in simulation/liveMeters.ts.
 *
 * The timebase always frames the last 3 periods of the measured signal
 * (period found via zero-crossing of the AC component). The vertical
 * scale has two modes (toggled by PlacedComponent's on-screen switch):
 * "auto" fits the full peak-to-peak swing to 80% of the screen height
 * (great for looking at a signal on its own terms, but zooms a small
 * ripple riding on a large DC level into an unreadable full-height
 * squiggle); "fixed" uses a constant 1V/division instead, so a well-
 * filtered DC supply reads as a flat line with visible mV-scale ripple.
 * Both modes center on the signal's mean (DC) level.
 */

const TRACE_COLOR = 0x39ff6a; // phosphor green
const GRID_COLOR = 0x1c3a24;
const GRID_COLOR_MAJOR = 0x2c5a38;
const SCREEN_BG = 0x081208;
const STATS_COLOR = 0x39ff6a;

const GRID_COLS = 10;
const GRID_ROWS = 8;

/** Fixed-scale mode's constant volts-per-division. */
const FIXED_VOLTS_PER_DIV = 1;

export type ScopeYMode = 'auto' | 'fixed';

/** Compact fixed-format voltage string: "118.4V", "12.3mV", etc. */
function formatVolts(v: number): string {
  const av = Math.abs(v);
  if (!Number.isFinite(v)) return '--';
  if (av >= 100) return `${v.toFixed(1)}V`;
  if (av >= 1) return `${v.toFixed(2)}V`;
  return `${(v * 1000).toFixed(1)}mV`;
}

export class OscilloscopeDisplay extends Container {
  private readonly screenW: number;
  private readonly screenH: number;
  private readonly backdrop = new Graphics();
  private readonly trace = new Graphics();
  private readonly statsText: Text;
  private yMode: ScopeYMode = 'auto';
  private lastTime: number[] = [];
  private lastValues: number[] = [];

  constructor(screenWidth: number, screenHeight: number) {
    super();
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.eventMode = 'none'; // display only — never intercepts the pointer

    this.addChild(this.backdrop);
    this.addChild(this.trace);
    // Clip the trace to the CRT bounds — in fixed 1V/div mode a signal
    // wider than the division range would otherwise be drawn straight
    // over the bezel/stats instead of clipping at the screen edge like a
    // real scope.
    const clip = new Graphics().rect(0, 0, screenWidth, screenHeight).fill(0xffffff);
    this.addChild(clip);
    this.trace.mask = clip;

    this.statsText = new Text({
      text: '',
      resolution: (window.devicePixelRatio || 1) * 2,
      style: {
        fontFamily: "'Consolas', 'Menlo', monospace",
        fontSize: screenHeight * 0.042,
        fontWeight: '600',
        fill: STATS_COLOR,
        lineHeight: screenHeight * 0.055,
      },
    });
    this.statsText.position.set(screenWidth * 0.63, screenHeight * 0.035);
    this.addChild(this.statsText);

    this.drawGrid();
    this.update([], []);
  }

  /** Total panel size (for callers fitting/positioning the display). */
  get panelWidth(): number {
    return this.screenW;
  }

  get panelHeight(): number {
    return this.screenH;
  }

  getYMode(): ScopeYMode {
    return this.yMode;
  }

  /** Switch vertical scale mode and immediately redraw the last waveform with it. */
  setYMode(mode: ScopeYMode): void {
    if (this.yMode === mode) return;
    this.yMode = mode;
    this.update(this.lastTime, this.lastValues);
  }

  private drawGrid(): void {
    this.backdrop.clear().rect(0, 0, this.screenW, this.screenH).fill(SCREEN_BG);
    for (let i = 0; i <= GRID_COLS; i++) {
      const x = (i / GRID_COLS) * this.screenW;
      const major = i % 5 === 0;
      this.backdrop
        .moveTo(x, 0)
        .lineTo(x, this.screenH)
        .stroke({ color: major ? GRID_COLOR_MAJOR : GRID_COLOR, width: major ? 1.5 : 1 });
    }
    for (let j = 0; j <= GRID_ROWS; j++) {
      const y = (j / GRID_ROWS) * this.screenH;
      const major = j % 4 === 0;
      this.backdrop
        .moveTo(0, y)
        .lineTo(this.screenW, y)
        .stroke({ color: major ? GRID_COLOR_MAJOR : GRID_COLOR, width: major ? 1.5 : 1 });
    }
  }

  /** Feed a fresh solver waveform (time in seconds, values in volts). */
  update(time: number[], values: number[]): void {
    this.lastTime = time;
    this.lastValues = values;
    this.trace.clear();
    if (time.length < 4 || values.length !== time.length) {
      this.statsText.text = 'VRMS  --\nVPP   --\nRIPPLE --\nFREQ  --';
      return;
    }

    const n = time.length;
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / n;
    const vrms = Math.sqrt(sumSq / n);
    const vpp = max - min;
    let acSumSq = 0;
    for (let i = 0; i < n; i++) {
      const d = values[i] - mean;
      acSumSq += d * d;
    }
    const rippleRms = Math.sqrt(acSumSq / n);
    const freqHz = estimateFrequency(time, values, mean);

    // Timebase: frame the last 3 measured periods (or the whole captured
    // tail if a period couldn't be determined, e.g. too few cycles yet).
    const tEnd = time[n - 1];
    const tStart0 = time[0];
    const period = freqHz > 0 ? 1 / freqHz : tEnd - tStart0;
    const span = Math.min(tEnd - tStart0, period * 3);
    const tStart = tEnd - span;

    let startIdx = 0;
    while (startIdx < n - 1 && time[startIdx] < tStart) startIdx++;

    // Vertical scale, centered on the mean: "auto" fits Vpp to 80% of the
    // screen height; "fixed" holds a constant 1V/division regardless of
    // the signal, so a small ripple on a large DC level reads as a flat
    // line instead of filling the whole screen.
    let voltsPerPx: number;
    if (this.yMode === 'fixed') {
      const pxPerDiv = this.screenH / GRID_ROWS;
      voltsPerPx = FIXED_VOLTS_PER_DIV / pxPerDiv;
    } else {
      const usablePx = this.screenH * 0.8;
      voltsPerPx = vpp > 1e-9 ? vpp / usablePx : 1;
    }
    const midY = this.screenH / 2;
    const xForT = (t: number) => ((t - tStart) / span) * this.screenW;
    const yForV = (v: number) => midY - (v - mean) / voltsPerPx;

    this.trace.moveTo(xForT(time[startIdx]), yForV(values[startIdx]));
    for (let i = startIdx + 1; i < n; i++) {
      this.trace.lineTo(xForT(time[i]), yForV(values[i]));
    }
    this.trace.stroke({
      color: TRACE_COLOR,
      width: Math.max(1.5, this.screenH * 0.005),
      join: 'round',
      cap: 'round',
    });

    this.statsText.text =
      `VRMS   ${formatVolts(vrms)}\n` +
      `VPP    ${formatVolts(vpp)}\n` +
      `RIPPLE ${formatVolts(rippleRms)}\n` +
      `FREQ   ${freqHz > 0 ? `${freqHz.toFixed(1)}Hz` : '--'}`;
  }
}

/** Average period between rising zero-crossings of the AC (mean-removed) signal. */
function estimateFrequency(time: number[], values: number[], mean: number): number {
  const crossings: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] - mean;
    const b = values[i] - mean;
    if (a < 0 && b >= 0) {
      const t = time[i - 1] + (time[i] - time[i - 1]) * (-a / (b - a));
      crossings.push(t);
    }
  }
  if (crossings.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < crossings.length; i++) sum += crossings[i] - crossings[i - 1];
  const avgPeriod = sum / (crossings.length - 1);
  return avgPeriod > 0 ? 1 / avgPeriod : 0;
}
