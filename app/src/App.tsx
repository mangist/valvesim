import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { PinContextMenu } from './components/PinContextMenu';
import { WireContextMenu } from './components/WireContextMenu';
import { ComponentContextMenu } from './components/ComponentContextMenu';
import { Viewport } from './engine/Viewport';
import { PlacedComponent, REFDES_PREFIX } from './engine/PlacedComponent';
import { WireTool } from './engine/WireTool';
import { PlacedWire } from './engine/PlacedWire';
import { buildDesignFile, parseDesignFile, type DesignFile, type SavedWire } from './engine/design';
import type { Pin } from './engine/Component';
import type { WireKind } from './engine/wireGauges';
import { buildLiveNetlist, readProbes, readWaveforms, type LiveProbe } from './simulation/liveMeters';
import { getComponentById, type ComponentModel } from './library';
import type { SpiceRequest, SpiceResponse } from './simulation/spice.worker';

/**
 * The live solver re-solves from t=0 out to how long Play has been
 * running (not a fixed short window) so slow transients (e.g. a
 * transformer's L/R turn-on inrush) actually decay to their real
 * steady-state reading instead of being sampled mid-inrush every tick.
 * Capped so a long Play session doesn't grow the per-tick solve time
 * without bound — circuits in this library settle well within the cap.
 */
const MIN_LIVE_SIM_SECONDS = 0.05;
const MAX_LIVE_SIM_SECONDS = 5;
/**
 * How often the solver is asked to tick — the *display* refresh rate for
 * simple circuits. A heavier circuit's own solve time (which can exceed
 * this) naturally throttles it further; see the solve-budget controller
 * below, which is the thing that actually keeps latency in check.
 */
const LIVE_TICK_MS = 250;
/**
 * Target wall-clock time per solve. The simulated duration requested each
 * tick (`simSeconds`) is adjusted so the solve itself keeps landing near
 * this budget: as long as solves come in under budget, the window keeps
 * growing (toward MAX_LIVE_SIM_SECONDS) so simple circuits still fully
 * settle; once a solve blows the budget (e.g. a stiff coupled-inductor
 * transformer model), the window is backed off proportionally so the next
 * solve lands back near the target instead of repeating a multi-second
 * stall. This trades perfect settling for responsiveness on expensive
 * circuits — the reading converges to "as settled as fits in the budget,"
 * not necessarily the full 5×τ ideal.
 */
