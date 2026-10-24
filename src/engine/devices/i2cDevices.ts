// Register/command-level models of common I2C parts. Each follows the datasheet
// framing (register pointer, 16-bit commands, CRC-8 where the part uses it) so a
// driver that speaks the real protocol works against the model.

import type { DeviceHost, DeviceModel } from './device';

/** Sensirion CRC-8 (poly 0x31, init 0xFF) used by SHT3x / SCD30 / SCD4x. */
export function crc8(bytes: number[]) {
  let c = 0xff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const word = (v: number) => {
  const w = [(v >> 8) & 0xff, v & 0xff];
  return [...w, crc8(w)];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const bcd = (v: number) => ((Math.floor(v / 10) << 4) | v % 10) & 0xff;
const unbcd = (v: number) => (v >> 4) * 10 + (v & 0x0f);

/** Base for parts with an auto-incrementing register pointer (first written byte). */
abstract class RegisterDevice implements DeviceModel {
  protected ptr = 0;
  constructor(protected host: DeviceHost) {}
  abstract i2cAddress(): number;
  protected abstract read(reg: number): number;
  protected write(_reg: number, _val: number): void {}
  i2cWrite(bytes: number[]) {
    if (!bytes.length) return;
    this.ptr = bytes[0] & 0xff;
    for (let i = 1; i < bytes.length; i++) {
      this.write(this.ptr, bytes[i] & 0xff);
      this.ptr = this.next(this.ptr);
    }
  }
  i2cRead(n: number) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(this.read(this.ptr) & 0xff);
      this.ptr = this.next(this.ptr);
    }
    return out;
  }
  protected next(p: number) {
    return (p + 1) & 0xff;
  }
}

// ---------------------------------------------------------------- SHT31 / SHT35
export class Sht3x implements DeviceModel {
  private out: number[] = [];
  private heater = false;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    return Number(this.host.props().address) || 0x44;
  }
  reset() {
    this.out = [];
  }
  private measure() {
    const f = this.host.fault();
    let t = this.host.value('temperature') + (this.heater ? 3 : 0);
    let h = this.host.value('humidity');
    if (f === 'invalid') {
      t = -45;
      h = 0;
    }
    const rt = Math.round(clamp(((t + 45) * 65535) / 175, 0, 65535));
    const rh = Math.round(clamp((h * 65535) / 100, 0, 65535));
    this.out = [...word(rt), ...word(rh)];
    this.host.rt?.() && Object.assign(this.host.rt!(), { lastRead: this.host.now() });
  }
  i2cWrite(bytes: number[]) {
    if (bytes.length < 2) return;
    const cmd = (bytes[0] << 8) | bytes[1];
    if (cmd === 0x2400 || cmd === 0x240b || cmd === 0x2416 || cmd === 0x2c06 || cmd === 0x2c0d || cmd === 0x2c10 || cmd === 0xe000) this.measure();
    else if (cmd === 0x30a2) this.reset();
    else if (cmd === 0x306d) this.heater = true;
    else if (cmd === 0x3066) this.heater = false;
    else if (cmd === 0xf32d) this.out = word(this.heater ? 0x2000 : 0x0000);
    else if (cmd === 0x3780) this.out = [...word(0x1234), ...word(0x5678)]; // serial number
  }
  i2cRead(n: number) {
    if (this.host.fault() === 'timeout' && Math.random() < 0.5) return new Array(n).fill(0xff);
    const o = this.out.slice(0, n);
    while (o.length < n) o.push(0xff);
    this.out = this.out.slice(n);
    return o;
  }
}

// ---------------------------------------------------------------- ADS1115
const ADS_FSR = [6.144, 4.096, 2.048, 1.024, 0.512, 0.256, 0.256, 0.256];

