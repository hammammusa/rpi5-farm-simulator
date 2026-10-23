import { SimClock } from './clock';
import { FarmModel, type ActuatorDrive, type FarmRole } from './farm';
import { buildNetlist, type Netlist } from './netlist';
import { BCM_TO_PHYS, defaultPull, I2C1, ONEWIRE_DEFAULT_PIN, SPI0, UART_PORTS, parsePinSpec } from './pi5';
import { getPart, hasPart, pinsOf, withDefaults, type PartManifest, type PostCtx, type SimView, type StampCtx } from './parts';
import { Circuit, GND, solve, type Solution } from './solver';
import type { ComponentInstance, GpioRuntime, Issue, PinPattern, ProjectDoc, Severity } from './types';
import { hasPullupResistor, validateStatic } from './validate';
import type { DeviceHost, DeviceModel } from './devices/device';
import { Bme280 } from './devices/bme280';
import { Mcp3008 } from './devices/mcp3008';
import { Bh1750 } from './devices/bh1750';
import { Hd44780 } from './devices/hd44780';
import { Ssd1306 } from './devices/ssd1306';
import { Mhz19 } from './devices/mhz19';
import { NextionRuntime } from './devices/nextion';
import { SerialTerminal } from './devices/serialTerm';

export interface EvalResult {
  c: Circuit;
  sol: Solution;
  nodeOf: Map<number, number>;
  vis: Map<string, Record<string, any>>;
  issues: Issue[];
}

export interface UartLogEntry {
  t: number;
  port: string;
  dir: 'tx' | 'rx';
  bytes: number[];
  peer: string;
  note?: string;
}

