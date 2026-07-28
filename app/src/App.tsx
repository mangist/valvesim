import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { PinContextMenu } from './components/PinContextMenu';
import { Viewport } from './engine/Viewport';
import { PlacedComponent, REFDES_PREFIX } from './engine/PlacedComponent';
import { WireTool } from './engine/WireTool';
import type { PlacedWire } from './engine/PlacedWire';
import type { Pin } from './engine/Component';
import type { WireKind } from './engine/wireGauges';
import { buildDemoNetlist } from './simulation/demo';
import { buildLiveNetlist, readProbes, type LiveProbe } from './simulation/liveMeters';
import { getComponentById, type ComponentModel } from './library';
import type { SpiceRequest, SpiceResponse } from './simulation/spice.worker';

type SimState = 'idle' | 'running' | 'done' | 'error';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** Placed component instances by GUID — the future designs.schematic payload. */
  const instancesRef = useRef(new Map<string, PlacedComponent>());
  const wiresRef = useRef(new Map<string, PlacedWire>());
  const wireToolRef = useRef<WireTool | null>(null);
  const refDesCounters = useRef(new Map<string, number>());
  /** Live metering: probes of the in-flight solve + re-entrancy guard. */
  const liveProbesRef = useRef<LiveProbe[]>([]);
  const liveBusyRef = useRef(false);

  const nextRefDes = (prefix: string): string => {
    const seq = (refDesCounters.current.get(prefix) ?? 0) + 1;
    refDesCounters.current.set(prefix, seq);
    return `${prefix}${seq}`;
  };
  const [simState, setSimState] = useState<SimState>('idle');
  const [statusText, setStatusText] = useState('Ready');
  /** Active component-label editor (input overlay above the canvas label). */
  const [labelEdit, setLabelEdit] = useState<{
    guid: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);
  /** Active right-click wire-type/gauge menu, anchored at a pin. */
  const [pinMenu, setPinMenu] = useState<{
    component: PlacedComponent;
    pin: Pin;
    x: number;
    y: number;
  } | null>(null);

  // Mount the PixiJS canvas pipeline into the canvas host element
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const viewport = new Viewport();
    let cancelled = false;

    viewport.init(host).then(() => {
      if (cancelled) {
        viewport.destroy();
        return;
      }
      viewportRef.current = viewport;
      // Viewport was rebuilt (dev remounts): previously placed instances died with it
      instancesRef.current.clear();
      wiresRef.current.clear();
      refDesCounters.current.clear();

      const wireModel = getComponentById('wire-hookup');
      if (wireModel) {
        wireToolRef.current = new WireTool(viewport, wireModel, (wire) => {
          wire.refDes = nextRefDes('W');
          wiresRef.current.set(wire.guid, wire);
          setStatusText(`Placed wire ${wire.refDes} · ${wire.guid}`);
        });
      }

      if (import.meta.env.DEV) {
        // Dev console handle for inspecting canvas state
        (window as { __valvesim?: object }).__valvesim = {
          viewport,
          instances: instancesRef.current,
          wires: wiresRef.current,
        };
      }
    });

    return () => {
      cancelled = true;
      wireToolRef.current?.dispose();
      wireToolRef.current = null;
      viewportRef.current = null;
      viewport.destroy();
    };
  }, []);

  /**
   * Instance a library component onto the canvas.
   * `clientPoint` = drop location in browser coordinates (from a palette
   * drag); null = single click, drop at the center of the current view.
   */
  const placeComponent = (model: ComponentModel, clientPoint: { x: number; y: number } | null) => {
    const viewport = viewportRef.current;
    const host = hostRef.current;
    if (!viewport || !host) return;

    const rect = host.getBoundingClientRect();
    let sx: number;
    let sy: number;
    if (clientPoint) {
      sx = clientPoint.x - rect.left;
      sy = clientPoint.y - rect.top;
      if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) {
        return; // dropped outside the canvas — cancel
      }
    } else {
      sx = rect.width / 2;
      sy = rect.height / 2;
    }
    const world = viewport.toWorld(sx, sy);

    const instance = new PlacedComponent(model, nextRefDes(REFDES_PREFIX[model.type] ?? 'U'));
    instance.position.set(viewport.snap(world.x), viewport.snap(world.y));
    instance.mount(viewport);
    instancesRef.current.set(instance.guid, instance);

    // Label click: open the rename editor over the canvas label
    instance.onLabelEdit = (component) => {
      const pos = component.getLabelScreenPosition();
      if (!pos) return;
      component.setLabelEditing(true);
      setLabelEdit({ guid: component.guid, x: pos.x, y: pos.y, value: component.label });
    };

    // Pin click: start a wire from it, or — if one's already in hand —
    // lock the free end onto it (merging both pins onto the same net).
    instance.onPinDown = (component, pin) => {
      const tool = wireToolRef.current;
      if (!tool) return;
      if (tool.isActive) {
        const wire = tool.finishOnPin(component as PlacedComponent, pin);
        if (wire) {
          setStatusText(
            `Wired ${wire.refDes || 'wire'} to ${component.refDes} pin ${pin.id} (${pin.name}) — net ${wire.net}`,
          );
        }
      } else {
        tool.startFromPin(component as PlacedComponent, pin);
        setStatusText(
          `Wiring from ${component.refDes} pin ${pin.id} (${pin.name}) — click a pin to connect, or canvas to drop`,
        );
      }
    };

    // Right-click a pin: choose wire type/gauge before starting the wire.
    // (Ignored while a wire is already in hand — one context at a time.)
    instance.onPinContextMenu = (component, pin, clientX, clientY) => {
      if (wireToolRef.current?.isActive) return;
      setPinMenu({ component: component as PlacedComponent, pin, x: clientX, y: clientY });
    };

    // AC inlet rocker: report power state changes in the status bar
    instance.onSwitchToggle = (component, on) => {
      setStatusText(`${component.refDes} (${component.label}) power ${on ? 'ON' : 'OFF'}`);
    };

    instance
      .load()
      .then(() => setStatusText(`Placed ${instance.refDes} — ${model.name} · ${instance.guid}`))
      .catch((err) =>
        setStatusText(
          `Failed to load ${model.name} symbol: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  };

  /** Lazily create the shared SPICE worker (runs are serialized inside it). */
  const ensureWorker = (): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./simulation/spice.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current.onmessage = (e: MessageEvent<SpiceResponse>) => {
        const msg = e.data;
        // 500ms live-meter solves route to the displays, silently
        if (msg.tag === 'live') {
          if (msg.type === 'result') {
            const readings = readProbes(msg.data, liveProbesRef.current);
            for (const [guid, value] of readings) {
              instancesRef.current.get(guid)?.setMeterValue(value);
            }
          }
          if (msg.type !== 'progress') liveBusyRef.current = false;
          return;
        }
        if (msg.type === 'result') {
          setSimState('done');
          setStatusText(
            `Simulation complete — ${msg.summary ?? 'results in console'}`,
          );
          console.log('[valvesim] SPICE results:', msg.data);
        } else if (msg.type === 'error') {
          setSimState('error');
          setStatusText(`Simulation error: ${msg.message}`);
        } else if (msg.type === 'progress') {
          setStatusText(msg.message);
        }
      };
    }
    return workerRef.current;
  };

  // Lazily create the SPICE worker and run a smoke-test netlist
  const runSimulation = async () => {
    const worker = ensureWorker();
    setSimState('running');
    setStatusText('Running SPICE simulation…');
    try {
      const request: SpiceRequest = {
        type: 'run',
        netlist: await buildDemoNetlist(),
      };
      worker.postMessage(request);
    } catch (err) {
      setSimState('error');
      setStatusText(
        `Netlist error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Background solver: every 500ms, re-solve the canvas circuit and push
  // fresh readings to the meter displays. Skips ticks while a solve is in
  // flight, and does nothing until a powered AC inlet exists.
  useEffect(() => {
    const tick = async () => {
      if (liveBusyRef.current) return;
      const instances = [...instancesRef.current.values()];
      try {
        const live = await buildLiveNetlist(instances);
        if (!live || live.probes.length === 0) return;
        liveBusyRef.current = true;
        liveProbesRef.current = live.probes;
        ensureWorker().postMessage({
          type: 'run',
          netlist: live.netlist,
          tag: 'live',
        } satisfies SpiceRequest);
      } catch {
        liveBusyRef.current = false; // malformed circuit — try again next tick
      }
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start a wire from the right-clicked pin with the chosen type/gauge. */
  const chooseWire = (kind: WireKind, gaugeAwg: number) => {
    const menu = pinMenu;
    setPinMenu(null);
    if (!menu) return;
    const tool = wireToolRef.current;
    if (!tool) return;
    tool.startFromPin(menu.component, menu.pin, { kind, gaugeAwg });
    setStatusText(
      `Wiring ${kind} ${gaugeAwg} AWG from ${menu.component.refDes} pin ${menu.pin.id} (${menu.pin.name}) — click a pin to connect, or canvas to drop`,
    );
  };

  /** Close the label editor, optionally committing the typed name. */
  const finishLabelEdit = (commit: boolean) => {
    if (!labelEdit) return;
    const instance = instancesRef.current.get(labelEdit.guid);
    if (instance) {
      if (commit) {
        instance.setLabel(labelEdit.value);
        setStatusText(`Renamed ${instance.refDes} to "${instance.label}" · ${instance.guid}`);
      }
      instance.setLabelEditing(false);
    }
    setLabelEdit(null);
  };

  return (
    <div className="vs-app">
      <header className="vs-header">
        <img className="vs-logo" src="/valvesim.svg" alt="valvesim.com" />
        <div className="vs-header-actions">
          <button className="vs-btn" disabled title="Coming soon">
            Save
          </button>
          <button
            className="vs-btn vs-btn-primary"
            onClick={runSimulation}
            disabled={simState === 'running'}
          >
            {simState === 'running' ? 'Simulating…' : 'Run Simulation'}
          </button>
        </div>
      </header>

      <Sidebar
        onGridSizeChange={(size) => viewportRef.current?.setGridSize(size)}
        onPlaceComponent={placeComponent}
        onPaletteDragStateChange={(dragging) =>
          viewportRef.current?.setInteractionLocked(dragging)
        }
        onNewComponent={(type, subcategoryLabel) =>
          // TODO: replace with a "new custom value" dialog.
          window.alert(`Custom ${subcategoryLabel} ${type} — dialog coming soon.`)
        }
      />

      <main className="vs-canvas-host" ref={hostRef}>
        {labelEdit && (
          <input
            className="vs-label-input"
            style={
              {
                '--vs-label-x': `${labelEdit.x}px`,
                '--vs-label-y': `${labelEdit.y}px`,
              } as CSSProperties
            }
            value={labelEdit.value}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) =>
              setLabelEdit((edit) => (edit ? { ...edit, value: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishLabelEdit(true);
              else if (e.key === 'Escape') finishLabelEdit(false);
            }}
            onBlur={() => finishLabelEdit(true)}
          />
        )}
      </main>

      {pinMenu && (
        <PinContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          onSelect={chooseWire}
          onClose={() => setPinMenu(null)}
        />
      )}

      <footer className="vs-statusbar">
        <span className={simState === 'done' ? 'vs-status-ok' : undefined}>
          {statusText}
        </span>
        <span className="vs-status-hint">Scroll to zoom · Drag to pan</span>
      </footer>
    </div>
  );
}
