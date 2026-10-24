// ADCs, I/O expanders, I2C multiplexer, RTC/EEPROM, logic ICs, power modules and
// simple switching/isolation parts.
import type { PinDef, PropDef } from '../types';
import type { Solution } from '../solver';
import { FAULT, clamp, pin, type PartManifest, type PostCtx, type StampCtx } from './base';
import { powerPost } from './sensors';
import { Ads1115, At24c, Ds3231, Mcp23017, Pcf8574, Tca9548a } from '../devices/i2cDevices';

/** DIP package pins: 1..n/2 on the bottom row (left → right), n..n/2+1 on the top row. */
export function dip(names: string[], kinds: Record<string, PinDef['kind']> = {}, labels: Record<string, string> = {}): PinDef[] {
  const n = names.length;
  const half = n / 2;
  return names.map((id, i) => {
    const bottom = i < half;
    const x = bottom ? i * 10 : (n - 1 - i) * 10;
    return pin(id, labels[id] ?? id, x, bottom ? 30 : 0, kinds[id] ?? (/^(VCC|VDD)$/.test(id) ? 'power' : /^(GND|VSS)$/.test(id) ? 'ground' : 'digital'), `pin ${i + 1}`);
  });
}

const bit = (k: string, label: string): PropDef => ({ key: k, label, type: 'boolean', default: false, group: 'config' });

/** I2C pull-ups as fitted on breakout boards (to the board's VCC). */
function i2cPullups(ctx: StampCtx, vcc = 'VCC') {
  for (const s of ['SDA', 'SCL']) ctx.R(`pu${s}`, ctx.node(s), ctx.node(vcc), 10000);
}

function vccOf(ctx: PostCtx, vcc = 'VCC', gnd = 'GND') {
  return ctx.connected(vcc) && ctx.connected(gnd) ? ctx.volt(vcc) - ctx.volt(gnd) : 0;
}

/** logic level of an input pin relative to the chip GND (null when floating) */
function level(ctx: PostCtx, p: string, vcc: number, gnd = 'GND'): 0 | 1 | null {
  const n = ctx.node(p);
  if (n === -2 || (n >= 0 && !ctx.sol.driven[n])) return null;
  return ctx.volt(p) - ctx.volt(gnd) > 0.5 * Math.max(vcc, 1.8) ? 1 : 0;
}

// ---------------------------------------------------------------- ADS1115
export const ads1115: PartManifest = {
  type: 'ads1115',
  name: 'ADS1115 16-bit ADC (I2C)',
  short: 'ADS1115',
  model: 'ADS1115',
  manufacturer: 'Texas Instruments',
  category: 'interface',
  group: 'ADC & I/O expanders',
  description: '4-channel 16-bit delta-sigma ADC with programmable gain. I2C address set by the ADDR pin: GND 0x48, VDD 0x49, SDA 0x4A, SCL 0x4B (breakout pulls ADDR down). Inputs must stay between GND and VDD.',
  w: 100,
  h: 50,
  pins: [
    pin('VDD', 'VDD', 0, 40, 'power'),
    pin('GND', 'GND', 10, 40, 'ground'),
    pin('SCL', 'SCL', 20, 40, 'digital'),
    pin('SDA', 'SDA', 30, 40, 'digital'),
    pin('ADDR', 'ADDR', 40, 40, 'digital'),
    pin('ALRT', 'ALRT', 50, 40, 'digital'),
    pin('A0', 'A0', 60, 40, 'analog'),
    pin('A1', 'A1', 70, 40, 'analog'),
    pin('A2', 'A2', 80, 40, 'analog'),
    pin('A3', 'A3', 90, 40, 'analog'),
  ],
  props: [],
  faults: [FAULT.none, FAULT.noise],
  support: 'full',
  fidelity: 'full',
  limits: 'Pointer/config/conversion registers, MUX (single-ended and differential), PGA ±6.144…±0.256 V, single-shot and continuous mode. Conversion time, comparator/ALERT and data-rate noise are not modelled.',
  voltage: '2.0–5.5 V',
  interfaces: ['I2C'],
  python: 'adafruit_ads1x15.ads1115.ADS1115(i2c) + AnalogIn(ads, ads1115.P0) · smartfarm.ADS1115()',
  drivers: ['adafruit_ads1x15', 'smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new Ads1115(h),
  insertable: true,
  commonErrors: ['Input voltage above VDD (e.g. a 5 V sensor output into a 3.3 V-powered ADS1115)', 'Two ADS1115 with ADDR on the same pin (address conflict)'],
  stamp(ctx) {
    ctx.R('idd', ctx.node('VDD'), ctx.node('GND'), 20000);
    i2cPullups(ctx, 'VDD');
    ctx.R('addr', ctx.node('ADDR'), ctx.node('GND'), 10000);
    for (const a of ['A0', 'A1', 'A2', 'A3']) ctx.R(`in${a}`, ctx.node(a), ctx.node('GND'), 10e6);
  },
  post(ctx) {
    const vdd = vccOf(ctx, 'VDD');
    const powered = vdd >= 2.0;
    if (ctx.connected('VDD') && !powered) ctx.issue('W_UNPOWERED', 'warning', { v: vdd.toFixed(1), min: 2.0 }, ['VDD']);
    if (vdd > 5.8) ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vdd.toFixed(1), max: 5.5 }, ['VDD']);
    const ch: (number | null)[] = [];
    for (const a of ['A0', 'A1', 'A2', 'A3']) {
      const n = ctx.node(a);
      const others = ctx.connected(a);
      const v = ctx.volt(a) - ctx.volt('GND');
      ch.push(others && n !== -2 ? v : null);
      if (others && powered && v > vdd + 0.3) ctx.issue('W_ADC_INPUT_RANGE', 'warning', { pin: a, v: v.toFixed(2), vdd: vdd.toFixed(1) }, [a]);
    }
    return { powered, vdd, ch };
  },
};