export interface SimLog {
  t: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export type PyEvent =
  | { k: 'edge'; pin: number; v: 0 | 1; t: number }
  | { k: 'http'; id: number; method: string; path: string; query: string; body: string; headers: Record<string, string> }
  | { k: 'stop' };

export class SimError extends Error {
  constructor(public pyType: string, message: string) {
    super(message);
  }
}

const UART_CANON: Record<string, string> = { '/dev/serial0': 'UART0', '/dev/ttyAMA0': 'UART0', '/dev/ttyAMA1': 'UART1', '/dev/ttyAMA2': 'UART2', '/dev/ttyAMA3': 'UART3', '/dev/ttyAMA4': 'UART4' };
const I2C_TYPES = new Set(['bme280', 'bh1750', 'lcd1602_i2c', 'oled_ssd1306']);
const UART_TYPES = new Set(['nextion', 'mhz19b', 'usb_serial']);

function freshGpio(bcm: number): GpioRuntime {
  return { bcm, mode: 'input', value: 0, pull: defaultPull(bcm), pwmFreq: 0, pwmDuty: 0, pattern: null };
}

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hash12(s: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

export class Simulator {
  doc!: ProjectDoc;
  net!: Netlist;
  clock: SimClock;
  farm: FarmModel;
  gpio: GpioRuntime[] = Array.from({ length: 28 }, (_, i) => freshGpio(i));
  rt = new Map<string, Record<string, any>>();
  vis = new Map<string, Record<string, any>>();
  issues: Issue[] = [];
  devices = new Map<string, DeviceModel>();
  claims = new Map<number, string>();
  uarts = new Map<string, { baud: number; port: string }>();
  rxq = new Map<string, { t: number; b: number }[]>();
  events: PyEvent[] = [];
  watchers = new Map<number, { last: 0 | 1 | null; bounceMs: number; lastEdgeT: number; pulse: boolean }>();
  uartLog: UartLogEntry[] = [];
  logs: SimLog[] = [];
  running = false;
  piPowered = true;
  version = 0;
  onPythonEvent: () => void = () => {};
  private listeners = new Set<() => void>();
  private main: EvalResult | null = null;
  private noise = new Map<string, number>();
  private powerState = new Map<string, boolean>();
  private lastTick = 0;
  private topoKey = '';
  private notifyQueued = false;

  constructor(doc: ProjectDoc, startMs = Date.now()) {
    this.clock = new SimClock(startMs);
    this.farm = new FarmModel(doc.farm, this.clock.now());
    this.setDoc(doc);
    this.lastTick = this.clock.now();
  }

  // ------------------------------------------------------------ subscriptions
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    this.version++;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const l of this.listeners) l();
    });
  }

  log(msg: string, level: SimLog['level'] = 'info') {
    this.logs.push({ t: this.clock.now(), level, msg });
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
    this.notify();
  }

  // ------------------------------------------------------------ document
  setDoc(doc: ProjectDoc) {
    this.doc = doc;
    this.net = buildNetlist(doc);
    const key = JSON.stringify([doc.components.map((c) => [c.id, c.type, c.x, c.y, c.rotation]), doc.wires.map((w) => [w.from, w.to])]);
    if (key !== this.topoKey) {
      this.topoKey = key;
      for (const r of this.rt.values()) {
        delete r.trip3v3;
        delete r.trip5v;
        delete r.tripped;
      }
    }
    const ids = new Set(doc.components.map((c) => c.id));
    for (const id of [...this.rt.keys()]) if (!ids.has(id)) this.rt.delete(id);
    for (const id of [...this.devices.keys()]) if (!ids.has(id)) this.devices.delete(id);
    this.farm.cfg = doc.farm;
    this.evaluate();
  }

  comp(id: string) {
    return this.doc.components.find((c) => c.id === id);
  }
  propsOf(c: ComponentInstance) {
    return withDefaults(getPart(c.type), c.props);
  }
  rtOf(id: string) {
    let r = this.rt.get(id);
    if (!r) {
      r = {};
      this.rt.set(id, r);
    }
    return r;
  }
  pi() {
    return this.net.piId ? this.comp(this.net.piId) ?? null : null;
  }
  piProps() {
    const p = this.pi();
    return p ? this.propsOf(p) : null;
  }

  // ------------------------------------------------------------ sensor values
  sensorValue(c: ComponentInstance, key: string): number {
    const m = getPart(c.type);
    const props = this.propsOf(c);
    const fk = m.farmKeys?.[key];
    let base = props.source === 'farm' && fk && this.doc.farm.enabled ? this.farm.read(fk) : Number(props[key]);
    if (!Number.isFinite(base)) base = 0;
    const r = this.rtOf(c.id);
    const fault = props.fault ?? 'none';
    if (fault === 'stuck') {
      r.stuck ??= {};
      if (r.stuck[key] === undefined) r.stuck[key] = base;
      return r.stuck[key];
    }
    delete r.stuck;
    if (fault === 'noise') {
      const nk = `${c.id}.${key}`;
      let n = this.noise.get(nk);
      if (n === undefined) {
        n = gauss() * (m.noise?.[key] ?? 0.05 * Math.abs(base));
        this.noise.set(nk, n);
      }
      return base + n;
    }
    return base;
  }

  // ------------------------------------------------------------ solving
  private timeVarying(): boolean {
    for (const g of this.gpio) if (g.mode === 'pwm' && g.pwmDuty > 0 && g.pwmDuty < 1 && this.net.gpioNet.has(g.bcm)) return true;
    for (const c of this.doc.components) if (c.type === 'flow_sensor' && this.sensorValue(c, 'flow') > 0) return true;
    return false;
  }

  private defaultLevel(bcm: number): 0 | 1 {
    const g = this.gpio[bcm];
    if (g.mode === 'pwm') return g.pwmDuty >= 0.5 ? 1 : 0;
    return g.value;
  }

  private instantLevels(t: number): Map<number, 0 | 1> {
    const m = new Map<number, 0 | 1>();
    for (const g of this.gpio) {
      if (g.mode === 'pwm' && g.pwmFreq > 0) m.set(g.bcm, (t * g.pwmFreq) % 1 < g.pwmDuty ? 1 : 0);
    }
    return m;
  }

  solveOnce(levels: Map<number, 0 | 1>, t: number, collect = true): EvalResult {
    const c = new Circuit(0);
    const nodeOf = new Map<number, number>();
    const groundNet = this.net.groundNet;
    const nodeOfNet = (netId: number) => {
      if (netId < 0) {
        c.n++;
        return c.n - 1;
      }
      if (netId === groundNet) return GND;
      let n = nodeOf.get(netId);
      if (n === undefined) {
        n = c.n++;
        nodeOf.set(netId, n);
      }
      return n;
    };
    const view: SimView = {
      now: t,
      gpio: (b) => this.gpio[b],
      phaseLevel: (b) => levels.get(b) ?? this.defaultLevel(b),
      farm: this.farm.state,
      piPowered: this.piPowered,
    };
    const ctxs: { m: PartManifest; ctx: StampCtx }[] = [];
    for (const comp of this.doc.components) {
      if (!hasPart(comp.type)) continue;
      const m = getPart(comp.type);
      const props = this.propsOf(comp);
      const rt = this.rtOf(comp.id);
      const pinIds = new Set(pinsOf(m, props).map((p) => p.id));
      const netOfPin = (pin: string) => (pinIds.has(pin) ? this.net.netOf({ comp: comp.id, pin }) : -1);
      const ctx: StampCtx = {
        comp,
        props,
        rt,
        fault: props.fault ?? 'none',
        sim: view,
        c,
        node: (pin) => nodeOfNet(netOfPin(pin)),
        newNode: () => c.n++,
        connected: (pin) => {
          const n = netOfPin(pin);
          if (n < 0) return false;
          for (const id of this.net.nets[n].comps) if (id !== comp.id) return true;
          return false;
        },
        gpioOf: (pin) => {
          if (comp.type === 'rpi5') return null;
          const n = netOfPin(pin);
          if (n < 0) return null;
          for (const [b, nn] of this.net.gpioNet) if (nn === n) return b;
          return null;
        },
        R: (tag, a, b, r) => void c.addR(comp.id, tag, a, b, r),
        V: (tag, a, b, v, rint, imax) => void c.addV(comp.id, tag, a, b, v, rint, imax),
        D: (tag, a, b, vf, rd) => void c.addD(comp.id, tag, a, b, vf, rd),
        SW: (tag, a, b, ron, ctl) => void c.addSW(comp.id, tag, a, b, ron, ctl),
        I: (tag, a, b, i) => void c.addI(comp.id, tag, a, b, i),
        id: (tag) => `${comp.id}:${tag}`,
        value: (key) => this.sensorValue(comp, key),
      };
      try {
        m.stamp?.(ctx);
      } catch (e) {
        console.error('stamp failed', comp.type, e);
      }
      ctxs.push({ m, ctx });
    }
    const sol = solve(c);
    const vis = new Map<string, Record<string, any>>();
    const issues: Issue[] = [];
    if (collect) {
      for (const { m, ctx } of ctxs) {
        if (!m.post) continue;
        const comp = ctx.comp;
        const pctx: PostCtx = {
          ...ctx,
          sol,
          volt: (pin) => sol.volt(ctx.node(pin)),
          cur: (tag) => sol.cur(`${comp.id}:${tag}`),
          issue: (code: string, severity: Severity, params?: Record<string, string | number>, pins?: string[]) => {
            issues.push({
              code,
              severity,
              params,
              comps: [comp.id],
              pins: pins?.map((p) => ({ comp: comp.id, pin: p })),
              key: `${code}|${comp.id}|${JSON.stringify(params ?? {})}`,
            });
          },
        } as PostCtx;
        // volt() must not allocate nodes for unconnected pins on every call
        const nodeCache = new Map<string, number>();
        pctx.volt = (pin: string) => {
          let n = nodeCache.get(pin);
          if (n === undefined) {
            const netId = this.net.netOf({ comp: comp.id, pin });
            n = netId === groundNet ? GND : nodeOf.get(netId) ?? -2;
            nodeCache.set(pin, n);
          }
          return n === -2 ? 0 : sol.volt(n);
        };
        pctx.node = (pin: string) => {
          const netId = this.net.netOf({ comp: comp.id, pin });
          return netId === groundNet ? GND : nodeOf.get(netId) ?? -2;
        };
        try {
          vis.set(comp.id, m.post(pctx));
        } catch (e) {
          console.error('post failed', comp.type, e);
        }
      }
    }
    return { c, sol, nodeOf, vis, issues };
  }

  /** Full evaluation at simulation time t: farm catch-up, solve (PWM phase-averaged), visuals, issues, events. */
  evaluate(t = this.clock.now()) {
    this.farm.advanceTo(t);
    this.noise.clear();
    const pwm = this.gpio.filter((g) => g.mode === 'pwm' && g.pwmDuty > 0 && g.pwmDuty < 1 && this.net.gpioNet.has(g.bcm)).slice(0, 3);
    const combos: { levels: Map<number, 0 | 1>; w: number }[] = [];
    const n = 1 << pwm.length;
    for (let mask = 0; mask < n; mask++) {
      const levels = new Map<number, 0 | 1>();
      let w = 1;
      pwm.forEach((g, i) => {
        const hi = (mask >> i) & 1;
        levels.set(g.bcm, hi ? 1 : 0);
        w *= hi ? g.pwmDuty : 1 - g.pwmDuty;
      });
      combos.push({ levels, w });
    }
    let results: EvalResult[] = [];
    for (let pass = 0; pass < 4; pass++) {
      for (const r of this.rt.values()) r.dirty = false;
      results = combos.map((cmb) => this.solveOnce(cmb.levels, t));
      if (![...this.rt.values()].some((r) => r.dirty)) break;
    }
    // weighted merge of visual state
    const vis = new Map<string, Record<string, any>>();
    for (const comp of this.doc.components) {
      const parts = results.map((r, i) => ({ v: r.vis.get(comp.id), w: combos[i].w })).filter((p) => p.v);
      if (parts.length) vis.set(comp.id, mergeVis(parts as { v: Record<string, any>; w: number }[]));
    }
    this.vis = vis;
    this.main = results[results.length - 1];
    const seen = new Set<string>();
    const issues: Issue[] = [];
    for (const r of results)
      for (const i of r.issues)
        if (!seen.has(i.key)) {
          seen.add(i.key);
          issues.push(i);
        }
    for (const i of validateStatic(this)) if (!seen.has(i.key)) {
      seen.add(i.key);
      issues.push(i);
    }
    this.issues = issues;
    this.updateDrives();
    this.updateDevicePower(t);
    this.detectEdges(t);
    this.notify();
  }

  /** latest (all-PWM-high) solution, used for validation helpers */
  mainResult() {
    if (!this.main) this.evaluate();
    return this.main!;
  }

  nodeOfNet(netId: number, r = this.mainResult()) {
    if (netId === this.net.groundNet) return GND;
    return r.nodeOf.get(netId) ?? null;
  }

  netVoltage(netId: number): number | null {
    const r = this.mainResult();
    const n = this.nodeOfNet(netId, r);
    if (n === null) return null;
    return r.sol.volt(n);
  }

  private updateDrives() {
    const drives: ActuatorDrive[] = [];
    for (const c of this.doc.components) {
      const props = this.propsOf(c);
      const role = props.role as FarmRole | undefined;
      if (!role || role === 'none') continue;
      const v = this.vis.get(c.id);
      if (!v) continue;
      drives.push({
        comp: c.id,
        role,
        run: Number(v.run) || 0,
        rate: Number(props.rate) || 0,
        watts: Number(v.watts) || 0,
        noFlow: !!v.noFlow,
        calibration: (Number(props.calibration) || 0) / 100,
      });
    }
    this.farm.drives = drives;
  }

  // ------------------------------------------------------------ devices
  device(id: string): DeviceModel | null {
    const c = this.comp(id);
    if (!c) return null;
    let d = this.devices.get(id);
    if (d) return d;
    const host: DeviceHost = {
      comp: () => this.comp(id)!,
      props: () => this.propsOf(this.comp(id)!),
      value: (key) => this.sensorValue(this.comp(id)!, key),
      fault: () => this.propsOf(this.comp(id)!).fault ?? 'none',
      powered: () => !!this.vis.get(id)?.powered,
      now: () => this.clock.now(),
      send: (bytes, t) => this.deviceSend(id, bytes, t ?? this.clock.now()),
      log: (m) => this.log(m),
      changed: () => this.notify(),
    };
    switch (c.type) {
      case 'bme280':
        d = new Bme280(host);
        break;
      case 'bh1750':
        d = new Bh1750(host);
        break;
      case 'lcd1602_i2c':
        d = new Hd44780(host);
        break;
      case 'oled_ssd1306':
        d = new Ssd1306(host);
        break;
      case 'mhz19b':
        d = new Mhz19(host);
        break;
      case 'usb_serial':
        d = new SerialTerminal(host);
        break;
      case 'nextion':
        d = new NextionRuntime(host, () => this.doc.nextion);
        break;
      case 'mcp3008':
        d = new Mcp3008((sgl, ch) => this.mcpSample(id, sgl, ch));
        break;
      default:
        return null;
    }
    this.devices.set(id, d);
    return d;
  }

  private updateDevicePower(t: number) {
    for (const c of this.doc.components) {
      if (!I2C_TYPES.has(c.type) && !UART_TYPES.has(c.type) && c.type !== 'mcp3008') continue;
      const on = !!this.vis.get(c.id)?.powered;
      const was = this.powerState.get(c.id) ?? false;
      if (on !== was) {
        this.powerState.set(c.id, on);
        const d = this.device(c.id);
        if (d) {
          if (on) d.reset?.();
          d.powerChanged?.(on, t);
        }
      }
    }
  }

  private pinNet(compId: string, pin: string) {
    return this.net.netOf({ comp: compId, pin });
  }

  private sharesGround(compId: string) {
    const g = this.pinNet(compId, 'GND');
    return g >= 0 && g === this.net.groundNet;
  }

  private mcpSample(id: string, sgl: boolean, ch: number) {
    const v = this.vis.get(id);
    if (!v?.powered) return 0;
    const r = this.mainResult();
    const read = (k: number) => {
      const netId = this.pinNet(id, `CH${k}`);
      const node = this.nodeOfNet(netId, r);
      if (node === null || (node >= 0 && !r.sol.driven[node])) return null;
      return v.ch[k] as number;
    };
    let vin: number | null;
    if (sgl) vin = read(ch);
    else {
      const a = read(ch & 6 | (ch & 1));
      const b = read((ch & 6) | ((ch & 1) ^ 1));
      vin = a === null || b === null ? null : a - b;
    }
    const comp = this.comp(id)!;
    const noisy = (this.propsOf(comp).fault ?? 'none') === 'noise';
    if (vin === null) return 300 + Math.random() * 400; // floating input reads garbage
    const vref = v.vref > 0.1 ? v.vref : v.vdd;
    let code = (1024 * vin) / vref;
    if (noisy) code += gauss() * 6;
    return Math.max(0, Math.min(1023, code));
  }

  // ------------------------------------------------------------ program lifecycle
  programStart() {
    this.running = true;
    this.claims.clear();
    this.uarts.clear();
    this.rxq.clear();
    this.events = [];
    this.watchers.clear();
    for (let i = 0; i < 28; i++) this.gpio[i] = freshGpio(i);
    const pp = this.piProps();
    if (pp?.onewire) {
      this.claims.set(ONEWIRE_DEFAULT_PIN, 'w1-gpio (1-Wire overlay)');
      Object.assign(this.gpio[ONEWIRE_DEFAULT_PIN], { mode: 'alt', alt: '1-Wire', pull: 'none' });
    }
    this.evaluate();
  }

  programEnd() {
    this.running = false;
    this.claims.clear();
    this.uarts.clear();
    this.watchers.clear();
    this.events = [];
    for (let i = 0; i < 28; i++) this.gpio[i] = freshGpio(i);
    this.evaluate();
  }

  takeEvents(): PyEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  pushEvent(e: PyEvent) {
    this.events.push(e);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    this.onPythonEvent();
  }

  // ------------------------------------------------------------ GPIO API (used by the Python bridge)
  private requirePi() {
    if (!this.pi()) throw new SimError('RuntimeError', 'No Raspberry Pi 5 in the workspace — add one from the component library.');
    if (!this.piPowered || this.propsOf(this.pi()!).fault === 'power_fail') throw new SimError('RuntimeError', 'The Raspberry Pi has no power.');
  }

  checkPin(spec: number | string): number {
    const b = parsePinSpec(spec);
    if (b === null) throw new SimError('PinInvalidPin', `${spec} is not a valid GPIO pin on the Raspberry Pi 5 header (use BCM 0–27, e.g. 17, "GPIO17" or "BOARD11")`);
    return b;
  }

  gpioSetup(spec: number | string, mode: 'input' | 'output', pull: 'up' | 'down' | 'none', owner: string, initial = 0, t?: number) {
    this.requirePi();
    const b = this.checkPin(spec);
    const cur = this.claims.get(b);
    if (cur && cur !== owner) throw new SimError('GPIOPinInUse', `GPIO${b} is already in use by ${cur}`);
    this.claims.set(b, owner);
    const g = this.gpio[b];
    g.mode = mode;
    g.pull = mode === 'input' ? pull : 'none';
    g.value = initial ? 1 : 0;
    g.pattern = null;
    g.owner = owner;
    g.pwmDuty = 0;
    if (b <= 1) this.log(`GPIO${b} is reserved for the HAT ID EEPROM (ID_SD/ID_SC) — avoid it`, 'warn');
    this.log(`GPIO${b} configured as ${mode.toUpperCase()}${mode === 'input' ? ` (pull ${pull})` : ''} by ${owner}`);
    this.evaluate(t);
    return b;
  }

  gpioRelease(b: number, t?: number) {
    this.claims.delete(b);
    this.watchers.delete(b);
    this.gpio[b] = freshGpio(b);
    this.evaluate(t);
  }

  gpioWrite(b: number, v: number, t?: number) {
    this.requirePi();
    const g = this.gpio[b];
    if (g.mode !== 'output' && g.mode !== 'pwm') throw new SimError('RuntimeError', `GPIO${b} is not configured as an output`);
    const nv: 0 | 1 = v ? 1 : 0;
    const changed = g.mode !== 'output' || g.value !== nv;
    g.mode = 'output';
    g.value = nv;
    g.pattern = null;
    if (changed) {
      this.log(`GPIO${b} → ${nv ? 'HIGH' : 'LOW'}`);
      this.evaluate(t);
    }
  }

  gpioPwm(b: number, freq: number, duty: number, t?: number) {
    this.requirePi();
    const g = this.gpio[b];
    if (g.mode === 'input' || g.mode === 'alt') throw new SimError('RuntimeError', `GPIO${b} is not configured as an output`);
    g.mode = 'pwm';
    g.pwmFreq = Math.max(0, freq);
    g.pwmDuty = Math.max(0, Math.min(1, duty));
    g.pattern = null;
    this.evaluate(t);
  }

  gpioPattern(b: number, p: Omit<PinPattern, 'startSim'> | null, t = this.clock.now()) {
    const g = this.gpio[b];
    g.pattern = p ? { ...p, startSim: t } : null;
    this.applyPatterns(t);
    this.evaluate(t);
  }

  gpioWatch(b: number, on: boolean, bounceMs = 0) {
    if (!on) {
      this.watchers.delete(b);
      return;
    }
    const pulse = this.pulseSourceFor(b) !== null;
    this.watchers.set(b, { last: this.readLevel(b).value, bounceMs, lastEdgeT: -1e9, pulse });
  }

  /** digital level seen by GPIO b at time t */
  readLevel(b: number, t = this.clock.now()): { value: 0 | 1; v: number | null; floating: boolean } {
    const g = this.gpio[b];
    if (g.mode === 'output') return { value: g.value, v: g.value ? 3.3 : 0, floating: false };
    const netId = this.net.gpioNet.get(b);
    const fromPull = (): { value: 0 | 1; v: number | null; floating: boolean } =>
      g.pull === 'up' ? { value: 1, v: 3.3, floating: false } : g.pull === 'down' ? { value: 0, v: 0, floating: false } : { value: Math.random() < 0.5 ? 1 : 0, v: null, floating: true };
    if (netId === undefined) return fromPull();
    const n = this.net.nets[netId];
    if (![...n.comps].some((id) => id !== this.net.piId) && n.piPins.length === 1) return fromPull();
    const r = this.timeVarying() ? this.solveOnce(this.instantLevels(t), t, false) : this.mainResult();
    const node = netId === this.net.groundNet ? GND : r.nodeOf.get(netId);
    if (node === undefined) return fromPull();
    if (node >= 0 && !r.sol.driven[node]) return { value: Math.random() < 0.5 ? 1 : 0, v: null, floating: true };
    const v = r.sol.volt(node);
    return { value: v >= 1.65 ? 1 : 0, v, floating: false };
  }

  gpioRead(b: number, t?: number) {
    this.requirePi();
    const r = this.readLevel(b, t);
    if (r.floating && this.gpio[b].mode === 'input') this.issueOnce('W_FLOATING_INPUT', { pin: b });
    return r;
  }

  private runtimeIssues = new Map<string, Issue>();
  private issueOnce(code: string, params: Record<string, string | number>) {
    const key = `${code}|${JSON.stringify(params)}`;
    if (!this.runtimeIssues.has(key)) {
      this.runtimeIssues.set(key, { code, severity: 'warning', params, comps: this.net.piId ? [this.net.piId] : [], key });
      this.log(`${code} ${JSON.stringify(params)}`, 'warn');
    }
  }
  getRuntimeIssues() {
    return this.running ? [...this.runtimeIssues.values()] : [];
  }

  private detectEdges(t: number) {
    for (const [b, w] of this.watchers) {
      if (w.pulse) continue;
      const lv = this.readLevel(b, t).value;
      if (w.last !== null && lv !== w.last) {
        if ((t - w.lastEdgeT) * 1000 >= w.bounceMs) {
          w.lastEdgeT = t;
          this.pushEvent({ k: 'edge', pin: b, v: lv, t });
        }
      }
      w.last = lv;
    }
  }

  private pulseSourceFor(b: number): ComponentInstance | null {
    const netId = this.net.gpioNet.get(b);
    if (netId === undefined) return null;
    for (const c of this.doc.components) if (c.type === 'flow_sensor' && this.pinNet(c.id, 'SIG') === netId) return c;
    return null;
  }

  private applyPatterns(t: number): boolean {
    let changed = false;
    for (const g of this.gpio) {
      const p = g.pattern;
      if (!p) continue;
      const cycle = p.steps.reduce((s, x) => s + x[1], 0);
      const el = t - p.startSim;
      if (cycle <= 0) continue;
      if (p.repeat !== null && el >= cycle * p.repeat) {
        g.pattern = null;
        if (p.pwm) {
          if (g.pwmDuty !== 0) changed = true;
          g.pwmDuty = 0;
        } else {
          if (g.value !== 0) changed = true;
          g.value = 0;
        }
        continue;
      }
      let x = el % cycle;
      let duty = 0;
      for (const [d, dur] of p.steps) {
        if (x < dur) {
          duty = d;
          break;
        }
        x -= dur;
      }
      if (p.pwm) {
        if (g.mode !== 'pwm' || Math.abs(g.pwmDuty - duty) > 1e-6) changed = true;
        g.mode = 'pwm';
        g.pwmFreq = p.freq || 100;
        g.pwmDuty = duty;
      } else {
        const v: 0 | 1 = duty >= 0.5 ? 1 : 0;
        if (g.value !== v) changed = true;
        g.mode = 'output';
        g.value = v;
      }
    }
    return changed;
  }

  // ------------------------------------------------------------ periodic tick
  tick() {
    const t = this.clock.now();
    const prev = this.lastTick;
    this.lastTick = t;
    let need = this.applyPatterns(t);
    // flow-meter pulses → edge events
    for (const [b, w] of this.watchers) {
      if (!w.pulse) continue;
      const src = this.pulseSourceFor(b);
      if (!src) continue;
      const hz = 7.5 * Math.max(0, this.sensorValue(src, 'flow'));
      if (hz <= 0 || !this.vis.get(src.id)?.powered) continue;
      const k0 = Math.floor(prev * hz);
      const k1 = Math.floor(t * hz);
      let count = 0;
      for (let k = k0 + 1; k <= k1 && count < 800; k++, count++) {
        this.events.push({ k: 'edge', pin: b, v: 0, t: k / hz });
        this.events.push({ k: 'edge', pin: b, v: 1, t: (k + 0.5) / hz });
      }
      if (count) this.onPythonEvent();
    }
    for (const [id, d] of this.devices) if (d.tick && this.vis.get(id)?.powered) d.tick(t);
    const farmSourced = this.doc.farm.enabled && this.doc.components.some((c) => (c.props?.source ?? '') === 'farm');
    if (need || farmSourced || this.timeVarying() || this.farm.drives.length) this.evaluate(t);
    else this.farm.advanceTo(t);
    this.notify();
  }

  // ------------------------------------------------------------ UART
  private canon(port: string) {
    return UART_CANON[port] ?? port;
  }

  uartOpen(port: string, baud: number) {
    this.requirePi();
    const def = UART_PORTS[port];
    if (!def) throw new SimError('SerialException', `[Errno 2] could not open port ${port}: [Errno 2] No such file or directory: '${port}'. On a Raspberry Pi 5 use /dev/serial0 (or /dev/ttyAMA0) for GPIO14/15.`);
    if (this.canon(port) === 'UART0' && !this.piProps()?.uart0)
      throw new SimError('SerialException', `could not open port ${port}: UART0 is disabled. Enable it (dtparam=uart0=on in config.txt / Pi properties in the inspector).`);
    for (const p of [def.tx, def.rx]) {
      const owner = this.claims.get(p);
      if (owner && !owner.startsWith('serial')) throw new SimError('SerialException', `could not open port ${port}: GPIO${p} is in use by ${owner}`);
    }
    const c = this.canon(port);
    this.claims.set(def.tx, `serial ${port}`);
    this.claims.set(def.rx, `serial ${port}`);
    Object.assign(this.gpio[def.tx], { mode: 'alt', alt: `${def.label} TX`, pull: 'none' });
    Object.assign(this.gpio[def.rx], { mode: 'alt', alt: `${def.label} RX`, pull: 'up' });
    this.uarts.set(c, { baud, port });
    this.rxq.set(c, []);
    this.log(`${port} opened at ${baud} baud (TX GPIO${def.tx}, RX GPIO${def.rx})`);
    this.evaluate();
  }

  uartClose(port: string) {
    const def = UART_PORTS[port];
    const c = this.canon(port);
    if (!this.uarts.has(c)) return;
    this.uarts.delete(c);
    if (def) {
      for (const p of [def.tx, def.rx]) {
        this.claims.delete(p);
        this.gpio[p] = freshGpio(p);
      }
    }
    this.evaluate();
  }

  uartSetBaud(port: string, baud: number) {
    const u = this.uarts.get(this.canon(port));
    if (u) u.baud = baud;
  }

  private uartDevices(): ComponentInstance[] {
    return this.doc.components.filter((c) => UART_TYPES.has(c.type));
  }

  private pushUartLog(e: UartLogEntry) {
    const last = this.uartLog[this.uartLog.length - 1];
    if (last && last.port === e.port && last.dir === e.dir && last.peer === e.peer && e.t - last.t < 0.002 && last.bytes.length < 256) last.bytes.push(...e.bytes);
    else this.uartLog.push(e);
    if (this.uartLog.length > 400) this.uartLog.splice(0, this.uartLog.length - 400);
  }

  uartWrite(port: string, bytes: number[], t = this.clock.now()) {
    this.requirePi();
    const c = this.canon(port);
    const u = this.uarts.get(c);
    if (!u) throw new SimError('PortNotOpenError', 'Attempting to use a port that is not open');
    const def = UART_PORTS[port] ?? UART_PORTS['/dev/serial0'];
    const txNet = this.net.gpioNet.get(def.tx);
    const rxNet = this.net.gpioNet.get(def.rx);
    const dur = (bytes.length * 10) / u.baud;
    let delivered = false;
    if (txNet !== undefined) {
      for (const d of this.uartDevices()) {
        if (this.pinNet(d.id, 'RX') !== txNet) continue;
        const name = getPart(d.type).name;
        const dev = this.device(d.id);
        if (!dev?.uartReceive) continue;
        if (!this.vis.get(d.id)?.powered) {
          this.pushUartLog({ t, port: c, dir: 'tx', bytes: [...bytes], peer: name, note: 'device not powered' });
          continue;
        }
        if (d.type !== 'usb_serial' && !this.sharesGround(d.id)) {
          this.pushUartLog({ t, port: c, dir: 'tx', bytes: [...bytes], peer: name, note: 'no common GND' });
          continue;
        }
        if (d.type === 'usb_serial' && !this.sharesGround(d.id)) {
          this.pushUartLog({ t, port: c, dir: 'tx', bytes: [...bytes], peer: name, note: 'no common GND' });
          continue;
        }
        const devBaud = dev.uartBaud?.() ?? 9600;
        const data = devBaud === u.baud ? bytes : garble(bytes);
        this.pushUartLog({ t, port: c, dir: 'tx', bytes: [...bytes], peer: name, note: devBaud === u.baud ? undefined : `baud mismatch: Pi ${u.baud}, device ${devBaud}` });
        dev.uartReceive(data, t + dur);
        delivered = true;
      }
      if (rxNet === txNet) {
        const q = this.rxq.get(c)!;
        bytes.forEach((b, i) => q.push({ t: t + ((i + 1) * 10) / u.baud, b }));
        delivered = true;
        this.onPythonEvent();
      }
    }
    if (!delivered) this.pushUartLog({ t, port: c, dir: 'tx', bytes: [...bytes], peer: '—', note: 'nothing connected to TX' });
    this.notify();
  }

  deviceSend(compId: string, bytes: number[], t: number) {
    const comp = this.comp(compId);
    if (!comp) return;
    const name = getPart(comp.type).name;
    const txNet = this.pinNet(compId, 'TX');
    const dev = this.device(compId);
    const devBaud = dev?.uartBaud?.() ?? 9600;
    let delivered = false;
    for (const [c, u] of this.uarts) {
      const def = UART_PORTS[u.port];
      if (this.net.gpioNet.get(def.rx) !== txNet) continue;
      if (!this.sharesGround(compId)) {
        this.pushUartLog({ t, port: c, dir: 'rx', bytes: [...bytes], peer: name, note: 'no common GND — data lost' });
        continue;
      }
      const data = devBaud === u.baud ? bytes : garble(bytes);
      const q = this.rxq.get(c)!;
      data.forEach((b, i) => q.push({ t: t + ((i + 1) * 10) / u.baud, b }));
      this.pushUartLog({ t, port: c, dir: 'rx', bytes: [...bytes], peer: name, note: devBaud === u.baud ? undefined : `baud mismatch: Pi ${u.baud}, device ${devBaud}` });
      delivered = true;
    }
    if (!delivered && txNet >= 0) this.pushUartLog({ t, port: '—', dir: 'rx', bytes: [...bytes], peer: name, note: 'Pi UART not open or TX not wired to Pi RX' });
    if (delivered) this.onPythonEvent();
    this.notify();
  }

  uartAvailable(port: string, t = this.clock.now()) {
    const q = this.rxq.get(this.canon(port));
    if (!q) return 0;
    let n = 0;
    for (const e of q) if (e.t <= t) n++;
    return n;
  }

  uartRead(port: string, max: number, t = this.clock.now()): number[] {
    const q = this.rxq.get(this.canon(port));
    if (!q) throw new SimError('PortNotOpenError', 'Attempting to use a port that is not open');
    const out: number[] = [];
    while (q.length && q[0].t <= t && out.length < max) out.push(q.shift()!.b);
    return out;
  }

  uartFlushInput(port: string) {
    const q = this.rxq.get(this.canon(port));
    if (q) q.length = 0;
  }

  // ------------------------------------------------------------ I2C
  private i2cDevices() {
    const sda = this.net.gpioNet.get(I2C1.sda);
    const scl = this.net.gpioNet.get(I2C1.scl);
    const out: { c: ComponentInstance; d: DeviceModel }[] = [];
    if (sda === undefined || scl === undefined) return out;
    for (const c of this.doc.components) {
      if (!I2C_TYPES.has(c.type)) continue;
      if (this.pinNet(c.id, 'SDA') !== sda || this.pinNet(c.id, 'SCL') !== scl) continue;
      if (!this.vis.get(c.id)?.powered) continue;
      if ((this.propsOf(c).fault ?? 'none') === 'disconnected') continue;
      if (!this.sharesGround(c.id)) continue;
      const d = this.device(c.id);
      if (d) out.push({ c, d });
    }
    return out;
  }

  i2cScan(): number[] {
    this.requirePi();
    return [...new Set(this.i2cDevices().map((x) => x.d.i2cAddress!()))].sort((a, b) => a - b);
  }

  i2c(bus: number, addr: number, write: number[] | null, readN: number) {
    this.requirePi();
    if (bus !== 1) throw new SimError('FileNotFoundError', `[Errno 2] No such file or directory: '/dev/i2c-${bus}' (the header I2C bus is bus 1)`);
    for (const p of [I2C1.sda, I2C1.scl]) {
      const o = this.claims.get(p);
      if (o && !o.startsWith('i2c')) throw new SimError('OSError', `[Errno 16] Device or resource busy: GPIO${p} is used by ${o}`);
    }
    const devs = this.i2cDevices().filter((x) => x.d.i2cAddress!() === addr);
    if (devs.length === 0) throw new SimError('OSError', '[Errno 121] Remote I/O error');
    if (devs.length > 1) throw new SimError('OSError', '[Errno 5] Input/output error (two devices answer at the same address)');
    const d = devs[0].d;
    if (write && write.length) d.i2cWrite?.(write);
    const out = readN > 0 ? d.i2cRead?.(readN) ?? new Array(readN).fill(0xff) : [];
    this.notify();
    return out;
  }

  // ------------------------------------------------------------ SPI
  spiOpen(bus: number, dev: number) {
    this.requirePi();
    if (bus !== 0 || (dev !== 0 && dev !== 1)) throw new SimError('FileNotFoundError', `[Errno 2] No such file or directory: '/dev/spidev${bus}.${dev}' (simulator provides spidev0.0 and spidev0.1)`);
    const pins = [SPI0.mosi, SPI0.miso, SPI0.sclk, SPI0.ce[dev]];
    for (const p of pins) {
      const o = this.claims.get(p);
      if (o && !o.startsWith('spi')) throw new SimError('OSError', `[Errno 16] Device or resource busy: GPIO${p} is used by ${o}`);
    }
    for (const p of pins) this.claims.set(p, 'spi0');
    Object.assign(this.gpio[SPI0.mosi], { mode: 'alt', alt: 'SPI0 MOSI', pull: 'none' });
    Object.assign(this.gpio[SPI0.sclk], { mode: 'alt', alt: 'SPI0 SCLK', pull: 'none' });
    Object.assign(this.gpio[SPI0.miso], { mode: 'alt', alt: 'SPI0 MISO', pull: 'none' });
    Object.assign(this.gpio[SPI0.ce[dev]], { mode: 'alt', alt: `SPI0 CE${dev}`, pull: 'none' });
    this.evaluate();
  }

  spiXfer(dev: number, bytes: number[]): number[] {
    this.requirePi();
    const g = this.net.gpioNet;
    for (const c of this.doc.components) {
      if (c.type !== 'mcp3008') continue;
      const ok =
        this.pinNet(c.id, 'CLK') === g.get(SPI0.sclk) &&
        this.pinNet(c.id, 'DIN') === g.get(SPI0.mosi) &&
        this.pinNet(c.id, 'DOUT') === g.get(SPI0.miso) &&
        this.pinNet(c.id, 'CS') === g.get(SPI0.ce[dev]) &&
        this.pinNet(c.id, 'DGND') === this.net.groundNet;
      if (!ok || !this.vis.get(c.id)?.powered) continue;
      return this.device(c.id)!.spiXfer!(bytes);
    }
    this.issueOnce('W_SPI_NO_DEVICE', { dev });
    return bytes.map(() => 0);
  }

  // ------------------------------------------------------------ DHT / 1-Wire
  private pulledUp(netId: number, maxOhms: number): boolean {
    return hasPullupResistor(this, netId, maxOhms);
  }

  dhtRead(b: number): { temperature: number; humidity: number } | { error: 'not_found' | 'timeout' } {
    this.requirePi();
    const netId = this.net.gpioNet.get(b);
    for (const c of this.doc.components) {
      if (c.type !== 'dht22' || netId === undefined || this.pinNet(c.id, 'DATA') !== netId) continue;
      const fault = this.propsOf(c).fault ?? 'none';
      if (!this.vis.get(c.id)?.powered || fault === 'disconnected' || !this.sharesGround(c.id)) return { error: 'not_found' };
      if (!this.pulledUp(netId, 20000)) return { error: 'not_found' };
      if (fault === 'timeout' && Math.random() < 0.6) return { error: 'timeout' };
      if (fault === 'invalid') return { temperature: -40, humidity: 0 };
      return { temperature: Math.round(this.sensorValue(c, 'temperature') * 10) / 10, humidity: Math.round(this.sensorValue(c, 'humidity') * 10) / 10 };
    }
    return { error: 'not_found' };
  }

  w1Id(compId: string) {
    return `28-${hash12(compId)}`;
  }

  w1List(): string[] {
    this.requirePi();
    if (!this.piProps()?.onewire) return [];
    const netId = this.net.gpioNet.get(ONEWIRE_DEFAULT_PIN);
    if (netId === undefined) return [];
    const out: string[] = [];
    for (const c of this.doc.components) {
      if (c.type !== 'ds18b20' || this.pinNet(c.id, 'DQ') !== netId) continue;
      if (!this.vis.get(c.id)?.powered || (this.propsOf(c).fault ?? 'none') === 'disconnected' || !this.sharesGround(c.id)) continue;
      if (!this.pulledUp(netId, 10000)) continue;
      out.push(this.w1Id(c.id));
    }
    return out;
  }

  w1Read(id: string): string | null {
    if (!this.w1List().includes(id)) return null;
    const c = this.doc.components.find((x) => x.type === 'ds18b20' && this.w1Id(x.id) === id)!;
    const fault = this.propsOf(c).fault ?? 'none';
    let milli = Math.round(this.sensorValue(c, 'temperature') * 16) * 62.5;
    if (fault === 'reset85') milli = 85000;
    const raw = Math.round(milli / 62.5) & 0xffff;
    const lo = (raw & 0xff).toString(16).padStart(2, '0');
    const hi = ((raw >> 8) & 0xff).toString(16).padStart(2, '0');
    const bytes = `${lo} ${hi} 4b 46 7f ff 0c 10 1c`;
    const bad = fault === 'invalid' || (fault === 'timeout' && Math.random() < 0.5);
    return `${bytes} : crc=1c ${bad ? 'NO' : 'YES'}\n${bytes} t=${bad ? -62 : Math.round(milli)}\n`;
  }

  cpuTemp() {
    return 48 + (this.running ? 4 : 0) + Math.sin(this.clock.now() / 30) * 1.5;
  }

  // ------------------------------------------------------------ UI interactions
  pressButton(compId: string, pressed: boolean) {
    this.rtOf(compId).pressed = pressed;
    this.evaluate();
  }

  nextionTouch(compId: string, name: string, press: boolean) {
    const d = this.device(compId) as NextionRuntime | null;
    d?.touch(name, press, this.clock.now());
  }

  serialType(compId: string, text: string) {
    const d = this.device(compId) as SerialTerminal | null;
    d?.type(text, this.clock.now());
  }

  setPiPowered(on: boolean) {
    this.piPowered = on;
    this.evaluate();
  }

  resetSimulation() {
    this.rt.clear();
    this.devices.clear();
    this.powerState.clear();
    this.uartLog = [];
    this.logs = [];
    this.runtimeIssues.clear();
    this.farm.reset(this.doc.farm, this.clock.now());
    this.evaluate();
  }

  gpioStateTable() {
    return this.gpio.map((g) => ({
      ...g,
      phys: BCM_TO_PHYS[g.bcm],
      level: this.readLevel(g.bcm).value,
      v: this.net.gpioNet.has(g.bcm) ? this.netVoltage(this.net.gpioNet.get(g.bcm)!) : null,
      owner: this.claims.get(g.bcm),
    }));
  }
}

function garble(bytes: number[]) {
  return bytes.map((b, i) => (b * 37 + 91 + i * 13) & 0xff);
}

function mergeVis(parts: { v: Record<string, any>; w: number }[]): Record<string, any> {
  if (parts.length === 1) return parts[0].v;
  const total = parts.reduce((s, p) => s + p.w, 0) || 1;
  const out: Record<string, any> = {};
  const heaviest = parts.reduce((a, b) => (b.w > a.w ? b : a));
  for (const key of Object.keys(heaviest.v)) {
    const vals = parts.map((p) => p.v[key]);
    if (vals.every((x) => typeof x === 'number')) out[key] = parts.reduce((s, p) => s + p.v[key] * p.w, 0) / total;
    else if (vals.every((x) => typeof x === 'boolean')) out[key] = parts.reduce((s, p) => s + (p.v[key] ? p.w : 0), 0) / total >= 0.5;
    else out[key] = heaviest.v[key];
  }
  return out;
}
