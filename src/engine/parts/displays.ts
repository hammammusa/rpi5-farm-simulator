import { FAULT, pin, type PartManifest, type PostCtx } from './base';

function supplyPost(ctx: PostCtx, min: number, max: number) {
  const vs = ctx.connected('VCC') && ctx.connected('GND') ? ctx.volt('VCC') - ctx.volt('GND') : 0;
  if (ctx.rt.vs === undefined || Math.abs(ctx.rt.vs - vs) > 0.01) {
    ctx.rt.vs = vs;
    ctx.rt.dirty = true;
  }
  if (ctx.connected('VCC') && !ctx.connected('GND')) ctx.issue('W_MISSING_GROUND', 'warning', {}, ['GND']);
  else if (ctx.connected('VCC') && vs < min) ctx.issue('W_UNPOWERED', 'warning', { v: vs.toFixed(1), min }, ['VCC']);
  if (vs > max + 0.3) {
    ctx.rt.damaged = true;
    ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vs.toFixed(1), max }, ['VCC']);
  }
  return { vs, powered: vs >= min && !ctx.rt.damaged };
}

export const nextion: PartManifest = {
  type: 'nextion',
  name: 'Nextion Enhanced 2.8" (NX3224K028)',
  category: 'display',
  description:
    'Nextion Enhanced HMI touchscreen, 320×240, UART (default 9600 baud). Every instruction ends with FF FF FF. Wire Nextion TX → Pi RX (GPIO15), Nextion RX → Pi TX (GPIO14), 5 V and GND. Design its pages in the Nextion tab.',
  w: 230,
  h: 180,
  pins: [pin('VCC', '+5V (red)', 0, 120, 'power'), pin('TX', 'TX (blue)', 0, 130, 'digital'), pin('RX', 'RX (yellow)', 0, 140, 'digital'), pin('GND', 'GND (black)', 0, 150, 'ground')],
  props: [
    { key: 'baud', label: 'Baud rate (bauds)', type: 'select', default: 9600, options: [2400, 4800, 9600, 19200, 38400, 57600, 115200].map((v) => ({ value: v, label: `${v}` })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.uartLoss, { id: 'touch_dead', label: 'Touch panel not responding' }],
  support: 'partial',
  limits:
    'Training model of NX3224K028 (2.8" Enhanced, 320×240), chosen from the 2026 regional equipment list as a reference model. Implements a documented subset of the Nextion instruction set over UART; .HMI/.TFT files are NOT imported or executed.',
  voltage: '4.75–7 V supply, 3.3 V TX (5 V-tolerant RX)',
  interfaces: ['UART'],
  python: 'serial.Serial("/dev/serial0", 9600) + bytes ending in b"\\xff\\xff\\xff"',
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 55);
    const vs = ctx.rt.vs ?? 0;
    if (vs >= 4.5 && !ctx.rt.damaged) {
      ctx.V('tx', ctx.node('TX'), ctx.node('GND'), 3.3, 200);
      ctx.V('rxpu', ctx.node('RX'), ctx.node('GND'), 3.3, 20000);
    }
  },
  post(ctx) {
    return supplyPost(ctx, 4.5, 7);
  },
};

