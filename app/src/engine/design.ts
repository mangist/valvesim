/**
 * Design-file format: the complete canvas serialized as JSON.
 *
 * The per-instance shapes are exactly what PlacedComponent.toJSON() and
 * PlacedWire.toJSON() already produce (guid, componentId, refDes, label,
 * position, params, pin nets / wire attachments) — the same payload the
 * future PostgreSQL designs.schematic JSONB column will store.
 */
import type { PlacedComponent } from './PlacedComponent';
import type { PlacedWire } from './PlacedWire';

export type SavedComponent = ReturnType<PlacedComponent['toJSON']>;
export type SavedWire = ReturnType<PlacedWire['toJSON']>;

export interface DesignFile {
  format: 'valvesim-design';
  version: 1;
  savedAt: string;
  components: SavedComponent[];
  wires: SavedWire[];
}

export function buildDesignFile(
  components: Iterable<PlacedComponent>,
  wires: Iterable<PlacedWire>,
): DesignFile {
  return {
    format: 'valvesim-design',
    version: 1,
    savedAt: new Date().toISOString(),
    components: [...components].map((c) => c.toJSON()),
    wires: [...wires].map((w) => w.toJSON()),
  };
}

/** Parse + validate a design file; throws with a readable message. */
export function parseDesignFile(text: string): DesignFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  const design = raw as Partial<DesignFile>;
  if (design?.format !== 'valvesim-design') {
    throw new Error('not a Valvesim design file (missing format marker)');
  }
  if (design.version !== 1) {
    throw new Error(`unsupported design version: ${String(design.version)}`);
  }
  if (!Array.isArray(design.components) || !Array.isArray(design.wires)) {
    throw new Error('malformed design file (components/wires missing)');
  }
  return design as DesignFile;
}
