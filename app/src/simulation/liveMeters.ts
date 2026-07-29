/**
 * Live metering: every ~500ms the app snapshots the canvas into a SPICE
 * netlist, runs it on the background worker, and pushes RMS readings
 * onto the 7-segment displays (the AC inlet's current-draw readout and
 * any Voltmeter/Ammeter faces).
 */
import { toSpiceAscii } from './netlist';
import { ComponentType, type MeterProperties } from '../library/types';
import type { PlacedComponent } from '../engine/PlacedComponent';

/** What to read out of the solve, and which instance shows it. */
export type LiveProbe =
  | { kind: 'current'; guid: string; vector: string }
  | { kind: 'voltage'; guid: string; plusNet: string | null; minusNet: string | null };

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
export async function buildLiveNetlist(instances: PlacedComponent[]): Promise<LiveNetlist | null> {
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
      if (props.meterType === 'ammeter') {
        probes.push({ kind: 'current', guid: inst.guid, vector: `i(v.x${ref}.vam)` });
      } else {
        const netFor = (pin: string) => inst.pins.find((p) => p.id === pin)?.net ?? null;
        probes.push({ kind: 'voltage', guid: inst.guid, plusNet: netFor('+'), minusNet: netFor('-') });
      }
    }
  }

  const lines = [
    '* Valvesim live meter solve',
    ...cards,
    '',
    ...models.values(),
    '',
    '.tran 200u 50m',
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
  const window = 1 / 60;

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
    } else {
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
  }
  return readings;
}
