// Bosch BME280 register model. Calibration constants are fixed sample values
// (T/P from the datasheet example); raw ADC values are found by inverting the
// datasheet's floating-point compensation formulas, so any real BME280 driver
// that applies the standard compensation reads back the configured values.

import type { DeviceHost, DeviceModel } from './device';

export const CAL = {
  T1: 27504, T2: 26435, T3: -1000,
  P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000,
  H1: 75, H2: 362, H3: 0, H4: 313, H5: 50, H6: 30,
};

export function compT(adc: number) {
  const v1 = (adc / 16384 - CAL.T1 / 1024) * CAL.T2;
  const v2 = (adc / 131072 - CAL.T1 / 8192) ** 2 * CAL.T3;
  const tfine = v1 + v2;
  return { t: tfine / 5120, tfine };
}

export function compP(adc: number, tfine: number) {
  let v1 = tfine / 2 - 64000;
  let v2 = (v1 * v1 * CAL.P6) / 32768;
  v2 = v2 + v1 * CAL.P5 * 2;
  v2 = v2 / 4 + CAL.P4 * 65536;
  v1 = ((CAL.P3 * v1 * v1) / 524288 + CAL.P2 * v1) / 524288;
  v1 = (1 + v1 / 32768) * CAL.P1;
  if (v1 === 0) return 0;
  let p = 1048576 - adc;
  p = ((p - v2 / 4096) * 6250) / v1;
  v1 = (CAL.P9 * p * p) / 2147483648;
  v2 = (p * CAL.P8) / 32768;
  return p + (v1 + v2 + CAL.P7) / 16; // Pa
}

export function compH(adc: number, tfine: number) {
  let h = tfine - 76800;
  h = (adc - (CAL.H4 * 64 + (CAL.H5 / 16384) * h)) * ((CAL.H2 / 65536) * (1 + (CAL.H6 / 67108864) * h * (1 + (CAL.H3 / 67108864) * h)));
  h = h * (1 - (CAL.H1 * h) / 524288);
  return Math.max(0, Math.min(100, h));
}

function bisect(f: (x: number) => number, target: number, lo: number, hi: number, increasing: boolean) {
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const v = f(mid);
    if (increasing ? v < target : v > target) lo = mid + 1;
    else hi = mid;
    if (lo >= hi) break;
  }
  return lo;
}

export function rawFor(tC: number, pHpa: number, hum: number) {
  const adcT = bisect((x) => compT(x).t, tC, 0, (1 << 20) - 1, true);
  const { tfine } = compT(adcT);
  const adcP = bisect((x) => compP(x, tfine), pHpa * 100, 0, (1 << 20) - 1, false);
  const adcH = bisect((x) => compH(x, tfine), hum, 0, 65535, true);
  return { adcT, adcP, adcH };
}

function calibrationBytes(): Map<number, number> {
  const m = new Map<number, number>();
  const u16 = (addr: number, v: number) => {
    const x = v & 0xffff;
    m.set(addr, x & 0xff);
    m.set(addr + 1, (x >> 8) & 0xff);
  };
  const keys = ['T1', 'T2', 'T3', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'] as const;
  keys.forEach((k, i) => u16(0x88 + i * 2, CAL[k]));
  m.set(0xa1, CAL.H1);
  u16(0xe1, CAL.H2);
  m.set(0xe3, CAL.H3);
  m.set(0xe4, (CAL.H4 >> 4) & 0xff);
  m.set(0xe5, (CAL.H4 & 0x0f) | ((CAL.H5 & 0x0f) << 4));
  m.set(0xe6, (CAL.H5 >> 4) & 0xff);
  m.set(0xe7, CAL.H6 & 0xff);
  return m;
}

export class Bme280 implements DeviceModel {
  private ptr = 0;
  private regs = new Map<number, number>();
  private measured = false;
  /** chipId 0x60 = BME280, 0x58 = BMP280 (same T/P registers, no humidity) */
  constructor(private host: DeviceHost, private chipId = 0x60) {
    this.reset();
  }
  reset() {
    this.regs = calibrationBytes();
    this.regs.set(0xd0, this.chipId);
    this.regs.set(0xf2, 0);
    this.regs.set(0xf3, 0);
    this.regs.set(0xf4, 0);
    this.regs.set(0xf5, 0);
    this.measured = false;
    this.latch(true);
  }
  i2cAddress() {
    return Number(this.host.props().address) || 0x76;
  }
  private latch(resetValues = false) {
    let t = this.host.value('temperature');
    let p = this.host.value('pressure');
    let h = this.chipId === 0x60 ? this.host.value('humidity') : 0;
    const f = this.host.fault();
    if (f === 'invalid') {
      t = -40;
      p = 300;
      h = 0;
    }
    const raw = resetValues ? { adcT: 0x80000, adcP: 0x80000, adcH: 0x8000 } : rawFor(t, p, h);
    this.regs.set(0xf7, (raw.adcP >> 12) & 0xff);
    this.regs.set(0xf8, (raw.adcP >> 4) & 0xff);
    this.regs.set(0xf9, (raw.adcP & 0xf) << 4);
    this.regs.set(0xfa, (raw.adcT >> 12) & 0xff);
    this.regs.set(0xfb, (raw.adcT >> 4) & 0xff);
    this.regs.set(0xfc, (raw.adcT & 0xf) << 4);
    this.regs.set(0xfd, (raw.adcH >> 8) & 0xff);
    this.regs.set(0xfe, raw.adcH & 0xff);
  }
  i2cWrite(bytes: number[]) {
    if (!bytes.length) return;
    // a single byte sets the register pointer; longer writes are reg/value pairs
    this.ptr = bytes[0] & 0xff;
    for (let i = 0; i + 1 < bytes.length; i += 2) this.writeReg(bytes[i] & 0xff, bytes[i + 1] & 0xff);
  }
  private writeReg(reg: number, val: number) {
    if (reg === 0xe0 && val === 0xb6) {
      this.reset();
      return;
    }
    if (reg === 0xf2 || reg === 0xf4 || reg === 0xf5) {
      this.regs.set(reg, val & 0xff);
      if (reg === 0xf4 && (val & 0x03) !== 0) {
        this.measured = true;
        this.latch();
        if ((val & 0x03) !== 0x03) this.regs.set(0xf4, val & 0xfc); // forced → back to sleep
      }
    }
  }
  i2cRead(n: number) {
    const mode = (this.regs.get(0xf4) ?? 0) & 0x03;
    if (mode === 0x03) this.latch(); // normal mode: continuously updated
    else if (!this.measured) this.latch(true);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.regs.get((this.ptr + i) & 0xff) ?? 0);
    this.ptr = (this.ptr + n) & 0xff;
    return out;
  }
}
