/**
 * Live metering: while Play is active, the app continuously re-solves the
 * canvas circuit from t=0 out to the solver's current elapsed run time
 * (not a fixed short window), and pushes RMS readings onto the 7-segment
 * displays (the AC inlet's current-draw readout and any Voltmeter/Ammeter
 * faces) several times a second. Simulating further out each time — rather
 * than always restarting a brief fixed-length transient — lets slow
 * (e.g. transformer L/R) turn-on transients actually decay to their real
 * steady-state reading instead of being sampled mid-inrush every time.
 *
 * Only the last `RMS_WINDOW_SECONDS` of each solve is ever read (see
 * `readProbes`), so the netlist's `.tran` Tstart tells ngspice not to
 * bother returning data from earlier than that — the run still integrates
 * the full duration (Tstart doesn't skip any physics), but the result
 * payload shipped back across the worker boundary shrinks from
 * `simSeconds/step` points down to a small constant-size tail, which is
 * most of the round-trip cost once `simSeconds` grows past a second or two.
 */
import { toSpiceAscii } from './netlist';
import { ComponentType, type MeterProperties } from '../library/types';
import type { PlacedComponent } from '../engine/PlacedComponent';

/** Fixed transient step — accuracy for the coupled-inductor models. */
const TRAN_STEP_SECONDS = 200e-6;

/** RMS is taken over the last full mains cycle — see `readProbes`. */
export const RMS_WINDOW_SECONDS = 1 / 60;

/**
 * Margin beyond the RMS window kept in the output, for safety/rounding —
 * also what the Oscilloscope's 3-period timebase draws from. Every
 * periodic signal in this simulator (mains, its rectified/ripple
 * harmonics) is at 60Hz or a multiple of it, so ~5 mains cycles of margin
 * comfortably covers "3 complete waveforms" at any of those frequencies.
 */
const OUTPUT_TAIL_MARGIN_SECONDS = 0.08;

/** ngspice accepts a plain decimal number of seconds (no suffix needed). */
function formatSpiceSeconds(seconds: number): string {
  return seconds.toFixed(6);
}

/** What to read out of the solve, and which instance shows it. */
export type LiveProbe =
  | { kind: 'current'; guid: string; vector: string }
  | { kind: 'voltage'; guid: string; plusNet: string | null; minusNet: string | null }
  /** Oscilloscope: same differential-voltage probe, but the raw waveform is kept (see `readWaveforms`), not reduced to a scalar. */
  | { kind: 'waveform'; guid: string; plusNet: string | null; minusNet: string | null };

export interface LiveNetlist {
  netlist: string;
  probes: LiveProbe[];
}

/**
 * Build a solvable netlist from everything placed on canvas.
 * Returns null when there's nothing worth solving. Note this runs even
 * when every inlet is switched OFF — the dead-input subckt solves to 0V,
 * so voltmeters correctly fall to zero instead of freezing at their last
 * powered reading.
 */
export async function buildLiveNetlist(
  instances: PlacedComponent[],
  simSeconds: number,
): Promise<LiveNetlist | null> {
  const relevant = instances.some(
    (i) => i.model.type === ComponentType.AcInlet || i.model.type === ComponentType.Meter,
  );
  if (!relevant) return null;

  // Subcircuit model texts, deduped by file
  const models = new Map<string, string>();
  for (const inst of instances) {
    const binding = inst.model.spice;
    if (binding && !models.has(binding.file)) {
      models.set(binding.file, await inst.model.loadSpiceModel());
    }
  }

  const cards = instances.map((inst) => inst.toSpice()).filter((c) => c.trim().length > 0);

  const probes: LiveProbe[] = [];
  for (const inst of instances) {
    const ref = inst.refDes.toLowerCase();
    if (inst.model.type === ComponentType.AcInlet && inst.switchOn) {
      // total draw = branch current of the mains source inside the subckt
      probes.push({ kind: 'current', guid: inst.guid, vector: `i(v.x${ref}.vac)` });
    } else if (inst.model.type === ComponentType.Meter) {
      const props = inst.model.properties as MeterProperties;
      const netFor = (pin: string) => inst.pins.find((p) => p.id === pin)?.net ?? null;
      if (props.meterType === 'ammeter') {
        probes.push({ kind: 'current', guid: inst.guid, vector: `i(v.x${ref}.vam)` });
      } else if (props.meterType === 'oscilloscope') {
        probes.push({ kind: 'waveform', guid: inst.guid, plusNet: netFor('+'), minusNet: netFor('-') });
      } else {
        probes.push({ kind: 'voltage', guid: inst.guid, plusNet: netFor('+'), minusNet: netFor('-') });
      }
    }
  }

  // Only ship back the tail we'll actually read (RMS window + margin) —
  // ngspice still integrates the whole thing, but skips returning the
  // (often much larger) discarded history, which is most of the payload
  // for a multi-second solve.
  const tStart = Math.max(0, simSeconds - RMS_WINDOW_SECONDS - OUTPUT_TAIL_MARGIN_SECONDS);

  const lines = [
    '* Valvesim live meter solve',
    ...cards,
    '',
    ...models.values(),
    '',
    `.tran ${formatSpiceSeconds(TRAN_STEP_SECONDS)} ${formatSpiceSeconds(simSeconds)} ${formatSpiceSeconds(tStart)}`,
    '.end',
    '',
  ];
  return { netlist: toSpiceAscii(lines.join('\n')), probes };
}

