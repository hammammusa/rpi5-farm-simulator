import type { PinDef } from '../types';
import { FAULT, clamp, pin, type PartManifest, type PostCtx } from './base';

// ---------------------------------------------------------------- breadboard
const BB_ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
const BB_ROWS_BOT = ['f', 'g', 'h', 'i', 'j'];
const bbCols = (p: Record<string, any>) => (p.size === 'full' ? 60 : 30);
const rowY: Record<string, number> = { a: 50, b: 60, c: 70, d: 80, e: 90, f: 120, g: 130, h: 140, i: 150, j: 160 };

function bbPins(p: Record<string, any>): PinDef[] {
  const n = bbCols(p);
  const out: PinDef[] = [];
  for (let c = 1; c <= n; c++) {
    const x = 10 + c * 10;
    for (const r of [...BB_ROWS_TOP, ...BB_ROWS_BOT]) out.push(pin(`${r}${c}`, `${r}${c}`, x, rowY[r], 'hole'));
    out.push(pin(`tn${c}`, `top −`, x, 10, 'hole'));
    out.push(pin(`tp${c}`, `top +`, x, 20, 'hole'));
    out.push(pin(`bp${c}`, `bottom +`, x, 190, 'hole'));
    out.push(pin(`bn${c}`, `bottom −`, x, 200, 'hole'));
  }
  return out;
}

