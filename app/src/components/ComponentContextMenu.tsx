import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

interface ComponentContextMenuProps {
  /** Anchor position in viewport (client) coordinates — where the user right-clicked. */
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Right-click component menu: currently just "Delete" (removes the
 * component and every wire attached to it) — a right-click replaces the
 * old hover "×" button, which was unreachable near the component's edge
 * (moving the mouse toward it left the component's own hover bounds
 * first). Same interaction pattern as WireContextMenu/PinContextMenu.
 */
export function ComponentContextMenu({ x, y, onDelete, onClose }: ComponentContextMenuProps) {
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
    // Deferred: the right-click that opens this menu is a native
    // pointerdown still bubbling to `window` when this effect runs —
    // attaching immediately would let it catch that same opening click
    // and close the menu instantly (see WireContextMenu/PinContextMenu).
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // Keep the menu on-screen even when the right-click lands near an edge.
  const left = Math.min(x, window.innerWidth - 160);
  const top = Math.min(y, window.innerHeight - 60);

  return (
    <div
      ref={rootRef}
      className="vs-pin-menu"
      style={{ '--vs-menu-x': `${left}px`, '--vs-menu-y': `${top}px` } as CSSProperties}
    >
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
