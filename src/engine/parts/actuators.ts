import { FARM_ROLE_LABELS, type FarmRole } from '../farm';
import type { PinDef, PropDef } from '../types';
import type { Solution } from '../solver';
import { FAULT, clamp, pin, type PartManifest } from './base';

const roleProp = (roles: FarmRole[], def: FarmRole): PropDef => ({
  key: 'role',
  label: 'Smart Farm role',
  type: 'select',
  default: def,
  options: roles.map((r) => ({ value: r, label: FARM_ROLE_LABELS[r] })),
  group: 'farm',
});

interface LoadOpts {
  type: string;
  name: string;
  description: string;
  volts: number[];
  vDefault: number;
  watts: number;
  /** strict: only runs with correct polarity (brushless / LED); reversible: spins backwards; none: resistive */
  polarity: 'strict' | 'reversible' | 'none';
  inductive: boolean;
  roles: FarmRole[];
  role: FarmRole;
  rate?: { key: string; label: string; unit: string; default: number; max: number };
  pwm?: boolean;
  w: number;
  h: number;
  faults?: { id: string; label: string; help?: string }[];
}

function load(o: LoadOpts): PartManifest {
  const props: PropDef[] = [
    {
      key: 'vrated',
      label: 'Rated voltage',
      type: 'select',
      default: o.vDefault,
      options: o.volts.map((v) => ({ value: v, label: `${v} V` })),
      group: 'config',
    },
    { key: 'watts', label: 'Rated power', type: 'number', default: o.watts, min: 0.1, max: 500, step: 0.1, unit: 'W', group: 'config' },
  ];
  if (o.rate)
    props.push({ key: o.rate.key, label: o.rate.label, type: 'number', default: o.rate.default, min: 0, max: o.rate.max, step: 0.1, unit: o.rate.unit, group: 'config' });
  if (o.rate?.unit === 'ml/min')
    props.push({
      key: 'calibration',
      label: 'Real flow error vs. nominal',
      type: 'number',
      default: 0,
      min: -30,
      max: 30,
      step: 0.5,
      unit: '%',
      group: 'config',
      help: 'Models an uncalibrated pump: actual flow = nominal × (1 + error). Calibrate in your code!',
    });
  props.push(roleProp(o.roles, o.role));
  return {
    type: o.type,
    name: o.name,
    category: 'actuator',
    description: o.description,
    w: o.w,
    h: o.h,
    pins: [pin('P', '+', 0, o.h - 20, 'terminal'), pin('N', '−', 0, o.h - 10, 'terminal')],
    props,
    faults: o.faults ?? [FAULT.none, FAULT.pumpFail, FAULT.burned],
    support: 'full',
    limits: 'Resistive load model (R = V²/P). Runs at ≥60 % of rated voltage; speed/flow scales with voltage. No start-up current or back-EMF.',
    voltage: `${o.vDefault} V`,
    inductive: o.inductive,
    loadPins: ['P', 'N'],
    insertable: false,
    stamp(ctx) {
      if (ctx.fault === 'open_winding' || ctx.fault === 'burned' || ctx.rt.burned) return;
      const vr = Number(ctx.props.vrated);
      const r = (vr * vr) / Math.max(0.1, Number(ctx.props.watts));
      if (o.polarity === 'strict') ctx.D('load', ctx.node('P'), ctx.node('N'), 0.3, r);
      else ctx.R('load', ctx.node('P'), ctx.node('N'), r);
    },
    post(ctx) {
      const vr = Number(ctx.props.vrated);
      const v = ctx.volt('P') - ctx.volt('N');
      const frac = v / vr;
      const failed = ctx.fault === 'open_winding' || ctx.fault === 'burned' || !!ctx.rt.burned;
      if (frac > 1.4 && !failed) {
        ctx.rt.burned = true;
        ctx.issue('E_LOAD_OVERVOLTAGE', 'error', { v: v.toFixed(1), rated: vr }, ['P', 'N']);
      }
      if (ctx.rt.burned) ctx.issue('E_LOAD_BURNED', 'error', { rated: vr }, ['P', 'N']);
      if (o.polarity === 'strict' && frac < -0.3) ctx.issue('W_POLARITY', 'warning', { v: (-v).toFixed(1) }, ['P', 'N']);
      const gp = ctx.gpioOf('P') ?? ctx.gpioOf('N');
      if (gp !== null) ctx.issue('E_GPIO_DRIVES_LOAD', 'error', { pin: gp, rated: vr, w: ctx.props.watts }, ['P', 'N']);
      if (frac > 0.15 && frac < 0.6 && !failed) ctx.issue('W_LOAD_UNDERVOLTAGE', 'warning', { v: v.toFixed(1), rated: vr }, ['P', 'N']);
      let run = 0;
      if (!failed) {
        if (frac >= 0.6) run = clamp(frac, 0, 1.2);
        else if (frac <= -0.6 && o.polarity !== 'strict') run = o.polarity === 'reversible' ? clamp(frac, -1.2, 0) : clamp(-frac, 0, 1.2);
      }
      const i = Math.abs(ctx.cur('load'));
      return { run, v, amps: i, watts: Math.abs(v) * i, noFlow: ctx.fault === 'clogged' };
    },
  };
}

