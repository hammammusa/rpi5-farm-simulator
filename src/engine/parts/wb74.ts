// Wiren Board 7.4 controller and the WB-MR6C Modbus relay module as circuit parts.
// WB7.4 terminals: V+ (9…48 V DC), GND, A1–A4 universal channels (open-collector output to
// GND, 30 V / 1 A with over-current protection; input with voltage measurement 0…36.3 V),
// W1–W2 (1-Wire at 5 V), RS-485-1 and RS-485-2 (A/B). The drivers that publish these over
// MQTT live in engine/wb/wbSystem.ts.
import { WB74, WB74_ADC_MAX_V, WB74_OUT_MAX_A, WB74_OUT_MAX_V, WB74_SUPPLY } from '../boards/wb74';
import type { PinDef } from '../types';
import { FAULT, pin, type PartManifest } from './base';
import { modbusCrc } from '../devices/serialDevices';
import type { DeviceHost, DeviceModel } from '../devices/device';

export const WB74_W = 200;
export const WB74_H = 170;

/** terminal blocks: power + A1–A4 on the bottom edge, W1/W2 + RS-485 on the top edge */
const BOTTOM = ['VIN1', 'VIN2', 'GND1', 'A1', 'A2', 'A3', 'A4', 'GND2'];
const TOP = ['W1', 'W2', 'GND3', 'RS1_A', 'RS1_B', 'RS2_A', 'RS2_B'];
const label = (id: string) => WB74.pins.find((p) => p.pin === id)!.label;

const pins: PinDef[] = [
  ...BOTTOM.map((id, i) => ({ id, label: label(id), x: 20 + i * 22, y: WB74_H, kind: (id.startsWith('VIN') ? 'power' : id.startsWith('GND') ? 'ground' : 'digital') as PinDef['kind'], desc: desc(id) })),
  ...TOP.map((id, i) => ({ id, label: label(id), x: 20 + i * 24, y: 0, kind: (id.startsWith('GND') ? 'ground' : 'digital') as PinDef['kind'], desc: desc(id) })),
];

function desc(id: string) {
  if (id.startsWith('VIN')) return 'V+ supply input, 9…48 V DC';
  if (id.startsWith('GND')) return 'GND (common)';
  if (/^A\d$/.test(id)) return `${id}: open-collector output to GND (30 V, 1 A, protected) · input / voltage measurement 0…36.3 V (MQTT wb-gpio/${id}_OUT, ${id}_IN, wb-adc/${id})`;
  if (/^W\d$/.test(id)) return `${id}: 1-Wire bus at 5 V (internal pull-up), DS18B20 sensors appear as wb-w1/28-…`;
  if (id.startsWith('RS1')) return `RS-485-1 line ${id.slice(-1)} (Modbus RTU, wb-mqtt-serial, port /dev/ttyRS485-1)`;
  return `RS-485-2 line ${id.slice(-1)} (Modbus RTU, port /dev/ttyRS485-2; shares the transceiver with CAN)`;
}

/** output transistor on-resistance and the assumed input pull-up of A1–A4 */
const R_ON = 0.3;
const R_PULLUP = 100000;

