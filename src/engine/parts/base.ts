import type { Circuit, Solution } from '../solver';
import type { Category, ComponentInstance, FaultDef, GpioRuntime, PinDef, PropDef, Severity } from '../types';
import type { FarmState } from '../farm';

/** What a part can ask the simulator while stamping/post-processing. */
export interface SimView {
  now: number; // simulation time (s since epoch)
  gpio(bcm: number): GpioRuntime;
  /** instantaneous logical level of a PWM/pattern pin for the phase being solved */
  phaseLevel(bcm: number): 0 | 1;
  farm: FarmState;
  piPowered: boolean;
}

export interface StampCtx {
  comp: ComponentInstance;
  props: Record<string, any>;
  rt: Record<string, any>;
  fault: string;
  sim: SimView;
  c: Circuit;
  node(pin: string): number;
  /** allocate an internal node private to this part */
  newNode(tag: string): number;
  connected(pin: string): boolean;
  /** BCM number of the Pi GPIO directly wired to this pin's net, or null */
  gpioOf(pin: string): number | null;
  R(tag: string, a: number, b: number, r: number): void;
  V(tag: string, a: number, b: number, v: number, rint: number, imax?: number): void;
  D(tag: string, a: number, b: number, vf: number, rd: number): void;
  SW(tag: string, a: number, b: number, ron: number, ctl: boolean | ((s: Solution) => boolean)): void;
  I(tag: string, a: number, b: number, i: number): void;
  id(tag: string): string;
  /** sensor reading for a quantity, honouring manual/farm source */
  value(key: string): number;
}

export interface PostCtx extends Omit<StampCtx, 'R' | 'V' | 'D' | 'SW' | 'I'> {
  sol: Solution;
  volt(pin: string): number;
  cur(tag: string): number;
  issue(code: string, severity: Severity, params?: Record<string, string | number>, pins?: string[]): void;
}

export interface PartManifest {
  type: string;
  name: string;
  category: Category;
  description: string;
  w: number;
  h: number;
  pins: PinDef[] | ((props: Record<string, any>) => PinDef[]);
  /** groups of pins that are internally connected (breadboard strips, Pi GND pins...) */
  internal?: (props: Record<string, any>) => string[][];
  props: PropDef[];
  faults?: FaultDef[];
  /** 'full' = behavioural model tied to wiring and code; 'partial' = see limits */
  support: 'full' | 'partial';
  limits?: string;
  voltage?: string;
  interfaces?: string[];
  /** Python APIs that talk to this part */
  python?: string;
  /** noise std-dev per sensor quantity, used by the "noise" fault */
  noise?: Record<string, number>;
  /** quantities this sensor can read from the farm model */
  farmKeys?: Record<string, string>;
  /** inductive load: needs a flyback diode when switched by a transistor */
  inductive?: boolean;
  /** two load terminals for flyback/polarity rules */
  loadPins?: [string, string];
  stamp?(ctx: StampCtx): void;
  post?(ctx: PostCtx): Record<string, any>;
  /** part can be inserted into breadboard holes */
  insertable?: boolean;
  hidden?: boolean;
}

export const pin = (id: string, label: string, x: number, y: number, kind: PinDef['kind'], desc?: string): PinDef => ({
  id,
  label,
  x,
  y,
  kind,
  desc,
});

export function pinsOf(m: PartManifest, props: Record<string, any>): PinDef[] {
  return typeof m.pins === 'function' ? m.pins(props) : m.pins;
}

export function withDefaults(m: PartManifest, props: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of m.props) out[p.key] = p.default;
  return { ...out, ...(props ?? {}) };
}

export const FAULT = {
  none: { id: 'none', label: 'No fault' },
  disconnected: { id: 'disconnected', label: 'Sensor disconnected', help: 'The sensor stops responding as if a wire came loose.' },
  stuck: { id: 'stuck', label: 'Sensor stuck', help: 'The reading freezes at its current value.' },
  invalid: { id: 'invalid', label: 'Invalid reading', help: 'The sensor returns physically impossible values.' },
  noise: { id: 'noise', label: 'Noisy signal', help: 'Random noise is added to each reading.' },
  timeout: { id: 'timeout', label: 'Read timeout', help: 'Communication times out intermittently.' },
  pumpFail: { id: 'open_winding', label: 'Motor failure (open winding)', help: 'The motor draws no current and does not move.' },
  clogged: { id: 'clogged', label: 'Clogged / no flow', help: 'The motor runs but no liquid moves.' },
  relayStuckOpen: { id: 'stuck_open', label: 'Contacts stuck open', help: 'The relay clicks but the contacts never close.' },
  relayStuckClosed: { id: 'stuck_closed', label: 'Contacts welded closed', help: 'NO contact stays closed even when the coil is off.' },
  uartLoss: { id: 'uart_loss', label: 'UART communication loss', help: 'The device stops transmitting and ignores received bytes.' },
  powerFail: { id: 'power_fail', label: 'Power failure', help: 'The power source turns off.' },
  burned: { id: 'burned', label: 'Burned out', help: 'The part is destroyed and conducts no current.' },
} satisfies Record<string, FaultDef>;

export const SENSOR_FAULTS: FaultDef[] = [FAULT.none, FAULT.disconnected, FAULT.stuck, FAULT.invalid, FAULT.noise, FAULT.timeout];

export const sourceProp = (farmDefault = false): PropDef => ({
  key: 'source',
  label: 'Value source',
  type: 'select',
  default: farmDefault ? 'farm' : 'manual',
  options: [
    { value: 'manual', label: 'Manual (sliders)' },
    { value: 'farm', label: 'Smart Farm model' },
  ],
  group: 'sensor',
  live: true,
});

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Supply voltage seen across a part's VCC/GND pins (0 if not connected). */
export function supply(ctx: PostCtx | StampCtx, vcc: string, gnd: string): number {
  if (!ctx.connected(vcc) || !ctx.connected(gnd)) return 0;
  if ('volt' in ctx) return ctx.volt(vcc) - ctx.volt(gnd);
  return 0;
}