export class Ads1115 implements DeviceModel {
  private ptr = 0;
  private config = 0x8583;
  private conv = 0;
  private lo = 0x8000;
  private hi = 0x7fff;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    const h = this.host;
    if (h.sameNet?.('ADDR', 'VDD')) return 0x49;
    if (h.sameNet?.('ADDR', 'SDA')) return 0x4a;
    if (h.sameNet?.('ADDR', 'SCL')) return 0x4b;
    return 0x48; // ADDR to GND, or the breakout's 10 kΩ pull-down
  }
  reset() {
    this.config = 0x8583;
    this.conv = 0;
  }
  /** input voltage for the configured multiplexer setting */
  private input(mux: number) {
    const v = this.host.vis?.() ?? {};
    const ch: (number | null)[] = v.ch ?? [0, 0, 0, 0];
    const pick = (i: number) => (ch[i] === null ? (Math.random() - 0.5) * 0.4 : (ch[i] as number));
    switch (mux) {
      case 0:
        return pick(0) - pick(1);
      case 1:
        return pick(0) - pick(3);
      case 2:
        return pick(1) - pick(3);
      case 3:
        return pick(2) - pick(3);
      default:
        return pick(mux - 4);
    }
  }
  private convert() {
    const mux = (this.config >> 12) & 7;
    const fsr = ADS_FSR[(this.config >> 9) & 7];
    let code = Math.round((this.input(mux) / fsr) * 32768);
    if (this.host.fault() === 'noise') code += Math.round((Math.random() - 0.5) * 40);
    this.conv = clamp(code, -32768, 32767) & 0xffff;
  }
  i2cWrite(bytes: number[]) {
    if (!bytes.length) return;
    this.ptr = bytes[0] & 3;
    if (bytes.length >= 3) {
      const v = ((bytes[1] << 8) | bytes[2]) & 0xffff;
      if (this.ptr === 1) {
        this.config = v & 0x7fff; // OS reads back 0 while converting
        if (v & 0x8000 || !(v & 0x0100)) this.convert();
        this.config |= 0x8000; // conversion done (conversion time is not modelled)
      } else if (this.ptr === 2) this.lo = v;
      else if (this.ptr === 3) this.hi = v;
    }
  }
  i2cRead(n: number) {
    if (this.ptr === 0 && !(this.config & 0x0100)) this.convert(); // continuous mode
    const v = this.ptr === 0 ? this.conv : this.ptr === 1 ? this.config : this.ptr === 2 ? this.lo : this.hi;
    const out = [(v >> 8) & 0xff, v & 0xff];
    while (out.length < n) out.push(0xff);
    return out.slice(0, n);
  }
}

// ---------------------------------------------------------------- PCF8574 quasi-bidirectional expander
export class Pcf8574 implements DeviceModel {
  constructor(private host: DeviceHost) {
    this.reset();
  }
  i2cAddress() {
    const p = this.host.props();
    const a = (p.a0 ? 1 : 0) | (p.a1 ? 2 : 0) | (p.a2 ? 4 : 0);
    return (p.variant === 'A' ? 0x38 : 0x20) + a;
  }
  reset() {
    const rt = this.host.rt?.();
    if (rt) rt.latch = 0xff; // power-on: all pins weakly high (inputs)
  }
  i2cWrite(bytes: number[]) {
    const rt = this.host.rt?.();
    if (!rt || !bytes.length) return;
    rt.latch = bytes[bytes.length - 1] & 0xff;
    this.host.reevaluate?.();
  }
  i2cRead(n: number) {
    const lv: number[] = this.host.vis?.()?.levels ?? [];
    let b = 0;
    for (let i = 0; i < 8; i++) if (lv[i]) b |= 1 << i;
    return new Array(n).fill(b);
  }
}

