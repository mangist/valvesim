/**
 * Resistor color-code chart (4-band: 2 significant digits + multiplier +
 * tolerance). Used to recolor a resistor symbol's band elements
 * (svg ids "band-1".."band-4") dynamically from its properties.
 */

const DIGIT_COLOR: Record<number, string> = {
  0: '#1A1A1A', // black
  1: '#7B3F00', // brown
  2: '#CC2936', // red
  3: '#D2691E', // orange
  4: '#E8D63A', // yellow
  5: '#3F7D3F', // green
  6: '#3C6FB0', // blue
  7: '#5B3E96', // violet
  8: '#7A7A7A', // grey
  9: '#E8E8E8', // white
};

const GOLD = '#D4AF37';
const SILVER = '#C0C0C0';

const TOLERANCE_COLOR: Record<number, string> = {
  1: DIGIT_COLOR[1],
  2: DIGIT_COLOR[2],
  0.5: DIGIT_COLOR[5],
  0.25: DIGIT_COLOR[6],
  0.1: DIGIT_COLOR[7],
  0.05: DIGIT_COLOR[8],
  5: GOLD,
  10: SILVER,
};

/** Two significant digits + power-of-ten multiplier for a resistance in ohms. */
function significantDigitsAndExponent(ohms: number): { d1: number; d2: number; exponent: number } {
  if (ohms <= 0) return { d1: 0, d2: 0, exponent: 0 };
  let exponent = Math.floor(Math.log10(ohms)) - 1;
  let sigFigs = Math.round(ohms / 10 ** exponent);
  // Rounding can carry into a 3rd digit (e.g. 995 -> 100 at exponent 1); renormalize.
  if (sigFigs >= 100) {
    sigFigs = Math.round(sigFigs / 10);
    exponent += 1;
  }
  return { d1: Math.floor(sigFigs / 10), d2: sigFigs % 10, exponent };
}

/** Multiplier band color for a power-of-ten exponent (supports x0.1/x0.01). */
function multiplierColor(exponent: number): string {
  if (exponent === -1) return GOLD;
  if (exponent === -2) return SILVER;
  return DIGIT_COLOR[Math.max(0, Math.min(9, exponent))] ?? DIGIT_COLOR[0];
}

/**
 * The 4 band colors (digit-1, digit-2, multiplier, tolerance) for a
 * resistor's value, matching svg ids "band-1".."band-4" left-to-right.
 */
export function getResistorBandColors(resistanceOhms: number, tolerancePercent = 5): string[] {
  const { d1, d2, exponent } = significantDigitsAndExponent(resistanceOhms);
  return [
    DIGIT_COLOR[d1] ?? DIGIT_COLOR[0],
    DIGIT_COLOR[d2] ?? DIGIT_COLOR[0],
    multiplierColor(exponent),
    TOLERANCE_COLOR[tolerancePercent] ?? GOLD,
  ];
}
