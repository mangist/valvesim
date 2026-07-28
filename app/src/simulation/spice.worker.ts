/// <reference lib="webworker" />
/**
 * Background thread that runs the Ngspice WebAssembly engine
 * (eecircuit-engine) so simulation never blocks the canvas.
 *
 * Protocol: post a SpiceRequest, receive SpiceResponse messages.
 */
import { Simulation } from 'eecircuit-engine';

export interface SpiceRequest {
  type: 'run';
  netlist: string;
}

export type SpiceResponse =
  | { type: 'progress'; message: string }
  | { type: 'result'; data: unknown; summary?: string }
  | { type: 'error'; message: string };

const post = (msg: SpiceResponse) => self.postMessage(msg);

let sim: Simulation | null = null;
let ready: Promise<void> | null = null;

function ensureEngine(): Promise<void> {
  if (!ready) {
    post({ type: 'progress', message: 'Loading Ngspice WASM engine…' });
    sim = new Simulation();
    ready = sim.start();
  }
  return ready;
}

self.onmessage = async (e: MessageEvent<SpiceRequest>) => {
  const msg = e.data;
  if (msg.type !== 'run') return;

  try {
    await ensureEngine();
    post({ type: 'progress', message: 'Running simulation…' });

    sim!.setNetList(msg.netlist);
    const result = await sim!.runSim();

    const r = result as {
      numPoints?: number;
      variableNames?: string[];
    };
    const summary =
      r?.numPoints !== undefined
        ? `${r.numPoints} points, variables: ${r.variableNames?.join(', ') ?? '?'}`
        : undefined;

    post({ type: 'result', data: result, summary });
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