// ---------------------------------------------------------------- PCF8574
const P8 = Array.from({ length: 8 }, (_, i) => `P${i}`);
export const pcf8574: PartManifest = {
  type: 'pcf8574',
  name: 'PCF8574 8-bit I/O expander',
  short: 'PCF8574',
  model: 'PCF8574',
  manufacturer: 'NXP / TI',
  category: 'interface',
  group: 'ADC & I/O expanders',
  description: 'Quasi-bidirectional 8-bit port over I2C (0x20–0x27; PCF8574A 0x38–0x3F). Writing 0 sinks current strongly; writing 1 releases the pin to a weak (~100 µA) pull-up so it can be read as an input.',
  w: 110,
  h: 50,
  pins: [pin('VCC', 'VCC', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), pin('SDA', 'SDA', 20, 40, 'digital'), pin('SCL', 'SCL', 30, 40, 'digital'), ...P8.map((p, i) => pin(p, p, 30 + i * 10, 0, 'digital')), pin('INT', 'INT', 110, 40, 'digital')],
  props: [bit('a0', 'A0 jumper (high)'), bit('a1', 'A1 jumper (high)'), bit('a2', 'A2 jumper (high)'), { key: 'variant', label: 'Chip', type: 'select', default: 'std', options: [{ value: 'std', label: 'PCF8574 (0x20–0x27)' }, { value: 'A', label: 'PCF8574A (0x38–0x3F)' }], group: 'config' }],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Latched outputs (strong LOW 25 Ω, weak HIGH ≈ 33 kΩ to VCC) and input reading of the real pin voltages. The INT output is not driven.',
  voltage: '2.5–6 V',
  interfaces: ['I2C'],
  python: 'smbus2 write_byte/read_byte · adafruit_pcf8574.PCF8574(i2c) · smartfarm.PCF8574()',
  drivers: ['adafruit_pcf8574', 'smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new Pcf8574(h),
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 50000);
    i2cPullups(ctx);
    const latch = ctx.rt.latch ?? 0xff;
    P8.forEach((p, i) => {
      if (latch & (1 << i)) ctx.R(`w${i}`, ctx.node(p), ctx.node('VCC'), 33000);
      else ctx.SW(`s${i}`, ctx.node(p), ctx.node('GND'), 25, true);
    });
  },
  post(ctx) {
    const vcc = vccOf(ctx);
    const powered = vcc >= 2.5;
    if (ctx.connected('VCC') && !powered) ctx.issue('W_UNPOWERED', 'warning', { v: vcc.toFixed(1), min: 2.5 }, ['VCC']);
    const levels = P8.map((p) => (ctx.volt(p) - ctx.volt('GND') > 0.5 * Math.max(vcc, 1) ? 1 : 0));
    return { powered, latch: ctx.rt.latch ?? 0xff, levels };
  },
};

