// Extra displays and communication modules.
import { FAULT, clamp, pin, type PartManifest, type PostCtx } from './base';
import { lcd1602 } from './displays';
import { powerPost } from './sensors';
import { Hd44780 } from '../devices/hd44780';
import { St7735 } from '../devices/st7735';
import { Max485 } from '../devices/serialDevices';

// ---------------------------------------------------------------- LCD 20×4
export const lcd2004: PartManifest = {
  ...lcd1602,
  type: 'lcd2004_i2c',
  name: 'LCD 20×4 with I2C backpack',
  short: 'LCD2004',
  model: 'LCD2004 + PCF8574',
  group: 'Displays',
  description: 'HD44780 20×4 character LCD with a PCF8574 I2C backpack (0x27 / 0x3F). Line start addresses 0x00, 0x40, 0x14, 0x54.',
  w: 200,
  h: 90,
  device: (h) => new Hd44780(h, 20, 4),
  bus: 'i2c',
  fidelity: 'full',
  drivers: ['RPLCD', 'smbus2', 'smartfarm'],
  python: 'RPLCD.i2c.CharLCD("PCF8574", 0x27, cols=20, rows=4) · smartfarm.LCD(cols=20, rows=4)',
};

// ---------------------------------------------------------------- single 7-segment digit
const SEG = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
export const sevenSegment: PartManifest = {
  type: 'seven_segment',
  name: '7-segment display (1 digit)',
  short: '7-seg',
  model: '5161AS (common cathode) / 5161BS (common anode)',
  category: 'output',
  group: 'LEDs & indicators',
  description: 'Eight LEDs (a–g + decimal point) with a common cathode or common anode. Every segment needs its own series resistor (220–330 Ω). Drive it from GPIOs or a 74HC595.',
  w: 50,
  h: 70,
  pins: [
    pin('e', 'e', 0, 70, 'passive'),
    pin('d', 'd', 10, 70, 'passive'),
    pin('COM2', 'COM', 20, 70, 'passive'),
    pin('c', 'c', 30, 70, 'passive'),
    pin('dp', 'DP', 40, 70, 'passive'),
    pin('g', 'g', 0, 0, 'passive'),
    pin('f', 'f', 10, 0, 'passive'),
    pin('COM', 'COM', 20, 0, 'passive'),
    pin('a', 'a', 30, 0, 'passive'),
    pin('b', 'b', 40, 0, 'passive'),
  ],
  internal: () => [['COM', 'COM2']],
  props: [
    { key: 'common', label: 'Type', type: 'select', default: 'cathode', options: [{ value: 'cathode', label: 'Common cathode (COM → GND)' }, { value: 'anode', label: 'Common anode (COM → +3.3 V)' }], group: 'config' },
    { key: 'color', label: 'Colour', type: 'select', default: 'red', options: ['red', 'green', 'blue', 'yellow'].map((c) => ({ value: c, label: c })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  fidelity: 'full',
  limits: 'Each segment is a real LED (Vf 2.0 V) in the circuit solver; brightness follows its current, > 60 mA burns the segment.',
  voltage: 'Vf ≈ 2 V per segment, 20 mA max',
  python: 'gpiozero.LEDBoard / LEDCharDisplay · smartfarm.SevenSegment(pins)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  insertable: true,
  stamp(ctx) {
    if (ctx.fault === 'burned') return;
    const ca = ctx.props.common === 'anode';
    for (const s of SEG) {
      if (ctx.rt[`burned_${s}`]) continue;
      if (ca) ctx.D(s, ctx.node('COM'), ctx.node(s), 2.0, 15);
      else ctx.D(s, ctx.node(s), ctx.node('COM'), 2.0, 15);
    }
  },
  post(ctx: PostCtx) {
    const seg: Record<string, number> = {};
    for (const s of SEG) {
      const i = ctx.cur(s);
      if (i > 0.06) ctx.rt[`burned_${s}`] = true;
      if (ctx.rt[`burned_${s}`]) ctx.issue('E_LED_BURNED', 'error', { ma: Math.round(i * 1000) }, [s]);
      else if (i > 0.025) ctx.issue('W_LED_NO_RESISTOR', 'warning', { ma: Math.round(i * 1000) }, [s]);
      seg[s] = ctx.rt[`burned_${s}`] ? 0 : i > 0.0003 ? clamp(Math.sqrt(i / 0.012), 0.15, 1) : 0;
    }
    return { seg };
  },
};

// ---------------------------------------------------------------- TM1637 4-digit display
/** Bit-level TM1637 two-wire protocol decoder (start/stop, LSB-first bytes, ACK on the 9th clock). */
function tm1637Decode(ctx: PostCtx, clk: boolean, dio: boolean) {
  const s = (ctx.rt.tm ??= { pc: true, pd: true, active: false, n: 0, byte: 0, bytes: [] as number[], digits: [0, 0, 0, 0, 0, 0], addr: 0, on: false, bright: 7, ack: false });
  if (s.pc && clk && s.pd && !dio) {
    s.active = true;
    s.n = 0;
    s.byte = 0;
    s.bytes = [];
  } else if (s.pc && clk && !s.pd && dio && s.active) {
    s.active = false;
    const [cmd, ...data] = s.bytes;
    if (cmd !== undefined) {
      if ((cmd & 0xc0) === 0x40) s.fixed = !!(cmd & 0x04);
      else if ((cmd & 0xc0) === 0xc0) {
        let a = cmd & 0x07;
        for (const b of data) {
          if (a < 6) s.digits[a] = b;
          if (!s.fixed) a++;
        }
      } else if ((cmd & 0xc0) === 0x80) {
        s.on = !!(cmd & 0x08);
        s.bright = cmd & 0x07;
      }
    }
  } else if (s.active && clk && !s.pc) {
    if (s.n < 8) {
      if (dio) s.byte |= 1 << s.n;
      s.n++;
    } else s.n = 9;
  } else if (s.active && !clk && s.pc) {
    if (s.n === 8 && !s.ack) {
      s.ack = true;
      ctx.rt.dirty = true;
    } else if (s.n === 9) {
      s.ack = false;
      s.bytes.push(s.byte & 0xff);
      s.byte = 0;
      s.n = 0;
      ctx.rt.dirty = true;
    }
  }
  s.pc = clk;
  s.pd = dio;
  return s;
}

export const tm1637: PartManifest = {
  type: 'tm1637',
  name: 'TM1637 4-digit 7-segment display',
  short: 'TM1637',
  model: 'TM1637 0.56" module',
  manufacturer: 'Titan Micro (chip)',
  category: 'display',
  group: 'Displays',
  description: '4-digit display with a colon, driven by the TM1637 over a 2-wire protocol (CLK, DIO — not I2C). The module has pull-ups on CLK and DIO; drive DIO open-drain (input = release, output LOW = 0). 3.3–5 V.',
  w: 120,
  h: 50,
  pins: [pin('CLK', 'CLK', 120, 10, 'digital'), pin('DIO', 'DIO', 120, 20, 'digital'), pin('VCC', 'VCC', 120, 30, 'power'), pin('GND', 'GND', 120, 40, 'ground')],
  props: [],
  faults: [FAULT.none, FAULT.disconnected],
  support: 'full',
  fidelity: 'full',
  limits: 'The protocol is decoded edge by edge from the real CLK/DIO voltages: start/stop conditions, LSB-first bytes, the ACK pulled LOW on the 9th clock, data/address/display-control commands, auto-increment and fixed addressing. Key scanning is not implemented.',
  voltage: '3.3–5 V',
  interfaces: ['2-wire (CLK/DIO, bit-banged)'],
  python: 'tm1637.TM1637(clk=23, dio=24).show("1234") · smartfarm.Display4(clk=23, dio=24)',
  drivers: ['tm1637', 'smartfarm'],
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 1000);
    if (ctx.fault === 'disconnected') return;
    ctx.R('puc', ctx.node('CLK'), ctx.node('VCC'), 10000);
    ctx.R('pud', ctx.node('DIO'), ctx.node('VCC'), 10000);
    if (ctx.rt.tm?.ack) ctx.SW('ack', ctx.node('DIO'), ctx.node('GND'), 30, true);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 3.0, 5.5);
    if (!p.powered || ctx.fault === 'disconnected') return { ...p, digits: [0, 0, 0, 0], on: false };
    const vcc = p.vs;
    const clk = ctx.volt('CLK') - ctx.volt('GND') > 0.5 * vcc;
    const dio = ctx.volt('DIO') - ctx.volt('GND') > 0.5 * vcc;
    const s = tm1637Decode(ctx, clk, dio);
    return { ...p, digits: s.digits.slice(0, 4), on: s.on, bright: s.bright };
  },
};

