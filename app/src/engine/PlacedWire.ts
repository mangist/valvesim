import { Wire, type WireAnchor } from './Wire';
import { DEFAULT_WIRE_GAUGE_AWG, type WireKind } from './wireGauges';
import type { ComponentModel } from '../library';

/** A wire endpoint's electrical attachment (component pin), when connected. */
export interface WireAttachment {
  componentGuid: string;
  pinId: string;
}

/**
 * A wire instanced onto the canvas: Verlet-physics Wire plus the catalog
 * reference, a persistent GUID (assigned at creation, for the designs
 * JSONB store), and endpoint attachment metadata.
 */
export class PlacedWire extends Wire {
  readonly guid: string;
  readonly model: ComponentModel;
  refDes = '';

  /** Pin the wire started from. */
  from: WireAttachment | null = null;
  /** Pin the wire ends on (null until wiring-to-pin locking lands). */
  to: WireAttachment | null = null;

  constructor(
    model: ComponentModel,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    guid: string = crypto.randomUUID(),
  ) {
    super(x1, y1, x2, y2);
    this.model = model;
    this.guid = guid;
    this.gaugeAwg = DEFAULT_WIRE_GAUGE_AWG;
  }

  /** Serializable state (schematic JSONB shape for save/load). */
  toJSON(): {
    guid: string;
    componentId: string;
    refDes: string;
    kind: WireKind;
    gaugeAwg: number;
    net: string | null;
    from: WireAttachment | null;
    to: WireAttachment | null;
    endpoints: Array<{ x: number; y: number }>;
    anchors: WireAnchor[];
  } {
    return {
      guid: this.guid,
      componentId: this.model.id,
      refDes: this.refDes,
      kind: this.kind,
      gaugeAwg: this.gaugeAwg,
      net: this.net,
      from: this.from,
      to: this.to,
      endpoints: this.endpoints,
      anchors: this.getAnchors(),
    };
  }
}