// ---------------------------------------------------------------- MCP23017
const GP = [...Array.from({ length: 8 }, (_, i) => `GPA${i}`), ...Array.from({ length: 8 }, (_, i) => `GPB${i}`)];
export const mcp23017: PartManifest = {
  type: 'mcp23017',
  name: 'MCP23017 16-bit I/O expander',
  short: 'MCP23017',
  model: 'MCP23017',
  manufacturer: 'Microchip',
  category: 'interface',
  group: 'ADC & I/O expanders',
  description: '16 GPIOs over I2C (0x20–0x27 via A0–A2). IODIR (1 = input), GPPU pull-ups, GPIO/OLAT registers, IOCON.BANK = 0 map. /RESET must be pulled HIGH or the chip stays in reset.',
  w: 170,
  h: 50,
  pins: [
    pin('VDD', 'VDD', 0, 40, 'power'),
    pin('VSS', 'VSS', 10, 40, 'ground'),
    pin('SDA', 'SDA', 20, 40, 'digital'),
    pin('SCL', 'SCL', 30, 40, 'digital'),
    pin('RST', '/RESET', 40, 40, 'digital'),
    ...GP.map((p, i) => pin(p, p, 10 + i * 10, 0, 'digital')),
  ],
  props: [bit('a0', 'A0 (high)'), bit('a1', 'A1 (high)'), bit('a2', 'A2 (high)'), { key: 'resetPullup', label: 'Board pull-up on /RESET', type: 'boolean', default: true, group: 'config' }],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Registers IODIR, IPOL, GPPU, GPIO, OLAT (BANK = 0, sequential addressing). Outputs drive VDD/0 V (≈30 Ω), pull-ups are 100 kΩ. Interrupt-on-change registers are stored but INTA/INTB are not driven.',
  voltage: '1.8–5.5 V',
  interfaces: ['I2C'],
  python: 'adafruit_mcp230xx.mcp23017.MCP23017(i2c).get_pin(0) · smbus2 · smartfarm.MCP23017()',
  drivers: ['adafruit_mcp230xx', 'smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new Mcp23017(h),
  insertable: true,
  commonErrors: ['/RESET left floating (chip never answers)', 'Using a pin as output without clearing its IODIR bit'],
  stamp(ctx) {
    ctx.R('idd', ctx.node('VDD'), ctx.node('VSS'), 50000);
    i2cPullups(ctx, 'VDD');
    if (ctx.props.resetPullup) ctx.R('rstpu', ctx.node('RST'), ctx.node('VDD'), 10000);
    const iodir: number[] = ctx.rt.iodir ?? [0xff, 0xff];
    const olat: number[] = ctx.rt.olat ?? [0, 0];
    const gppu: number[] = ctx.rt.gppu ?? [0, 0];
    const vdd = ctx.rt.vs ?? 0;
    GP.forEach((p, i) => {
      const port = i >> 3;
      const b = 1 << (i & 7);
      if (!(iodir[port] & b)) ctx.V(`o${i}`, ctx.node(p), ctx.node('VSS'), olat[port] & b ? vdd : 0, 30);
      else if (gppu[port] & b) ctx.R(`pu${i}`, ctx.node(p), ctx.node('VDD'), 100000);
    });
  },
  post(ctx) {
    const vdd = vccOf(ctx, 'VDD', 'VSS');
    if (Math.abs((ctx.rt.vs ?? 0) - vdd) > 0.01) {
      ctx.rt.vs = vdd;
      ctx.rt.dirty = true;
    }
    const rst = ctx.volt('RST') - ctx.volt('VSS') > 0.8 * Math.max(vdd, 1);
    const powered = vdd >= 1.8 && rst;
    if (vdd >= 1.8 && !rst) ctx.issue('W_CHIP_IN_RESET', 'warning', { pin: '/RESET' }, ['RST']);
    const levels = GP.map((p) => (ctx.volt(p) - ctx.volt('VSS') > 0.5 * Math.max(vdd, 1) ? 1 : 0));
    return { powered, levels, vs: vdd };
  },
};

// ---------------------------------------------------------------- TCA9548A
const CH = Array.from({ length: 8 }, (_, i) => i);
export const tca9548a: PartManifest = {
  type: 'tca9548a',
  name: 'TCA9548A I2C multiplexer',
  short: 'TCA9548A',
  model: 'TCA9548A',
  manufacturer: 'Texas Instruments',
  category: 'interface',
  group: 'ADC & I/O expanders',
  description: '1-to-8 I2C switch (0x70–0x77). Write a channel bit-mask to the control register to connect downstream buses SDx/SCx — use it for several sensors with the same address.',
  w: 180,
  h: 50,
  pins: [
    pin('VIN', 'VIN', 0, 40, 'power'),
    pin('GND', 'GND', 10, 40, 'ground'),
    pin('SDA', 'SDA', 20, 40, 'digital'),
    pin('SCL', 'SCL', 30, 40, 'digital'),
    pin('RST', 'RST', 40, 40, 'digital'),
    ...CH.flatMap((c) => [pin(`SD${c}`, `SD${c}`, 20 + c * 20, 0, 'digital'), pin(`SC${c}`, `SC${c}`, 30 + c * 20, 0, 'digital')]),
  ],
  props: [bit('a0', 'A0 (high)'), bit('a1', 'A1 (high)'), bit('a2', 'A2 (high)')],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Control register and channel switching are modelled at bus-topology level: a device on SDx/SCx is reachable only while bit x is set. Downstream pull-ups are expected on the sensor boards.',
  voltage: '1.65–5.5 V',
  interfaces: ['I2C'],
  python: 'adafruit_tca9548a.TCA9548A(i2c)[n] · smbus2.write_byte(0x70, 1 << n) · smartfarm.I2CMux()',
  drivers: ['adafruit_tca9548a', 'smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new Tca9548a(h),
  stamp(ctx) {
    ctx.R('idd', ctx.node('VIN'), ctx.node('GND'), 50000);
    for (const s of ['SDA', 'SCL']) ctx.R(`pu${s}`, ctx.node(s), ctx.node('VIN'), 10000);
  },
  post(ctx) {
    const v = vccOf(ctx, 'VIN');
    return { powered: v >= 1.65, vs: v };
  },
};

// ---------------------------------------------------------------- DS3231 RTC + AT24C EEPROM + SD
export const ds3231: PartManifest = {
  type: 'ds3231',
  name: 'DS3231 real-time clock',
  short: 'DS3231',
  model: 'DS3231',
  manufacturer: 'Analog Devices (Maxim)',
  category: 'interface',
  group: 'Logic & memory ICs',
  description: 'Temperature-compensated RTC with CR2032 backup, I2C 0x68. Time registers are BCD (seconds … year). Keeps time across program runs; the on-chip temperature sensor reads to 0.25 °C.',
  w: 70,
  h: 50,
  pins: [pin('VCC', 'VCC', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), pin('SDA', 'SDA', 20, 40, 'digital'), pin('SCL', 'SCL', 30, 40, 'digital'), pin('SQW', 'SQW', 40, 40, 'digital'), pin('K32', '32K', 50, 40, 'digital')],
  props: [{ key: 'temperature', label: 'Board temperature', type: 'number', default: 25, min: -40, max: 85, step: 0.25, unit: '°C', live: true, group: 'sensor' }],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Time/date (24 h), control/status (OSF) and temperature registers. Alarms, SQW and the 32 kHz output are stored/not driven. Time advances with simulation time.',
  voltage: '2.3–5.5 V',
  interfaces: ['I2C'],
  python: 'adafruit_ds3231.DS3231(i2c).datetime · smbus2 · smartfarm.RTC()',
  drivers: ['adafruit_ds3231', 'smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new Ds3231(h),
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 20000);
    i2cPullups(ctx);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 2.3, 5.5);
    return { ...p, temperature: ctx.value('temperature') };
  },
};