// ---------------------------------------------------------------- MCP23017 16-bit expander (IOCON.BANK = 0)
export class Mcp23017 extends RegisterDevice {
  regs = new Array(0x16).fill(0);
  constructor(host: DeviceHost) {
    super(host);
    this.reset();
  }
  i2cAddress() {
    const p = this.host.props();
    return 0x20 + ((p.a0 ? 1 : 0) | (p.a1 ? 2 : 0) | (p.a2 ? 4 : 0));
  }
  reset() {
    this.regs.fill(0);
    this.regs[0x00] = 0xff; // IODIRA: inputs
    this.regs[0x01] = 0xff; // IODIRB
    this.sync();
  }
  private sync() {
    const rt = this.host.rt?.();
    if (!rt) return;
    rt.iodir = [this.regs[0], this.regs[1]];
    rt.olat = [this.regs[0x14], this.regs[0x15]];
    rt.gppu = [this.regs[0x0c], this.regs[0x0d]];
  }
  protected read(reg: number) {
    if (reg === 0x12 || reg === 0x13) {
      const port = reg - 0x12;
      const lv: number[] = this.host.vis?.()?.levels ?? [];
      let b = 0;
      for (let i = 0; i < 8; i++) if (lv[port * 8 + i]) b |= 1 << i;
      return b ^ this.regs[0x02 + port]; // IPOL inverts inputs
    }
    return this.regs[reg] ?? 0;
  }
  protected write(reg: number, val: number) {
    if (reg >= 0x16) return;
    if (reg === 0x12 || reg === 0x13) reg += 2; // writing GPIO writes the output latch
    this.regs[reg] = val;
    this.sync();
    this.host.reevaluate?.();
  }
  protected next(p: number) {
    return (p + 1) % 0x16;
  }
}

// ---------------------------------------------------------------- TCA9548A I2C multiplexer
export class Tca9548a implements DeviceModel {
  private ch = 0;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    const p = this.host.props();
    return 0x70 + ((p.a0 ? 1 : 0) | (p.a1 ? 2 : 0) | (p.a2 ? 4 : 0));
  }
  mask() {
    return this.ch;
  }
  reset() {
    this.ch = 0;
  }
  i2cWrite(bytes: number[]) {
    if (bytes.length) this.ch = bytes[bytes.length - 1] & 0xff;
    this.host.changed();
  }
  i2cRead(n: number) {
    return new Array(n).fill(this.ch);
  }
}

// ---------------------------------------------------------------- DS3231 RTC
export class Ds3231 extends RegisterDevice {
  private regs = new Array(0x13).fill(0);
  private offset = 0; // seconds between RTC time and simulation time
  constructor(host: DeviceHost) {
    super(host);
    this.regs[0x0e] = 0x1c;
    this.regs[0x0f] = 0x88; // OSF set after first power-up
  }
  i2cAddress() {
    return 0x68;
  }
  private time() {
    return new Date((this.host.now() + this.offset) * 1000);
  }
  protected read(reg: number) {
    const d = this.time();
    switch (reg) {
      case 0:
        return bcd(d.getUTCSeconds());
      case 1:
        return bcd(d.getUTCMinutes());
      case 2:
        return bcd(d.getUTCHours());
      case 3:
        return d.getUTCDay() + 1;
      case 4:
        return bcd(d.getUTCDate());
      case 5:
        return bcd(d.getUTCMonth() + 1) | (d.getUTCFullYear() >= 2100 ? 0x80 : 0);
      case 6:
        return bcd(d.getUTCFullYear() % 100);
      case 0x11: {
        const t = this.host.value('temperature');
        return Math.floor(t) & 0xff;
      }
      case 0x12:
        return (Math.round((this.host.value('temperature') % 1) * 4) & 3) << 6;
      default:
        return this.regs[reg] ?? 0;
    }
  }
  private pending: Record<number, number> = {};
  protected write(reg: number, val: number) {
    if (reg <= 6) {
      this.pending[reg] = val;
      const cur = this.time();
      const g = (r: number, now: number) => (this.pending[r] !== undefined ? unbcd(this.pending[r] & (r === 5 ? 0x1f : r === 2 ? 0x3f : 0x7f)) : now);
      const year = 2000 + g(6, cur.getUTCFullYear() % 100);
      const t = Date.UTC(year, g(5, cur.getUTCMonth() + 1) - 1, g(4, cur.getUTCDate()), g(2, cur.getUTCHours()), g(1, cur.getUTCMinutes()), g(0, cur.getUTCSeconds()));
      this.offset = t / 1000 - this.host.now();
      if (reg === 6) this.pending = {};
      this.regs[0x0f] &= 0x7f; // writing the time clears OSF
      this.host.log('DS3231: time set to ' + new Date(t).toISOString());
    } else if (reg < this.regs.length) this.regs[reg] = val;
  }
  protected next(p: number) {
    return (p + 1) % 0x13;
  }
}

