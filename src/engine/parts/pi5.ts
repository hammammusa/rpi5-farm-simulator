import { GND } from '../solver';
import { GPIO_ABS_MAX_V, GPIO_MAX_MA, GPIO_RINT, PI5_HEADER } from '../pi5';
import type { PinDef } from '../types';
import { FAULT, type PartManifest } from './base';

// Header geometry: pin 1 at the left, odd pins on the inner row (y=30),
// even pins on the outer row (y=20) — the way the board looks from above
// with the USB/Ethernet ports on the right.
export const PI_HEADER_X0 = 40;
const pins: PinDef[] = PI5_HEADER.map((h) => {
  const col = Math.floor((h.physical - 1) / 2);
  const odd = h.physical % 2 === 1;
  return {
    id: `P${h.physical}`,
    label: h.name,
    x: PI_HEADER_X0 + col * 10,
    y: odd ? 30 : 20,
    kind: h.kind === 'gpio' ? 'gpio' : h.kind === 'ground' ? 'ground' : 'power',
    desc: `Pin ${h.physical} · ${h.name}${h.bcm !== null ? ` (BCM ${h.bcm})` : ''}${h.alts.length ? ' · ' + h.alts.join(', ') : ''}`,
  };
});

const group = (k: string) => PI5_HEADER.filter((h) => h.kind === k).map((h) => `P${h.physical}`);

/** Output levels of alternate-function pins while a bus is open. */
function altDrive(alt: string): 'high' | 'low' | 'pullup' | 'none' {
  if (/TX$/.test(alt)) return 'high';
  if (/RX$/.test(alt)) return 'pullup';
  if (/CE\d$/.test(alt)) return 'high';
  if (/SCLK|MOSI/.test(alt)) return 'low';
  return 'none';
}

export const pi5: PartManifest = {
  type: 'rpi5',
  name: 'Raspberry Pi 5 Model B (8GB)',
  category: 'board',
  description:
    'Raspberry Pi 5 Model B, 8 GB LPDDR4X, BCM2712 + RP1 I/O controller. 40-pin header with 3.3 V GPIO logic. No built-in ADC.',
  w: 340,
  h: 230,
  pins,
  internal: () => [group('ground'), group('power3v3'), group('power5v')],
  props: [
    { key: 'onewire', label: '1-Wire (dtoverlay=w1-gpio)', type: 'boolean', default: true, group: 'config', help: 'Enables the 1-Wire bus on GPIO4 like dtoverlay=w1-gpio in /boot/firmware/config.txt' },
    { key: 'uart0', label: 'UART0 enabled (dtparam=uart0=on)', type: 'boolean', default: true, group: 'config' },
  ],
  faults: [FAULT.none, FAULT.powerFail],
  support: 'full',
  limits: 'Functional GPIO/bus model. The BCM2712 CPU and Raspberry Pi OS are not emulated; your Python runs in Pyodide (CPython 3.13 compiled to WebAssembly).',
  voltage: '5 V USB-C in, 3.3 V GPIO logic',
  interfaces: ['GPIO', 'PWM', 'I2C1', 'SPI0', 'UART0-4', '1-Wire'],
  stamp(ctx) {
    if (!ctx.sim.piPowered || ctx.fault === 'power_fail') return;
    if (!ctx.rt.trip3v3 && ctx.connected('P1')) ctx.V('3v3', ctx.node('P1'), GND, 3.3, 0.05);
    if (!ctx.rt.trip5v && ctx.connected('P2')) ctx.V('5v', ctx.node('P2'), GND, 5.0, 0.03);
    for (const h of PI5_HEADER) {
      if (h.bcm === null) continue;
      const pid = `P${h.physical}`;
      if (!ctx.connected(pid)) continue;
      const n = ctx.node(pid);
      const g = ctx.sim.gpio(h.bcm);
      // GPIO2/3 always carry the board's fixed 1.8 kΩ pull-ups to 3.3 V
      if (h.bcm === 2 || h.bcm === 3) ctx.V(`i2cpu${h.bcm}`, n, GND, 3.3, 1800);
      if (g.mode === 'output' || g.mode === 'pwm') {
        ctx.V(`g${h.bcm}`, n, GND, ctx.sim.phaseLevel(h.bcm) ? 3.3 : 0, GPIO_RINT);
      } else if (g.mode === 'alt' && g.alt) {
        const d = altDrive(g.alt);
        if (d === 'high') ctx.V(`g${h.bcm}`, n, GND, 3.3, GPIO_RINT);
        else if (d === 'low') ctx.V(`g${h.bcm}`, n, GND, 0, GPIO_RINT);
        else if (d === 'pullup') ctx.V(`pu${h.bcm}`, n, GND, 3.3, 50000);
      } else if (g.pull === 'up') {
        ctx.V(`pu${h.bcm}`, n, GND, 3.3, 50000);
      } else if (g.pull === 'down') {
        ctx.R(`pd${h.bcm}`, n, GND, 50000);
      }
    }
  },
  post(ctx) {
    const out: Record<string, any> = { gpio: {} as Record<number, { v: number; ma: number }> };
    if (!ctx.sim.piPowered || ctx.fault === 'power_fail') return { ...out, off: true };
    const i3 = ctx.cur('3v3');
    const i5 = ctx.cur('5v');
    out.i3v3 = i3;
    out.i5v = i5;
    if (i3 > 1.0) {
      ctx.rt.trip3v3 = true;
      ctx.issue('E_SHORT_RAIL', 'error', { rail: '3.3V', amps: i3.toFixed(1) }, ['P1']);
    } else if (i3 > 0.5) ctx.issue('W_RAIL_BUDGET', 'warning', { rail: '3.3V', ma: Math.round(i3 * 1000), limit: 500 }, ['P1']);
    if (i5 > 5) {
      ctx.rt.trip5v = true;
      ctx.issue('E_SHORT_RAIL', 'error', { rail: '5V', amps: i5.toFixed(1) }, ['P2']);
    } else if (i5 > 1.6) ctx.issue('W_RAIL_BUDGET', 'warning', { rail: '5V', ma: Math.round(i5 * 1000), limit: 1600 }, ['P2']);
    if (ctx.rt.trip3v3) ctx.issue('E_SHORT_RAIL', 'error', { rail: '3.3V', amps: '>1' }, ['P1']);
    if (ctx.rt.trip5v) ctx.issue('E_SHORT_RAIL', 'error', { rail: '5V', amps: '>5' }, ['P2']);
    for (const h of PI5_HEADER) {
      if (h.bcm === null) continue;
      const pid = `P${h.physical}`;
      if (!ctx.connected(pid)) continue;
      const v = ctx.volt(pid);
      const ma = Math.abs(ctx.cur(`g${h.bcm}`)) * 1000;
      out.gpio[h.bcm] = { v, ma };
      if (v > GPIO_ABS_MAX_V) ctx.issue('E_GPIO_OVERVOLTAGE', 'error', { pin: h.bcm, phys: h.physical, v: v.toFixed(1) }, [pid]);
      else if (v < -0.5) ctx.issue('E_GPIO_NEGATIVE', 'error', { pin: h.bcm, phys: h.physical, v: v.toFixed(1) }, [pid]);
      if (ma > 50) ctx.issue('E_GPIO_SHORT', 'error', { pin: h.bcm, phys: h.physical, ma: Math.round(ma) }, [pid]);
      else if (ma > GPIO_MAX_MA) ctx.issue('W_GPIO_OVERCURRENT', 'warning', { pin: h.bcm, phys: h.physical, ma: Math.round(ma), limit: GPIO_MAX_MA }, [pid]);
    }
    return out;
  },
};