export const at24c32: PartManifest = {
  type: 'at24c32',
  name: 'AT24C32 / AT24C256 EEPROM',
  short: 'EEPROM',
  model: 'AT24C32',
  manufacturer: 'Microchip (Atmel)',
  category: 'interface',
  group: 'Logic & memory ICs',
  description: 'I2C serial EEPROM (4 KB or 32 KB), address 0x50–0x57 via A0–A2. Two address bytes, 32-byte page writes that wrap inside the page, sequential reads. Data survives program runs and power-off (cleared by "Reset simulation").',
  w: 60,
  h: 50,
  pins: [pin('VCC', 'VCC', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), pin('SDA', 'SDA', 20, 40, 'digital'), pin('SCL', 'SCL', 30, 40, 'digital'), pin('WP', 'WP', 40, 40, 'digital')],
  props: [bit('a0', 'A0 (high)'), bit('a1', 'A1 (high)'), bit('a2', 'A2 (high)'), { key: 'kbits', label: 'Size', type: 'select', default: 32, options: [{ value: 32, label: 'AT24C32 (4 KB)' }, { value: 256, label: 'AT24C256 (32 KB)' }], group: 'config' }, { key: 'wp', label: 'Write-protect (WP high)', type: 'boolean', default: false, group: 'config' }],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Byte/page write and current/random/sequential read. The 5 ms write cycle and ACK polling are not modelled (writes complete immediately).',
  voltage: '1.8–5.5 V',
  interfaces: ['I2C'],
  python: 'smbus2 i2c_rdwr / write_i2c_block_data · smartfarm.EEPROM()',
  drivers: ['smbus2', 'smartfarm'],
  bus: 'i2c',
  device: (h) => new At24c(h),
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 50000);
    i2cPullups(ctx);
  },
  post(ctx) {
    return powerPost(ctx, 'VCC', 'GND', 1.8, 5.5);
  },
};

export const sdCardModule: PartManifest = {
  type: 'sd_module',
  name: 'SPI micro-SD card module',
  short: 'SD module',
  category: 'interface',
  group: 'Logic & memory ICs',
  description: 'Micro-SD adapter with SPI pins and a 3.3 V regulator. On a Raspberry Pi you normally store files on the boot SD card or a USB stick instead.',
  w: 60,
  h: 60,
  pins: [pin('GND', 'GND', 0, 50, 'ground'), pin('VCC', 'VCC', 10, 50, 'power'), pin('MISO', 'MISO', 20, 50, 'digital'), pin('MOSI', 'MOSI', 30, 50, 'digital'), pin('SCK', 'SCK', 40, 50, 'digital'), pin('CS', 'CS', 50, 50, 'digital')],
  props: [],
  support: 'partial',
  fidelity: 'visual',
  limits: 'VISUAL ONLY: drawn and documented for wiring diagrams and the BOM. The SD-card SPI protocol and a FAT file system are not simulated, so Python cannot use this module.',
  voltage: '3.3–5 V',
  interfaces: ['SPI (not simulated)'],
  drivers: [],
};

// ---------------------------------------------------------------- 74HC595 shift register
const HC595 = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND', 'Q7S', 'MR', 'SHCP', 'STCP', 'OE', 'DS', 'Q0', 'VCC'];
export const hc595: PartManifest = {
  type: 'hc595',
  name: '74HC595 shift register',
  short: '74HC595',
  model: 'SN74HC595N',
  manufacturer: 'Texas Instruments / Nexperia',
  category: 'interface',
  group: 'Logic & memory ICs',
  description: 'Serial-in, parallel-out 8-bit shift register with output latch (DIP-16). DS = data, SHCP = shift clock, STCP = latch clock, /OE LOW enables outputs, /MR HIGH for normal operation. Drive up to 8 LEDs from 3 GPIOs.',
  w: 70,
  h: 30,
  pins: dip(HC595, {}, { MR: '/MR (pin 10)', OE: '/OE (pin 13)', SHCP: 'SHCP / SRCLK', STCP: 'STCP / RCLK', DS: 'DS / SER' }),
  props: [],
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Edge-accurate logic model: shift on SHCP rising edge, latch on STCP rising edge, asynchronous /MR clear, /OE tri-state. Each output drives VCC/0 V through ≈50 Ω (35 mA abs. max is checked).',
  voltage: '2–6 V',
  interfaces: ['GPIO bit-bang (SPI-like)'],
  python: 'gpiozero.OutputDevice ×3 / RPi.GPIO / spidev · smartfarm.ShiftRegister(data, clock, latch)',
  drivers: ['gpiozero', 'RPi.GPIO', 'spidev', 'smartfarm'],
  insertable: true,
  commonErrors: ['/MR left floating or LOW: the register is held cleared', '/OE left floating: outputs disabled — tie it to GND'],
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 100000);
    const vcc = ctx.rt.vcc ?? 0;
    if (vcc < 2 || !ctx.rt.oe) return;
    const latch = ctx.rt.latch ?? 0;
    for (let i = 0; i < 8; i++) ctx.V(`q${i}`, ctx.node(`Q${i}`), ctx.node('GND'), latch & (1 << i) ? vcc : 0, 50);
    ctx.V('q7s', ctx.node('Q7S'), ctx.node('GND'), (ctx.rt.sr ?? 0) & 0x80 ? vcc : 0, 50);
  },
  post(ctx) {
    const vcc = vccOf(ctx);
    const L = (p: string) => level(ctx, p, vcc);
    let sr = ctx.rt.sr ?? 0;
    let latch = ctx.rt.latch ?? 0;
    const mr = L('MR');
    const sh = L('SHCP') === 1;
    const st = L('STCP') === 1;
    if (mr !== 1) sr = 0;
    else if (sh && !ctx.rt.psh) sr = ((sr << 1) | (L('DS') === 1 ? 1 : 0)) & 0xff;
    if (st && !ctx.rt.pst) latch = sr;
    ctx.rt.psh = sh;
    ctx.rt.pst = st;
    const oe = L('OE') === 0;
    if (sr !== ctx.rt.sr || latch !== ctx.rt.latch || oe !== ctx.rt.oe || Math.abs((ctx.rt.vcc ?? 0) - vcc) > 0.05) {
      Object.assign(ctx.rt, { sr, latch, oe, vcc });
      ctx.rt.dirty = true;
    }
    if (vcc >= 2 && mr === null) ctx.issue('W_LOGIC_INPUT_FLOATING', 'warning', { pin: '/MR' }, ['MR']);
    if (vcc >= 2 && L('OE') === null) ctx.issue('W_LOGIC_INPUT_FLOATING', 'warning', { pin: '/OE' }, ['OE']);
    for (let i = 0; i < 8; i++) if (Math.abs(ctx.cur(`q${i}`)) > 0.035) ctx.issue('W_IC_OUTPUT_CURRENT', 'warning', { pin: `Q${i}`, ma: Math.round(Math.abs(ctx.cur(`q${i}`)) * 1000) }, [`Q${i}`]);
    return { powered: vcc >= 2, sr, latch, outputs: oe ? latch : null };
  },
};

