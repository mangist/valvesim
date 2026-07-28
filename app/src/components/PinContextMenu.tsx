import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { COMMON_AWG_GAUGES, WIRE_KINDS, DEFAULT_WIRE_GAUGE_AWG, type WireKind } from '../engine/wireGauges';

interface PinContextMenuProps {
  /** Anchor position in viewport (client) coordinates — where the user right-clicked. */
  x: number;
  y: number;
  onSelect: (kind: WireKind, gaugeAwg: number) => void;
  onClose: () => void;
}

/**
 * Right-click pin menu: choose "Loose" or "Rigid", each with a submenu of
 * 6 common AWG gauges. Clicking the top-level item itself (not a gauge)
 * uses the default gauge — matches a plain left-click wire start.
 */
export function PinContextMenu({ x, y, onSelect, onClose }: PinContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Bubble-phase + containment check: clicks inside the menu (including
    // the submenu) keep working; anything else closes it.
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // Keep the menu on-screen even when the right-click lands near an edge.
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 100);

  return (
    <div
      ref={rootRef}
      className="vs-pin-menu"
      style={{ '--vs-menu-x': `${left}px`, '--vs-menu-y': `${top}px` } as CSSProperties}
    >
      {WIRE_KINDS.map(({ kind, label }) => (
        <div
          key={kind}
          className="vs-pin-menu-item"
          onClick={() => onSelect(kind, DEFAULT_WIRE_GAUGE_AWG)}
        >
          <span>{label}</span>
          <span className="vs-pin-menu-arrow">›</span>

          <div className="vs-pin-submenu">
            {COMMON_AWG_GAUGES.map((awg) => (
              <div
                key={awg}
                className="vs-pin-submenu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(kind, awg);
                }}
              >
                {awg} AWG
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