export const breadboard: PartManifest = {
  type: 'breadboard',
  name: 'Breadboard',
  category: 'basic',
  description: 'Solderless breadboard. Each column of 5 holes (a–e, f–j) is connected; the power rails run the full length.',
  w: 340,
  h: 210,
  pins: bbPins,
  internal: (p) => {
    const n = bbCols(p);
    const g: string[][] = [];
    for (let c = 1; c <= n; c++) {
      g.push(BB_ROWS_TOP.map((r) => `${r}${c}`));
      g.push(BB_ROWS_BOT.map((r) => `${r}${c}`));
    }
    const rail = (prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
    g.push(rail('tn'), rail('tp'), rail('bp'), rail('bn'));
    return g;
  },
  props: [
    {
      key: 'size',
      label: 'Size',
      type: 'select',
      default: 'half',
      options: [
        { value: 'half', label: 'Half (30 columns)' },
        { value: 'full', label: 'Full (60 columns)' },
      ],
      group: 'config',
    },
  ],
  support: 'full',
};

// ---------------------------------------------------------------- LED
const LED_VF: Record<string, number> = { red: 1.9, yellow: 2.0, green: 2.1, blue: 2.9, white: 2.9 };

function ledPost(ctx: PostCtx, tag: string, a: string, k: string) {
  const i = ctx.cur(tag);
  if (i > 0.06) ctx.rt[`burned_${tag}`] = true;
  if (ctx.rt[`burned_${tag}`]) {
    ctx.issue('E_LED_BURNED', 'error', { ma: Math.round(i * 1000) }, [a, k]);
    return { brightness: 0, ma: 0, burned: true };
  }
  if (i > 0.025) ctx.issue('W_LED_NO_RESISTOR', 'warning', { ma: Math.round(i * 1000) }, [a, k]);
  const rev = ctx.volt(k) - ctx.volt(a);
  if (rev > 1.0 && ctx.connected(a) && ctx.connected(k)) ctx.issue('W_LED_REVERSED', 'warning', { v: rev.toFixed(1) }, [a, k]);
  const brightness = i > 0.0003 ? clamp(Math.sqrt(i / 0.012), 0.15, 1) : 0;
  return { brightness, ma: i * 1000, burned: false };
}

/** An LED with a driven anode but no conductive return path (or vice versa) is an open circuit. */
function openCheck(ctx: PostCtx, a: string, k: string) {
  if (!ctx.connected(a) && !ctx.connected(k)) return;
  // node -1 is the reference (GND); -2 means the pin is not on any solved net
  const isDriven = (n: number) => n === -1 || (n >= 0 && ctx.sol.driven[n] === 1);
  const da = isDriven(ctx.node(a));
  const dk = isDriven(ctx.node(k));
  if (da !== dk) ctx.issue('W_OPEN_CIRCUIT', 'warning', { side: da ? 'cathode (−)' : 'anode (+)' }, [da ? k : a]);
}

export const led: PartManifest = {
  type: 'led',
  name: 'LED',
  category: 'output',
  description: '5 mm LED. The longer leg (anode, +) goes towards the supply, the cathode (−, flat side) towards GND. Needs a series resistor (220–330 Ω at 3.3 V).',
  w: 20,
  h: 50,
  pins: [pin('A', 'Anode (+)', 10, 40, 'passive'), pin('K', 'Cathode (−)', 0, 40, 'passive')],
  props: [
    {
      key: 'color',
      label: 'Colour',
      type: 'select',
      default: 'red',
      options: ['red', 'green', 'yellow', 'blue', 'white'].map((c) => ({ value: c, label: c })),
      group: 'config',
    },
  ],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  voltage: 'Vf ≈ 1.9–2.9 V, 20 mA max',
  insertable: true,
  python: 'gpiozero.LED, gpiozero.PWMLED, RPi.GPIO',
  stamp(ctx) {
    if (ctx.fault === 'burned' || ctx.rt.burned_d) return;
    ctx.D('d', ctx.node('A'), ctx.node('K'), LED_VF[ctx.props.color] ?? 2, 15);
  },
  post(ctx) {
    if (ctx.fault === 'burned') return { brightness: 0, burned: true };
    openCheck(ctx, 'A', 'K');
    return ledPost(ctx, 'd', 'A', 'K');
  },
};

export const rgbLed: PartManifest = {
  type: 'rgb_led',
  name: 'RGB LED',
  category: 'output',
  description: 'Common-cathode or common-anode RGB LED. Use one resistor per colour channel.',
  w: 40,
  h: 50,
  pins: [pin('R', 'Red', 0, 40, 'passive'), pin('COM', 'Common', 10, 40, 'passive'), pin('G', 'Green', 20, 40, 'passive'), pin('B', 'Blue', 30, 40, 'passive')],
  props: [
    {
      key: 'common',
      label: 'Type',
      type: 'select',
      default: 'cathode',
      options: [
        { value: 'cathode', label: 'Common cathode (−)' },
        { value: 'anode', label: 'Common anode (+)' },
      ],
      group: 'config',
    },
  ],
  support: 'full',
  insertable: true,
  python: 'gpiozero.RGBLED',
  stamp(ctx) {
    const com = ctx.node('COM');
    const ca = ctx.props.common === 'anode';
    const ch: [string, number][] = [
      ['R', 1.9],
      ['G', 2.9],
      ['B', 2.9],
    ];
    for (const [p, vf] of ch) {
      if (ctx.rt[`burned_${p}`]) continue;
      if (ca) ctx.D(p, com, ctx.node(p), vf, 15);
      else ctx.D(p, ctx.node(p), com, vf, 15);
    }
  },
  post(ctx) {
    const out: Record<string, any> = {};
    for (const p of ['R', 'G', 'B']) {
      const s = ledPost(ctx, p, ctx.props.common === 'anode' ? 'COM' : p, ctx.props.common === 'anode' ? p : 'COM');
      out[p] = s.brightness;
      if (s.burned) out.burned = true;
    }
    return out;
  },
};

// ---------------------------------------------------------------- passives
export const resistor: PartManifest = {
  type: 'resistor',
  name: 'Resistor',
  category: 'passive',
  description: 'Fixed resistor. Limits current (Ohm’s law: I = V / R).',
  w: 40,
  h: 10,
  pins: [pin('1', 'Lead 1', 0, 0, 'passive'), pin('2', 'Lead 2', 40, 0, 'passive')],
  props: [
    {
      key: 'ohms',
      label: 'Resistance',
      type: 'select',
      default: 220,
      options: [10, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 20000, 47000, 100000].map((v) => ({
        value: v,
        label: v >= 1000 ? `${v / 1000} kΩ` : `${v} Ω`,
      })),
      group: 'config',
    },
  ],
  support: 'full',
  insertable: true,
  stamp(ctx) {
    ctx.R('r', ctx.node('1'), ctx.node('2'), Number(ctx.props.ohms) || 220);
  },
  post(ctx) {
    const i = ctx.cur('r');
    const p = i * i * (Number(ctx.props.ohms) || 220);
    if (p > 0.25) ctx.issue('W_RESISTOR_POWER', 'warning', { w: p.toFixed(2) }, ['1', '2']);
    return { ma: i * 1000, mw: p * 1000 };
  },
};

export const capacitor: PartManifest = {
  type: 'capacitor',
  name: 'Capacitor',
  category: 'passive',
  description: 'Ceramic or electrolytic capacitor. In this DC simulator a capacitor is an open circuit (no transient/charging behaviour).',
  w: 20,
  h: 30,
  pins: [pin('P', '+', 0, 20, 'passive'), pin('N', '−', 10, 20, 'passive')],
  props: [
    { key: 'uf', label: 'Capacitance', type: 'number', default: 10, min: 0.001, max: 10000, unit: 'µF', group: 'config' },
    {
      key: 'kind',
      label: 'Type',
      type: 'select',
      default: 'electrolytic',
      options: [
        { value: 'electrolytic', label: 'Electrolytic (polarised)' },
        { value: 'ceramic', label: 'Ceramic' },
      ],
      group: 'config',
    },
    { key: 'vmax', label: 'Rated voltage', type: 'number', default: 16, unit: 'V', group: 'config' },
  ],
  support: 'partial',
  limits: 'DC open circuit only. Charging, filtering and timing are not simulated.',
  insertable: true,
  post(ctx) {
    const v = ctx.volt('P') - ctx.volt('N');
    if (ctx.props.kind === 'electrolytic' && v < -0.5) ctx.issue('W_CAP_REVERSED', 'warning', { v: (-v).toFixed(1) }, ['P', 'N']);
    if (Math.abs(v) > Number(ctx.props.vmax)) ctx.issue('E_CAP_OVERVOLTAGE', 'error', { v: v.toFixed(1), max: ctx.props.vmax }, ['P', 'N']);
    return { v };
  },
};

export const pushButton: PartManifest = {
  type: 'button',
  name: 'Push button',
  category: 'input',
  description:
    '4-leg tactile push button. Legs 1a/1b are always connected, and so are 2a/2b; pressing connects side 1 to side 2. Place it across the breadboard centre gap.',
  w: 20,
  h: 30,
  pins: [pin('1a', '1a', 0, 0, 'passive'), pin('2a', '2a', 20, 0, 'passive'), pin('1b', '1b', 0, 30, 'passive'), pin('2b', '2b', 20, 30, 'passive')],
  internal: () => [
    ['1a', '1b'],
    ['2a', '2b'],
  ],
  props: [{ key: 'latched', label: 'Held down', type: 'boolean', default: false, live: true, group: 'sensor', help: 'Keep the button pressed (or press it with the mouse in the workspace).' }],
  faults: [FAULT.none, { id: 'stuck_open', label: 'Broken (never closes)' }],
  support: 'full',
  insertable: true,
  python: 'gpiozero.Button, RPi.GPIO input',
  stamp(ctx) {
    const pressed = (ctx.rt.pressed || ctx.props.latched) && ctx.fault !== 'stuck_open';
    ctx.SW('sw', ctx.node('1a'), ctx.node('2a'), 0.05, !!pressed);
  },
  post(ctx) {
    return { pressed: !!(ctx.rt.pressed || ctx.props.latched) };
  },
};

export const toggleSwitch: PartManifest = {
  type: 'switch',
  name: 'Toggle switch (SPDT)',
  category: 'input',
  description: 'Slide/toggle switch: COM connects to A or to B.',
  w: 30,
  h: 30,
  pins: [pin('A', 'A', 0, 20, 'passive'), pin('COM', 'COM', 10, 20, 'passive'), pin('B', 'B', 20, 20, 'passive')],
  props: [
    {
      key: 'position',
      label: 'Position',
      type: 'select',
      default: 'A',
      options: [
        { value: 'A', label: 'COM ↔ A' },
        { value: 'B', label: 'COM ↔ B' },
      ],
      live: true,
      group: 'sensor',
    },
  ],
  support: 'full',
  insertable: true,
  stamp(ctx) {
    ctx.SW('a', ctx.node('COM'), ctx.node('A'), 0.05, ctx.props.position === 'A');
    ctx.SW('b', ctx.node('COM'), ctx.node('B'), 0.05, ctx.props.position === 'B');
  },
  post(ctx) {
    return { position: ctx.props.position };
  },
};

export const potentiometer: PartManifest = {
  type: 'potentiometer',
  name: 'Potentiometer',
  category: 'input',
  description: 'Variable resistor / voltage divider. The wiper (W) voltage is analog — read it through an ADC such as the MCP3008.',
  w: 30,
  h: 40,
  pins: [pin('A', 'A', 0, 30, 'passive'), pin('W', 'Wiper', 10, 30, 'analog'), pin('B', 'B', 20, 30, 'passive')],
  props: [
    { key: 'ohms', label: 'Total resistance', type: 'select', default: 10000, options: [1000, 10000, 100000].map((v) => ({ value: v, label: `${v / 1000} kΩ` })), group: 'config' },
    { key: 'position', label: 'Knob position', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%', live: true, group: 'sensor' },
  ],
  support: 'full',
  insertable: true,
  python: 'gpiozero.MCP3008 / spidev',
  stamp(ctx) {
    const r = Number(ctx.props.ohms) || 10000;
    const f = clamp(Number(ctx.props.position) / 100, 0, 1);
    ctx.R('aw', ctx.node('A'), ctx.node('W'), Math.max(1, r * f));
    ctx.R('wb', ctx.node('W'), ctx.node('B'), Math.max(1, r * (1 - f)));
  },
  post(ctx) {
    return { position: ctx.props.position, vw: ctx.volt('W') };
  },
};

export const buzzer: PartManifest = {
  type: 'buzzer',
  name: 'Active buzzer',
  category: 'output',
  description: 'Active buzzer (built-in oscillator): beeps whenever 3–5 V is applied with correct polarity. Draws ~25 mA.',
  w: 30,
  h: 40,
  pins: [pin('P', '+', 0, 30, 'passive'), pin('N', '−', 20, 30, 'passive')],
  props: [],
  support: 'full',
  insertable: true,
  python: 'gpiozero.Buzzer',
  loadPins: ['P', 'N'],
  stamp(ctx) {
    // modelled as a 0.3 V threshold + 120 Ω load (polarised)
    ctx.D('d', ctx.node('P'), ctx.node('N'), 0.3, 120);
  },
  post(ctx) {
    const v = ctx.volt('P') - ctx.volt('N');
    if (v < -1) ctx.issue('W_POLARITY', 'warning', { v: (-v).toFixed(1) }, ['P', 'N']);
    return { on: v > 2.5, v };
  },
};

export const diode: PartManifest = {
  type: 'diode',
  name: 'Diode 1N4007',
  category: 'semiconductor',
  description: 'Rectifier diode (also used as a flyback diode across motors, pumps, solenoids and relay coils). Stripe = cathode.',
  w: 40,
  h: 10,
  pins: [pin('A', 'Anode', 0, 0, 'passive'), pin('K', 'Cathode (stripe)', 40, 0, 'passive')],
  props: [],
  support: 'full',
  insertable: true,
  stamp(ctx) {
    ctx.D('d', ctx.node('A'), ctx.node('K'), 0.7, 0.5);
  },
  post(ctx) {
    const i = ctx.cur('d');
    if (i > 1.5) ctx.issue('E_DIODE_OVERCURRENT', 'error', { a: i.toFixed(1) }, ['A', 'K']);
    return { ma: i * 1000 };
  },
};

export const npn: PartManifest = {
  type: 'npn',
  name: 'NPN transistor 2N2222',
  category: 'semiconductor',
  description: 'NPN BJT used as a low-side switch. Pins (flat side facing you): E, B, C. Put a 1 kΩ resistor in series with the base.',
  w: 30,
  h: 40,
  pins: [pin('E', 'Emitter', 0, 30, 'passive'), pin('B', 'Base', 10, 30, 'passive'), pin('C', 'Collector', 20, 30, 'passive')],
  props: [],
  support: 'partial',
  limits: 'Switch model: saturated when base current > 50 µA, otherwise off. No linear amplification region.',
  insertable: true,
  stamp(ctx) {
    const be = ctx.id('be');
    ctx.D('be', ctx.node('B'), ctx.node('E'), 0.65, 50);
    ctx.SW('ce', ctx.node('C'), ctx.node('E'), 0.5, (s) => s.cur(be) > 50e-6);
  },
  post(ctx) {
    const ib = ctx.cur('be');
    const ic = ctx.cur('ce');
    if (ic > 0.8) ctx.issue('E_TRANSISTOR_OVERCURRENT', 'error', { a: ic.toFixed(2), max: 0.6 }, ['C', 'E']);
    if (ib > 0.02) ctx.issue('W_BASE_NO_RESISTOR', 'warning', { ma: Math.round(ib * 1000) }, ['B']);
    return { on: ic > 1e-4 || ib > 50e-6, ic: ic * 1000 };
  },
};

export const pnp: PartManifest = {
  type: 'pnp',
  name: 'PNP transistor 2N2907',
  category: 'semiconductor',
  description: 'PNP BJT used as a high-side switch. Pins: E, B, C. Turns on when the base is pulled ~0.7 V below the emitter.',
  w: 30,
  h: 40,
  pins: [pin('E', 'Emitter', 0, 30, 'passive'), pin('B', 'Base', 10, 30, 'passive'), pin('C', 'Collector', 20, 30, 'passive')],
  props: [],
  support: 'partial',
  limits: 'Switch model only (saturated/off).',
  insertable: true,
  stamp(ctx) {
    const eb = ctx.id('eb');
    ctx.D('eb', ctx.node('E'), ctx.node('B'), 0.65, 50);
    ctx.SW('ec', ctx.node('E'), ctx.node('C'), 0.5, (s) => s.cur(eb) > 50e-6);
  },
  post(ctx) {
    return { on: ctx.cur('eb') > 50e-6, ic: ctx.cur('ec') * 1000 };
  },
};

export const mosfet: PartManifest = {
  type: 'mosfet',
  name: 'N-channel MOSFET',
  category: 'semiconductor',
  description:
    'N-channel MOSFET low-side switch for pumps, fans, LED strips. Pins: G, D, S. IRLZ44N is logic-level (works from 3.3 V GPIO); IRF540N needs ~10 V on the gate and will NOT switch properly from a Pi.',
  w: 30,
  h: 50,
  pins: [pin('G', 'Gate', 0, 40, 'passive'), pin('D', 'Drain', 10, 40, 'passive'), pin('S', 'Source', 20, 40, 'passive')],
  props: [
    {
      key: 'model',
      label: 'Model',
      type: 'select',
      default: 'IRLZ44N',
      options: [
        { value: 'IRLZ44N', label: 'IRLZ44N (logic-level, Vgs(th) ≈ 2 V)' },
        { value: 'IRF540N', label: 'IRF540N (standard, needs 10 V gate)' },
      ],
      group: 'config',
    },
  ],
  support: 'partial',
  limits: 'Switch model: on when Vgs exceeds the model’s full-enhancement threshold; partial enhancement is treated as off.',
  insertable: true,
  stamp(ctx) {
    const g = ctx.node('G');
    const s = ctx.node('S');
    const vth = ctx.props.model === 'IRF540N' ? 4.5 : 2.0;
    ctx.SW('ds', ctx.node('D'), s, 0.03, (sol) => sol.volt(g) - sol.volt(s) > vth);
    ctx.D('body', s, ctx.node('D'), 0.8, 0.1);
    ctx.R('gs', g, s, 1e7);
  },
  post(ctx) {
    const vgs = ctx.volt('G') - ctx.volt('S');
    if (!ctx.connected('G')) ctx.issue('W_GATE_FLOATING', 'warning', {}, ['G']);
    if (ctx.props.model === 'IRF540N' && vgs > 1.5 && vgs < 4.5) ctx.issue('W_MOSFET_NOT_LOGIC', 'warning', { v: vgs.toFixed(1) }, ['G']);
    return { on: vgs > (ctx.props.model === 'IRF540N' ? 4.5 : 2.0), id: ctx.cur('ds') };
  },
};

export const powerSupply: PartManifest = {
  type: 'power_supply',
  name: 'DC power supply',
  category: 'power',
  description: 'External DC supply (wall adapter / bench supply) for pumps, fans, valves and lights. Connect its − to the Pi GND when signals are shared.',
  w: 90,
  h: 60,
  pins: [pin('P', '+', 90, 20, 'power'), pin('N', '−', 90, 40, 'ground')],
  props: [
    { key: 'volts', label: 'Voltage', type: 'select', default: 12, options: [3.3, 5, 9, 12, 24].map((v) => ({ value: v, label: `${v} V` })), group: 'config' },
    { key: 'amps', label: 'Current limit', type: 'number', default: 3, min: 0.1, max: 20, step: 0.1, unit: 'A', group: 'config' },
    { key: 'on', label: 'Output on', type: 'boolean', default: true, live: true, group: 'sensor' },
  ],
  faults: [FAULT.none, FAULT.powerFail],
  support: 'full',
  stamp(ctx) {
    if (!ctx.props.on || ctx.fault === 'power_fail' || ctx.rt.tripped) return;
    ctx.V('out', ctx.node('P'), ctx.node('N'), Number(ctx.props.volts), 0.02);
  },
  post(ctx) {
    const i = ctx.cur('out');
    if (i > Number(ctx.props.amps)) ctx.rt.tripped = true;
    if (ctx.rt.tripped) ctx.issue('E_SUPPLY_OVERLOAD', 'error', { a: i > 0 ? i.toFixed(1) : `>${ctx.props.amps}`, max: ctx.props.amps }, ['P', 'N']);
    return { on: !!ctx.props.on && ctx.fault !== 'power_fail' && !ctx.rt.tripped, amps: i, watts: i * Number(ctx.props.volts) };
  },
};