// ---------------------------------------------------------------- 74HC logic gates
function gate(type: string, name: string, model: string, fn: (a: number, b: number) => number, inverter = false): PartManifest {
  const names = inverter
    ? ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC']
    : ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
  const gates = inverter ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4];
  return {
    type,
    name,
    short: model,
    model,
    category: 'semiconductor',
    group: 'Logic & memory ICs',
    description: `${name} (DIP-14, HC CMOS, 2–6 V). Pin 7 = GND, pin 14 = VCC. Unused inputs must be tied HIGH or LOW.`,
    w: 60,
    h: 30,
    pins: dip(names),
    props: [],
    faults: [FAULT.none, FAULT.burned],
    support: 'full',
    fidelity: 'full',
    limits: 'Ideal combinational logic: VIH ≥ VCC/2, outputs VCC/0 V through ≈50 Ω, zero propagation delay. Floating inputs read LOW and are reported.',
    voltage: '2–6 V',
    interfaces: ['Digital logic'],
    python: 'drive inputs with gpiozero.OutputDevice, read outputs with gpiozero.DigitalInputDevice',
    drivers: ['gpiozero', 'RPi.GPIO'],
    insertable: true,
    stamp(ctx) {
      ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 200000);
      const vcc = ctx.rt.vcc ?? 0;
      if (vcc < 2 || ctx.fault === 'burned') return;
      const out = ctx.rt.out ?? 0;
      for (const g of gates) ctx.V(`y${g}`, ctx.node(`${g}Y`), ctx.node('GND'), out & (1 << g) ? vcc : 0, 50);
    },
    post(ctx) {
      const vcc = vccOf(ctx);
      let out = 0;
      const floating: string[] = [];
      for (const g of gates) {
        const a = level(ctx, `${g}A`, vcc);
        const b = inverter ? 0 : level(ctx, `${g}B`, vcc);
        if (a === null && ctx.connected(`${g}Y`)) floating.push(`${g}A`);
        if (!inverter && b === null && ctx.connected(`${g}Y`)) floating.push(`${g}B`);
        if (fn(a ?? 0, b ?? 0)) out |= 1 << g;
      }
      if (out !== ctx.rt.out || Math.abs((ctx.rt.vcc ?? 0) - vcc) > 0.05) {
        ctx.rt.out = out;
        ctx.rt.vcc = vcc;
        ctx.rt.dirty = true;
      }
      if (vcc >= 2 && floating.length) ctx.issue('W_LOGIC_INPUT_FLOATING', 'warning', { pin: floating.join(', ') }, floating);
      return { powered: vcc >= 2, out };
    },
  };
}
export const hc08 = gate('hc08', '74HC08 quad AND gate', '74HC08', (a, b) => a & b);
export const hc32 = gate('hc32', '74HC32 quad OR gate', '74HC32', (a, b) => a | b);
export const hc86 = gate('hc86', '74HC86 quad XOR gate', '74HC86', (a, b) => a ^ b);
export const hc04 = gate('hc04', '74HC04 hex inverter (NOT)', '74HC04', (a) => (a ? 0 : 1), true);

// ---------------------------------------------------------------- PC817 optocoupler
export const pc817: PartManifest = {
  type: 'pc817',
  name: 'PC817 optocoupler',
  short: 'PC817',
  model: 'PC817',
  manufacturer: 'Sharp',
  category: 'semiconductor',
  group: 'Semiconductors',
  description: 'Opto-isolator (DIP-4): pin 1 anode, 2 cathode (input LED, use a series resistor ≈ 330 Ω–1 kΩ), pin 4 collector, 3 emitter (phototransistor). Isolates the Pi from a load circuit with a separate ground.',
  w: 30,
  h: 30,
  pins: dip(['A', 'K', 'E', 'C'], { A: 'passive', K: 'passive', E: 'passive', C: 'passive' }, { A: 'Anode (1)', K: 'Cathode (2)', E: 'Emitter (3)', C: 'Collector (4)' }),
  props: [],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  fidelity: 'full',
  limits: 'Input LED (Vf 1.2 V) and an output switch (≈100 Ω) that conducts when the LED current exceeds 1 mA (CTR not modelled as a linear gain).',
  voltage: 'IF ≤ 50 mA, VCEO 35 V',
  interfaces: ['Digital isolation'],
  python: 'gpiozero.OutputDevice (input side) / DigitalInputDevice (output side)',
  drivers: ['gpiozero', 'RPi.GPIO'],
  insertable: true,
  stamp(ctx) {
    if (ctx.fault === 'burned') return;
    ctx.D('led', ctx.node('A'), ctx.node('K'), 1.2, 30);
    const led = ctx.id('led');
    ctx.SW('ce', ctx.node('C'), ctx.node('E'), 100, (s: Solution) => s.cur(led) > 1e-3);
  },
  post(ctx) {
    const i = ctx.cur('led');
    if (i > 0.05) ctx.issue('W_LED_NO_RESISTOR', 'warning', { ma: Math.round(i * 1000) }, ['A', 'K']);
    return { on: i > 1e-3, ma: i * 1000 };
  },
};

