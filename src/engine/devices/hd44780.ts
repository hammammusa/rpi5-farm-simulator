// PCF8574 I2C expander driving an HD44780 in 4-bit mode (the common "LCD1602 I2C" backpack).
// PCF8574 bit map: P0=RS, P1=RW, P2=E, P3=backlight, P4..P7 = D4..D7.

import type { DeviceHost, DeviceModel } from './device';

export class Hd44780 implements DeviceModel {
  ddram = new Array(128).fill(0x20);
  addr = 0;
  shift = 0;
  inc = true;
  displayOn = false;
  cursor = false;
  blink = false;
  backlight = false;
  fourBit = false;
  private pending: number | null = null;
  private lastE = 0;
  private port = 0xff;
  /** 16×2 (default) or 20×4 character module */
  constructor(private host: DeviceHost, private cols = 16, private rows = 2) {}

  i2cAddress() {
    return Number(this.host.props().address) || 0x27;
  }

  reset() {
    this.ddram.fill(0x20);
    this.addr = 0;
    this.shift = 0;
    this.displayOn = false;
    this.fourBit = false;
    this.pending = null;
    this.lastE = 0;
  }

  i2cWrite(bytes: number[]) {
    for (const b of bytes) this.portWrite(b & 0xff);
    this.host.changed();
  }

  i2cRead(n: number) {
    return new Array(n).fill(this.port);
  }

  private portWrite(b: number) {
    this.port = b;
    this.backlight = (b & 0x08) !== 0;
    const e = (b >> 2) & 1;
    if (this.lastE === 1 && e === 0) this.latch((b >> 4) & 0x0f, (b & 1) === 1, (b & 2) !== 0);
    this.lastE = e;
  }

  private latch(nibble: number, rs: boolean, rw: boolean) {
    if (rw) return;
    if (!this.fourBit) {
      // 8-bit mode: only DB4..DB7 are wired, so each strobe is a full (upper-nibble) command
      this.exec((nibble << 4) & 0xf0, rs);
      return;
    }
    if (this.pending === null) this.pending = nibble;
    else {
      const v = (this.pending << 4) | nibble;
      this.pending = null;
      this.exec(v, rs);
    }
  }

  private exec(v: number, rs: boolean) {
    if (rs) {
      this.ddram[this.addr & 0x7f] = v;
      this.addr = (this.addr + (this.inc ? 1 : -1)) & 0x7f;
      return;
    }
    if (v & 0x80) this.addr = v & 0x7f;
    else if (v & 0x40) {
      /* CGRAM address — custom glyphs not rendered */
    } else if (v & 0x20) {
      this.fourBit = (v & 0x10) === 0;
      this.pending = null;
    } else if (v & 0x10) {
      if (v & 0x08) this.shift += v & 0x04 ? -1 : 1;
    } else if (v & 0x08) {
      this.displayOn = (v & 0x04) !== 0;
      this.cursor = (v & 0x02) !== 0;
      this.blink = (v & 0x01) !== 0;
    } else if (v & 0x04) this.inc = (v & 0x02) !== 0;
    else if (v & 0x02) {
      this.addr = 0;
      this.shift = 0;
    } else if (v & 0x01) {
      this.ddram.fill(0x20);
      this.addr = 0;
      this.shift = 0;
    }
  }

  lines(): string[] {
    const out: string[] = [];
    // DDRAM line starts: 16×2 → 0x00, 0x40; 20×4 → 0x00, 0x40, 0x14, 0x54
    const bases = this.rows === 4 ? [0x00, 0x40, 0x14, 0x54] : [0x00, 0x40];
    for (const base of bases) {
      let s = '';
      for (let i = 0; i < this.cols; i++) {
        const idx = this.rows === 4 ? base + i + this.shift : base + ((((i + this.shift) % 40) + 40) % 40);
        const c = this.ddram[idx];
        s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c === 0xdf ? '°' : c < 8 ? '█' : ' ';
      }
      out.push(s);
    }
    return out;
  }

  view() {
    return { lines: this.lines(), on: this.displayOn, backlight: this.backlight, cursor: this.cursor, addr: this.addr };
  }
}
