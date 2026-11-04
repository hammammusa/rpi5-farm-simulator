// Per-controller I/O state for every programmable board other than the Raspberry Pi
// (the Pi keeps its historic tables in the Simulator: `gpio`, `claims`, `watchers`).
// Each placed controller owns its pin table, its pin claims (one owner per pin), its edge
// watchers and its own event queue; nothing here is shared between two controllers.
import type { BoardDefinition, BoardPin } from './boards';
import type { GpioRuntime } from './types';

export type McuEvent =
  | { k: 'edge'; pin: number; v: 0 | 1; t: number }
  | { k: 'mqtt'; topic: string; payload: string; t: number }
  | { k: 'stop' };

export interface PinWatcher {
  last: 0 | 1 | null;
  bounceMs: number;
  lastEdgeT: number;
  /** pulse source (flow meter, tachometer) feeding this pin */
  pulse: boolean;
}

export function freshPin(num: number): GpioRuntime {
  return { bcm: num, mode: 'input', value: 0, pull: 'none', pwmFreq: 0, pwmDuty: 0, pattern: null };
}

export class ControllerIO {
  pins = new Map<number, GpioRuntime>();
  claims = new Map<number, string>();
  watchers = new Map<number, PinWatcher>();
  events: McuEvent[] = [];
  /** a program is running on this controller */
  running = false;
  /** analogWrite / DAC levels (V) on DAC-capable pins */
  dac = new Map<number, number>();
  /** called when events are queued for the program */
  onEvent: () => void = () => {};
  readonly byNum: Map<number, BoardPin>;

  constructor(
    readonly id: string,
    readonly def: BoardDefinition,
  ) {
    this.byNum = new Map(def.pins.filter((p) => p.num !== undefined).map((p) => [p.num!, p]));
    this.reset();
  }

  reset() {
    this.pins.clear();
    for (const p of this.def.pins) if (p.num !== undefined) this.pins.set(p.num, freshPin(p.num));
    this.claims.clear();
    this.watchers.clear();
    this.events = [];
    this.dac.clear();
  }

  pin(num: number): GpioRuntime | null {
    return this.pins.get(num) ?? null;
  }

  pushEvent(e: McuEvent) {
    this.events.push(e);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    this.onEvent();
  }

  takeEvents(): McuEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