// ---------------------------------------------------------------- bidirectional level shifter (BSS138)
const LVK = [1, 2, 3, 4];
export const levelShifter: PartManifest = {
  type: 'level_shifter',
  name: 'Logic level converter (BSS138, 4-ch)',
  short: 'Level shift',
  model: 'BSS138 4-channel board',
  category: 'interface',
  group: 'Communication',
  description: 'Bidirectional 3.3 V ↔ 5 V converter for I2C/UART/digital signals. LV = 3.3 V (from the Pi), HV = 5 V, common GND. Each channel has 10 kΩ pull-ups on both sides.',
  w: 90,
  h: 50,
  pins: [pin('LV', 'LV', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), ...LVK.map((k) => pin(`LV${k}`, `LV${k}`, 10 + k * 10, 40, 'digital')), pin('HV', 'HV', 0, 0, 'power'), pin('GND2', 'GND', 10, 0, 'ground'), ...LVK.map((k) => pin(`HV${k}`, `HV${k}`, 10 + k * 10, 0, 'digital'))],
  internal: () => [['GND', 'GND2']],
  props: [],
  support: 'full',
  fidelity: 'functional',
  limits: 'Switch model of the BSS138 + body diode: a channel conducts when either side is pulled more than ~1.2 V below LV. Edge rates and capacitance are not modelled.',
  voltage: 'LV 1.8–3.3 V, HV ≤ 10 V',
  interfaces: ['Digital / I2C / UART level translation'],
  insertable: true,
  stamp(ctx) {
    const gnd = ctx.node('GND');
    const lv = ctx.node('LV');
    for (const k of LVK) {
      const l = ctx.node(`LV${k}`);
      const h = ctx.node(`HV${k}`);
      ctx.R(`pl${k}`, l, lv, 10000);
      ctx.R(`ph${k}`, h, ctx.node('HV'), 10000);
      ctx.SW(`fet${k}`, l, h, 8, (s: Solution) => {
        const vlv = s.volt(lv) - s.volt(gnd);
        if (vlv < 1.5) return false;
        return s.volt(l) - s.volt(gnd) < vlv - 1.2 || s.volt(h) - s.volt(gnd) < vlv - 1.2;
      });
    }
  },
  post(ctx) {
    const lv = vccOf(ctx, 'LV');
    const hv = vccOf(ctx, 'HV');
    if (ctx.connected('LV') && ctx.connected('HV') && lv > hv + 0.3) ctx.issue('W_LEVEL_SIDES_SWAPPED', 'warning', { lv: lv.toFixed(1), hv: hv.toFixed(1) }, ['LV', 'HV']);
    return { lv, hv, powered: lv > 1.5 };
  },
};

// ---------------------------------------------------------------- regulators & power modules
function linearReg(type: string, name: string, model: string, vout: number, dropout: number, vinMax: number, imax: number): PartManifest {
  return {
    type,
    name,
    short: model,
    model,
    category: 'power',
    group: 'Power',
    description: `${name}: VIN → fixed ${vout} V output (dropout ≈ ${dropout} V, max ${imax} A). Input current ≈ output current (the difference is lost as heat). Add 10 µF capacitors on input and output on real hardware.`,
    w: 40,
    h: 40,
    pins: [pin('VIN', 'VIN', 0, 30, 'power'), pin('GND', 'GND', 20, 30, 'ground'), pin('VOUT', 'VOUT', 40, 30, 'power')],
    props: [],
    faults: [FAULT.none, FAULT.burned],
    support: 'full',
    fidelity: 'full',
    limits: 'Ideal regulator with dropout and current limit; quiescent current, thermal shutdown and ripple are not modelled. Dissipated power (VIN − VOUT) × I is reported.',
    voltage: `VIN ${(vout + dropout).toFixed(1)}–${vinMax} V → ${vout} V`,
    interfaces: ['Power'],
    insertable: true,
    stamp(ctx) {
      if (ctx.fault === 'burned' || ctx.rt.burned) return;
      const vin = ctx.rt.vin ?? 0;
      const v = clamp(vin - dropout, 0, vout);
      if (vin > 1) ctx.V('out', ctx.node('VOUT'), ctx.node('GND'), v, 0.05, imax);
      ctx.I('iin', ctx.node('VIN'), ctx.node('GND'), -(ctx.rt.iout ?? 0)); // draws the output current from VIN
      ctx.R('iq', ctx.node('VIN'), ctx.node('GND'), 1e6);
    },
    post(ctx) {
      const vin = vccOf(ctx, 'VIN');
      const iout = Math.max(0, ctx.cur('out'));
      if (Math.abs((ctx.rt.vin ?? 0) - vin) > 0.02 || Math.abs((ctx.rt.iout ?? 0) - iout) > 0.002) {
        ctx.rt.vin = vin;
        ctx.rt.iout = iout;
        ctx.rt.dirty = true;
      }
      if (vin > vinMax) {
        ctx.rt.burned = true;
        ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vin.toFixed(1), max: vinMax }, ['VIN']);
      }
      if (vin > 0.5 && vin < vout + dropout) ctx.issue('W_REG_DROPOUT', 'warning', { vin: vin.toFixed(1), vout, drop: dropout }, ['VIN']);
      const vo = ctx.volt('VOUT') - ctx.volt('GND');
      return { vin, vout: vo, iout, heatW: Math.max(0, (vin - vo) * iout), powered: vo > 0.9 * vout };
    },
  };
}
export const ams1117 = linearReg('ams1117', 'AMS1117-3.3 regulator', 'AMS1117-3.3', 3.3, 1.1, 15, 0.8);
export const lm7805 = linearReg('lm7805', 'LM7805 5 V regulator', 'L7805CV', 5.0, 2.0, 35, 1.5);