// ---------------------------------------------------------------- WS2812B strip
export const ws2812: PartManifest = {
  type: 'ws2812_strip',
  name: 'WS2812B / NeoPixel strip',
  short: 'NeoPixel',
  model: 'WS2812B',
  manufacturer: 'Worldsemi',
  category: 'output',
  group: 'LEDs & indicators',
  description: 'Addressable RGB LEDs on one data line (DIN → DOUT chains strips). 5 V supply, up to 60 mA per LED at full white — power long strips externally with a common GND. On a Raspberry Pi 5 use the Pi 5 NeoPixel driver.',
  w: 170,
  h: 40,
  pins: [pin('DIN', 'DIN', 0, 20, 'digital'), pin('VCC', '+5V', 0, 10, 'power'), pin('GND', 'GND', 0, 30, 'ground'), pin('DOUT', 'DOUT', 170, 20, 'digital'), pin('VCC2', '+5V', 170, 10, 'power'), pin('GND2', 'GND', 170, 30, 'ground')],
  internal: () => [['VCC', 'VCC2'], ['GND', 'GND2']],
  props: [{ key: 'count', label: 'LEDs', type: 'select', default: 8, options: [1, 4, 8, 12, 16, 24, 30].map((n) => ({ value: n, label: `${n}` })), group: 'config' }],
  faults: [FAULT.none, { id: 'dead_pixel', label: 'First LED dead (breaks the chain)' }],
  support: 'full',
  fidelity: 'functional',
  limits: 'Pixel data delivered by the neopixel driver is routed along the DIN → DOUT chain by topology; the 800 kHz bit timing is not simulated. Supply current (≈20 mA per channel at full brightness) is drawn from the 5 V net.',
  voltage: '5 V (3.5–5.3 V)',
  interfaces: ['1-wire NZR (800 kHz)'],
  python: 'neopixel.NeoPixel(board.D18, 8, brightness=0.3) · smartfarm.LEDStrip(18, 8)',
  drivers: ['neopixel', 'smartfarm'],
  stamp(ctx) {
    ctx.R('din', ctx.node('DIN'), ctx.node('GND'), 100000);
    const px: number[][] = ctx.rt.pixels ?? [];
    const ma = px.reduce((s, c) => s + ((c[0] + c[1] + c[2]) / 255) * 20, 0) + Number(ctx.props.count) * 1;
    ctx.R('leds', ctx.node('VCC'), ctx.node('GND'), 5 / (ma / 1000));
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 3.5, 5.5);
    const g = ctx.gpioOf('DIN');
    if (g !== null && p.powered && p.vs > 4.5) ctx.issue('I_WS2812_3V3_DATA', 'info', { pin: g }, ['DIN']);
    return { ...p, pixels: p.powered ? ctx.rt.pixels ?? [] : [], amps: Math.abs(ctx.cur('leds')) };
  },
};

