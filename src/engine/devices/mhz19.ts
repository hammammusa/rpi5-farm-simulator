// Winsen MH-Z19B UART protocol (9600 8N1, 9-byte frames, checksum = 0xFF - sum(b1..b7) + 1).

import type { DeviceHost, DeviceModel } from './device';

export function mhzChecksum(frame: number[]) {
  let s = 0;
  for (let i = 1; i < 8; i++) s = (s + frame[i]) & 0xff;
  return (0xff - s + 1) & 0xff;
}

export class Mhz19 implements DeviceModel {
  private buf: number[] = [];
  private zeroOffset = 0;
  abc = true;
  range = 5000;
  constructor(private host: DeviceHost) {}

  uartBaud() {
    return 9600;
  }

  reset() {
    this.buf = [];
  }

  uartReceive(bytes: number[], t: number) {
    const f = this.host.fault();
    if (f === 'uart_loss' || f === 'disconnected') return;
    for (const b of bytes) {
      if (this.buf.length === 0 && b !== 0xff) continue;
      this.buf.push(b);
      if (this.buf.length === 9) {
        const frame = this.buf;
        this.buf = [];
        if (mhzChecksum(frame) !== frame[8]) {
          this.host.log('MH-Z19B: frame with wrong checksum ignored');
          continue;
        }
        this.handle(frame, t);
      }
    }
  }

  private handle(frame: number[], t: number) {
    const cmd = frame[2];
    if (cmd === 0x86) {
      if (this.host.fault() === 'timeout' && Math.random() < 0.5) return;
      let ppm = Math.round(this.host.value('co2') - this.zeroOffset);
      if (this.host.fault() === 'invalid') ppm = Math.random() < 0.5 ? 0 : 65535;
      ppm = Math.max(0, Math.min(this.host.fault() === 'invalid' ? 65535 : this.range, ppm));
      const temp = Math.round(this.host.value('temperature')) + 40;
      const resp = [0xff, 0x86, (ppm >> 8) & 0xff, ppm & 0xff, temp & 0xff, 0x00, 0x00, 0x00, 0];
      resp[8] = mhzChecksum(resp);
      this.host.send(resp, t + 0.01);
    } else if (cmd === 0x87) {
      this.zeroOffset = this.host.value('co2') - 400;
      this.host.log('MH-Z19B: zero point calibrated to 400 ppm');
    } else if (cmd === 0x79) {
      this.abc = frame[3] === 0xa0;
    } else if (cmd === 0x99) {
      this.range = (frame[6] << 8) | frame[7] || 5000;
    }
  }

  view() {
    return { abc: this.abc, range: this.range };
  }
}
