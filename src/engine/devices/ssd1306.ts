// SSD1306 128x64 I2C OLED: decodes the control byte (0x00 command / 0x40 data,
// Co bit) and the addressing commands into a GDDRAM frame buffer.

import type { DeviceHost, DeviceModel } from './device';

const ARGS: Record<number, number> = {
  0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0x8d: 1, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1, 0xa3: 2,
  0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5,
};

export class Ssd1306 implements DeviceModel {
  ram = new Uint8Array(128 * 8);
  on = false;
  inverse = false;
  contrast = 0x7f;
  mode = 2; // page addressing after reset
  col = 0;
  page = 0;
  colStart = 0;
  colEnd = 127;
  pageStart = 0;
  pageEnd = 7;
  private cmd: number[] = [];
  version = 0;
  constructor(private host: DeviceHost) {}

  i2cAddress() {
    return Number(this.host.props().address) || 0x3c;
  }

  reset() {
    this.ram.fill(0);
    this.on = false;
    this.mode = 2;
    this.col = this.page = 0;
    this.cmd = [];
  }

  i2cWrite(bytes: number[]) {
    let i = 0;
    while (i < bytes.length) {
      const control = bytes[i++];
      const co = (control & 0x80) !== 0;
      const isData = (control & 0x40) !== 0;
      if (co) {
        if (i < bytes.length) isData ? this.data(bytes[i++]) : this.command(bytes[i++]);
      } else {
        for (; i < bytes.length; i++) isData ? this.data(bytes[i]) : this.command(bytes[i]);
      }
    }
    this.version++;
    this.host.changed();
  }

  i2cRead(n: number) {
    return new Array(n).fill(0x40 | (this.on ? 0 : 0x40));
  }

  private command(b: number) {
    if (this.cmd.length) {
      this.cmd.push(b);
      const need = ARGS[this.cmd[0]] ?? 0;
      if (this.cmd.length - 1 >= need) this.runCmd();
      return;
    }
    if (ARGS[b]) {
      this.cmd = [b];
      return;
    }
    this.cmd = [b];
    this.runCmd();
  }

  private runCmd() {
    const [c, a, b] = this.cmd;
    this.cmd = [];
    if (c === 0xae) this.on = false;
    else if (c === 0xaf) this.on = true;
    else if (c === 0xa6) this.inverse = false;
    else if (c === 0xa7) this.inverse = true;
    else if (c === 0x81) this.contrast = a;
    else if (c === 0x20) this.mode = a & 3;
    else if (c === 0x21) {
      this.colStart = a & 127;
      this.colEnd = b & 127;
      this.col = this.colStart;
    } else if (c === 0x22) {
      this.pageStart = a & 7;
      this.pageEnd = b & 7;
      this.page = this.pageStart;
    } else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
    else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
    else if (c >= 0x10 && c <= 0x1f) this.col = ((c & 0x0f) << 4) | (this.col & 0x0f);
  }

  private data(b: number) {
    this.ram[this.page * 128 + (this.col & 127)] = b;
    if (this.mode === 0) {
      this.col++;
      if (this.col > this.colEnd) {
        this.col = this.colStart;
        this.page = this.page >= this.pageEnd ? this.pageStart : this.page + 1;
      }
    } else if (this.mode === 1) {
      this.page++;
      if (this.page > this.pageEnd) {
        this.page = this.pageStart;
        this.col = this.col >= this.colEnd ? this.colStart : this.col + 1;
      }
    } else {
      this.col = (this.col + 1) & 127;
    }
  }

  view() {
    return { on: this.on, inverse: this.inverse, ram: this.ram, version: this.version };
  }
}
