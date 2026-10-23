// Bit-accurate MCP3008 SPI model (mode 0, MSB first, CS held for the whole transfer).
// Sequence on DIN: leading zeros, start bit (1), SGL/DIFF, D2, D1, D0.
// DOUT: one undefined sample clock, a null bit (0), then B9..B0.

import type { DeviceModel } from './device';

export class Mcp3008 implements DeviceModel {
  constructor(private sample: (sgl: boolean, ch: number) => number) {}

  spiXfer(bytes: number[]): number[] {
    const out: number[] = [];
    let state: 'idle' | 'cfg' | 'out' = 'idle';
    let cfg = 0;
    let cfgBits = 0;
    let outBits: number[] = [];
    for (const byte of bytes) {
      let ob = 0;
      for (let bit = 7; bit >= 0; bit--) {
        const din = (byte >> bit) & 1;
        let dout = 0;
        if (state === 'idle') {
          if (din === 1) {
            state = 'cfg';
            cfg = 0;
            cfgBits = 0;
          }
        } else if (state === 'cfg') {
          cfg = (cfg << 1) | din;
          cfgBits++;
          if (cfgBits === 4) {
            const sgl = (cfg & 0b1000) !== 0;
            const ch = cfg & 0b111;
            const code = Math.max(0, Math.min(1023, Math.round(this.sample(sgl, ch))));
            outBits = [0, 0]; // sample clock (hi-Z, reads 0) + null bit
            for (let i = 9; i >= 0; i--) outBits.push((code >> i) & 1);
            for (let i = 1; i <= 9; i++) outBits.push((code >> i) & 1); // LSB-first repeat
            state = 'out';
          }
        } else {
          dout = outBits.shift() ?? 0;
        }
        ob |= dout << bit;
      }
      out.push(ob);
    }
    return out;
  }
}
