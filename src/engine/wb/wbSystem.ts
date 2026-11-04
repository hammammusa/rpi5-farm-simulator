// The software side of a Wiren Board 7.4 inside the simulation: its MQTT broker and the
// standard drivers that publish the hardware as MQTT "devices" (Wiren Board MQTT conventions):
//   wb-mqtt-gpio   /devices/wb-gpio/controls/A1_OUT (switch, writable via …/on), A1_IN (readonly)
//   wb-mqtt-adc    /devices/wb-adc/controls/A1…A4, Vin (voltage)
//   wb-mqtt-w1     /devices/wb-w1/controls/28-xxxxxxxxxxxx (temperature)
//   wb-mqtt-serial Modbus RTU devices on RS-485-1/2: /devices/<template>_<address>/controls/…
// Values are retained; each control has /meta/type, /meta/readonly and a JSON /meta.
// Modbus frames are real (CRC-16) and go to the device models on the A/B pair; missing
// answers become timeouts with /meta/error "r" (read) or "w" (write) like wb-mqtt-serial.
import type { Simulator } from '../simulator';
import { modbusCrc } from '../devices/serialDevices';
import { MqttBroker, type MqttMessage } from './mqtt';

export const DRIVER_CLIENT = 'wb-drivers';

type ControlType = 'switch' | 'voltage' | 'temperature' | 'value' | 'text' | 'rel_humidity';

interface Control {
  type: ControlType;
  readonly: boolean;
  order: number;
}

interface ModbusPoint {
  ctl: string;
  type: ControlType;
  /** register index in the polled block */
  reg: number;
  scale?: number;
  signed?: boolean;
  /** coil (writable switch) */
  coil?: boolean;
}

interface ModbusTemplate {
  id: string;
  title: string;
  /** function and block read on every poll */
  read: { fn: 1 | 3 | 4; start: number; count: number };
  points: ModbusPoint[];
}

/** wb-mqtt-serial templates for the Modbus parts of the library */
export const MODBUS_TEMPLATES: Record<string, ModbusTemplate> = {
  wb_mr6c: {
    id: 'wb-mr6c',
    title: 'WB-MR6C',
    read: { fn: 1, start: 0, count: 6 },
    points: [1, 2, 3, 4, 5, 6].map((k) => ({ ctl: `K${k}`, type: 'switch' as const, reg: k - 1, coil: true })),
  },
  rs485_soil: {
    id: 'soil-probe',
    title: 'RS-485 soil probe',
    read: { fn: 3, start: 0, count: 7 },
    points: [
      { ctl: 'Moisture', type: 'rel_humidity', reg: 0, scale: 0.1 },
      { ctl: 'Temperature', type: 'temperature', reg: 1, scale: 0.1, signed: true },
      { ctl: 'EC', type: 'value', reg: 2 },
      { ctl: 'pH', type: 'value', reg: 3, scale: 0.1 },
      { ctl: 'N', type: 'value', reg: 4 },
      { ctl: 'P', type: 'value', reg: 5 },
      { ctl: 'K', type: 'value', reg: 6 },
    ],
  },
};

interface BusDevice {
  comp: string;
  type: string;
  addr: number;
  port: 1 | 2;
  tpl: ModbusTemplate;
  name: string;
  errors: number;
  nextPoll: number;
}

export interface WbLogLine {
  t: number;
  level: 'info' | 'warning' | 'error' | 'debug';
  src: string;
  msg: string;
}

const fmtNum = (v: number, digits: number) => String(Number(v.toFixed(digits)));

export class WbSystem {
  broker = new MqttBroker();
  log: WbLogLine[] = [];
  private controls = new Map<string, Control>();
  private values = new Map<string, string>();
  private wasPowered = false;
  private nextW1 = 0;
  private devs = new Map<string, BusDevice>();
  private warned = new Set<string>();
  /** listeners for log lines (the UI terminal of this controller) */
  onLog: ((l: WbLogLine) => void) | null = null;

  constructor(
    private sim: Simulator,
    readonly id: string,
  ) {}

  powered() {
    return !!this.sim.vis.get(this.id)?.powered;
  }

  private rt() {
    return this.sim.rtOf(this.id);
  }

  addLog(level: WbLogLine['level'], src: string, msg: string, t = this.sim.clock.now()) {
    const l = { t, level, src, msg };
    this.log.push(l);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.onLog?.(l);
  }

