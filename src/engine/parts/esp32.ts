// ESP32-DevKitC V4 (ESP32-WROOM-32) as a part: drawing geometry, power rails, GPIO drivers
// and the electrical checks that matter on this board (3.3 V-only GPIO, input-only pins,
// strapping pins at boot, SPI-flash pins).
import { GND } from '../solver';
import { ESP32_DEVKITC, ESP32_J2, ESP32_J3 } from '../boards/esp32';
import type { PinDef } from '../types';
import { FAULT, type PartManifest } from './base';

/** pin pitch 2.54 mm = 10 units; the two headers are 2.54 cm apart */
export const ESP32_W = 120;
export const ESP32_H = 250;
const Y0 = 50;

const pins: PinDef[] = [
  ...ESP32_J2.map((p, i) => ({ id: p.pin, label: p.label, x: 10, y: Y0 + i * 10, kind: kindOf(p.kind), desc: descOf(p) })),
  ...ESP32_J3.map((p, i) => ({ id: p.pin, label: p.label, x: ESP32_W - 10, y: Y0 + i * 10, kind: kindOf(p.kind), desc: descOf(p) })),
];

function kindOf(k: string): PinDef['kind'] {
  return k === 'gpio' ? 'gpio' : k === 'ground' ? 'ground' : k === 'power' ? 'power' : 'digital';
}

function descOf(p: (typeof ESP32_J2)[number]): string {
  const parts: string[] = [p.label];
  if (p.num !== undefined) parts.push(`GPIO${p.num}`);
  if (p.caps.flash) parts.push('SPI flash — do not use');
  else if (p.kind === 'gpio' && !p.caps.output) parts.push('input only, no pull-up/down');
  if (p.caps.adc) parts.push(`ADC${p.caps.adc.unit}_CH${p.caps.adc.ch}`);
  if (p.caps.dac) parts.push('DAC');
  if (p.caps.defaultFn) parts.push(p.caps.defaultFn);
  if (p.caps.strapping) parts.push('strapping pin');
  if (p.pin === 'EN') parts.push('chip enable / reset (internal pull-up)');
  if (p.pin === '5V') parts.push('USB 5 V (VBUS) when powered from USB');
  if (p.pin === '3V3') parts.push('3.3 V from the on-board regulator');
  return parts.join(' · ');
}

/** effective output resistance of a GPIO at the default drive strength (≈20 mA) */
const RINT = 30;
/** internal weak pull-up/down resistance */
const RPULL = 45000;

