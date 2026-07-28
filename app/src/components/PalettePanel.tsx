import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { getComponentLibrary, type ComponentModel } from '../library';
import { ComponentType } from '../library/types';
import type { CapacitorProperties, ResistorProperties } from '../library/types';
import { CAPACITOR_SUBCATEGORIES, RESISTOR_SUBCATEGORIES } from '../library/passiveValues';

export type PlaceHandler = (
  model: ComponentModel,
  clientPoint: { x: number; y: number } | null,
) => void;

/** Fires when the user picks "New…" at the bottom of a value submenu. */
export type NewComponentHandler = (type: 'capacitor' | 'resistor', subcategoryLabel: string) => void;

interface PalettePanelProps {
  /** Called with null for a single click (drop at view center) or with the drop point for a drag. */
  onPlace?: PlaceHandler;
  /** Fires when a palette drag starts/ends (used to lock viewport panning). */
  onDragStateChange?: (dragging: boolean) => void;
  /** Fires when "New…" is picked in a capacitor/resistor value submenu. */
  onNewComponent?: NewComponentHandler;
}

/** Pixels of pointer travel before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 5;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = map.get(k) ?? [];
    group.push(item);
    map.set(k, group);
  }
  return map;
}

/**
 * Component palette: library components grouped by category.
 * Single click drops an instance at the center of the canvas view;
 * click-drag picks the component up and places it at the drop point.
 *
 * Capacitors and resistors are hierarchical: hovering the "Capacitors"/
 * "Resistors" entry flies out a submenu of construction subcategories
 * (electrolytic/ceramic/film, carbon comp/film, metal film, wirewound),
 * hovering a subcategory flies out its 10 common tube-amp values plus
 * a trailing "New…" entry for a custom value.
 */
export function PalettePanel({ onPlace, onDragStateChange, onNewComponent }: PalettePanelProps) {
  const components = getComponentLibrary().filter((c) => c.type !== ComponentType.Wire);

  const capacitors = components.filter((c) => c.type === ComponentType.Capacitor);
  const resistors = components.filter((c) => c.type === ComponentType.Resistor);
  const flatComponents = components.filter(
    (c) => c.type !== ComponentType.Capacitor && c.type !== ComponentType.Resistor,
  );

  const capacitorsByDielectric = groupBy(
    capacitors,
    (c) => (c.properties as CapacitorProperties).dielectric ?? 'other',
  );
  const resistorsByType = groupBy(
    resistors,
    (c) => (c.properties as ResistorProperties).resistorType ?? 'other',
  );

  const byCategory = new Map<string, ComponentModel[]>();
  for (const c of flatComponents) {
    const group = byCategory.get(c.category) ?? [];
    group.push(c);
    byCategory.set(c.category, group);
  }

  if (components.length === 0) {
    return <div className="vs-palette-empty">Component library is empty.</div>;
  }

  return (
    <div>
      {[...byCategory.entries()].map(([category, items]) => (
        <div key={category}>
          <h3 className="vs-palette-category">{category}</h3>
          {items.map((c) => (
            <PaletteItem
              key={c.id}
              component={c}
              onPlace={onPlace}
              onDragStateChange={onDragStateChange}
            />
          ))}
        </div>
      ))}

      <div>
        <h3 className="vs-palette-category">Passive Components</h3>
        <Branch label="Capacitors" icon={<RectangleIcon />}>
          {CAPACITOR_SUBCATEGORIES.map((sub) => {
            const subItems = capacitorsByDielectric.get(sub.key) ?? [];
            // Electrolytics span both lead styles — split into an
            // Axial/Radial sub-menu before showing values.
            if (sub.key === 'electrolytic') {
              const byOrientation = groupBy(
                subItems,
                (c) => (c.properties as CapacitorProperties).orientation ?? 'other',
              );
              return (
                <Branch key={sub.key} label={sub.label}>
                  {(['axial', 'radial'] as const).map((orientation) => (
                    <Branch
                      key={orientation}
                      label={orientation === 'axial' ? 'Axial' : 'Radial'}
                    >
                      {(byOrientation.get(orientation) ?? []).map((c) => (
                        <PaletteItem
                          key={c.id}
                          component={c}
                          onPlace={onPlace}
                          onDragStateChange={onDragStateChange}
                        />
                      ))}
                      <NewComponentItem
                        onClick={() =>
                          onNewComponent?.(
                            'capacitor',
                            `${sub.label} (${orientation === 'axial' ? 'Axial' : 'Radial'})`,
                          )
                        }
                      />
                    </Branch>
                  ))}
                </Branch>
              );
            }
            return (
              <Branch key={sub.key} label={sub.label}>
                {subItems.map((c) => (
                  <PaletteItem
                    key={c.id}
                    component={c}
                    onPlace={onPlace}
                    onDragStateChange={onDragStateChange}
                  />
                ))}
                <NewComponentItem onClick={() => onNewComponent?.('capacitor', sub.label)} />
              </Branch>
            );
          })}
        </Branch>
        <Branch label="Resistors" icon={<RectangleIcon />}>
          {RESISTOR_SUBCATEGORIES.map((sub) => (
            <Branch key={sub.key} label={sub.label}>
              {(resistorsByType.get(sub.key) ?? []).map((c) => (
                <PaletteItem
                  key={c.id}
                  component={c}
                  onPlace={onPlace}
                  onDragStateChange={onDragStateChange}
                />
              ))}
              <NewComponentItem onClick={() => onNewComponent?.('resistor', sub.label)} />
            </Branch>
          ))}
        </Branch>
      </div>
    </div>
  );
}

