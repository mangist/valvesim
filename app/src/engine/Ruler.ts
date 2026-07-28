import { Container, Graphics, Text } from 'pixi.js';
import { PIXELS_PER_INCH } from './units';

const SIZE = 24; // ruler strip thickness, screen px
const COLOR_BG = 0x26262e;
const COLOR_BORDER = 0x33333d;
const COLOR_TICK = 0x6a6f7a;
const COLOR_TEXT = 0x9a9aa5;

/**
 * Screen-space inch rulers along the top and left canvas edges.
 * Ticks track the world transform (pan/zoom); labels are whole inches.
 */
export class Ruler {
  readonly container = new Container();

  private gfx = new Graphics();
  private hTexts: Text[] = [];
  private vTexts: Text[] = [];

  constructor() {
    this.container.eventMode = 'none'; // never intercept canvas input
    this.container.addChild(this.gfx);
  }

  update(
    screen: { width: number; height: number },
    worldPos: { x: number; y: number },
    zoom: number,
  ): void {
    const g = this.gfx;
    g.clear();

    // strips + corner
    g.rect(0, 0, screen.width, SIZE).fill(COLOR_BG);
    g.rect(0, 0, SIZE, screen.height).fill(COLOR_BG);
    g.moveTo(0, SIZE).lineTo(screen.width, SIZE).stroke({ color: COLOR_BORDER, width: 1 });
    g.moveTo(SIZE, 0).lineTo(SIZE, screen.height).stroke({ color: COLOR_BORDER, width: 1 });

    const step = PIXELS_PER_INCH * zoom; // screen px per inch
    // label every whole inch while they fit, else every 2nd/5th/10th…
    const labelEvery = step >= 34 ? 1 : step >= 17 ? 2 : step >= 7 ? 5 : 10;

    let h = 0;
    let v = 0;

    // horizontal ticks
    const iMinX = Math.ceil((SIZE - worldPos.x) / step);
    const iMaxX = Math.floor((screen.width - worldPos.x) / step);
    for (let i = iMinX; i <= iMaxX; i++) {
      const x = worldPos.x + i * step;
      const labeled = i % labelEvery === 0;
      g.moveTo(x, labeled ? SIZE - 10 : SIZE - 5).lineTo(x, SIZE);
      if (labeled) {
        const t = this.text(this.hTexts, h++);
        t.text = String(i);
        t.position.set(x + 3, 2);
      }
      // half-inch tick when there's room
      if (step >= 50 && x + step / 2 < screen.width) {
        g.moveTo(x + step / 2, SIZE - 4).lineTo(x + step / 2, SIZE);
      }
    }

    // vertical ticks
    const iMinY = Math.ceil((SIZE - worldPos.y) / step);
    const iMaxY = Math.floor((screen.height - worldPos.y) / step);
    for (let i = iMinY; i <= iMaxY; i++) {
      const y = worldPos.y + i * step;
      const labeled = i % labelEvery === 0;
      g.moveTo(labeled ? SIZE - 10 : SIZE - 5, y).lineTo(SIZE, y);
      if (labeled) {
        const t = this.text(this.vTexts, v++);
        t.text = String(i);
        t.position.set(2, y + 2);
      }
      if (step >= 50 && y + step / 2 < screen.height) {
        g.moveTo(SIZE - 4, y + step / 2).lineTo(SIZE, y + step / 2);
      }
    }

    g.stroke({ color: COLOR_TICK, pixelLine: true });

    // corner square masks tick overflow
    g.rect(0, 0, SIZE, SIZE).fill(COLOR_BG);
    g.moveTo(0, SIZE).lineTo(SIZE, SIZE).stroke({ color: COLOR_BORDER, width: 1 });
    g.moveTo(SIZE, 0).lineTo(SIZE, SIZE).stroke({ color: COLOR_BORDER, width: 1 });

    for (let i = h; i < this.hTexts.length; i++) this.hTexts[i].visible = false;
    for (let i = v; i < this.vTexts.length; i++) this.vTexts[i].visible = false;
  }

  /** Pooled tick labels — reused across redraws (pan redraws every frame). */
  private text(pool: Text[], index: number): Text {
    let t = pool[index];
    if (!t) {
      t = new Text({
        text: '',
        resolution: (window.devicePixelRatio || 1) * 2,
        style: {
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          fontSize: 9,
          fill: COLOR_TEXT,
        },
      });
      pool.push(t);
      this.container.addChild(t);
    }
    t.visible = true;
    return t;
  }
}
