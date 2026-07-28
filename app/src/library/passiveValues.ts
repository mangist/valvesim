/**
 * Generated catalog entries for common passive-component values.
 *
 * Resistors and capacitors are cheap to enumerate combinatorially (type x
 * subcategory x value) rather than hand-authoring 80+ near-identical
 * components.json blocks. Each subcategory lists the 10 values most
 * commonly seen in tube-amp schematics. Resistor symbols are a generic
 * two-lead placeholder until real reference art exists; capacitors use
 * axial/radial reference-photo symbols per their lead orientation.
 */
import { ComponentType, formatEng } from './types';
import type { CapacitorDefinition, ResistorDefinition, PinDefinition } from './types';

const TWO_LEAD_PINS: PinDefinition[] = [
  { number: '1', name: 'A', svgId: 'pin-1', terminal: '1' },
  { number: '2', name: 'B', svgId: 'pin-2', terminal: '2' },
];

export interface CapacitorSubcategory {
  key: string; // dielectric
  label: string;
  values: Array<{
    capacitance: number;
    voltageRating: number;
    orientation: 'axial' | 'radial' | 'film';
  }>;
}

export interface ResistorSubcategory {
  key: string; // resistorType
  label: string;
  values: Array<{ resistance: number; powerRating: number }>;
}

export const CAPACITOR_SUBCATEGORIES: CapacitorSubcategory[] = [
  {
    key: 'electrolytic',
    label: 'Electrolytic',
    values: [
      { capacitance: 1e-6, voltageRating: 50, orientation: 'radial' },
      { capacitance: 4.7e-6, voltageRating: 450, orientation: 'axial' },
      { capacitance: 10e-6, voltageRating: 25, orientation: 'radial' },
      { capacitance: 16e-6, voltageRating: 450, orientation: 'axial' },
      { capacitance: 22e-6, voltageRating: 25, orientation: 'radial' },
      { capacitance: 32e-6, voltageRating: 450, orientation: 'axial' },
      { capacitance: 47e-6, voltageRating: 25, orientation: 'radial' },
      { capacitance: 68e-6, voltageRating: 450, orientation: 'axial' },
      { capacitance: 100e-6, voltageRating: 350, orientation: 'axial' },
      { capacitance: 220e-6, voltageRating: 16, orientation: 'radial' },
    ],
  },
  {
    key: 'ceramic',
    label: 'Ceramic',
    values: [
      { capacitance: 100e-12, voltageRating: 500, orientation: 'radial' },
      { capacitance: 220e-12, voltageRating: 500, orientation: 'radial' },
      { capacitance: 470e-12, voltageRating: 500, orientation: 'radial' },
      { capacitance: 1e-9, voltageRating: 500, orientation: 'radial' },
      { capacitance: 2.2e-9, voltageRating: 500, orientation: 'radial' },
      { capacitance: 4.7e-9, voltageRating: 500, orientation: 'radial' },
      { capacitance: 10e-9, voltageRating: 50, orientation: 'radial' },
      { capacitance: 22e-9, voltageRating: 50, orientation: 'radial' },
      { capacitance: 47e-9, voltageRating: 50, orientation: 'radial' },
      { capacitance: 100e-9, voltageRating: 50, orientation: 'radial' },
    ],
  },
  {
    key: 'polyester-film',
    label: 'Polyester Film',
    values: [
      { capacitance: 1e-9, voltageRating: 600, orientation: 'film' },
      { capacitance: 2.2e-9, voltageRating: 600, orientation: 'film' },
      { capacitance: 4.7e-9, voltageRating: 600, orientation: 'film' },
      { capacitance: 10e-9, voltageRating: 600, orientation: 'film' },
      { capacitance: 22e-9, voltageRating: 600, orientation: 'film' },
      { capacitance: 33e-9, voltageRating: 400, orientation: 'film' },
      { capacitance: 47e-9, voltageRating: 400, orientation: 'film' },
      { capacitance: 100e-9, voltageRating: 400, orientation: 'film' },
      { capacitance: 220e-9, voltageRating: 400, orientation: 'film' },
      { capacitance: 470e-9, voltageRating: 200, orientation: 'film' },
    ],
  },
];

