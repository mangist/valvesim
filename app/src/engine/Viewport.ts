import { Application, Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { Ruler } from './Ruler';

/** Theme colors (Retro Filament Glow) */
const COLOR_BG = 0x2a2a2c; // Neutral Charcoal Gray
const COLOR_GRID = 0x38383a; // Muted Gunmetal
const COLOR_GRID_MAJOR = 0x46464a;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;

/**
 * Schematic viewport: owns the Pixi Application, an infinite pan/zoom
 * world container, and the background grid.
 *
 * Components and wires are added to `world` so they inherit the
 * viewport transform.
 */
export class Viewport {
  readonly app = new Application();

  /** Transformed container that all schematic content lives in. */
  readonly world = new Container();

  /** Snap resolution in world units. */
  gridSize = 20;

  /**
   * While true, the viewport ignores pan/zoom input — set during palette
   * drags so stray pointer events can't move the world under the drop.
   */
  interactionLocked = false;

  private grid = new Graphics();
  private ruler = new Ruler();
  private host: HTMLElement | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: COLOR_BG,
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      // WebGPU with automatic WebGL/canvas fallback
      preference: 'webgpu',
    });

    // init() is async — the host may unmount (React strict-mode) before it settles
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }

    this.host = host;
    host.appendChild(this.app.canvas);

    this.app.stage.addChild(this.grid);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.ruler.container);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', this.onPointerDown);
    this.app.stage.on('pointermove', this.onPointerMove);
    this.app.stage.on('pointerup', this.onPointerUp);
    this.app.stage.on('pointerupoutside', this.onPointerUp);
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Right-click drives the pin wire-type menu, not the OS/browser context menu
    this.app.canvas.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.drawGrid());
    this.resizeObserver.observe(host);

    this.drawGrid();
  }

  /** Convert a screen-space point to world (schematic) coordinates. */
  toWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.world.position.x) / this.world.scale.x,
      y: (y - this.world.position.y) / this.world.scale.y,
    };
  }

  /** Snap a world coordinate to the schematic grid. */
  snap(v: number): number {
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  /** Change the grid resolution and redraw. */
  setGridSize(size: number): void {
    this.gridSize = Math.max(1, size);
    this.drawGrid();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.app.renderer) {
      this.app.canvas.removeEventListener('wheel', this.onWheel);
      this.app.canvas.removeEventListener('contextmenu', this.onContextMenu);
      this.app.destroy(true, { children: true });
    }
    this.host = null;
  }

  // ---------- pan ----------

  /** Lock or unlock pan/zoom (also cancels any pan in progress). */
  setInteractionLocked(locked: boolean): void {
    this.interactionLocked = locked;
    if (locked) this.dragging = false;
  }

  private onPointerDown = (e: FederatedPointerEvent) => {
    if (this.interactionLocked) return;
    // Pan on empty canvas; components stop propagation for their own drag
    this.dragging = true;
    this.lastPointer = { x: e.global.x, y: e.global.y };
  };

  private onPointerMove = (e: FederatedPointerEvent) => {
    if (!this.dragging) return;
    const dx = e.global.x - this.lastPointer.x;
    const dy = e.global.y - this.lastPointer.y;
    this.lastPointer = { x: e.global.x, y: e.global.y };
    this.world.position.x += dx;
    this.world.position.y += dy;
    this.drawGrid();
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  // ---------- zoom ----------

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.interactionLocked) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.world.scale.x * factor));
    const applied = next / this.world.scale.x;

    // Zoom about the cursor position
    this.world.position.x = px - (px - this.world.position.x) * applied;
    this.world.position.y = py - (py - this.world.position.y) * applied;
    this.world.scale.set(next);

    this.drawGrid();
  };

  // ---------- grid ----------

  /** Redraw the screen-space grid to match the current world transform. */
  private drawGrid(): void {
    if (!this.host || !this.app.renderer) return;

    const { width, height } = this.app.screen;
    const scale = this.world.scale.x;
    const step = this.gridSize * scale;
    const g = this.grid;
    g.clear();

    // Hide the minor grid when it gets too dense to read
    if (step >= 6) {
      const ox = ((this.world.position.x % step) + step) % step;
      const oy = ((this.world.position.y % step) + step) % step;
      for (let x = ox; x <= width; x += step) {
        g.moveTo(x, 0).lineTo(x, height);
      }
      for (let y = oy; y <= height; y += step) {
        g.moveTo(0, y).lineTo(width, y);
      }
      g.stroke({ color: COLOR_GRID, pixelLine: true });
    }

    // Major grid every 5 cells
    const major = step * 5;
    const mox = ((this.world.position.x % major) + major) % major;
    const moy = ((this.world.position.y % major) + major) % major;
    for (let x = mox; x <= width; x += major) {
      g.moveTo(x, 0).lineTo(x, height);
    }
    for (let y = moy; y <= height; y += major) {
      g.moveTo(0, y).lineTo(width, y);
    }
    g.stroke({ color: COLOR_GRID_MAJOR, pixelLine: true });

    // inch rulers track the same transform
    this.ruler.update(this.app.screen, this.world.position, scale);
  }
}