// ---------------------------------------------------------------- ST7735 TFT
export const st7735: PartManifest = {
  type: 'tft_st7735',
  name: '1.8" TFT 128×160 (ST7735, SPI)',
  short: 'ST7735',
  model: 'ST7735S 1.8" module',
  manufacturer: 'Sitronix (controller)',
  category: 'display',
  group: 'Displays',
  description: 'Colour TFT on SPI0: SCK → GPIO11, SDA (MOSI) → GPIO10, CS → CE0 (GPIO8), DC → any GPIO (LOW = command), RES → GPIO or 3.3 V, BL → 3.3 V. RGB565 pixels.',
  w: 120,
  h: 150,
  pins: [
    pin('GND', 'GND', 0, 150, 'ground'),
    pin('VCC', 'VCC', 10, 150, 'power'),
    pin('SCL', 'SCL/SCK', 20, 150, 'digital'),
    pin('SDA', 'SDA/MOSI', 30, 150, 'digital'),
    pin('RES', 'RES', 40, 150, 'digital'),
    pin('DC', 'DC', 50, 150, 'digital'),
    pin('CS', 'CS', 60, 150, 'digital'),
    pin('BL', 'BL', 70, 150, 'power'),
  ],
  props: [],
  faults: [FAULT.none, FAULT.disconnected],
  support: 'partial',
  fidelity: 'experimental',
  limits: 'EXPERIMENTAL: ST7735 command set subset (SWRESET, SLPOUT, DISPON/OFF, INVON/OFF, CASET, RASET, RAMWR, MADCTL, COLMOD) on SPI with the D/C pin. Gamma tables, scrolling and read commands are ignored. The simulator driver is a small subset API, not the PIL-based Pimoroni/Adafruit libraries.',
  voltage: '3.3 V logic (VCC 3.3–5 V)',
  interfaces: ['SPI0 + DC'],
  python: 'st7735.ST7735(dc=24, rst=25) — simulator subset API (fill, pixel, rect, text)',
  drivers: ['st7735'],
  bus: 'spi',
  device: (h) => new St7735(h),
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 100);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 2.8, 5.5);
    return { ...p, backlight: ctx.volt('BL') - ctx.volt('GND') > 2.5 };
  },
};
(st7735 as any).spiPins = { sck: 'SCL', mosi: 'SDA', miso: '', cs: 'CS', gnd: 'GND' };