export const wb74: PartManifest = {
  type: 'wb74',
  name: 'Wiren Board 7.4 controller',
  short: 'WB7',
  category: 'board',
  manufacturer: 'Wiren Board',
  model: 'Wiren Board 7.4',
  description:
    'Linux automation controller for DIN rail. In this simulator it runs wb-rules scripts (JavaScript) and the standard drivers: wb-mqtt-gpio (A1–A4 outputs/inputs), wb-mqtt-adc (voltages), wb-mqtt-w1 (1-Wire) and wb-mqtt-serial (Modbus RTU on RS-485), all over its MQTT broker.',
  w: WB74_W,
  h: WB74_H,
  pins,
  // terminals run along the top and bottom edges: the name goes beside the housing
  labelAt: { x: -10, y: WB74_H / 2 + 4, anchor: 'end' },
  internal: () => [
    ['VIN1', 'VIN2'],
    ['GND1', 'GND2', 'GND3'],
  ],
  props: [
    { key: 'wifiSsid', label: 'Wi-Fi access point SSID', type: 'string', default: 'WirenBoard-AP', group: 'config', help: 'ESP32 boards join this network with WiFi.begin / network.WLAN.connect.' },
    { key: 'wifiPass', label: 'Wi-Fi password', type: 'string', default: 'wirenboard', group: 'config' },
    { key: 'ip', label: 'IP address (MQTT broker on port 1883)', type: 'string', default: '192.168.42.1', group: 'config' },
    { key: 'rs1Baud', label: 'RS-485-1 baud rate', type: 'select', default: 9600, options: [2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => ({ value: b, label: `${b}` })), group: 'config' },
    { key: 'rs2Baud', label: 'RS-485-2 baud rate', type: 'select', default: 9600, options: [2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => ({ value: b, label: `${b}` })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.powerFail, { id: 'rs485_fail', label: 'RS-485 line failure', help: 'Modbus requests on both ports get no answer (cable cut, termination missing).' }],
  support: 'full',
  limits: WB74.limits,
  voltage: '9…48 V DC on V+; A1–A4 30 V / 1 A; W1/W2 5 V',
  interfaces: ['A1–A4 universal I/O', '1-Wire ×2', 'RS-485 ×2 (Modbus RTU)', 'MQTT broker', 'Wi-Fi access point (virtual)'],
  python: 'wb-rules (JavaScript ES5): defineRule, whenChanged/asSoonAs/when/cron, dev["device/control"], defineVirtualDevice, setTimeout/setInterval, startTimer/startTicker, publish, trackMqtt, log',
  commonErrors: [
    'Powering the board from 5 V or 12 V below 9 V: it does not start (the supply must be 9…48 V DC).',
    'Driving a load from A1–A4 without connecting the load to V+: the outputs only switch to GND (open collector).',
    'More than 1 A through an output: the protection switches it off.',
    'Swapping RS-485 A and B: Modbus devices never answer (timeouts in the log).',
  ],
  stamp(ctx) {
    const vin = ctx.node('VIN1');
    const gnd = ctx.node('GND1');
    // the controller itself draws ≈3 W
    ctx.R('load', vin, gnd, 48);
    if (!ctx.rt.powered || ctx.fault === 'power_fail') return;
    const out: boolean[] = ctx.rt.out ?? [];
    const trip: boolean[] = ctx.rt.trip ?? [];
    for (let n = 1; n <= 4; n++) {
      if (!ctx.connected(`A${n}`)) continue;
      const a = ctx.node(`A${n}`);
      if (out[n] && !trip[n]) ctx.R(`o${n}`, a, gnd, R_ON);
      else ctx.V(`pu${n}`, a, gnd, 5, R_PULLUP);
    }
    for (const w of ['W1', 'W2']) if (ctx.connected(w)) ctx.V(`pu${w}`, ctx.node(w), gnd, 5, 4700);
  },
  post(ctx) {
    const vin = ctx.connected('VIN1') && ctx.connected('GND1') ? ctx.volt('VIN1') - ctx.volt('GND1') : 0;
    const powered = ctx.fault !== 'power_fail' && vin >= WB74_SUPPLY.min && vin <= WB74_SUPPLY.max + 2 && !ctx.rt.damaged;
    if (vin > WB74_SUPPLY.max + 2) {
      ctx.issue('E_WB_OVERVOLTAGE', 'error', { v: vin.toFixed(1) }, ['VIN1']);
      ctx.rt.damaged = true;
    } else if (vin > 1 && vin < WB74_SUPPLY.min) ctx.issue('W_WB_UNDERVOLTAGE', 'warning', { v: vin.toFixed(1) }, ['VIN1']);
    if (powered !== !!ctx.rt.powered) ctx.rt.dirty = true;
    ctx.rt.powered = powered;
    const a: { v: number; i: number; out: boolean; trip: boolean }[] = [];
    const trip: boolean[] = (ctx.rt.trip ??= []);
    for (let n = 1; n <= 4; n++) {
      const v = ctx.connected(`A${n}`) ? Math.max(0, ctx.volt(`A${n}`) - ctx.volt('GND1')) : 0;
      const i = Math.abs(ctx.cur(`o${n}`));
      const on = !!ctx.rt.out?.[n];
      if (on && i > WB74_OUT_MAX_A && !trip[n]) {
        trip[n] = true;
        ctx.rt.dirty = true;
        ctx.issue('W_WB_OUT_OVERCURRENT', 'warning', { ch: `A${n}`, a: i.toFixed(2), max: WB74_OUT_MAX_A }, [`A${n}`]);
      }
      if (v > WB74_ADC_MAX_V) ctx.issue('E_WB_INPUT_OVERVOLTAGE', 'error', { ch: `A${n}`, v: v.toFixed(1), max: WB74_ADC_MAX_V }, [`A${n}`]);
      else if (!on && v > WB74_OUT_MAX_V + 0.5) ctx.issue('W_WB_OUT_VOLTAGE', 'warning', { ch: `A${n}`, v: v.toFixed(1), max: WB74_OUT_MAX_V }, [`A${n}`]);
      a.push({ v, i, out: on, trip: !!trip[n] });
    }
    return { powered, vin, a, running: ctx.sim.boardRunning(ctx.comp.id) };
  },
};

// ---------------------------------------------------------------- WB-MR6C relay module
/**
 * Wiren Board WB-MR6C: 6 relays controlled over Modbus RTU. Register map used here (from the
 * WB-MR6C documentation): coils 0–5 = relays K1–K6 (functions 01/05/15), holding register
 * 128 = Modbus address, 110 = baud rate / 100 (functions 03/06). 8N2 at 9600 baud by default.
 */
export class WbMr6c implements DeviceModel {
  constructor(private host: DeviceHost) {}
  uartBaud() {
    return Number(this.host.props().baud) || 9600;
  }
  private coils(): boolean[] {
    const rt = this.host.rt!();
    return (rt.coils ??= [false, false, false, false, false, false]);
  }
  rs485Receive(bytes: number[], t: number, reply: (b: number[], t: number) => void) {
    if (!this.host.powered() || this.host.fault() === 'disconnected') return;
    if (bytes.length < 8) return;
    const addr = bytes[0];
    if (addr !== (Number(this.host.props().slave) || 1)) return;
    const fn = bytes[1];
    const len = fn === 15 ? 9 + bytes[6] : 8;
    const fr = bytes.slice(0, len);
    const crc = modbusCrc(fr.slice(0, len - 2));
    if (crc[0] !== fr[len - 2] || crc[1] !== fr[len - 1]) return;
    const reg = (bytes[2] << 8) | bytes[3];
    const val = (bytes[4] << 8) | bytes[5];
    const coils = this.coils();
    let resp: number[];
    const ex = (code: number) => [addr, fn | 0x80, code];
    if (fn === 1) {
      if (val < 1 || reg + val > 6) resp = ex(2);
      else {
        let b = 0;
        for (let i = 0; i < val; i++) if (coils[reg + i]) b |= 1 << i;
        resp = [addr, 1, 1, b];
      }
    } else if (fn === 5) {
      if (reg > 5 || (val !== 0xff00 && val !== 0)) resp = ex(reg > 5 ? 2 : 3);
      else {
        coils[reg] = val === 0xff00;
        this.host.reevaluate?.();
        resp = bytes.slice(0, 6);
      }
    } else if (fn === 15) {
      if (reg + val > 6) resp = ex(2);
      else {
        for (let i = 0; i < val; i++) coils[reg + i] = ((bytes[7 + (i >> 3)] >> (i & 7)) & 1) === 1;
        this.host.reevaluate?.();
        resp = bytes.slice(0, 6);
      }
    } else if (fn === 3) {
      const regs: Record<number, number> = { 128: Number(this.host.props().slave) || 1, 110: this.uartBaud() / 100 };
      if (val !== 1 || regs[reg] === undefined) resp = ex(2);
      else resp = [addr, 3, 2, (regs[reg] >> 8) & 0xff, regs[reg] & 0xff];
    } else resp = ex(1);
    resp.push(...modbusCrc(resp));
    reply(resp, t + 0.01 + (resp.length * 11) / this.uartBaud());
  }
}

const mr6cPins: PinDef[] = [
  pin('VIN', 'V+', 0, 10, 'power'),
  pin('GND', 'GND', 0, 20, 'ground'),
  pin('A', 'A', 0, 40, 'digital'),
  pin('B', 'B', 0, 50, 'digital'),
  ...[1, 2, 3, 4, 5, 6].flatMap((k) => [pin(`COM${k}`, `K${k} COM`, 110, 10 + (k - 1) * 20, 'digital'), pin(`NO${k}`, `K${k} NO`, 110, 20 + (k - 1) * 20, 'digital')]),
];

export const wbMr6c: PartManifest = {
  type: 'wb_mr6c',
  name: 'WB-MR6C Modbus relay module (6 relays)',
  short: 'WB-MR6C',
  category: 'actuator',
  manufacturer: 'Wiren Board',
  model: 'WB-MR6C v2',
  description:
    'DIN-rail module with 6 relays controlled over RS-485 Modbus RTU. Connect A↔A and B↔B to the Wiren Board RS-485 port and 9…28 V to V+/GND. Coils 0–5 switch K1–K6 (COMx↔NOx). The Wiren Board publishes the relays as /devices/wb-mr6c_<address>/controls/K1…K6.',
  w: 110,
  h: 130,
  pins: mr6cPins,
  props: [
    { key: 'slave', label: 'Modbus address', type: 'number', default: 32, min: 1, max: 247, step: 1, unit: '', group: 'config' },
    { key: 'baud', label: 'Baud rate', type: 'select', default: 9600, options: [9600, 19200, 38400, 57600, 115200].map((b) => ({ value: b, label: `${b}` })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.disconnected, FAULT.relayStuckOpen],
  support: 'full',
  fidelity: 'functional',
  limits: 'Modbus RTU functions 01, 03, 05, 15 with CRC-16 and exception codes; relay contacts are solved in the circuit (10 A each). Inputs, counters and the module settings registers other than address/baud are not modelled.',
  voltage: '9…28 V DC',
  interfaces: ['RS-485 Modbus RTU'],
  python: 'Wiren Board: dev["wb-mr6c_32/K1"] = true · Raspberry Pi: minimalmodbus via MAX485 (write_bit(0, 1, functioncode=5))',
  drivers: ['wb-mqtt-serial', 'minimalmodbus'],
  device: (h) => new WbMr6c(h),
  stamp(ctx) {
    const vin = ctx.node('VIN');
    const gnd = ctx.node('GND');
    ctx.R('idd', vin, gnd, 600);
    const rt = ctx.rt;
    const fault = ctx.fault;
    for (let k = 1; k <= 6; k++) {
      // read the coil state at solve time: Modbus writes change it between two solves
      const on = (s: { volt(n: number): number }) => fault !== 'stuck_open' && !!rt.coils?.[k - 1] && s.volt(vin) - s.volt(gnd) >= 9;
      ctx.SW(`k${k}`, ctx.node(`COM${k}`), ctx.node(`NO${k}`), 0.02, on as any);
    }
  },
  post(ctx) {
    const v = ctx.volt('VIN') - ctx.volt('GND');
    const powered = v >= 9 && v <= 30;
    const ch: boolean[] = [];
    for (let k = 1; k <= 6; k++) {
      ch.push((ctx.c.get(ctx.id(`k${k}`)) as any)?.on === true);
      const i = Math.abs(ctx.cur(`k${k}`));
      if (i > 10) ctx.issue('E_RELAY_CONTACT_OVERLOAD', 'error', { a: i.toFixed(1) }, [`COM${k}`]);
    }
    if (ctx.connected('VIN') && v > 1 && v < 9) ctx.issue('W_RELAY_UNDERPOWERED', 'warning', { v: v.toFixed(1), coil: 12 }, ['VIN']);
    return { powered, ch, vs: v };
  },
};