// ---------------------------------------------------------------- AT24C32 / AT24C256 EEPROM (2-byte address)
export class At24c implements DeviceModel {
  private addr = 0;
  constructor(private host: DeviceHost) {}
  private size() {
    return Number(this.host.props().kbits) === 256 ? 32768 : 4096;
  }
  private mem(): number[] {
    const rt = this.host.rt!();
    if (!rt.mem || rt.mem.length !== this.size()) rt.mem = new Array(this.size()).fill(0xff);
    return rt.mem;
  }
  i2cAddress() {
    const p = this.host.props();
    return 0x50 + ((p.a0 ? 1 : 0) | (p.a1 ? 2 : 0) | (p.a2 ? 4 : 0));
  }
  i2cWrite(bytes: number[]) {
    if (bytes.length < 2) return;
    const size = this.size();
    this.addr = ((bytes[0] << 8) | bytes[1]) % size;
    if (bytes.length > 2) {
      if (this.host.props().wp) return; // write-protect pin high
      const m = this.mem();
      const page = this.addr & ~31;
      let a = this.addr;
      for (const b of bytes.slice(2)) {
        m[a] = b & 0xff;
        a = page + (((a - page) + 1) & 31); // page write wraps inside the 32-byte page
      }
    }
  }
  i2cRead(n: number) {
    const m = this.mem();
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(m[this.addr]);
      this.addr = (this.addr + 1) % this.size();
    }
    return out;
  }
}

// ---------------------------------------------------------------- Sensirion SCD30 (CO₂ / T / RH)
function floatWords(v: number) {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v);
  return [...word((b.getUint8(0) << 8) | b.getUint8(1)), ...word((b.getUint8(2) << 8) | b.getUint8(3))];
}

export class Scd30 implements DeviceModel {
  private out: number[] = [];
  private running = false;
  private started = 0;
  private interval = 2;
  private lastRead = -1e9;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    return 0x61;
  }
  reset() {
    this.running = false;
    this.out = [];
  }
  private ready() {
    const t = this.host.now();
    return this.running && t - this.started >= this.interval && t - this.lastRead >= this.interval;
  }
  i2cWrite(bytes: number[]) {
    if (bytes.length < 2) return;
    const cmd = (bytes[0] << 8) | bytes[1];
    switch (cmd) {
      case 0x0010:
        this.running = true;
        this.started = this.host.now();
        break;
      case 0x0104:
        this.running = false;
        break;
      case 0x4600:
        if (bytes.length >= 4) this.interval = Math.max(2, (bytes[2] << 8) | bytes[3]);
        else this.out = word(this.interval);
        break;
      case 0x0202:
        this.out = word(this.ready() ? 1 : 0);
        break;
      case 0x0300: {
        if (this.host.fault() === 'timeout' && Math.random() < 0.5) {
          this.out = [];
          break;
        }
        this.lastRead = this.host.now();
        const co2 = this.host.fault() === 'invalid' ? 0 : this.host.value('co2');
        this.out = [...floatWords(co2), ...floatWords(this.host.value('temperature')), ...floatWords(this.host.value('humidity'))];
        break;
      }
      case 0xd100:
        this.out = word(0x0342);
        break;
      case 0xd304:
        this.reset();
        break;
      default:
        break;
    }
  }
  i2cRead(n: number) {
    const o = this.out.slice(0, n);
    while (o.length < n) o.push(0xff);
    this.out = this.out.slice(n);
    return o;
  }
}