const PUMP_FAULTS = [FAULT.none, FAULT.pumpFail, FAULT.clogged, FAULT.burned];

export const waterPump = load({
  type: 'water_pump',
  name: 'Water pump (12 V DC)',
  description: 'Submersible/inline DC water pump. Needs its own supply and a relay or logic-level MOSFET — never drive it from a GPIO pin.',
  volts: [5, 12, 24],
  vDefault: 12,
  watts: 6,
  polarity: 'strict',
  inductive: true,
  roles: ['circulation', 'fresh_water', 'drain', 'none'],
  role: 'circulation',
  rate: { key: 'rate', label: 'Rated flow', unit: 'L/min', default: 4, max: 60 },
  w: 80,
  h: 70,
  faults: PUMP_FAULTS,
});

export const dosingPump = load({
  type: 'dosing_pump',
  name: 'Peristaltic dosing pump',
  description: 'Peristaltic pump for nutrients/pH solutions. Volume = flow rate × run time. Reversing polarity pumps backwards.',
  volts: [6, 12, 24],
  vDefault: 12,
  watts: 3.6,
  polarity: 'reversible',
  inductive: true,
  roles: ['dose_a', 'dose_b', 'ph_down', 'none'],
  role: 'dose_a',
  rate: { key: 'rate', label: 'Nominal flow', unit: 'ml/min', default: 100, max: 500 },
  w: 70,
  h: 70,
  faults: PUMP_FAULTS,
});

export const solenoidValve = load({
  type: 'solenoid_valve',
  name: 'Solenoid valve (NC)',
  description: 'Normally-closed 12 V solenoid valve: opens while powered. Inductive — add a flyback diode when switching with a transistor.',
  volts: [12, 24],
  vDefault: 12,
  watts: 4.8,
  polarity: 'none',
  inductive: true,
  roles: ['fresh_water', 'drain', 'circulation', 'none'],
  role: 'fresh_water',
  rate: { key: 'rate', label: 'Flow when open', unit: 'L/min', default: 3, max: 60 },
  w: 70,
  h: 60,
  faults: [FAULT.none, FAULT.pumpFail, FAULT.clogged],
});

export const fan = load({
  type: 'fan',
  name: 'Cooling fan (DC)',
  description: 'Brushless DC fan. Speed follows voltage/PWM (through a MOSFET). Brushless fans do not run with reversed polarity.',
  volts: [5, 12],
  vDefault: 12,
  watts: 2.4,
  polarity: 'strict',
  inductive: true,
  roles: ['fan', 'none'],
  role: 'fan',
  w: 70,
  h: 80,
});

export const dcMotor = load({
  type: 'dc_motor',
  name: 'DC motor',
  description: 'Brushed DC motor. Reversing polarity reverses direction. Drive via a transistor, MOSFET, relay or H-bridge.',
  volts: [3, 5, 6, 12],
  vDefault: 5,
  watts: 1.5,
  polarity: 'reversible',
  inductive: true,
  roles: ['none', 'fan', 'circulation'],
  role: 'none',
  w: 60,
  h: 60,
});

export const heater = load({
  type: 'heater',
  name: 'Heater (12 V element)',
  description: 'Resistive 12 V heating element. Switch it with a relay.',
  volts: [12, 24],
  vDefault: 12,
  watts: 60,
  polarity: 'none',
  inductive: false,
  roles: ['heater', 'none'],
  role: 'heater',
  w: 80,
  h: 60,
  faults: [FAULT.none, FAULT.burned],
});

