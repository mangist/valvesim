/**
 * Wire type/gauge catalog for the right-click pin menu.
 *
 * "Rigid" wire (bus wire / tinned solid-core) doesn't have its own
 * physics yet — it's created as an ordinary Verlet wire for now, with
 * `kind` recorded so the future stiff/straight behavior can key off it.
 */
export type WireKind = 'loose' | 'rigid';

export const WIRE_KINDS: Array<{ kind: WireKind; label: string }> = [
  { kind: 'loose', label: 'Loose' },
  { kind: 'rigid', label: 'Rigid' },
];

/** 6 common hookup-wire gauges, thin to thick. */
export const COMMON_AWG_GAUGES = [24, 22, 20, 18, 16, 14] as const;
export type WireGaugeAwg = (typeof COMMON_AWG_GAUGES)[number];

export const DEFAULT_WIRE_GAUGE_AWG: WireGaugeAwg = 22;
export const DEFAULT_WIRE_KIND: WireKind = 'loose';

/**
 * On-screen stroke width (px, at zoom 1) for a given gauge — thicker
 * wire reads as a thicker line. Purely cosmetic.
 */
export function gaugeStrokeWidth(awg: number): number {
  // 24 AWG -> 2.2px … 14 AWG -> 6px, evenly spaced across the common range.
  const t = (24 - awg) / (24 - 14);
  return 2.2 + t * 3.8;
}