interface RealVector {
  name: string;
  values: number[];
}

interface TranResult {
  variableNames?: string[];
  data?: RealVector[];
}

/**
 * Evaluate the probes against a finished .tran result: RMS over the last
 * full mains cycle (16.7ms @ 60Hz), which reads as the steady-state
 * value for AC and as |V| for settled DC.
 */
export function readProbes(result: unknown, probes: LiveProbe[]): Map<string, number> {
  const res = result as TranResult;
  const vectors = new Map<string, number[]>();
  for (const v of res.data ?? []) vectors.set(v.name.toLowerCase(), v.values);

  const time = vectors.get('time');
  const readings = new Map<string, number>();
  if (!time || time.length === 0) return readings;
  const tEnd = time[time.length - 1];
  const window = RMS_WINDOW_SECONDS;

  const rmsOf = (sample: (i: number) => number): number => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < time.length; i++) {
      if (time[i] > tEnd - window) {
        const s = sample(i);
        sum += s * s;
        n++;
      }
    }
    return n > 0 ? Math.sqrt(sum / n) : 0;
  };

  for (const probe of probes) {
    if (probe.kind === 'current') {
      const v = vectors.get(probe.vector);
      readings.set(probe.guid, v ? rmsOf((i) => v[i]) : 0);
    } else if (probe.kind === 'voltage') {
      const plus = probe.plusNet ? vectors.get(`v(${probe.plusNet.toLowerCase()})`) : undefined;
      const minus = probe.minusNet ? vectors.get(`v(${probe.minusNet.toLowerCase()})`) : undefined;
      if (!plus && !minus) {
        readings.set(probe.guid, 0);
      } else {
        readings.set(
          probe.guid,
          rmsOf((i) => (plus?.[i] ?? 0) - (minus?.[i] ?? 0)),
        );
      }
    }
    // 'waveform' probes are handled separately by readWaveforms — they need
    // the raw samples, not a scalar reduction.
  }
  return readings;
}

export interface WaveformReading {
  time: number[];
  values: number[];
}

/** Raw differential-voltage samples for every 'waveform' probe (the Oscilloscope). */
export function readWaveforms(result: unknown, probes: LiveProbe[]): Map<string, WaveformReading> {
  const res = result as TranResult;
  const vectors = new Map<string, number[]>();
  for (const v of res.data ?? []) vectors.set(v.name.toLowerCase(), v.values);

  const time = vectors.get('time');
  const readings = new Map<string, WaveformReading>();
  if (!time || time.length === 0) return readings;

  for (const probe of probes) {
    if (probe.kind !== 'waveform') continue;
    const plus = probe.plusNet ? vectors.get(`v(${probe.plusNet.toLowerCase()})`) : undefined;
    const minus = probe.minusNet ? vectors.get(`v(${probe.minusNet.toLowerCase()})`) : undefined;
    if (!plus && !minus) continue;
    const values = time.map((_, i) => (plus?.[i] ?? 0) - (minus?.[i] ?? 0));
    readings.set(probe.guid, { time: [...time], values });
  }
  return readings;
}
