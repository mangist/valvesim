/**
 * Component library: catalog definitions (components.json) plus their
 * SPICE models, which live as .inc files in the repo-level /models folder
 * and are lazy-loaded on demand.
 */
import { toSpiceAscii } from '../simulation/netlist';
import {
  ComponentType,
  type ComponentDefinition,
  type PinDefinition,
  type SpiceBinding,
} from './types';
import rawLibrary from './components.json';

/**
 * All .inc tube/component models, keyed by absolute-ish module path.
 * Lazy (`() => Promise<string>`): 280 models exist and we only inline
 * the ones a design actually uses.
 */
const spiceModelFiles = import.meta.glob('../../../models/*.inc', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

function spiceFileKey(file: string): string | undefined {
  return Object.keys(spiceModelFiles).find((k) => k.endsWith(`/${file}`));
}

const VALID_TYPES = new Set<string>(Object.values(ComponentType));

/**
 * A library component: definition + SPICE model access.
 * This is the "basic component model class" — canvas symbols
 * (engine/Component.ts) will be constructed from one of these.
 */
export class ComponentModel {
  constructor(readonly definition: ComponentDefinition) {}

  get id(): string {
    return this.definition.id;
  }

  get name(): string {
    return this.definition.name;
  }

  get category(): string {
    return this.definition.category;
  }

  get type(): ComponentType {
    return this.definition.type;
  }

  get pins(): PinDefinition[] {
    return this.definition.pins;
  }

  get properties(): ComponentDefinition['properties'] {
    return this.definition.properties;
  }

  get spice(): SpiceBinding | undefined {
    return this.definition.spice;
  }

  /** URL of the symbol SVG (undefined until the component has one designed). */
  get symbolUrl(): string | undefined {
    return this.definition.symbol;
  }

  /** Physical width, inches. */
  get widthIn(): number {
    return this.definition.width;
  }

  /** Physical height, inches. */
  get heightIn(): number {
    return this.definition.height;
  }

  /** Pins a wire can electrically attach to (i.e. mapped to a SPICE terminal). */
  get connectablePins(): PinDefinition[] {
    return this.definition.pins.filter((p) => p.terminal != null);
  }

  /**
   * Resolve a physical pin to its SPICE terminal(s) as
   * { instanceSuffix, port } pairs. A bare-port terminal (e.g. the 5U4G's
   * shared filament/cathode "K") expands to that port on every instance.
   * Empty array = NC pin, nothing to wire to.
   */
  terminalsForPin(pinNumber: string): Array<{ suffix: string; port: string }> {
    const pin = this.definition.pins.find((p) => p.number === pinNumber);
    const binding = this.definition.spice;
    if (!pin?.terminal || !binding) return [];

    const [a, b] = pin.terminal.split('.');
    if (b !== undefined) {
      return [{ suffix: a, port: b }];
    }
    // bare port: shared across all instances
    return binding.instances.map((inst) => ({ suffix: inst.suffix, port: a }));
  }

  /**
   * Load this component's SPICE model text (.SUBCKT …) from /models,
   * sanitized for the WASM engine (which hangs on non-ASCII bytes).
   */
  async loadSpiceModel(): Promise<string> {
    const binding = this.definition.spice;
    if (!binding) {
      throw new Error(`Component ${this.name} has no SPICE binding`);
    }
    const key = spiceFileKey(binding.file);
    if (!key) {
      throw new Error(`SPICE model file not found in /models: ${binding.file}`);
    }
    const text = await spiceModelFiles[key]();
    return toSpiceAscii(text.trim());
  }

  /**
   * Emit the X-instance card(s) for one placed component.
   * `refDes` is the schematic designator (e.g. "V1"); `pinNets` maps
   * physical pin numbers to resolved net names.
   */
  toSpiceInstances(refDes: string, pinNets: Record<string, string>): string[] {
    const binding = this.definition.spice;
    if (!binding) return [];
    return binding.instances.map(({ suffix, portToPin }) => {
      const nodes = binding.ports.map((port) => {
        const pin = portToPin[port];
        const net = pinNets[pin];
        if (!net) {
          throw new Error(
            `${this.name} ${refDes}: pin ${pin} (${port}) is not connected to a net`,
          );
        }
        return net;
      });
      return `X${refDes}${suffix} ${nodes.join(' ')} ${binding.subckt}`;
    });
  }
}

function parseLibrary(): ComponentModel[] {
  return rawLibrary.components.map((entry) => {
    if (!VALID_TYPES.has(entry.type)) {
      throw new Error(
        `components.json: "${entry.id}" has unknown type "${entry.type}"`,
      );
    }
    return new ComponentModel(entry as ComponentDefinition);
  });
}

const library = parseLibrary();

/** All catalog components, in palette order. */
export function getComponentLibrary(): ComponentModel[] {
  return library;
}

export function getComponentById(id: string): ComponentModel | undefined {
  return library.find((c) => c.id === id);
}