/**
 * A hoverable menu row that flies out a submenu of its children, anchored
 * to its own right edge in fixed (viewport) coordinates so the flyout
 * escapes the sidebar's scroll/overflow clipping.
 */
function Branch({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const open = () => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  };
  const close = () => setRect(null);

  return (
    <div
      ref={ref}
      className="vs-palette-item vs-palette-branch"
      onMouseEnter={open}
      onMouseLeave={close}
    >
      {icon && <span className="vs-palette-item-icon">{icon}</span>}
      <span className="vs-palette-item-name">{label}</span>
      <span className="vs-palette-branch-arrow" aria-hidden="true">
        &rsaquo;
      </span>

      {rect && (
        <div
          className="vs-flyout"
          style={{ left: rect.right, top: rect.top }}
          onMouseEnter={open}
          onMouseLeave={close}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function NewComponentItem({ onClick }: { onClick: () => void }) {
  return (
    <div className="vs-palette-item vs-palette-new" onClick={onClick}>
      <span className="vs-palette-item-name">New…</span>
    </div>
  );
}

function PaletteItem({
  component,
  onPlace,
  onDragStateChange,
}: {
  component: ComponentModel;
  onPlace?: PlaceHandler;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const { definition } = component;
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start || e.pointerId !== start.pointerId) return;
    if (
      ghost ||
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD
    ) {
      if (!ghost) onDragStateChange?.(true);
      setGhost({ x: e.clientX, y: e.clientY });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start || e.pointerId !== start.pointerId) return;
    press.current = null;
    if (ghost) {
      setGhost(null);
      onDragStateChange?.(false);
      // Drag: place at drop point (App cancels drops outside the canvas)
      onPlace?.(component, { x: e.clientX, y: e.clientY });
    } else {
      // Click: drop at the center of the current view
      onPlace?.(component, null);
    }
  };

  const onPointerCancel = () => {
    press.current = null;
    setGhost(null);
    onDragStateChange?.(false);
  };

  return (
    <div
      className="vs-palette-item"
      title={definition.description ?? component.name}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="vs-palette-item-icon">
        <TypeIcon type={component.type} />
      </span>
      <span className="vs-palette-item-name">{component.name}</span>
      <span className="vs-palette-item-type">{component.type}</span>

      {ghost && (
        <div className="vs-drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {component.symbolUrl ? (
            <img src={component.symbolUrl} alt={component.name} draggable={false} />
          ) : (
            <span className="vs-drag-ghost-chip">{component.name}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'tube':
      return <TubeIcon />;
    case 'transformer':
      return <TransformerIcon />;
    case 'ac-inlet':
      return <AcInletIcon />;
    case 'resistor':
    case 'capacitor':
      return <RectangleIcon />;
    case 'meter':
      return <MeterIcon />;
    default:
      return null;
  }
}

/** Small digital panel-meter glyph: bezel with red 7-seg-style dashes. */
function MeterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="4" width="17" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="5" y1="9" x2="8" y2="9" stroke="#ff3b2b" strokeWidth="2" />
      <line x1="10" y1="9" x2="13" y2="9" stroke="#ff3b2b" strokeWidth="2" />
      <line x1="6" y1="14" x2="6" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="14" x2="14" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Generic leaded-part glyph: placeholder rectangle body with two leads. */
function RectangleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <line x1="0" y1="10" x2="5" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="15" y1="10" x2="20" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="4" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Small AC inlet glyph: plug prongs over a switch rocker. */
function AcInletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {/* panel body */}
      <rect x="2" y="2" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* IEC blade slots */}
      <rect x="6" y="5" width="2.5" height="5" fill="currentColor" />
      <rect x="11.5" y="5" width="2.5" height="5" fill="currentColor" />
      <circle cx="10" cy="13.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {/* rocker hint */}
      <line x1="5" y1="16.3" x2="9" y2="16.3" stroke="var(--vs-glow)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small transformer glyph: lamination frame, end bell, winding, feet. */
function TransformerIcon() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
      {/* lamination frame */}
      <rect x="3" y="2" width="14" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* end bell */}
      <rect x="6" y="5" width="8" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {/* winding hint */}
      <line x1="7" y1="12" x2="13" y2="12" stroke="var(--vs-glow)" strokeWidth="1.5" />
      <line x1="7" y1="14" x2="13" y2="14" stroke="var(--vs-glow)" strokeWidth="1.5" />
      {/* mounting feet */}
      <line x1="1" y1="20" x2="6" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="20" x2="19" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small vacuum-tube glyph: glass envelope, glowing filament, base pins. */
function TubeIcon() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
      {/* envelope */}
      <path
        d="M 3.5 15 L 3.5 6.5 Q 3.5 1.5 9 1.5 Q 14.5 1.5 14.5 6.5 L 14.5 15 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* filament */}
      <path
        d="M 6.5 12 L 6.5 7 Q 9 4.5 11.5 7 L 11.5 12"
        fill="none"
        stroke="var(--vs-glow)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* base + pins */}
      <rect x="2.5" y="15" width="13" height="3" rx="1" fill="currentColor" />
      <line x1="5.5" y1="18" x2="5.5" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="18" x2="9" y2="21" stroke="var(--vs-glow)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12.5" y1="18" x2="12.5" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
