import type { DeviceHost, DeviceModel } from './device';

export class Bh1750 implements DeviceModel {
  private on = false;
  private mode = 0;
  constructor(private host: DeviceHost) {}
  i2cAddress() {
    return Number(this.host.props().address) || 0x23;
  }
  reset() {
    this.on = false;
    this.mode = 0;
  }
  i2cWrite(bytes: number[]) {
    for (const b of bytes) {
      if (b === 0x00) this.on = false;
      else if (b === 0x01) this.on = true;
      else if (b === 0x07) this.mode = 0;
      else if ([0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(b)) {
        this.on = true;
        this.mode = b;
      }
    }
  }
  i2cRead(n: number) {
    let raw = 0;
    if (this.on && this.mode) {
      let lux = this.host.value('lux');
      if (this.host.fault() === 'invalid') lux = 54612;
      const factor = this.mode === 0x11 || this.mode === 0x21 ? 2.4 : 1.2;
      raw = Math.max(0, Math.min(65535, Math.round(lux * factor)));
      if (this.mode >= 0x20) this.on = false; // one-time modes power down
    }
    const out = [(raw >> 8) & 0xff, raw & 0xff];
    while (out.length < n) out.push(0);
    return out.slice(0, n);
  }
}
