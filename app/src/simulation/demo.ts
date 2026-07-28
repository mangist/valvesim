/**
 * Smoke-test circuit proving the full pipeline: component library (JSON)
 * → SPICE model from /models/*.inc → netlist text → Ngspice WASM worker.
 *
 * Circuit: 5U4G full-wave rectifier on a 300-0-300 HT winding into a
 * capacitor-input filter. Goes away once schematics are built on canvas.
 */
import { getComponentById } from '../library';
import { buildNetlist, type Schematic } from './netlist';

export async function buildDemoNetlist(): Promise<string> {
  const tube = getComponentById('tube-5u4g');
  if (!tube) throw new Error('5U4G missing from component library');

  const model = await tube.loadSpiceModel();

  // V1 = the 5U4G: plates (pins 4/6) on the winding ends, filament (pin 8)
  // is the cathode feeding the reservoir cap. Heater supply not simulated.
  const tubeCards = tube.toSpiceInstances('V1', {
    '4': 'p1',
    '6': 'p2',
    '8': 'out',
  });

  const schematic: Schematic = {
    title: 'Valvesim smoke test - 5U4G full-wave rectifier',
    components: [
      // 300-0-300 VRMS HT winding as two opposite-phase sources (60 Hz)
      {
        refDes: 'VP1',
        pins: [
          { id: '1', net: 'p1' },
          { id: '2', net: '0' },
        ],
        value: 'SIN(0 424 60)',
      },
      {
        refDes: 'VP2',
        pins: [
          { id: '1', net: 'p2' },
          { id: '2', net: '0' },
        ],
        value: 'SIN(0 424 60 0 0 180)',
      },
      // Capacitor-input filter and bleeder/load
      {
        refDes: 'CL',
        pins: [
          { id: '1', net: 'out' },
          { id: '2', net: '0' },
        ],
        value: '47u',
      },
      {
        refDes: 'RL',
        pins: [
          { id: '1', net: 'out' },
          { id: '2', net: '0' },
        ],
        value: '5k',
      },
    ],
    extraCards: tubeCards,
    models: [model],
    analyses: ['.tran 100u 50m'],
  };

  return buildNetlist(schematic);
}
