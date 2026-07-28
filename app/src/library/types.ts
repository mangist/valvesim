/**
 * Component library data model.
 *
 * These are *catalog* definitions (what a 5U4G is), as opposed to
 * engine/Component.ts which is the interactive canvas symbol. Definitions
 * live in components.json for now; the shape mirrors the future PostgreSQL
 * `components` table (kind, name, pin_map, spice_model, params).
 */

export enum ComponentType {
  Wire = 'wire',
  Resistor = 'resistor',
  Capacitor = 'capacitor',
  Inductor = 'inductor',
  Potentiometer = 'potentiometer',
  Transformer = 'transformer',
  Tube = 'tube',
  SolderLugStrip = 'solder-lug-strip',
  Switch = 'switch',
  Jack = 'jack',
  AcInlet = 'ac-inlet',
  Ground = 'ground',
}

/**
 * A physical terminal, in the labeled-pin style of the reference sheets:
 * pin number, electrical role, and the SPICE terminal it presents.
 * e.g. 5U4G pin 4 → PLATE_1 → anode of diode instance A.
 */
export interface PinDefinition {
  /** Physical pin/lug identifier, e.g. "4" on an octal base. */
  number: string;
  /** Electrical role, e.g. "PLATE_1", "FILAMENT+". "NC" = not connected. */
  name: string;
  /**
   * Element id of this pin in the component's symbol SVG (e.g. "pin-4") —
   * the wire attachment point on canvas.
   */
  svgId?: string;
  /**
   * SPICE model terminal a wire on this pin connects to:
   *  - "<instanceSuffix>.<port>", e.g. "A.A" = port A of X-instance A, or
   *  - a bare port shared by every instance, e.g. "K" (the 5U4G's
   *    directly-heated filament is the cathode of both diode sections).
   * null/omitted = not connected to the model (mechanical pin only).
   */
  terminal?: string | null;
}

// ---------- per-type properties ----------
// All values are SI base units (ohms, farads, henries, volts, amps);
// use formatEng() for µF/pF-style display.

export interface WireProperties {
  gauge?: string; // e.g. "20 AWG"
  insulation?: string;
}

export interface ResistorProperties {
  resistance: number; // ohms
  powerRating?: number; // watts
  tolerance?: number; // percent
  /** Construction/subcategory, e.g. "carbon-comp", "carbon-film", "metal-film", "wirewound". */
  resistorType?: string;
}

export interface CapacitorProperties {
  capacitance: number; // farads
  voltageRating?: number; // volts DC
  /** Construction/subcategory, e.g. "electrolytic", "ceramic", "polyester-film". */
  dielectric?: string;
  /** Lead style: both leads from one end/side ("radial") or one from each end ("axial"). */
  orientation?: 'axial' | 'radial';
}

export interface InductorProperties {
  inductance: number; // henries
  dcResistance?: number; // ohms
  currentRating?: number; // amps
}

export interface PotentiometerProperties {
  resistance: number; // ohms, end-to-end
  taper?: 'linear' | 'audio' | 'reverse-audio';
  powerRating?: number; // watts
}

/** One secondary winding (or tap) of a transformer. */
export interface TransformerSecondary {
  label: string; // e.g. "HV", "5V rectifier filament", "6.3V heaters"
  voltage: number; // VRMS across the full winding
  current?: number; // amps
  centerTapped?: boolean;
  dcResistance?: number; // ohms, full winding
}

export interface TransformerProperties {
  primaryVoltage: number; // VRMS
  /** 1..n secondary windings/taps. */
  secondaries: TransformerSecondary[];
  va?: number; // volt-amp rating
  primaryInductance?: number; // henries
  primaryDcResistance?: number; // ohms
}

export interface TubeProperties {
  /** Functional class, e.g. "full-wave-rectifier", "triode", "pentode". */
  tubeType: string;
  base: string; // e.g. "Octal (IO) 5T"
  heaterVoltage: number; // volts
  heaterCurrent: number; // amps
  /** Directly heated = the filament is the cathode (true for the 5U4G). */
  directlyHeated?: boolean;
  /** Independent electrical sections in the envelope (5U4G: 2 diodes). */
  sections?: number;
  /** Free-form datasheet limits, e.g. { peakInverseVoltage: 1550 }. */
  maxRatings?: Record<string, number>;
}

export interface SolderLugStripProperties {
  lugs: number;
  grounded?: boolean; // mounting lug bonded to chassis
}

export interface SwitchProperties {
  poles: number;
  throws: number;
}