// ---------------------------------------------------------------- MAX485 RS-485 transceiver
export const max485: PartManifest = {
  type: 'max485',
  name: 'MAX485 RS-485 transceiver module',
  short: 'MAX485',
  model: 'MAX485 module',
  manufacturer: 'Analog Devices (Maxim) chip',
  category: 'interface',
  group: 'Communication',
  description: 'TTL-UART ↔ RS-485 for Modbus sensors over long cables. RO → Pi RX (GPIO15), DI ← Pi TX (GPIO14), DE and /RE (usually joined) from a GPIO: HIGH to transmit, LOW to receive. A/B go to the bus (A↔A, B↔B). Module VCC 5 V (RO then needs a divider) — 3.3 V-capable variants exist.',
  w: 80,
  h: 50,
  pins: [pin('TX', 'RO', 0, 10, 'digital'), pin('RE', '/RE', 0, 20, 'digital'), pin('DE', 'DE', 0, 30, 'digital'), pin('RX', 'DI', 0, 40, 'digital'), pin('VCC', 'VCC', 80, 10, 'power'), pin('B', 'B', 80, 20, 'digital'), pin('A', 'A', 80, 30, 'digital'), pin('GND', 'GND', 80, 40, 'ground')],
  props: [
    { key: 'baud', label: 'Bus baud rate', type: 'select', default: 9600, options: [2400, 4800, 9600, 19200].map((b) => ({ value: b, label: `${b}` })), group: 'config' },
    { key: 'auto', label: 'Auto-direction module (no DE/RE control)', type: 'boolean', default: false, group: 'config' },
    { key: 'term', label: '120 Ω termination fitted', type: 'boolean', default: true, group: 'config' },
  ],
  faults: [FAULT.none, FAULT.uartLoss],
  support: 'full',
  fidelity: 'functional',
  limits: 'Frames on DI are forwarded to RS-485 devices on the same A/B pair while DE is HIGH; replies reach RO while /RE is LOW. Differential voltages, line length and collisions are not solved.',
  voltage: '5 V (3.3 V variants)',
  interfaces: ['UART ↔ RS-485'],
  python: 'serial.Serial("/dev/serial0", 9600) + gpiozero.OutputDevice(DE/RE) · minimalmodbus · smartfarm.ModbusSoilSensor',
  drivers: ['serial', 'minimalmodbus', 'smartfarm'],
  bus: 'uart',
  device: (h) => new Max485(h),
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 5000);
    for (const p of ['RE', 'DE', 'RX']) ctx.R(`r${p}`, ctx.node(p), ctx.node('GND'), 100000);
    const vs = ctx.rt.vs ?? 0;
    if (vs >= 3) ctx.V('ro', ctx.node('TX'), ctx.node('GND'), vs, 200); // RO idles HIGH
    if (ctx.props.term) ctx.R('term', ctx.node('A'), ctx.node('B'), 120);
  },
  post(ctx) {
    // a 5 V module drives RO to 5 V: the Pi's own GPIO over-voltage check reports it
    return powerPost(ctx, 'VCC', 'GND', 3.0, 5.5);
  },
};

export const DISPLAY2_PARTS: PartManifest[] = [lcd2004, sevenSegment, tm1637, ws2812, st7735, max485];