export const esp32: PartManifest = {
  type: 'esp32_devkitc',
  name: 'ESP32-DevKitC V4 (ESP32-WROOM-32)',
  short: 'ESP32',
  category: 'board',
  manufacturer: 'Espressif',
  model: 'ESP32-DevKitC V4',
  description:
    'Espressif ESP32-DevKitC V4 development board with the ESP32-WROOM-32 module: dual-core Xtensa LX6, Wi-Fi + Bluetooth, 3.3 V GPIO. Programmable in MicroPython or Arduino C++ in this simulator.',
  w: ESP32_W,
  h: ESP32_H,
  pins,
  internal: () => [['GND1', 'GND2', 'GND3']],
  props: [
    {
      key: 'power',
      label: 'Power source',
      type: 'select',
      default: 'usb',
      options: [
        { value: 'usb', label: 'Micro-USB from the PC (5 V)' },
        { value: 'pins', label: 'External supply on the 5V or 3V3 pin' },
      ],
      group: 'config',
      help: 'Use only one power source at a time: USB, the 5V pin or the 3V3 pin (Espressif user guide).',
    },
  ],
  faults: [FAULT.none, FAULT.powerFail],
  support: 'full',
  limits: ESP32_DEVKITC.limits,
  voltage: '5 V USB or 5V pin (on-board 3.3 V regulator); GPIO 3.3 V, not 5 V tolerant',
  interfaces: ['GPIO', 'ADC1/ADC2 (12-bit)', 'DAC (GPIO25/26)', 'PWM (LEDC)', 'I2C', 'UART0/1/2', '1-Wire (software)'],
  python: 'MicroPython: machine.Pin, ADC, DAC, PWM, I2C/SoftI2C, UART, Timer, time, dht, onewire/ds18x20, neopixel · Arduino C++: pinMode/digitalWrite/digitalRead, analogRead(MilliVolts), ledcAttach/ledcWrite, analogWrite, dacWrite, attachInterrupt, Serial/Serial1/Serial2, Wire, DHT.h, DallasTemperature.h, Adafruit_NeoPixel.h',
  commonErrors: [
    'Using GPIO6–11 (CLK, D0–D3, CMD): they belong to the on-module SPI flash.',
    'Driving an output on GPIO34–39: these pins are input-only and have no internal pull resistors.',
    'Connecting a 5 V signal (HC-SR04 echo, 5 V module output) directly to a GPIO.',
    'Holding GPIO0 LOW or GPIO12 HIGH at power-up (strapping pins): the board does not start your program.',
    'Reading an ADC2 pin (GPIO0, 2, 4, 12–15, 25–27) while Wi-Fi is active.',
  ],
  stamp(ctx) {
    const id = ctx.comp.id;
    const usb = ctx.props.power !== 'pins';
    if (ctx.fault === 'power_fail') return;
    if (usb) {
      if (ctx.connected('3V3')) ctx.V('3v3', ctx.node('3V3'), GND, 3.3, 0.05);
      if (ctx.connected('5V')) ctx.V('5v', ctx.node('5V'), GND, 5.0, 0.2);
    } else if (ctx.rt.extPowered && ctx.rt.via5v && ctx.connected('3V3')) {
      // 5 V on the 5V pin feeds the on-board LDO, which then drives the 3V3 pin
      ctx.V('3v3', ctx.node('3V3'), GND, 3.3, 0.05);
    }
    if (!usb && !ctx.rt.extPowered) return;
    for (const p of ESP32_DEVKITC.pins) {
      if (p.num === undefined || p.caps.flash || !ctx.connected(p.pin)) continue;
      const g = ctx.sim.pin(id, p.num);
      if (!g) continue;
      const n = ctx.node(p.pin);
      if (g.mode === 'output' || g.mode === 'pwm') ctx.V(`g${p.num}`, n, GND, ctx.sim.pinPhase(id, p.num) ? 3.3 : 0, RINT);
      else if (g.mode === 'alt' && g.alt?.endsWith(' TX')) ctx.V(`tx${p.num}`, n, GND, 3.3, RINT); // UART TX idles HIGH
      else if (g.mode === 'alt' && g.alt === 'DAC') ctx.V(`dac${p.num}`, n, GND, 3.3 * g.pwmDuty, 1000); // DAC output ≈1 kΩ
      else if (g.pull === 'up') ctx.V(`pu${p.num}`, n, GND, 3.3, RPULL);
      else if (g.pull === 'down') ctx.R(`pd${p.num}`, n, GND, RPULL);
    }
  },
  post(ctx) {
    const id = ctx.comp.id;
    const out: Record<string, any> = { gpio: {} as Record<number, { v: number; ma: number }> };
    const usb = ctx.props.power !== 'pins';
    if (!usb) {
      const v5 = ctx.connected('5V') ? ctx.volt('5V') : 0;
      const v3 = ctx.connected('3V3') ? ctx.volt('3V3') : 0;
      const ext = v5 >= 4.3 || v3 >= 3.0;
      const via5v = v5 >= 4.3;
      if (ext !== !!ctx.rt.extPowered || via5v !== !!ctx.rt.via5v) ctx.rt.dirty = true;
      ctx.rt.extPowered = ext;
      ctx.rt.via5v = via5v;
      if (v3 > 3.6) ctx.issue('E_MCU_OVERVOLTAGE', 'error', { board: ctx.comp.label || id, pin: '3V3', v: v3.toFixed(1) }, ['3V3']);
      if (v5 > 5.5) ctx.issue('E_MCU_OVERVOLTAGE', 'error', { board: ctx.comp.label || id, pin: '5V', v: v5.toFixed(1) }, ['5V']);
    }
    const powered = ctx.fault !== 'power_fail' && (usb || !!ctx.rt.extPowered);
    out.powered = powered;
    out.running = ctx.sim.boardRunning(id);
    if (!powered) return out;
    out.i3v3 = usb ? ctx.cur('3v3') : 0;
    if (out.i3v3 > 0.6) ctx.issue('W_RAIL_BUDGET', 'warning', { rail: 'ESP32 3V3', ma: Math.round(out.i3v3 * 1000), limit: 600 }, ['3V3']);
    for (const p of ESP32_DEVKITC.pins) {
      if (p.num === undefined || !ctx.connected(p.pin)) continue;
      const v = ctx.volt(p.pin);
      const g = ctx.sim.pin(id, p.num);
      const driven = g?.mode === 'output' || g?.mode === 'pwm';
      const ma = driven ? Math.abs(ctx.cur(`g${p.num}`)) * 1000 : 0;
      out.gpio[p.num] = { v, ma };
      const where = { board: ctx.comp.label || id, pin: `GPIO${p.num}`, label: p.label };
      if (p.caps.flash) ctx.issue('E_MCU_FLASH_PIN', 'error', where, [p.pin]);
      if (v > ESP32_DEVKITC.absMaxV) ctx.issue('E_MCU_OVERVOLTAGE', 'error', { ...where, v: v.toFixed(1) }, [p.pin]);
      else if (v < -0.5) ctx.issue('E_MCU_OVERVOLTAGE', 'error', { ...where, v: v.toFixed(1) }, [p.pin]);
      if (ma > ESP32_DEVKITC.pinMa.max) ctx.issue('E_MCU_SHORT', 'error', { ...where, ma: Math.round(ma) }, [p.pin]);
      else if (ma > ESP32_DEVKITC.pinMa.recommended) ctx.issue('W_MCU_OVERCURRENT', 'warning', { ...where, ma: Math.round(ma), limit: ESP32_DEVKITC.pinMa.recommended }, [p.pin]);
      // strapping pins held by the external circuit at power-up
      if (!driven && p.num === 0 && v < 0.8 && ctx.sim.boardRunning(id) === false) ctx.issue('W_STRAP_BOOT', 'warning', where, [p.pin]);
      if (!driven && p.num === 12 && v > 2.0) ctx.issue('W_STRAP_FLASH_V', 'warning', where, [p.pin]);
    }
    return out;
  },
};