export interface JackProperties {
  connector: string; // e.g. "1/4in TS"
  switching?: boolean;
}

export interface AcInletProperties {
  voltage: number; // VRMS
  frequency: number; // Hz
  hasSwitch?: boolean;
  fuseRating?: number; // amps, if the module includes a fuse holder
}

export interface GroundProperties {
  /** "chassis" (bonded through a bonding resistance) or "earth" (mains PE). */
  groundType?: 'chassis' | 'earth';
}

// ---------- SPICE binding ----------

/**
 * How a library component maps onto SPICE. The model text itself lives in
 * /models/*.inc (referenced by file name) and is inlined into the netlist.
 */
export interface SpiceBinding {
  /** File name inside the repo-level /models folder, e.g. "5U4G.inc". */
  file: string;
  /** Subcircuit name declared by that file. */
  subckt: string;
  /** Port order of the .SUBCKT line, e.g. ["A", "K"]. */
  ports: string[];
  /**
   * X-instances placed per physical component, mapping subckt port → pin
   * number. The 5U4G file models ONE diode, so the twin-plate tube places
   * two instances sharing the filament pins.
   */
  instances: Array<{
    /** Appended to the refDes, e.g. "A" → X1A. */
    suffix: string;
    portToPin: Record<string, string>;
  }>;
  notes?: string;
}

// ---------- component definition (discriminated union) ----------

interface BaseDefinition<T extends ComponentType, P> {
  /** Stable library id, e.g. "tube-5u4g". */
  id: string;
  /** Display name, e.g. "5U4G". */
  name: string;
  /** Palette grouping, e.g. "Rectifier Tubes". */
  category: string;
  type: T;
  description?: string;
  /** Physical width in inches (canvas: 1 major grid square = 1"). */
  width: number;
  /** Physical height in inches. */
  height: number;
  /** URL of the symbol SVG (flat labeled-pin illustration), e.g. "/components/5U4G.svg". */
  symbol?: string;
  pins: PinDefinition[];
  properties: P;
  spice?: SpiceBinding;
}

export type WireDefinition = BaseDefinition<ComponentType.Wire, WireProperties>;
export type ResistorDefinition = BaseDefinition<ComponentType.Resistor, ResistorProperties>;
export type CapacitorDefinition = BaseDefinition<ComponentType.Capacitor, CapacitorProperties>;
export type InductorDefinition = BaseDefinition<ComponentType.Inductor, InductorProperties>;
export type PotentiometerDefinition = BaseDefinition<
  ComponentType.Potentiometer,
  PotentiometerProperties
>;
export type TransformerDefinition = BaseDefinition<
  ComponentType.Transformer,
  TransformerProperties
>;
export type TubeDefinition = BaseDefinition<ComponentType.Tube, TubeProperties>;
export type SolderLugStripDefinition = BaseDefinition<
  ComponentType.SolderLugStrip,
  SolderLugStripProperties
>;
export type SwitchDefinition = BaseDefinition<ComponentType.Switch, SwitchProperties>;
export type JackDefinition = BaseDefinition<ComponentType.Jack, JackProperties>;
export type AcInletDefinition = BaseDefinition<ComponentType.AcInlet, AcInletProperties>;
export type GroundDefinition = BaseDefinition<ComponentType.Ground, GroundProperties>;

export type ComponentDefinition =
  | WireDefinition
  | ResistorDefinition
  | CapacitorDefinition
  | InductorDefinition
  | PotentiometerDefinition
  | TransformerDefinition
  | TubeDefinition
  | SolderLugStripDefinition
  | SwitchDefinition
  | JackDefinition
  | AcInletDefinition
  | GroundDefinition;

// ---------- helpers ----------

const ENG_PREFIXES: Array<[number, string]> = [
  [1e9, 'G'],
  [1e6, 'Meg'], // SPICE spelling; 'M' means milli in SPICE
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'u'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/**
 * Format an SI value in engineering notation, SPICE-compatible and
 * human-readable: 4.7e-8 F → "47n", 470000 Ω → "470k".
 */
export function formatEng(value: number, unit = ''): string {
  if (value === 0) return `0${unit}`;
  const abs = Math.abs(value);
  for (const [factor, prefix] of ENG_PREFIXES) {
    if (abs >= factor) {
      const scaled = value / factor;
      const rounded = Math.round(scaled * 1000) / 1000;
      return `${rounded}${prefix}${unit}`;
    }
  }
  return `${value}${unit}`;
}