  /** the board lost power or the project was reset: broker and drivers start from scratch */
  reset() {
    this.broker.reset();
    this.controls.clear();
    this.values.clear();
    this.devs.clear();
    this.wasPowered = false;
    const rt = this.rt();
    rt.out = [];
    rt.trip = [];
  }

  private boot(t: number) {
    this.broker.reset();
    this.controls.clear();
    this.values.clear();
    this.devs.clear();
    this.broker.connect(DRIVER_CLIENT, (m) => this.onCommand(m));
    this.broker.subscribe(DRIVER_CLIENT, '/devices/+/controls/+/on', t);
    this.addLog('info', 'system', `Wiren Board 7.4 started — MQTT broker on ${this.sim.propsOf(this.sim.comp(this.id)!).ip ?? '192.168.42.1'}:1883`, t);
    this.deviceMeta('wb-gpio', 'Discrete I/O', t);
    this.deviceMeta('wb-adc', 'ADCs', t);
    this.deviceMeta('wb-w1', '1-Wire Thermometers', t);
    for (let n = 1; n <= 4; n++) this.publishControl('wb-gpio', `A${n}_OUT`, '0', { type: 'switch', readonly: false, order: n * 2 }, t);
  }

  private deviceMeta(dev: string, title: string, t: number) {
    this.broker.publish(DRIVER_CLIENT, `/devices/${dev}/meta/name`, title, true, t);
    this.broker.publish(DRIVER_CLIENT, `/devices/${dev}/meta`, JSON.stringify({ driver: dev.startsWith('wb-') ? `wb-mqtt-${dev.slice(3)}` : 'wb-mqtt-serial', title: { en: title } }), true, t);
  }

  publishControl(dev: string, ctl: string, value: string, c: Control, t: number) {
    const key = `${dev}/${ctl}`;
    if (!this.controls.has(key)) {
      this.controls.set(key, c);
      const base = `/devices/${dev}/controls/${ctl}`;
      this.broker.publish(DRIVER_CLIENT, `${base}/meta/type`, c.type, true, t);
      this.broker.publish(DRIVER_CLIENT, `${base}/meta/readonly`, c.readonly ? '1' : '0', true, t);
      this.broker.publish(DRIVER_CLIENT, `${base}/meta/order`, String(c.order), true, t);
      this.broker.publish(DRIVER_CLIENT, `${base}/meta`, JSON.stringify({ type: c.type, readonly: c.readonly, order: c.order }), true, t);
    }
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    this.broker.publish(DRIVER_CLIENT, `/devices/${dev}/controls/${ctl}`, value, true, t);
  }

  private setError(dev: string, ctl: string, err: '' | 'r' | 'w', t: number) {
    const key = `${dev}/${ctl}#err`;
    if ((this.values.get(key) ?? '') === err) return;
    this.values.set(key, err);
    this.broker.publish(DRIVER_CLIENT, `/devices/${dev}/controls/${ctl}/meta/error`, err, true, t);
  }

  value(dev: string, ctl: string) {
    return this.values.get(`${dev}/${ctl}`);
  }

  // ---------------------------------------------------------------- commands (…/on)
  private onCommand(m: MqttMessage) {
    const p = /^\/devices\/([^/]+)\/controls\/([^/]+)\/on$/.exec(m.topic);
    if (!p) return;
    const [, dev, ctl] = p;
    const on = m.payload === '1' || m.payload.toLowerCase() === 'true';
    if (dev === 'wb-gpio') {
      const o = /^A([1-4])_OUT$/.exec(ctl);
      if (!o) return this.addLog('warning', 'wb-mqtt-gpio', `${ctl} is read-only`, m.t);
      this.setOutput(Number(o[1]), on, m.t);
      return;
    }
    const d = [...this.devs.values()].find((x) => x.name === dev);
    const pt = d?.tpl.points.find((x) => x.ctl === ctl);
    if (!d || !pt?.coil) return;
    const frame = [d.addr, 5, 0, pt.reg, on ? 0xff : 0, 0];
    frame.push(...modbusCrc(frame));
    const resp = this.request(d.port, frame, m.t);
    if (!resp) {
      this.setError(dev, ctl, 'w', m.t);
      this.addLog('error', 'wb-mqtt-serial', `${this.portName(d.port)}: modbus: request timed out writing ${dev}/${ctl} (slave ${d.addr})`, m.t);
      return;
    }
    this.setError(dev, ctl, '', m.t);
    this.publishControl(dev, ctl, on ? '1' : '0', { type: 'switch', readonly: false, order: pt.reg + 1 }, m.t);
  }