export const buckConverter: PartManifest = {
  type: 'buck_converter',
  name: 'DC-DC buck converter (LM2596)',
  short: 'Buck',
  model: 'LM2596 module',
  category: 'power',
  group: 'Power',
  description: 'Adjustable step-down converter: IN 4.5–40 V → OUT 1.25–(IN − 1.5) V, ≈85 % efficiency, max 3 A. IN− and OUT− are connected on the board. Set the output voltage BEFORE connecting the Pi.',
  w: 80,
  h: 50,
  pins: [pin('INP', 'IN+', 0, 10, 'power'), pin('INN', 'IN−', 0, 30, 'ground'), pin('OUTP', 'OUT+', 80, 10, 'power'), pin('OUTN', 'OUT−', 80, 30, 'ground')],
  internal: () => [['INN', 'OUTN']],
  props: [{ key: 'vout', label: 'Output voltage (trimmer)', type: 'number', default: 5, min: 1.25, max: 35, step: 0.05, unit: 'V', group: 'config' }],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  fidelity: 'functional',
  limits: 'Averaged model: ideal output source with dropout and 3 A limit; input current = Pout / (0.85 · Vin). Switching ripple is not modelled.',
  voltage: 'IN 4.5–40 V',
  interfaces: ['Power'],
  stamp(ctx) {
    if (ctx.fault === 'burned' || ctx.rt.burned) return;
    const vin = ctx.rt.vin ?? 0;
    const v = clamp(Math.min(Number(ctx.props.vout), vin - 1.5), 0, 35);
    if (vin > 4) ctx.V('out', ctx.node('OUTP'), ctx.node('OUTN'), v, 0.05, 3);
    ctx.I('iin', ctx.node('INP'), ctx.node('INN'), -(ctx.rt.iin ?? 0));
  },
  post(ctx) {
    const vin = ctx.connected('INP') ? ctx.volt('INP') - ctx.volt('INN') : 0;
    const vo = ctx.volt('OUTP') - ctx.volt('OUTN');
    const iout = Math.max(0, ctx.cur('out'));
    const iin = vin > 1 ? (vo * iout) / (0.85 * vin) : 0;
    if (Math.abs((ctx.rt.vin ?? 0) - vin) > 0.02 || Math.abs((ctx.rt.iin ?? 0) - iin) > 0.002) {
      ctx.rt.vin = vin;
      ctx.rt.iin = iin;
      ctx.rt.dirty = true;
    }
    if (vin > 40) {
      ctx.rt.burned = true;
      ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vin.toFixed(1), max: 40 }, ['INP']);
    }
    return { vin, vout: vo, iout, powered: vo > 1 };
  },
};

export const breadboardPsu: PartManifest = {
  type: 'mb102_psu',
  name: 'Breadboard power supply (MB102)',
  short: 'MB102',
  model: 'MB102',
  category: 'power',
  group: 'Power',
  description: 'Plug-in breadboard supply fed from a 6.5–12 V adapter: two rails, each jumper-selectable 3.3 V or 5 V (max ≈ 700 mA). Connect its GND to the Pi GND when signals go between them.',
  w: 70,
  h: 50,
  pins: [pin('L+', 'Left +', 0, 10, 'power'), pin('L-', 'Left −', 0, 30, 'ground'), pin('R+', 'Right +', 70, 10, 'power'), pin('R-', 'Right −', 70, 30, 'ground')],
  internal: () => [['L-', 'R-']],
  props: [
    { key: 'left', label: 'Left rail', type: 'select', default: 5, options: [{ value: 3.3, label: '3.3 V' }, { value: 5, label: '5 V' }], group: 'config' },
    { key: 'right', label: 'Right rail', type: 'select', default: 3.3, options: [{ value: 3.3, label: '3.3 V' }, { value: 5, label: '5 V' }], group: 'config' },
    { key: 'on', label: 'Switch ON', type: 'boolean', default: true, group: 'config' },
  ],
  faults: [FAULT.none, FAULT.powerFail],
  support: 'full',
  fidelity: 'functional',
  limits: 'Two ideal sources with 0.1 Ω internal resistance and a 0.7 A limit; the adapter input is assumed present.',
  voltage: '3.3 V / 5 V out',
  interfaces: ['Power'],
  stamp(ctx) {
    if (!ctx.props.on || ctx.fault === 'power_fail') return;
    ctx.V('l', ctx.node('L+'), ctx.node('L-'), Number(ctx.props.left), 0.1, 0.7);
    ctx.V('r', ctx.node('R+'), ctx.node('R-'), Number(ctx.props.right), 0.1, 0.7);
  },
  post(ctx) {
    return { on: !!ctx.props.on && ctx.fault !== 'power_fail', il: ctx.cur('l'), ir: ctx.cur('r') };
  },
};