// ---------------------------------------------------------------- Sensirion SCD40 / SCD41
export class Scd4x implements DeviceModel {
  private out: number[] = [];
  private running = false;
  private started = 0;
  private lastRead = -1e9;
  private single = -1;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    return 0x62;
  }
  reset() {
    this.running = false;
    this.out = [];
  }
  private ready() {
    const t = this.host.now();
    if (this.single >= 0) return t - this.single >= 5;
    return this.running && t - this.started >= 5 && t - this.lastRead >= 5;
  }
  i2cWrite(bytes: number[]) {
    if (bytes.length < 2) return;
    const cmd = (bytes[0] << 8) | bytes[1];
    switch (cmd) {
      case 0x21b1: // start_periodic_measurement
        this.running = true;
        this.started = this.host.now();
        break;
      case 0x21ac: // start_low_power_periodic_measurement (30 s)
        this.running = true;
        this.started = this.host.now() - 0;
        break;
      case 0x3f86:
        this.running = false;
        break;
      case 0x219d: // measure_single_shot (SCD41 only)
        if (this.host.props().model === 'SCD41') this.single = this.host.now();
        break;
      case 0xe4b8:
        this.out = word(this.ready() ? 0x8006 : 0x8000);
        break;
      case 0xec05: {
        this.lastRead = this.host.now();
        this.single = -1;
        const co2 = Math.round(clamp(this.host.fault() === 'invalid' ? 0 : this.host.value('co2'), 0, 40000));
        const t = Math.round(clamp(((this.host.value('temperature') + 45) * 65535) / 175, 0, 65535));
        const h = Math.round(clamp((this.host.value('humidity') * 65535) / 100, 0, 65535));
        this.out = [...word(co2), ...word(t), ...word(h)];
        break;
      }
      case 0x3682:
        this.out = [...word(0xa1b2), ...word(0xc3d4), ...word(0xe5f6)];
        break;
      default:
        break;
    }
  }
  i2cRead(n: number) {
    const o = this.out.slice(0, n);
    while (o.length < n) o.push(0xff);
    this.out = this.out.slice(n);
    return o;
  }
}

// ---------------------------------------------------------------- AMS CCS811 (eCO₂ / TVOC)
export class Ccs811 implements DeviceModel {
  private ptr = 0;
  private app = false;
  private mode = 0;
  private reads = 0;
  constructor(private host: DeviceHost) {}
  /** nWAKE must be pulled LOW to talk to the sensor; when it floats or is high the part ignores the bus */
  i2cAddress() {
    const h = this.host;
    const wakeLow = h.sameNet?.('WAK', 'GND') || (h.pinConnected?.('WAK') && (h.pinVolt?.('WAK') ?? 3.3) < 0.8);
    if (!wakeLow) return -1;
    return this.host.props().addr === 0x5b ? 0x5b : 0x5a;
  }
  reset() {
    this.app = false;
    this.mode = 0;
  }
  i2cWrite(bytes: number[]) {
    if (!bytes.length) return;
    this.ptr = bytes[0];
    if (this.ptr === 0xf4) this.app = true;
    else if (this.ptr === 0x01 && bytes.length > 1) this.mode = (bytes[1] >> 4) & 7;
    else if (this.ptr === 0xff && bytes.length === 5) this.reset();
  }
  i2cRead(n: number) {
    let out: number[] = [];
    switch (this.ptr) {
      case 0x20:
        out = [0x81];
        break;
      case 0x24:
        out = [0x11, 0x00];
        break;
      case 0x00:
        out = [(this.app ? 0x80 : 0) | 0x10 | (this.app && this.mode ? 0x08 : 0)];
        break;
      case 0x01:
        out = [this.mode << 4];
        break;
      case 0x02: {
        this.reads++;
        const eco2 = Math.round(clamp(this.host.value('eco2'), 400, 8192));
        const tvoc = Math.round(clamp(this.host.value('tvoc'), 0, 1187));
        out = [eco2 >> 8, eco2 & 0xff, tvoc >> 8, tvoc & 0xff, 0x98, 0, 0, 0];
        break;
      }
      default:
        out = [0];
    }
    while (out.length < n) out.push(0);
    return out.slice(0, n);
  }
}