export const lcd1602: PartManifest = {
  type: 'lcd1602_i2c',
  name: 'LCD 16×2 with I2C backpack',
  category: 'display',
  description:
    'HD44780 16×2 character LCD with PCF8574 I2C backpack (address 0x27 or 0x3F). The backpack has 4.7 kΩ pull-ups to its VCC: at 5 V they lift the Pi’s I2C lines above 3.3 V unless removed or a level shifter is used.',
  w: 160,
  h: 70,
  pins: [pin('GND', 'GND', 0, 10, 'ground'), pin('VCC', 'VCC', 0, 20, 'power'), pin('SDA', 'SDA', 0, 30, 'digital'), pin('SCL', 'SCL', 0, 40, 'digital')],
  props: [
    { key: 'address', label: 'I2C address', type: 'select', default: 0x27, options: [{ value: 0x27, label: '0x27 (PCF8574)' }, { value: 0x3f, label: '0x3F (PCF8574A)' }], group: 'config' },
    {
      key: 'pullups',
      label: 'Backpack pull-ups',
      type: 'select',
      default: 'vcc',
      options: [
        { value: 'vcc', label: '4.7 kΩ to VCC (stock)' },
        { value: 'removed', label: 'Removed / level-shifted' },
      ],
      group: 'config',
    },
  ],
  faults: [FAULT.none, FAULT.disconnected],
  support: 'full',
  limits: 'PCF8574 → HD44780 4-bit protocol is decoded from the actual I2C bytes (E strobe, RS, nibbles). Custom characters (CGRAM) are stored but drawn as blocks.',
  voltage: '5 V (works at 3.3 V with low contrast)',
  interfaces: ['I2C'],
  python: 'RPLCD.i2c.CharLCD("PCF8574", 0x27) or raw smbus2 writes',
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 200);
    if (ctx.props.pullups === 'vcc' && ctx.fault !== 'disconnected') {
      ctx.R('puSDA', ctx.node('SDA'), ctx.node('VCC'), 4700);
      ctx.R('puSCL', ctx.node('SCL'), ctx.node('VCC'), 4700);
    }
  },
  post(ctx) {
    return supplyPost(ctx, 2.7, 5.5);
  },
};

export const oled: PartManifest = {
  type: 'oled_ssd1306',
  name: 'OLED 0.96" SSD1306 (I2C)',
  category: 'display',
  description: '128×64 monochrome OLED, SSD1306 controller, I2C address 0x3C. Board has a regulator and 3.3 V pull-ups.',
  w: 110,
  h: 80,
  pins: [pin('GND', 'GND', 0, 70, 'ground'), pin('VCC', 'VCC', 10, 70, 'power'), pin('SCL', 'SCL', 20, 70, 'digital'), pin('SDA', 'SDA', 30, 70, 'digital')],
  props: [{ key: 'address', label: 'I2C address', type: 'select', default: 0x3c, options: [{ value: 0x3c, label: '0x3C' }, { value: 0x3d, label: '0x3D' }], group: 'config' }],
  faults: [FAULT.none, FAULT.disconnected],
  support: 'partial',
  limits: 'SSD1306 command/data stream decoded into the 128×64 frame buffer (horizontal, vertical and page addressing). Scrolling commands are accepted but not animated.',
  voltage: '3.3–5 V',
  interfaces: ['I2C'],
  python: 'ssd1306.SSD1306_I2C(128, 64, smbus2.SMBus(1)) — MicroPython-style framebuf API',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 300);
    if (ctx.fault === 'disconnected') return;
    for (const s of ['SDA', 'SCL']) ctx.V(`pu${s}`, ctx.node(s), ctx.node('GND'), 3.3, 4700);
  },
  post(ctx) {
    return supplyPost(ctx, 3.0, 5.5);
  },
};

export const usbSerial: PartManifest = {
  type: 'usb_serial',
  name: 'USB-serial adapter (PC terminal)',
  category: 'interface',
  description: '3.3 V USB-UART adapter connected to a PC serial terminal. Adapter TXD → Pi RX (GPIO15), adapter RXD → Pi TX (GPIO14), GND → GND. Type in the UART panel to send.',
  w: 90,
  h: 40,
  pins: [pin('GND', 'GND', 0, 10, 'ground'), pin('TX', 'TXD', 0, 20, 'digital'), pin('RX', 'RXD', 0, 30, 'digital')],
  props: [{ key: 'baud', label: 'Terminal baud', type: 'select', default: 9600, options: [9600, 19200, 38400, 57600, 115200].map((v) => ({ value: v, label: `${v}` })), group: 'config' }],
  faults: [FAULT.none, FAULT.uartLoss],
  support: 'full',
  interfaces: ['UART'],
  python: 'serial.Serial("/dev/serial0", 9600)',
  stamp(ctx) {
    ctx.V('tx', ctx.node('TX'), ctx.node('GND'), 3.3, 200);
  },
  post() {
    return { powered: true };
  },
};
