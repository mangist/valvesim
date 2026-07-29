import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { COMMON_AWG_GAUGES, WIRE_KINDS, type WireKind } from '../engine/wireGauges';

interface WireContextMenuProps {
  /** Anchor position in viewport (client) coordinates — where the user right-clicked. */
  x: number;
  y: number;
  gaugeAwg: number;
  onSelectKind: (kind: WireKind) => void;
  onSelectGauge: (kind: WireKind, gaugeAwg: number) => void;
  onAddAnchor: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Right-click wire menu: switch Loose/Rigid (each with an AWG-gauge
 * submenu that also picks the gauge), add a bend/anchor point at the
 * click location, or delete the wire. Same interaction pattern as
 * PinContextMenu.
 */
export function WireContextMenu({
  x,
  y,
  gaugeAwg,
  onSelectKind,
  onSelectGauge,
  onAddAnchor,
  onDelete,
  onClose,
}: WireContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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
  const top = Math.min(y, window.innerHeight - 180);

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
          onClick={() => {
            onSelectKind(kind);
            onClose();
          }}
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
                  onSelectGauge(kind, awg);
                  onClose();
                }}
              >
                {awg} AWG{awg === gaugeAwg ? ' ✓' : ''}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="vs-menu-divider" />

      <div
        className="vs-pin-menu-item"
        onClick={() => {
          onAddAnchor();
          onClose();
        }}
      >
        <span>Add anchor</span>
      </div>

      <div className="vs-menu-divider" />

      <div
        className="vs-pin-menu-item vs-menu-item-danger"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <span>Delete</span>
      </div>
    </div>
  );
}