export const humidifier = load({
  type: 'humidifier',
  name: 'Ultrasonic humidifier',
  description: 'Ultrasonic mist module. Raises humidity while running.',
  volts: [5, 12, 24],
  vDefault: 5,
  watts: 2,
  polarity: 'strict',
  inductive: false,
  roles: ['humidifier', 'none'],
  role: 'humidifier',
  w: 60,
  h: 60,
  faults: [FAULT.none, FAULT.pumpFail],
});

export const growLight = load({
  type: 'grow_light',
  name: 'LED grow light',
  description: 'Full-spectrum 12 V LED grow light. Dimmable with PWM through a logic-level MOSFET; switch on/off with a relay.',
  volts: [12, 24],
  vDefault: 12,
  watts: 36,
  polarity: 'strict',
  inductive: false,
  roles: ['grow_light', 'none'],
  role: 'grow_light',
  pwm: true,
  w: 120,
  h: 40,
  faults: [FAULT.none, FAULT.burned],
});

// ---------------------------------------------------------------- relay module
function relayPins(p: Record<string, any>): PinDef[] {
  const n = Number(p.channels) || 1;
  const out: PinDef[] = [pin('VCC', 'VCC', 0, 10, 'power'), pin('GND', 'GND', 0, 20, 'ground')];
  for (let k = 1; k <= n; k++) out.push(pin(`IN${k}`, `IN${k}`, 0, 20 + k * 10, 'digital'));
  for (let k = 1; k <= n; k++) {
    const y = (k - 1) * 40;
    out.push(pin(`NO${k}`, `NO${k}`, 120, y + 10, 'terminal'));
    out.push(pin(`COM${k}`, `COM${k}`, 120, y + 20, 'terminal'));
    out.push(pin(`NC${k}`, `NC${k}`, 120, y + 30, 'terminal'));
  }
  return out;
}