  setOutput(n: number, on: boolean, t: number) {
    const rt = this.rt();
    rt.out ??= [];
    rt.trip ??= [];
    rt.out[n] = on;
    if (on) rt.trip[n] = false; // switching on again re-arms the protection
    this.sim.evaluate(t);
    this.publishControl('wb-gpio', `A${n}_OUT`, on ? '1' : '0', { type: 'switch', readonly: false, order: n * 2 }, t);
  }

  // ---------------------------------------------------------------- periodic driver work
  tick(t: number) {
    const powered = this.powered();
    if (!powered) {
      if (this.wasPowered) {
        this.addLog('warning', 'system', 'power lost — the controller is off', t);
        this.reset();
      }
      return;
    }
    if (!this.wasPowered) {
      this.wasPowered = true;
      this.boot(t);
    }
    const v = this.sim.vis.get(this.id) ?? {};
    const a: { v: number; out: boolean; trip: boolean }[] = v.a ?? [];
    for (let n = 1; n <= 4; n++) {
      const ch = a[n - 1];
      if (!ch) continue;
      // input state: HIGH above 2.5 V (dry contact closed to GND reads 0)
      this.publishControl('wb-gpio', `A${n}_IN`, ch.v > 2.5 ? '1' : '0', { type: 'switch', readonly: true, order: n * 2 + 1 }, t);
      const prev = Number(this.value('wb-adc', `A${n}`) ?? NaN);
      if (!(Math.abs(prev - ch.v) < 0.05)) this.publishControl('wb-adc', `A${n}`, fmtNum(ch.v, 2), { type: 'voltage', readonly: true, order: n }, t);
      if (ch.trip && this.value('wb-gpio', `A${n}_OUT`) === '1') {
        this.addLog('error', 'wb-mqtt-gpio', `A${n}: over-current protection switched the output off (> 1 A)`, t);
        this.sim.issueOnce('W_WB_OUT_OVERCURRENT', { ch: `A${n}`, a: '>1', max: 1 }, 'warning', [this.id]);
        this.setOutput(n, false, t);
      }
    }
    const vin = Number(this.value('wb-adc', 'Vin') ?? NaN);
    if (!(Math.abs(vin - v.vin) < 0.1)) this.publishControl('wb-adc', 'Vin', fmtNum(v.vin ?? 0, 1), { type: 'voltage', readonly: true, order: 10 }, t);
    if (t >= this.nextW1) {
      this.nextW1 = t + 1;
      this.pollW1(t);
    }
    this.pollModbus(t);
  }

  private pollW1(t: number) {
    for (const w of ['W1', 'W2']) {
      const net = this.sim.net.boardNet.get(this.id)?.get(w === 'W1' ? 101 : 102);
      if (net === undefined) continue;
      for (const rid of this.sim.w1ListNet(net, 4700, true)) {
        const txt = this.sim.w1Read(rid, net, true);
        const m = txt && /YES/.test(txt) ? /t=(-?\d+)/.exec(txt) : null;
        if (m) {
          this.publishControl('wb-w1', rid, fmtNum(Number(m[1]) / 1000, 3), { type: 'temperature', readonly: true, order: 1 }, t);
          this.setError('wb-w1', rid, '', t);
        } else if (this.values.has(`wb-w1/${rid}`)) this.setError('wb-w1', rid, 'r', t);
      }
    }
  }

  // ---------------------------------------------------------------- Modbus RTU (wb-mqtt-serial)
  private portName(port: 1 | 2) {
    return `/dev/ttyRS485-${port}`;
  }

