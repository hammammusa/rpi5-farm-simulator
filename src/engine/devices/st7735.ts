// Sitronix ST7735 TFT controller over SPI with a D/C pin (LOW = command, HIGH = data).
// Supported commands: SWRESET, SLPIN/SLPOUT, INVOFF/INVON, DISPOFF/DISPON, CASET, RASET,
// RAMWR (RGB565, big-endian), MADCTL (rotation bits MX/MY/MV), COLMOD. Others are ignored.

import type { DeviceHost, DeviceModel } from './device';

export class St7735 implements DeviceModel {
  w = 128;
  h = 160;
  fb = new Uint16Array(128 * 160);
  on = false;
  sleep = true;
  invert = false;
  madctl = 0;
  private cmd = -1;
  private args: number[] = [];
  private x0 = 0;
  private x1 = 127;
  private y0 = 0;
  private y1 = 159;
  private cx = 0;
  private cy = 0;
  private pending: number | null = null;
  version = 0;
  constructor(private host: DeviceHost) {}
  reset() {
    this.fb.fill(0);
    this.on = false;
    this.sleep = true;
    this.cmd = -1;
  }
  private dc() {
    return (this.host.pinVolt?.('DC') ?? 0) > 1.5;
  }
  private dims() {
    return this.madctl & 0x20 ? { w: this.h, h: this.w } : { w: this.w, h: this.h };
  }
  spiXfer(bytes: number[]) {
    const data = this.dc();
    for (const b of bytes) {
      if (!data) {
        this.cmd = b;
        this.args = [];
        this.pending = null;
        switch (b) {
          case 0x01:
            this.reset();
            break;
          case 0x10:
            this.sleep = true;
            break;
          case 0x11:
            this.sleep = false;
            break;
          case 0x20:
            this.invert = false;
            break;
          case 0x21:
            this.invert = true;
            break;
          case 0x28:
            this.on = false;
            break;
          case 0x29:
            this.on = true;
            break;
          case 0x2c:
            this.cx = this.x0;
            this.cy = this.y0;
            break;
        }
        continue;
      }
      this.args.push(b);
      if (this.cmd === 0x2a && this.args.length === 4) {
        this.x0 = (this.args[0] << 8) | this.args[1];
        this.x1 = (this.args[2] << 8) | this.args[3];
      } else if (this.cmd === 0x2b && this.args.length === 4) {
        this.y0 = (this.args[0] << 8) | this.args[1];
        this.y1 = (this.args[2] << 8) | this.args[3];
      } else if (this.cmd === 0x36 && this.args.length === 1) this.madctl = b;
      else if (this.cmd === 0x2c) {
        if (this.pending === null) this.pending = b;
        else {
          this.put((this.pending << 8) | b);
          this.pending = null;
        }
        this.args.length = 0;
      }
    }
    this.version++;
    this.host.changed();
    return bytes.map(() => 0);
  }
  private put(c: number) {
    const { w, h } = this.dims();
    if (this.cx < w && this.cy < h && this.cx >= 0 && this.cy >= 0) this.fb[this.cy * w + this.cx] = c;
    this.cx++;
    if (this.cx > this.x1) {
      this.cx = this.x0;
      this.cy++;
      if (this.cy > this.y1) this.cy = this.y0;
    }
  }
  view() {
    const { w, h } = this.dims();
    return { fb: this.fb, w, h, on: this.on && !this.sleep, invert: this.invert, version: this.version };
  }
}