export const RESISTOR_SUBCATEGORIES: ResistorSubcategory[] = [
  {
    key: 'carbon-comp',
    label: 'Carbon Comp',
    values: [
      { resistance: 220, powerRating: 1 },
      { resistance: 470, powerRating: 1 },
      { resistance: 1000, powerRating: 1 },
      { resistance: 1500, powerRating: 1 },
      { resistance: 2200, powerRating: 1 },
      { resistance: 10000, powerRating: 1 },
      { resistance: 22000, powerRating: 0.5 },
      { resistance: 100000, powerRating: 0.5 },
      { resistance: 220000, powerRating: 0.5 },
      { resistance: 1000000, powerRating: 0.5 },
    ],
  },
  {
    key: 'carbon-film',
    label: 'Carbon Film',
    values: [
      { resistance: 100, powerRating: 0.25 },
      { resistance: 220, powerRating: 0.25 },
      { resistance: 470, powerRating: 0.25 },
      { resistance: 1000, powerRating: 0.25 },
      { resistance: 2200, powerRating: 0.25 },
      { resistance: 4700, powerRating: 0.25 },
      { resistance: 10000, powerRating: 0.25 },
      { resistance: 47000, powerRating: 0.25 },
      { resistance: 100000, powerRating: 0.25 },
      { resistance: 1000000, powerRating: 0.25 },
    ],
  },
  {
    key: 'metal-film',
    label: 'Metal Film',
    values: [
      { resistance: 100, powerRating: 0.5 },
      { resistance: 220, powerRating: 0.5 },
      { resistance: 1000, powerRating: 0.5 },
      { resistance: 4700, powerRating: 0.5 },
      { resistance: 10000, powerRating: 0.5 },
      { resistance: 22000, powerRating: 0.5 },
      { resistance: 47000, powerRating: 0.5 },
      { resistance: 100000, powerRating: 0.5 },
      { resistance: 220000, powerRating: 0.5 },
      { resistance: 1000000, powerRating: 0.5 },
    ],
  },
  {
    key: 'wirewound',
    label: 'Wirewound',
    values: [
      { resistance: 10, powerRating: 5 },
      { resistance: 22, powerRating: 5 },
      { resistance: 47, powerRating: 5 },
      { resistance: 100, powerRating: 5 },
      { resistance: 220, powerRating: 5 },
      { resistance: 470, powerRating: 10 },
      { resistance: 500, powerRating: 10 },
      { resistance: 1000, powerRating: 10 },
      { resistance: 2200, powerRating: 10 },
      { resistance: 5000, powerRating: 10 },
    ],
  },
];

function idSafe(engValue: string): string {
  return engValue.toLowerCase().replace(/\./g, 'p');
}

function buildCapacitorDefinitions(): CapacitorDefinition[] {
  return CAPACITOR_SUBCATEGORIES.flatMap((sub) =>
    sub.values.map(({ capacitance, voltageRating, orientation }): CapacitorDefinition => {
      const capLabel = formatEng(capacitance, 'F');
      const SYMBOL_BY_ORIENTATION: Record<string, { symbol: string; width: number; height: number }> = {
        axial: { symbol: '/components/capacitor-axial.svg', width: 1.1, height: 0.5 },
        radial: { symbol: '/components/capacitor-radial.svg', width: 0.4, height: 0.75 },
        film: { symbol: '/components/capacitor-film.svg', width: 0.7, height: 0.8 },
      };
      const art = SYMBOL_BY_ORIENTATION[orientation];
      return {
        id: `capacitor-${sub.key}-${idSafe(capLabel)}-${voltageRating}v`,
        name: `${capLabel} ${voltageRating}V`,
        category: 'Capacitors',
        type: ComponentType.Capacitor,
        description: `${sub.label} capacitor, ${capLabel}, ${voltageRating}V rated, ${orientation} leads.`,
        width: art.width,
        height: art.height,
        symbol: art.symbol,
        pins: TWO_LEAD_PINS,
        properties: { capacitance, voltageRating, dielectric: sub.key, orientation },
      };
    }),
  );
}

/** Reference art for carbon-comp resistors, keyed by power rating (watts). */
const CARBON_COMP_SYMBOL: Record<number, { symbol: string; width: number; height: number }> = {
  0.5: { symbol: '/components/CC-0.5W.svg', width: 0.9, height: 0.14 },
  1: { symbol: '/components/CC-1W.svg', width: 1.1, height: 0.19 },
  2: { symbol: '/components/CC-2W.svg', width: 1.3, height: 0.26 },
};

function buildResistorDefinitions(): ResistorDefinition[] {
  return RESISTOR_SUBCATEGORIES.flatMap((sub) =>
    sub.values.map(({ resistance, powerRating }): ResistorDefinition => {
      const resLabel = formatEng(resistance, 'Ω');
      const art = sub.key === 'carbon-comp' ? CARBON_COMP_SYMBOL[powerRating] : undefined;
      return {
        id: `resistor-${sub.key}-${idSafe(resLabel)}-${powerRating}w`,
        name: `${resLabel} ${powerRating}W`,
        category: 'Resistors',
        type: ComponentType.Resistor,
        description: `${sub.label} resistor, ${resLabel}, ${powerRating}W rated.`,
        width: art?.width ?? 0.25,
        height: art?.height ?? 0.6,
        symbol: art?.symbol ?? '/components/resistor-placeholder.svg',
        pins: TWO_LEAD_PINS,
        properties: { resistance, powerRating, resistorType: sub.key },
      };
    }),
  );
}

export const CAPACITOR_DEFINITIONS: CapacitorDefinition[] = buildCapacitorDefinitions();
export const RESISTOR_DEFINITIONS: ResistorDefinition[] = buildResistorDefinitions();