  /** Modbus devices whose A and B are wired to this controller's RS-485 port */
  private scanBus(t: number) {
    const nets = this.sim.net.boardNet.get(this.id);
    const seen = new Set<string>();
    for (const port of [1, 2] as const) {
      const na = this.sim.pinNetOf(this.id, `RS${port}_A`);
      const nb = this.sim.pinNetOf(this.id, `RS${port}_B`);
      if (na < 0 || nb < 0) continue;
      for (const c of this.sim.doc.components) {
        const tpl = MODBUS_TEMPLATES[c.type];
        if (!tpl) continue;
        const ca = this.sim.pinNetOf(c.id, 'A');
        const cb = this.sim.pinNetOf(c.id, 'B');
        if (ca === nb && cb === na && !this.warned.has(`swap:${c.id}`)) {
          this.warned.add(`swap:${c.id}`);
          this.addLog('error', 'wb-mqtt-serial', `${c.label || c.id}: RS-485 A and B are swapped (device A → controller B). Modbus will time out.`, t);
        }
        if (ca !== na || cb !== nb) continue;
        const addr = Number(this.sim.propsOf(c).slave) || 1;
        const key = `${port}:${c.id}`;
        seen.add(key);
        if (!this.devs.has(key)) {
          const name = `${tpl.id}_${addr}`;
          this.devs.set(key, { comp: c.id, type: c.type, addr, port, tpl, name, errors: 0, nextPoll: t });
          this.deviceMeta(name, `${tpl.title} (${addr})`, t);
          this.addLog('info', 'wb-mqtt-serial', `${this.portName(port)}: device ${name} added (slave ${addr})`, t);
        } else this.devs.get(key)!.addr = addr;
      }
    }
    void nets;
    for (const k of [...this.devs.keys()]) if (!seen.has(k)) this.devs.delete(k);
  }

  /** send one request frame on a port; returns the addressed device's valid reply or null (timeout) */
  request(port: 1 | 2, frame: number[], t: number): number[] | null {
    const comp = this.sim.comp(this.id)!;
    if ((this.sim.propsOf(comp).fault ?? 'none') === 'rs485_fail') return null;
    const baud = Number(this.sim.propsOf(comp)[`rs${port}Baud`]) || 9600;
    let answer: number[] | null = null;
    for (const d of this.devs.values()) {
      if (d.port !== port) continue;
      const dev = this.sim.device(d.comp);
      if (!dev?.rs485Receive) continue;
      const devBaud = dev.uartBaud?.() ?? 9600;
      // a device at another baud rate sees garbage: no valid frame, no answer
      const bytes = devBaud === baud ? frame : frame.map((b) => (b * 37 + 11) & 0xff);
      dev.rs485Receive(bytes, t, (r) => {
        if (devBaud !== baud) return;
        const crc = modbusCrc(r.slice(0, -2));
        if (crc[0] === r[r.length - 2] && crc[1] === r[r.length - 1]) answer = r;
      });
    }
    return answer;
  }

  private pollModbus(t: number) {
    this.scanBus(t);
    for (const d of this.devs.values()) {
      if (t < d.nextPoll) continue;
      d.nextPoll = t + 1;
      const { fn, start, count } = d.tpl.read;
      const frame = [d.addr, fn, start >> 8, start & 0xff, count >> 8, count & 0xff];
      frame.push(...modbusCrc(frame));
      const r = this.request(d.port, frame, t);
      if (!r || r[1] & 0x80) {
        d.errors++;
        for (const p of d.tpl.points) this.setError(d.name, p.ctl, 'r', t);
        if (d.errors === 1 || d.errors % 30 === 0)
          this.addLog('error', 'wb-mqtt-serial', r ? `${this.portName(d.port)}: ${d.name}: Modbus exception ${r[2]}` : `${this.portName(d.port)}: modbus: request timed out (slave ${d.addr}, ${d.name})`, t);
        continue;
      }
      if (d.errors) this.addLog('info', 'wb-mqtt-serial', `${d.name}: communication restored`, t);
      d.errors = 0;
      for (const p of d.tpl.points) {
        let val: string;
        if (fn === 1) val = (r[3] >> p.reg) & 1 ? '1' : '0';
        else {
          let x = (r[3 + p.reg * 2] << 8) | r[4 + p.reg * 2];
          if (p.signed && x & 0x8000) x -= 0x10000;
          val = fmtNum(x * (p.scale ?? 1), 2);
        }
        this.setError(d.name, p.ctl, '', t);
        this.publishControl(d.name, p.ctl, val, { type: p.type, readonly: !p.coil, order: p.reg + 1 }, t);
      }
    }
  }
}
