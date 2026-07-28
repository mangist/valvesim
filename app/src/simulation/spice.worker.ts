/// <reference lib="webworker" />
/**
 * Background thread that runs the Ngspice WebAssembly engine
 * (eecircuit-engine) so simulation never blocks the canvas.
 *
 * Protocol: post a SpiceRequest, receive SpiceResponse messages. The
 * optional `tag` is echoed on every response so the app can route
 * results (e.g. the 500ms live-meter solves vs. a user-triggered run).
 * Runs are serialized through a queue — the engine is a single global
 * instance, and interleaving two async runs would corrupt both.
 */
import { Simulation } from 'eecircuit-engine';

export interface SpiceRequest {
  type: 'run';
  netlist: string;
  /** Echoed back on responses, for routing (e.g. 'live' meter updates). */
  tag?: string;
}

export type SpiceResponse =
  | { type: 'progress'; message: string; tag?: string }
  | { type: 'result'; data: unknown; summary?: string; tag?: string }
  | { type: 'error'; message: string; tag?: string };

const post = (msg: SpiceResponse) => self.postMessage(msg);

let sim: Simulation | null = null;
let ready: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();

function ensureEngine(tag?: string): Promise<void> {
  if (!ready) {
    post({ type: 'progress', message: 'Loading Ngspice WASM engine…', tag });
    sim = new Simulation();
    ready = sim.start();
  }
  return ready;
}

async function runOne(msg: SpiceRequest): Promise<void> {
  const tag = msg.tag;
  try {
    await ensureEngine(tag);
    if (!tag) post({ type: 'progress', message: 'Running simulation…' });

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

    post({ type: 'result', data: result, summary, tag });
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      tag,
    });
  }
}

self.onmessage = (e: MessageEvent<SpiceRequest>) => {
  const msg = e.data;
  if (msg.type !== 'run') return;
  queue = queue.then(() => runOne(msg));
};
