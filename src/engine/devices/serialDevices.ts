// UART-level device models: Plantower PMS5003 frames, a MAX485 RS-485 transceiver
// and a Modbus-RTU soil sensor that sits on the RS-485 pair.

import type { DeviceHost, DeviceModel } from './device';

// ---------------------------------------------------------------- PMS5003 particulate sensor
/** 32-byte PMS5003 frame: 42 4D, length 28, 13 data words, checksum = sum of bytes 0..29. */
export function pmsFrame(pm1: number, pm25: number, pm10: number) {
  const r = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));
  const words = [pm1, pm25, pm10, pm1, pm25, pm10, pm25 * 180, pm25 * 52, pm25 * 9, pm25 * 1.2, pm10 * 0.3, pm10 * 0.1, 0].map(r);
  const f = [0x42, 0x4d, 0x00, 0x1c];
  for (const w of words) f.push((w >> 8) & 0xff, w & 0xff);
  const sum = f.reduce((s, b) => s + b, 0) & 0xffff;
  f.push((sum >> 8) & 0xff, sum & 0xff);
  return f;
}

export class Pms5003 implements DeviceModel {
  private active = true;
  private next = 0;
  private buf: number[] = [];
  constructor(private host: DeviceHost) {}
  uartBaud() {
    return 9600;
  }
  reset() {
    this.active = true;
    this.next = this.host.now() + 1;
  }
  private frame() {
    const f = this.host.fault();
    if (f === 'disconnected' || f === 'uart_loss') return null;
    const v = (k: string) => this.host.value(k);
    const fr = pmsFrame(v('pm1'), v('pm25'), v('pm10'));
    if (f === 'invalid') fr[fr.length - 1] ^= 0x55; // corrupt checksum
    return fr;
  }
  /** SET pin LOW = sleep (the module pulls SET high internally) */
  private sleeping() {
    return this.host.pinConnected?.('SET') && (this.host.pinVolt?.('SET') ?? 3.3) < 0.8;
  }
  tick(t: number) {
    if (!this.active || this.sleeping() || t < this.next) return;
    this.next = t + 1;
    const fr = this.frame();
    if (fr) this.host.send(fr, t);
  }
  uartReceive(bytes: number[], t: number) {
    for (const b of bytes) {
      if (!this.buf.length && b !== 0x42) continue;
      this.buf.push(b);
      if (this.buf.length === 7) {
        const [, m, cmd, , data] = this.buf;
        this.buf = [];
        if (m !== 0x4d) continue;
        if (cmd === 0xe1) this.active = data === 1; // change mode: 0 passive, 1 active
        else if (cmd === 0xe2 && !this.active) {
          const fr = this.frame();
          if (fr) this.host.send(fr, t + 0.05);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Modbus RTU helpers
export function modbusCrc(bytes: number[]) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return [crc & 0xff, (crc >> 8) & 0xff];
}

// ---------------------------------------------------------------- MAX485 transceiver
/**
 * TTL side: DI (from Pi TX), RO (to Pi RX), DE (driver enable, active high), /RE (receiver enable, active low).
 * Bus side: A/B. Bytes are forwarded to every RS-485 device on the same A and B nets while DE is high;
 * replies reach RO only while /RE is low (or always, for auto-direction boards).
 */
export class Max485 implements DeviceModel {
  constructor(private host: DeviceHost) {}
  uartBaud() {
    return Number(this.host.props().baud) || 9600;
  }
  private level(pin: string, idle: number) {
    if (!this.host.pinConnected?.(pin)) return idle;
    return (this.host.pinVolt?.(pin) ?? 0) >= 1.5 ? 1 : 0;
  }
  private auto() {
    return !!this.host.props().auto;
  }
  uartReceive(bytes: number[], t: number) {
    if (!this.auto() && !this.level('DE', 0)) {
      this.host.log('MAX485: data on DI ignored — DE is LOW (driver disabled). Drive DE HIGH while transmitting.');
      return;
    }
    const onB = new Set((this.host.netPeers?.('B') ?? []).map((p) => p.id));
    const peers = (this.host.netPeers?.('A') ?? []).filter((p) => onB.has(p.id));
    let n = 0;
    for (const p of peers) {
      if (!p.dev?.rs485Receive) continue;
      // both A and B must be shared (A↔A, B↔B)
      n++;
      p.dev.rs485Receive(bytes, t, (reply, rt) => this.fromBus(reply, rt));
    }
    if (!n) this.host.log('MAX485: no RS-485 device on the A/B pair');
  }
  /** a frame from the bus reaches RO (→ Pi RX) only while /RE is LOW */
  private fromBus(bytes: number[], t: number) {
    if (!this.auto() && this.level('RE', 0)) {
      this.host.log('MAX485: reply lost — /RE is HIGH (receiver disabled). Pull DE and /RE LOW after sending.');
      return;
    }
    this.host.send(bytes, t);
  }
}

// ---------------------------------------------------------------- RS-485 Modbus soil sensor
/**
 * Generic 7-in-1 RS-485 soil probe (Modbus RTU, 8N1). Holding/input registers:
 * 0 moisture ×10 %, 1 temperature ×10 °C (signed), 2 EC µS/cm, 3 pH ×10, 4 N mg/kg, 5 P mg/kg, 6 K mg/kg.
 * Register maps differ between vendors — this one is documented in the part description.
 */
export class ModbusSoilSensor implements DeviceModel {
  constructor(private host: DeviceHost) {}
  uartBaud() {
    return Number(this.host.props().baud) || 9600;
  }
  private regs(): number[] {
    const v = (k: string) => this.host.value(k);
    const s16 = (x: number) => Math.round(x) & 0xffff;
    return [s16(v('moisture') * 10), s16(v('temperature') * 10), s16(v('ec')), s16(v('ph') * 10), s16(v('n')), s16(v('p')), s16(v('k'))];
  }
  rs485Receive(bytes: number[], t: number, reply: (b: number[], t: number) => void) {
    const f = this.host.fault();
    if (f === 'disconnected' || f === 'uart_loss' || !this.host.powered()) return;
    if (bytes.length < 8) return;
    const fr = bytes.slice(0, 8);
    const [addr, fn, ah, al, nh, nl, c1, c2] = fr;
    const crc = modbusCrc(fr.slice(0, 6));
    if (crc[0] !== c1 || crc[1] !== c2) {
      this.host.log('Modbus sensor: frame with bad CRC ignored');
      return;
    }
    if (addr !== (Number(this.host.props().slave) || 1)) return;
    const start = (ah << 8) | al;
    const count = (nh << 8) | nl;
    const regs = this.regs();
    let resp: number[];
    if ((fn !== 3 && fn !== 4) || count < 1 || count > 16) resp = [addr, fn | 0x80, 0x01];
    else if (start + count > regs.length) resp = [addr, fn | 0x80, 0x02];
    else {
      resp = [addr, fn, count * 2];
      for (let i = 0; i < count; i++) resp.push((regs[start + i] >> 8) & 0xff, regs[start + i] & 0xff);
    }
    if (f === 'invalid') resp[resp.length - 1] ^= 0xff;
    resp.push(...modbusCrc(resp));
    this.host.rt?.() && Object.assign(this.host.rt!(), { lastRead: t });
    reply(resp, t + 0.02 + (resp.length * 10) / this.uartBaud());
  }
}