// ---------------------------------------------------------------- TSL2561 luminosity (T package)
export class Tsl2561 implements DeviceModel {
  private reg = 0;
  private power = false;
  private timing = 0x02; // 402 ms, gain 1x
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    const a = this.host.props().addr;
    return a === 0x29 || a === 0x49 ? a : 0x39;
  }
  reset() {
    this.power = false;
    this.timing = 0x02;
  }
  private counts(): [number, number] {
    if (!this.power) return [0, 0];
    const lux = Math.max(0, this.host.value('lux'));
    // CH1/CH0 = 0.25 → lux = CH0 × (0.0304 − 0.062 × 0.25^1.4) at 402 ms, 16× gain
    const ch0full = lux / (0.0304 - 0.062 * Math.pow(0.25, 1.4));
    const gain = this.timing & 0x10 ? 1 : 1 / 16;
    const integ = [0.034, 0.252, 1, 1][this.timing & 3];
    const max = [5047, 37177, 65535, 65535][this.timing & 3];
    const c0 = Math.min(max, Math.round(ch0full * gain * integ));
    return [c0, Math.min(max, Math.round(c0 * 0.25))];
  }
  i2cWrite(bytes: number[]) {
    if (!bytes.length) return;
    if (bytes[0] & 0x80) this.reg = bytes[0] & 0x0f;
    if (bytes.length > 1) {
      if (this.reg === 0x0) this.power = (bytes[1] & 3) === 3;
      else if (this.reg === 0x1) this.timing = bytes[1] & 0x13;
    }
  }
  i2cRead(n: number) {
    const [c0, c1] = this.counts();
    const map: Record<number, number> = { 0x0: this.power ? 0x03 : 0, 0x1: this.timing, 0xa: 0x50, 0xc: c0 & 0xff, 0xd: c0 >> 8, 0xe: c1 & 0xff, 0xf: c1 >> 8 };
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(map[(this.reg + i) & 0x0f] ?? 0);
    return out;
  }
}

// ---------------------------------------------------------------- BME680 (simplified register model)
// Chip-ID 0x61, forced-mode trigger in ctrl_meas (0x74), new-data flag in 0x1D.
// Compensated values are placed in a simplified, documented layout — the Bosch
// calibration algorithm is NOT reproduced (fidelity: functional).
export class Bme680 extends RegisterDevice {
  private regs = new Map<number, number>();
  constructor(host: DeviceHost) {
    super(host);
    this.reset();
  }
  i2cAddress() {
    return Number(this.host.props().address) || 0x77;
  }
  reset() {
    this.regs = new Map([
      [0xd0, 0x61],
      [0x74, 0],
      [0x1d, 0],
    ]);
  }
  private latch() {
    const T = Math.round(this.host.value('temperature') * 100);
    const P = Math.round(this.host.value('pressure') * 100);
    const H = Math.round(this.host.value('humidity') * 1000);
    const G = Math.round(this.host.value('gas'));
    const set = (a: number, v: number, n: number) => {
      for (let i = 0; i < n; i++) this.regs.set(a + i, (v >>> ((n - 1 - i) * 8)) & 0xff);
    };
    set(0x1f, P, 3);
    set(0x22, T & 0xffff, 2);
    set(0x25, H, 2);
    set(0x2a, G, 4);
    this.regs.set(0x1d, 0x80);
  }
  protected read(reg: number) {
    const v = this.regs.get(reg) ?? 0;
    if (reg === 0x1d) this.regs.set(0x1d, v & 0x7f);
    return v;
  }
  protected write(reg: number, val: number) {
    if (reg === 0xe0 && val === 0xb6) return this.reset();
    this.regs.set(reg, val);
    if (reg === 0x74 && (val & 3) === 1) this.latch();
  }
}