// ---------------------------------------------------------------- terminal block, DIP switch, SSR
export const terminalBlock: PartManifest = {
  type: 'terminal_block',
  name: 'Screw terminal block',
  short: 'Terminal',
  category: 'basic',
  group: 'Breadboard & wiring',
  description: 'PCB screw terminals (5.08 mm). Each position connects its wire side (top) to its board side (bottom) — use them for pump, valve and power-supply leads.',
  w: 50,
  h: 40,
  pins: (p) => Array.from({ length: Number(p.positions) || 2 }, (_, i) => [pin(`T${i + 1}`, `${i + 1} wire`, i * 10, 0, 'terminal'), pin(`B${i + 1}`, `${i + 1} board`, i * 10, 40, 'terminal')]).flat(),
  internal: (p) => Array.from({ length: Number(p.positions) || 2 }, (_, i) => [`T${i + 1}`, `B${i + 1}`]),
  props: [{ key: 'positions', label: 'Positions', type: 'select', default: 2, options: [2, 3, 4].map((v) => ({ value: v, label: `${v}` })), group: 'config' }],
  support: 'full',
  fidelity: 'full',
  limits: 'Ideal connection (0 Ω) between the wire and board side of each position.',
  voltage: '≤ 300 V, ≤ 10 A',
  interfaces: ['Wiring'],
};

const SW4 = [1, 2, 3, 4];
export const dipSwitch: PartManifest = {
  type: 'dip_switch',
  name: 'DIP switch (4-position)',
  short: 'DIP ×4',
  category: 'input',
  group: 'Inputs & switches',
  description: '4 independent slide switches in a DIP-8 package: switch k connects pin k to pin 9−k. Use with pull-up/down resistors (or the GPIO pull-ups) to set configuration bits.',
  w: 40,
  h: 30,
  pins: dip(['1', '2', '3', '4', '5', '6', '7', '8'], { 1: 'passive', 2: 'passive', 3: 'passive', 4: 'passive', 5: 'passive', 6: 'passive', 7: 'passive', 8: 'passive' }),
  props: SW4.map((k) => ({ key: `sw${k}`, label: `Switch ${k} ON`, type: 'boolean' as const, default: false, live: true, group: 'sensor' as const })),
  faults: [FAULT.none],
  support: 'full',
  fidelity: 'full',
  limits: 'Ideal switches (0.1 Ω closed). Click a switch while the program runs to toggle it.',
  voltage: '≤ 24 V, 25 mA',
  python: 'gpiozero.Button(pin) / DigitalInputDevice(pin, pull_up=True)',
  drivers: ['gpiozero', 'RPi.GPIO'],
  insertable: true,
  stamp(ctx) {
    for (const k of SW4) ctx.SW(`s${k}`, ctx.node(String(k)), ctx.node(String(9 - k)), 0.1, !!ctx.props[`sw${k}`]);
  },
  post(ctx) {
    return { states: SW4.map((k) => !!ctx.props[`sw${k}`]) };
  },
};

export const ssr: PartManifest = {
  type: 'ssr',
  name: 'Solid-state relay (DC control)',
  short: 'SSR',
  model: 'SSR-25 DA type',
  category: 'actuator',
  group: 'Actuators & relays',
  description: 'Solid-state relay with an opto-isolated 3–32 V DC control input (3+ / 4−) and a load switch (1/2). No contacts, no click, silent switching of heaters and grow lights. This model switches DC loads (the real "DA" types switch AC mains — do not wire mains on a breadboard).',
  w: 80,
  h: 60,
  pins: [pin('IN+', '3 (+) input', 0, 10, 'terminal'), pin('IN-', '4 (−) input', 0, 30, 'terminal'), pin('L1', '1 load', 80, 10, 'terminal'), pin('L2', '2 load', 80, 30, 'terminal')],
  props: [],
  faults: [FAULT.none, { id: 'shorted', label: 'Output failed shorted (always ON)' }, { id: 'open', label: 'Output failed open' }],
  support: 'full',
  fidelity: 'full',
  limits: 'Input = LED (Vf 1.2 V) + 1 kΩ, ON above 2 mA; output = 0.2 Ω switch. Zero-cross behaviour and leakage are not modelled.',
  voltage: 'Control 3–32 V DC',
  interfaces: ['Digital (GPIO direct, ~2 mA)'],
  python: 'gpiozero.OutputDevice(pin) · smartfarm.Relay(pin, active_high=True)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  stamp(ctx) {
    ctx.D('in', ctx.node('IN+'), ctx.node('IN-'), 1.2, 1000);
    const led = ctx.id('in');
    if (ctx.fault === 'open') return;
    ctx.SW('out', ctx.node('L1'), ctx.node('L2'), 0.2, ctx.fault === 'shorted' ? true : (s: Solution) => s.cur(led) > 2e-3);
  },
  post(ctx) {
    const on = ctx.fault === 'shorted' || (ctx.fault !== 'open' && ctx.cur('in') > 2e-3);
    return { on, ma: ctx.cur('in') * 1000, amps: Math.abs(ctx.cur('out')) };
  },
};

export const IC_PARTS: PartManifest[] = [ads1115, pcf8574, mcp23017, tca9548a, ds3231, at24c32, sdCardModule, hc595, hc08, hc32, hc86, hc04, pc817, levelShifter, ams1117, lm7805, buckConverter, breadboardPsu, terminalBlock, dipSwitch, ssr];