const SOLVE_BUDGET_MS = 1200;

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
  const liveSimStartRef = useRef(performance.now());
  /** Solve-budget controller state — see SOLVE_BUDGET_MS above. */
  const liveSolveStartRef = useRef(0);
  const lastSolveMsRef = useRef(0);
  const targetSimSecondsRef = useRef(MIN_LIVE_SIM_SECONDS);
  /** Wall-clock display of how long the solver has been running Play — updates faster than the solve cadence so it reads as live. */
  const [liveElapsedLabel, setLiveElapsedLabel] = useState('0.0s');
  /** Real-time simulation transport (Play/Stop). Ref mirrors state for the tick. */
  const [simRunning, setSimRunning] = useState(true);
  const simRunningRef = useRef(true);
  /** Hidden file input backing the Load button. */
  const loadInputRef = useRef<HTMLInputElement>(null);

  const nextRefDes = (prefix: string): string => {
    const seq = (refDesCounters.current.get(prefix) ?? 0) + 1;
    refDesCounters.current.set(prefix, seq);
    return `${prefix}${seq}`;
  };
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
  /** Active right-click menu on a placed wire's body. */
  const [wireMenu, setWireMenu] = useState<{
    wire: PlacedWire;
    x: number;
    y: number;
  } | null>(null);
  /** Active right-click delete menu on a component's body. */
  const [componentMenu, setComponentMenu] = useState<{
    component: PlacedComponent;
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
          registerWireHandlers(wire);
          setStatusText(`Placed wire ${wire.refDes} · ${wire.guid}`);
        });
      }

      if (import.meta.env.DEV) {
        // Dev console handle for inspecting canvas state
        (window as { __valvesim?: object }).__valvesim = {
          viewport,
          instances: instancesRef.current,
          wires: wiresRef.current,
          buildDesign: () =>
            buildDesignFile(instancesRef.current.values(), wiresRef.current.values()),
          loadDesign,
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
    registerInstanceHandlers(instance);

    instance
      .load()
      .then(() => setStatusText(`Placed ${instance.refDes} — ${model.name} · ${instance.guid}`))
      .catch((err) =>
        setStatusText(
          `Failed to load ${model.name} symbol: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  };

  /** Wire up the interactive callbacks every canvas instance needs. */
  const registerInstanceHandlers = (instance: PlacedComponent) => {
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

    // Right-click the component body: open its delete menu.
    // (Ignored while a wire is already in hand — one context at a time.)
    instance.onContextMenu = (component, clientX, clientY) => {
      if (wireToolRef.current?.isActive) return;
      setComponentMenu({ component: component as PlacedComponent, x: clientX, y: clientY });
    };
  };

  /** Component right-click menu: remove it and every wire attached to one of its pins. */
  const deleteComponent = (instance: PlacedComponent) => {
    for (const [guid, wire] of [...wiresRef.current.entries()]) {
      if (wire.from?.componentGuid === instance.guid || wire.to?.componentGuid === instance.guid) {
        wiresRef.current.delete(guid);
        wire.destroy();
      }
    }
    instancesRef.current.delete(instance.guid);
    instance.destroy();
    setStatusText(`Deleted ${instance.refDes} (${instance.model.name})`);
  };

  /** Right-click a wire's body: open its Loose/Rigid + AWG + delete menu. */
  const registerWireHandlers = (wire: PlacedWire) => {
    wire.onContextMenu = (w, clientX, clientY) => {
      setWireMenu({ wire: w as PlacedWire, x: clientX, y: clientY });
    };
  };

  /** Convert a client (browser) point to world coordinates, for anchor placement. */
  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const viewport = viewportRef.current;
    const host = hostRef.current;
    if (!viewport || !host) return null;
    const rect = host.getBoundingClientRect();
    return viewport.toWorld(clientX - rect.left, clientY - rect.top);
  };

  /** Wire menu: change kind, optionally also the gauge (re-stroked immediately). */
  const changeWireKindGauge = (kind: WireKind, gaugeAwg?: number) => {
    const wire = wireMenu?.wire;
    if (!wire) return;
    wire.kind = kind;
    if (gaugeAwg !== undefined) wire.gaugeAwg = gaugeAwg;
    setStatusText(
      `${wire.refDes || 'wire'} set to ${kind}${gaugeAwg !== undefined ? ` · ${gaugeAwg} AWG` : ''}`,
    );
  };

  /** Wire menu: add a bend/anchor point at the right-click location. */
  const addWireAnchor = () => {
    const menu = wireMenu;
    if (!menu) return;
    const world = clientToWorld(menu.x, menu.y);
    if (!world) return;
    menu.wire.addAnchor(world.x, world.y);
    setStatusText(`Added anchor to ${menu.wire.refDes || 'wire'}`);
  };

  /** Wire menu: remove the wire from the canvas circuit entirely. */
  const deleteWire = () => {
    const wire = wireMenu?.wire;
    if (!wire) return;
    wiresRef.current.delete(wire.guid);
    wire.destroy();
    setStatusText(`Deleted ${wire.refDes || 'wire'}`);
  };

  /** Track loaded refDes values so future placements continue after them. */
  const bumpRefDes = (refDes: string) => {
    const m = /^([A-Za-z]+?)(\d+)$/.exec(refDes);
    if (!m) return;
    const prefix = m[1];
    const seq = Number(m[2]);
    refDesCounters.current.set(prefix, Math.max(refDesCounters.current.get(prefix) ?? 0, seq));
  };

  /** Download the whole canvas as a .json design file. */
  const saveDesign = () => {
    const design = buildDesignFile(instancesRef.current.values(), wiresRef.current.values());
    const stamp = design.savedAt.replace(/[:T]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `valvesim-design-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusText(
      `Saved design — ${design.components.length} components, ${design.wires.length} wires`,
    );
  };

  /** Remove everything from the canvas (before loading a design). */
  const clearCanvas = () => {
    wireToolRef.current?.cancel();
    for (const inst of instancesRef.current.values()) inst.destroy();
    for (const wire of wiresRef.current.values()) wire.destroy();
    instancesRef.current.clear();
    wiresRef.current.clear();
    refDesCounters.current.clear();
  };

  /** Rebuild the canvas from a parsed design file. */
  const loadDesign = async (design: DesignFile) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    clearCanvas();

    // Components first (wires re-attach to their pins afterwards)
    const loads: Promise<void>[] = [];
    for (const saved of design.components) {
      const model = getComponentById(saved.componentId);
      if (!model) {
        console.warn(`[valvesim] unknown component in design file: ${saved.componentId}`);
        continue;
      }
      const instance = new PlacedComponent(model, saved.refDes, saved.guid);
      instance.position.set(saved.x, saved.y);
      instance.params = { ...saved.params };
      instance.setLabel(saved.label);
      instance.mount(viewport);
      registerInstanceHandlers(instance);
      instancesRef.current.set(instance.guid, instance);
      bumpRefDes(saved.refDes);
      loads.push(
        instance.load().then(() => {
          for (const savedPin of saved.pins) {
            const pin = instance.pins.find((p) => p.id === savedPin.id);
            if (pin) pin.net = savedPin.net;
          }
          instance.refreshPins();
        }),
      );
    }
    await Promise.all(loads);

    // Wires: restore geometry, then re-lock attached ends to their pins
    const wireModel = getComponentById('wire-hookup');
    const attachEnd = (wire: PlacedWire, which: 0 | 1, att: SavedWire['from']) => {
      if (!att) return;
      const comp = instancesRef.current.get(att.componentGuid);
      const pin = comp?.pins.find((p) => p.id === att.pinId);
      if (!comp || !pin) return;
      if (which === 0) wire.from = att;
      else wire.to = att;
      const pinWorld = () => viewport.world.toLocal(comp.toGlobal({ x: pin.x, y: pin.y }));
      const pos = pinWorld();
      wire.setEndpoint(which, pos.x, pos.y);
      wire.setFollow(which, pinWorld);
    };
    for (const saved of design.wires) {
      if (!wireModel) break;
      const [a, b] = saved.endpoints;
      const wire = new PlacedWire(wireModel, a.x, a.y, b.x, b.y, saved.guid);
      wire.refDes = saved.refDes;
      wire.kind = saved.kind ?? 'loose';
      wire.gaugeAwg = saved.gaugeAwg ?? 22;
      wire.net = saved.net;
      viewport.world.addChild(wire);
      wire.attach(viewport.app.ticker);
      attachEnd(wire, 0, saved.from);
      attachEnd(wire, 1, saved.to);
      wire.restoreAnchors(saved.anchors ?? []);
      registerWireHandlers(wire);
      wiresRef.current.set(wire.guid, wire);
      bumpRefDes(saved.refDes);
    }

    // New wires must mint nets above anything the file already uses
    let maxNet = 0;
    const trackNet = (net: string | null) => {
      const m = net ? /^N(\d+)$/.exec(net) : null;
      if (m) maxNet = Math.max(maxNet, Number(m[1]));
    };
    for (const inst of instancesRef.current.values()) inst.pins.forEach((p) => trackNet(p.net));
    for (const wire of wiresRef.current.values()) trackNet(wire.net);
    wireToolRef.current?.seedNetCounter(maxNet);

    setStatusText(
      `Loaded design — ${instancesRef.current.size} components, ${wiresRef.current.size} wires`,
    );
  };

  /** Load button: browse for a design file, then rebuild the canvas. */
  const onLoadFileChosen = async (file: File | null) => {
    if (!file) return;
    try {
      const design = parseDesignFile(await file.text());
      await loadDesign(design);
    } catch (err) {
      setStatusText(
        `Could not load design: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  /** New button: wipe the canvas after confirming the user is OK losing unsaved work. */
  const newDesign = () => {
    if (!window.confirm('Start a new design? Any unsaved changes on the canvas will be lost.')) {
      return;
    }
    clearCanvas();
    setStatusText('New design — canvas cleared');
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
        // Live-meter solves route to the displays, silently
        if (msg.tag === 'live') {
          // ignore a straggler result that lands after the user hit Stop
          if (msg.type === 'result' && simRunningRef.current) {
            const readings = readProbes(msg.data, liveProbesRef.current);
            for (const [guid, value] of readings) {
              instancesRef.current.get(guid)?.setMeterValue(value);
            }
            const waveforms = readWaveforms(msg.data, liveProbesRef.current);
            for (const [guid, waveform] of waveforms) {
              instancesRef.current.get(guid)?.setWaveform(waveform.time, waveform.values);
            }
          }
          if (msg.type !== 'progress') {
            liveBusyRef.current = false;
            // Feeds the solve-budget controller (see the tick loop below) —
            // recorded for both a result and an error, since either way
            // this is how long that requested duration actually took.
            lastSolveMsRef.current = performance.now() - liveSolveStartRef.current;
          }
          return;
        }
        // untagged runs (none in the UI anymore) — log for debugging
        if (msg.type === 'result') {
          console.log('[valvesim] SPICE results:', msg.data);
        } else if (msg.type === 'error') {
          console.error('[valvesim] SPICE error:', msg.message);
        }
      };
    }
    return workerRef.current;
  };

  // Background solver: up to 4×/sec, re-solve the canvas circuit — from
  // t=0 out to a duration chosen by the solve-budget controller — and push
  // fresh readings to the meter displays. The solver itself thus runs
  // continuously for the whole Play session (a growing transient, not a
  // fixed short one restarted from scratch); any wire/circuit change is
  // picked up on the very next tick since the netlist is rebuilt from the
  // live instances each time. Skips ticks while a solve is in flight, and
  // does nothing until a powered AC inlet exists.
  useEffect(() => {
    const tick = async () => {
      if (!simRunningRef.current) return; // transport stopped (Play/Stop)
      if (liveBusyRef.current) return;
      const instances = [...instancesRef.current.values()];
      try {
        const elapsedSec = (performance.now() - liveSimStartRef.current) / 1000;
        const ceiling = Math.min(MAX_LIVE_SIM_SECONDS, Math.max(MIN_LIVE_SIM_SECONDS, elapsedSec));
        // Solve-budget controller: while solves land under budget, grow the
        // target gradually toward the ceiling (full settling for circuits
        // cheap enough to afford it) — capped per-tick growth so backing off
        // from an over-budget solve doesn't immediately snap back up and
        // retrigger the same overshoot. Once a solve blows the budget, back
        // the target off proportionally so the next one lands back near
        // budget instead of repeating the same overshoot.
        const simSeconds =
          lastSolveMsRef.current === 0 || lastSolveMsRef.current <= SOLVE_BUDGET_MS
            ? Math.min(ceiling, targetSimSecondsRef.current * 1.5 + 0.1)
            : Math.min(
                ceiling,
                Math.max(
                  MIN_LIVE_SIM_SECONDS,
                  targetSimSecondsRef.current * (SOLVE_BUDGET_MS / lastSolveMsRef.current) * 0.85,
                ),
              );
        targetSimSecondsRef.current = simSeconds;
        const live = await buildLiveNetlist(instances, simSeconds);
        if (!live || live.probes.length === 0) return;
        liveBusyRef.current = true;
        liveProbesRef.current = live.probes;
        liveSolveStartRef.current = performance.now();
        ensureWorker().postMessage({
          type: 'run',
          netlist: live.netlist,
          tag: 'live',
        } satisfies SpiceRequest);
      } catch {
        liveBusyRef.current = false; // malformed circuit — try again next tick
      }
    };
    const id = setInterval(tick, LIVE_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticks the header's running-time readout faster than the solve cadence
  // (so it visibly counts up in real time) while Play is active.
  useEffect(() => {
    const id = setInterval(() => {
      if (!simRunningRef.current) return;
      const elapsedSec = (performance.now() - liveSimStartRef.current) / 1000;
      setLiveElapsedLabel(`${elapsedSec.toFixed(1)}s`);
    }, 100);
    return () => clearInterval(id);
  }, []);

  /** Play: resume the continuous real-time solve loop from a fresh t=0. */
  const startLiveSim = () => {
    liveSimStartRef.current = performance.now();
    setLiveElapsedLabel('0.0s');
    lastSolveMsRef.current = 0;
    targetSimSecondsRef.current = MIN_LIVE_SIM_SECONDS;
    simRunningRef.current = true;
    setSimRunning(true);
    setStatusText('Real-time simulation running');
  };

  /** Stop: halt the solve loop and zero every meter readout. */
  const stopLiveSim = () => {
    simRunningRef.current = false;
    setSimRunning(false);
    liveSimStartRef.current = performance.now();
    setLiveElapsedLabel('0.0s');
    lastSolveMsRef.current = 0;
    targetSimSecondsRef.current = MIN_LIVE_SIM_SECONDS;
    for (const inst of instancesRef.current.values()) {
      inst.setMeterValue(0);
    }
    setStatusText('Real-time simulation stopped');
  };

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
          <button
            className={`vs-btn vs-btn-transport vs-btn-play ${simRunning ? 'vs-btn-transport-active' : ''}`}
            onClick={startLiveSim}
            disabled={simRunning}
            title="Run the real-time circuit simulation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M 2 1 L 13 7 L 2 13 Z" fill="currentColor" />
            </svg>
            Play
          </button>
          <button
            className={`vs-btn vs-btn-transport vs-btn-stop ${simRunning ? '' : 'vs-btn-transport-active'}`}
            onClick={stopLiveSim}
            disabled={!simRunning}
            title="Stop the real-time circuit simulation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2" y="2" width="10" height="10" fill="currentColor" />
            </svg>
            Stop
          </button>
          <span
            className={`vs-sim-clock ${simRunning ? 'vs-sim-clock-active' : ''}`}
            title="Total time the live solver has been running this Play session"
          >
            {liveElapsedLabel}
          </span>
          <button
            className="vs-btn vs-btn-transport vs-btn-load"
            onClick={() => loadInputRef.current?.click()}
            title="Load a design file onto the canvas"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M 7 10 L 7 2 M 3.5 5.5 L 7 2 L 10.5 5.5 M 1.5 9.5 L 1.5 12.5 L 12.5 12.5 L 12.5 9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Load
          </button>
          <button
            className="vs-btn vs-btn-transport vs-btn-save"
            onClick={saveDesign}
            title="Download the canvas as a design file"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M 1.5 1.5 L 10.5 1.5 L 12.5 3.5 L 12.5 12.5 L 1.5 12.5 Z M 4 1.5 L 4 5 L 10 5 L 10 1.5 M 3.5 12.5 L 3.5 8 L 10.5 8 L 10.5 12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            Save
          </button>
          <button
            className="vs-btn vs-btn-transport vs-btn-new"
            onClick={newDesign}
            title="Clear the canvas and start a new design"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M 2 1.5 L 9 1.5 L 12 4.5 L 12 12.5 L 2 12.5 Z M 9 1.5 L 9 4.5 L 12 4.5 M 7 6.5 L 7 10.5 M 5 8.5 L 9 8.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            New
          </button>
          <input
            ref={loadInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void onLoadFileChosen(e.target.files?.[0] ?? null);
              e.target.value = ''; // allow re-loading the same file
            }}
          />
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

      {wireMenu && (
        <WireContextMenu
          x={wireMenu.x}
          y={wireMenu.y}
          gaugeAwg={wireMenu.wire.gaugeAwg}
          onSelectKind={(kind) => changeWireKindGauge(kind)}
          onSelectGauge={(kind, gaugeAwg) => changeWireKindGauge(kind, gaugeAwg)}
          onAddAnchor={addWireAnchor}
          onDelete={deleteWire}
          onClose={() => setWireMenu(null)}
        />
      )}

      {componentMenu && (
        <ComponentContextMenu
          x={componentMenu.x}
          y={componentMenu.y}
          onDelete={() => deleteComponent(componentMenu.component)}
          onClose={() => setComponentMenu(null)}
        />
      )}

      <footer className="vs-statusbar">
        <span>{statusText}</span>
        <span className="vs-status-hint">Scroll to zoom · Drag to pan</span>
      </footer>
    </div>
  );
}