export const relayModule: PartManifest = {
  type: 'relay_module',
  name: 'Relay module',
  category: 'actuator',
  description:
    'Opto-isolated relay board (1/2/4 channels). VCC/GND power the coils, INx are the logic inputs. Most boards are active-LOW: IN pulled LOW energises the relay. COM↔NO closes when energised, COM↔NC is closed when idle.',
  w: 120,
  h: 50,
  pins: relayPins,
  props: [
    { key: 'channels', label: 'Channels', type: 'select', default: 1, options: [1, 2, 4].map((v) => ({ value: v, label: `${v}` })), group: 'config' },
    {
      key: 'trigger',
      label: 'Trigger',
      type: 'select',
      default: 'low',
      options: [
        { value: 'low', label: 'Active-LOW (IN=0 → ON)' },
        { value: 'high', label: 'Active-HIGH (IN=1 → ON)' },
      ],
      group: 'config',
    },
    { key: 'coil', label: 'Coil voltage', type: 'select', default: 5, options: [5, 12].map((v) => ({ value: v, label: `${v} V` })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.relayStuckOpen, FAULT.relayStuckClosed, { id: 'coil_open', label: 'Coil burned open' }],
  support: 'full',
  limits: 'Input modelled as opto-LED (Vf 2.0 V + 1 kΩ to VCC for active-LOW, 0.7 V + 1 kΩ to GND for active-HIGH). Contacts are ideal switches; no bounce.',
  voltage: '5 V or 12 V coil, 3.3/5 V logic',
  python: 'gpiozero.OutputDevice(pin, active_high=False) for active-LOW boards',
  stamp(ctx) {
    const n = Number(ctx.props.channels) || 1;
    const coilV = Number(ctx.props.coil) || 5;
    const vcc = ctx.node('VCC');
    const gnd = ctx.node('GND');
    for (let k = 1; k <= n; k++) {
      const inN = ctx.node(`IN${k}`);
      const opto = ctx.id(`opto${k}`);
      if (ctx.props.trigger === 'high') ctx.D(`opto${k}`, inN, gnd, 0.7, 1000);
      else ctx.D(`opto${k}`, vcc, inN, 2.0, 1000);
      const energised = (s: Solution) =>
        ctx.fault !== 'coil_open' && s.cur(opto) > 0.4e-3 && s.volt(vcc) - s.volt(gnd) >= 0.7 * coilV;
      ctx.SW(`coil${k}`, vcc, gnd, coilV === 12 ? 400 : 70, energised);
      const contactNO = (s: Solution) => ctx.fault === 'stuck_closed' || (ctx.fault !== 'stuck_open' && energised(s));
      ctx.SW(`no${k}`, ctx.node(`COM${k}`), ctx.node(`NO${k}`), 0.05, contactNO);
      ctx.SW(`nc${k}`, ctx.node(`COM${k}`), ctx.node(`NC${k}`), 0.05, (s) => !contactNO(s));
    }
  },
  post(ctx) {
    const n = Number(ctx.props.channels) || 1;
    const coilV = Number(ctx.props.coil) || 5;
    const vs = ctx.volt('VCC') - ctx.volt('GND');
    const ch: { active: boolean; energised: boolean; no: boolean }[] = [];
    let anyActive = false;
    for (let k = 1; k <= n; k++) {
      const active = ctx.cur(`opto${k}`) > 0.4e-3;
      const energised = Math.abs(ctx.cur(`coil${k}`)) > 1e-3;
      const no = (ctx.c.get(ctx.id(`no${k}`)) as any)?.on === true;
      ch.push({ active, energised, no });
      anyActive ||= active;
      if (!ctx.connected(`IN${k}`) && ctx.connected('VCC')) ctx.issue('I_RELAY_IN_FLOATING', 'info', { ch: k }, [`IN${k}`]);
      // contact current rating
      const ic = Math.max(Math.abs(ctx.cur(`no${k}`)), Math.abs(ctx.cur(`nc${k}`)));
      if (ic > 10) ctx.issue('E_RELAY_CONTACT_OVERLOAD', 'error', { a: ic.toFixed(1) }, [`COM${k}`]);
    }
    if (ctx.connected('VCC') && vs > 0.5 && vs < 0.7 * coilV) ctx.issue('W_RELAY_UNDERPOWERED', 'warning', { v: vs.toFixed(1), coil: coilV }, ['VCC']);
    if (vs > coilV * 1.3) ctx.issue('E_RELAY_OVERVOLTAGE', 'error', { v: vs.toFixed(1), coil: coilV }, ['VCC']);
    if (anyActive && !ctx.connected('GND')) ctx.issue('W_MISSING_GROUND', 'warning', {}, ['GND']);
    return { ch, powered: vs >= 0.7 * coilV };
  },
};

// ---------------------------------------------------------------- servo
export const servo: PartManifest = {
  type: 'servo',
  name: 'Servo motor SG90',
  category: 'actuator',
  description: 'Hobby servo. Brown = GND, red = 5 V, orange = signal (50 Hz PWM, 0.5–2.5 ms pulse ≈ −90…+90°).',
  w: 70,
  h: 50,
  pins: [pin('GND', 'GND (brown)', 0, 20, 'ground'), pin('VCC', 'V+ (red)', 0, 30, 'power'), pin('SIG', 'Signal (orange)', 0, 40, 'digital')],
  props: [],
  support: 'partial',
  limits: 'Angle follows the PWM pulse width of the GPIO wired to SIG. No torque/speed dynamics.',
  python: 'gpiozero.Servo, gpiozero.AngularServo',
  stamp(ctx) {
    ctx.R('sig', ctx.node('SIG'), ctx.node('GND'), 100000);
    ctx.R('motor', ctx.node('VCC'), ctx.node('GND'), 50);
  },
  post(ctx) {
    const vs = ctx.volt('VCC') - ctx.volt('GND');
    const bcm = ctx.gpioOf('SIG');
    let angle = ctx.rt.angle ?? 0;
    if (vs > 4 && bcm !== null) {
      const g = ctx.sim.gpio(bcm);
      if (g.mode === 'pwm' && g.pwmFreq > 0) {
        const pulseMs = (g.pwmDuty / g.pwmFreq) * 1000;
        if (pulseMs >= 0.4 && pulseMs <= 2.6) angle = clamp((pulseMs - 1.5) * 90, -90, 90);
        if (g.pwmFreq < 40 || g.pwmFreq > 60) ctx.issue('W_SERVO_FREQ', 'warning', { hz: g.pwmFreq }, ['SIG']);
      }
    }
    if (ctx.connected('VCC') && vs < 4) ctx.issue('W_UNPOWERED', 'warning', { v: vs.toFixed(1), min: 4.8 }, ['VCC']);
    ctx.rt.angle = angle;
    return { angle };
  },
};
