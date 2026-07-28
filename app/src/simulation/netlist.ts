/**
 * Netlist generation: converts the canvas schematic model
 * (components + pin/net coordinates) into SPICE netlist text
 * for the Ngspice WASM engine.
 */

export interface NetlistPin {
  /** Pin identifier on the component (e.g. "4" on a 5U4G base). */
  id: string;
  /** Net (node) name this pin connects to, e.g. "HV_P1". "0" is ground. */
  net: string;
}

export interface NetlistComponent {
  /** Reference designator: V1, R1, C2, T1… (first letter selects the SPICE element). */
  refDes: string;
  /** Ordered pin → net connections. */
  pins: NetlistPin[];
  /** Value or model, e.g. "1k", "100n", "SIN(0 1 1k)". */
  value: string;
}

export interface Schematic {
  title: string;
  components: NetlistComponent[];
  /** Pre-rendered element cards, e.g. subckt X-instances from the library. */
  extraCards?: string[];
  /** Analysis control lines, e.g. ".tran 10u 5m". */
  analyses: string[];
  /** .model / .subckt definitions (tube models, transformer subcircuits…). */
  models?: string[];
}

/**
 * The Ngspice WASM engine hangs (runSim never resolves) if the netlist
 * contains non-ASCII bytes. Map the symbols users actually type in
 * electronics (µ, Ω, °…) to ASCII and strip the rest.
 */
export function toSpiceAscii(text: string): string {
  return text
    .replace(/[µμ]/g, 'u') // micro sign, greek mu
    .replace(/[ΩΩ]/g, 'ohm') // greek omega, ohm sign
    .replace(/°/g, 'deg')
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, '?');
}

/**
 * Build SPICE netlist text from a schematic model.
 *
 * This is deliberately simple for now: components already carry resolved
 * net names. The full coordinate → net resolution (walking wire graphs to
 * merge electrically-connected pins) will live here as the AST grows.
 */
export function buildNetlist(schematic: Schematic): string {
  const lines: string[] = [`* ${schematic.title}`];

  for (const c of schematic.components) {
    const nodes = c.pins.map((p) => p.net).join(' ');
    lines.push(`${c.refDes} ${nodes} ${c.value}`);
  }

  if (schematic.extraCards?.length) {
    lines.push(...schematic.extraCards);
  }

  if (schematic.models?.length) {
    lines.push('', ...schematic.models);
  }

  lines.push('', ...schematic.analyses, '.end', '');
  return toSpiceAscii(lines.join('\n'));
}

// (The smoke-test circuit lives in demo.ts — it exercises the component
// library end to end: JSON catalog -> /models .inc -> netlist -> worker.)
