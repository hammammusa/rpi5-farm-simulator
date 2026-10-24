// Motors, motor drivers and extra actuators.
import type { PinDef } from '../types';
import { FAULT, clamp, pin, type PartManifest, type PostCtx, type StampCtx } from './base';
import { PUMP_FAULTS, load, roleProp, servo } from './actuators';

/**
 * Logic level of a driver input for the circuit phase being solved. Inputs wired straight
 * to a GPIO follow the GPIO's instantaneous (PWM-phase) level, so PWM on ENA/PWMA is exact;
 * other inputs use the level measured in the previous solve.
 */
function inLevel(ctx: StampCtx, p: string, open: 0 | 1 = 0): 0 | 1 {
  const g = ctx.gpioOf(p);
  if (g !== null) {
    const st = ctx.sim.gpio(g);
    if (st.mode === 'output' || st.mode === 'pwm') return ctx.sim.phaseLevel(g);
  }
  const v = ctx.rt.lvl?.[p];
  return v === undefined || v === null ? open : v;
}

/** record measured input levels for the next solve (non-GPIO-driven inputs) */
function measure(ctx: PostCtx, pins: string[], vth = 2.0) {
  const lvl: Record<string, 0 | 1 | null> = {};
  for (const p of pins) {
    const n = ctx.node(p);
    lvl[p] = n === -2 || (n >= 0 && !ctx.sol.driven[n]) ? null : ctx.volt(p) - ctx.volt('GND') > vth ? 1 : 0;
  }
  if (JSON.stringify(lvl) !== JSON.stringify(ctx.rt.lvl ?? {})) {
    ctx.rt.lvl = lvl;
    ctx.rt.dirty = true;
  }
  return lvl;
}

// ---------------------------------------------------------------- 4-wire PWM fan
/** PWM duty seen by the fan: the GPIO's duty when driven directly, otherwise the measured level. */
function fanDuty(ctx: StampCtx | PostCtx): number {
  const g = ctx.gpioOf('PWM');
  if (g !== null) {
    const st = ctx.sim.gpio(g);
    if (st.mode === 'pwm') return st.pwmDuty;
    if (st.mode === 'output') return st.value;
  }
  const l = ctx.rt.lvl?.PWM;
  return l === undefined || l === null ? 1 : l;
}

function fanRpmOf(ctx: StampCtx | PostCtx, vs: number) {
  if (ctx.fault === 'open_winding' || vs < 7) return 0;
  const d = fanDuty(ctx);
  return d * 100 < Number(ctx.props.minDuty) ? 0 : d * Number(ctx.props.maxRpm) * clamp(vs / 12, 0, 1.1);
}

export const pwmFan: PartManifest = {
  type: 'pwm_fan',
  name: '4-wire PWM fan (12 V)',
  short: 'PWM fan',
  category: 'actuator',
  group: 'Motors & drivers',
  description: 'PC-style 4-pin fan: 12 V, GND, TACH (open collector, 2 pulses per revolution — needs a pull-up to 3.3 V) and PWM (25 kHz control, pulled up inside the fan: unconnected = full speed). The PWM input is low-current and can be driven from a GPIO directly.',
  w: 70,
  h: 80,
  pins: [pin('V12', '+12V', 0, 40, 'power'), pin('GND', 'GND', 0, 50, 'ground'), pin('TACH', 'TACH', 0, 60, 'digital'), pin('PWM', 'PWM', 0, 70, 'digital')],
  props: [
    { key: 'maxRpm', label: 'Max speed', type: 'number', default: 3000, min: 500, max: 10000, step: 50, unit: 'rpm', group: 'config' },
    { key: 'watts', label: 'Rated power', type: 'number', default: 3, min: 0.5, max: 50, step: 0.1, unit: 'W', group: 'config' },
    { key: 'minDuty', label: 'Minimum duty (stops below)', type: 'number', default: 20, min: 0, max: 50, step: 1, unit: '%', group: 'config' },
    roleProp(['fan', 'none'], 'fan'),
  ],
  faults: [FAULT.none, FAULT.pumpFail, { id: 'no_tach', label: 'Tach wire broken' }],
  support: 'full',
  fidelity: 'functional',
  limits: 'Speed = max rpm × PWM duty (measured per PWM phase), zero below the minimum duty. Spin-up time and the fan curve are not modelled.',
  voltage: '12 V',
  inductive: false,
  python: 'gpiozero.PWMOutputDevice(18, frequency=25000) · tach via DigitalInputDevice callbacks · smartfarm.PWMFan(pwm=18, tach=24)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  pulse: { pin: 'TACH', hz: (_v, vis) => ((vis?.rpm ?? 0) / 60) * 2 },
  stamp(ctx) {
    ctx.V('pwmpu', ctx.node('PWM'), ctx.node('GND'), 3.3, 10000); // internal pull-up
    if (ctx.fault === 'open_winding') return;
    const vs = ctx.rt.vs ?? 0;
    const hi = inLevel(ctx, 'PWM', 1);
    const r = (12 * 12) / Math.max(0.1, Number(ctx.props.watts));
    ctx.R('load', ctx.node('V12'), ctx.node('GND'), hi ? r : r * 20);
    const rpm = fanRpmOf(ctx, vs);
    if (ctx.fault !== 'no_tach' && rpm > 0) {
      const hz = (rpm / 60) * 2;
      ctx.SW('tach', ctx.node('TACH'), ctx.node('GND'), 50, (ctx.sim.now * hz) % 1 < 0.5);
    }
  },
  post(ctx) {
    const vs = ctx.volt('V12') - ctx.volt('GND');
    if (Math.abs((ctx.rt.vs ?? 0) - vs) > 0.05) {
      ctx.rt.vs = vs;
      ctx.rt.dirty = true;
    }
    const hi = ctx.volt('PWM') - ctx.volt('GND') > 1.5;
    measure(ctx, ['PWM'], 1.5);
    const rpm = fanRpmOf(ctx, vs);
    const run = rpm > 0 ? rpm / Number(ctx.props.maxRpm) : 0;
    const gp = ctx.gpioOf('V12');
    if (gp !== null) ctx.issue('E_GPIO_DRIVES_LOAD', 'error', { pin: gp, rated: 12, w: ctx.props.watts }, ['V12']);
    return { run, rpm, powered: vs > 7, amps: Math.abs(ctx.cur('load')), watts: vs * Math.abs(ctx.cur('load')), v: vs, hi };
  },
};

// ---------------------------------------------------------------- servos
export const sg90: PartManifest = {
  ...servo,
  type: 'sg90',
  name: 'Micro servo SG90',
  short: 'SG90',
  model: 'SG90',
  manufacturer: 'TowerPro',
  group: 'Motors & drivers',
  description: '9 g micro servo, 4.8–6 V, ~1.8 kg·cm. Brown = GND, red = 5 V, orange = signal (50 Hz, 0.5–2.5 ms ≈ −90…+90°). Small enough to run from the Pi 5 V pin.',
  fidelity: 'functional',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  python: 'gpiozero.AngularServo(18, min_pulse_width=0.0005, max_pulse_width=0.0025) · smartfarm.Servo(18)',
};

export const mg996r: PartManifest = {
  ...servo,
  type: 'mg996r',
  name: 'High-torque servo MG996R',
  short: 'MG996R',
  model: 'MG996R',
  manufacturer: 'TowerPro',
  group: 'Motors & drivers',
  description: 'Metal-gear servo, 4.8–7.2 V, ~10 kg·cm, up to 2.5 A at stall. Give it its own 5–6 V supply with a common GND — the Pi 5 V pin browns out under stall current.',
  fidelity: 'functional',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  python: 'gpiozero.AngularServo(18) · smartfarm.Servo(18)',
  stamp(ctx) {
    ctx.R('sig', ctx.node('SIG'), ctx.node('GND'), 100000);
    ctx.R('motor', ctx.node('VCC'), ctx.node('GND'), 8); // ≈600 mA running
  },
};

// ---------------------------------------------------------------- 28BYJ-48 + ULN2003
const HALF = [0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001];
export const stepper28byj: PartManifest = {
  type: 'stepper_28byj48',
  name: 'Stepper 28BYJ-48 + ULN2003 board',
  short: '28BYJ-48',
  model: '28BYJ-48 (5 V) + ULN2003A',
  category: 'actuator',
  group: 'Motors & drivers',
  description: 'Geared unipolar stepper with its Darlington driver board. IN1–IN4 from four GPIOs; 5 V (or 12 V version) on +. 4096 half-steps (2048 full steps) per output revolution. Drive the coils with the half-step or full-step sequence.',
  w: 90,
  h: 80,
  pins: [pin('IN1', 'IN1', 0, 30, 'digital'), pin('IN2', 'IN2', 0, 40, 'digital'), pin('IN3', 'IN3', 0, 50, 'digital'), pin('IN4', 'IN4', 0, 60, 'digital'), pin('VCC', '+ (5–12 V)', 0, 70, 'power'), pin('GND', '−', 10, 70, 'ground')],
  props: [{ key: 'vrated', label: 'Motor voltage', type: 'select', default: 5, options: [{ value: 5, label: '5 V' }, { value: 12, label: '12 V' }], group: 'config' }],
  faults: [FAULT.none, { id: 'coil_open', label: 'One coil open' }],
  support: 'full',
  fidelity: 'full',
  limits: 'Position follows the coil pattern sequence (half- and full-step, both directions); patterns that jump by 4 half-steps are ignored (as on a real motor they are ambiguous). Torque, missed steps at high speed and inertia are not modelled.',
  voltage: '5 V (or 12 V) motor, 3.3 V logic inputs',
  inductive: true,
  python: 'gpiozero.OutputDevice ×4 · RPi.GPIO · smartfarm.Stepper28BYJ([17, 18, 27, 22])',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  stamp(ctx) {
    for (let k = 1; k <= 4; k++) ctx.R(`in${k}`, ctx.node(`IN${k}`), ctx.node('GND'), 3000);
    const vr = Number(ctx.props.vrated);
    const coils = ctx.rt.coils ?? 0;
    for (let k = 0; k < 4; k++) if (coils & (1 << k) && !(ctx.fault === 'coil_open' && k === 2)) ctx.R(`coil${k}`, ctx.node('VCC'), ctx.node('GND'), vr === 12 ? 130 : 50);
  },
  post(ctx) {
    const vs = ctx.volt('VCC') - ctx.volt('GND');
    let pat = 0;
    for (let k = 0; k < 4; k++) if (ctx.volt(`IN${k + 1}`) - ctx.volt('GND') > 1.6) pat |= 1 << k;
    const powered = vs > 0.7 * Number(ctx.props.vrated);
    const eff = powered ? pat & (ctx.fault === 'coil_open' ? 0b1011 : 0b1111) : 0;
    if (eff !== (ctx.rt.coils ?? 0)) {
      ctx.rt.coils = eff;
      ctx.rt.dirty = true;
    }
    const ph = HALF.indexOf(eff);
    if (ph >= 0 && ctx.rt.phase !== undefined && ctx.rt.phase !== ph) {
      const d = (ph - ctx.rt.phase + 8) % 8;
      if (d >= 1 && d <= 3) ctx.rt.pos = (ctx.rt.pos ?? 0) + d;
      else if (d >= 5) ctx.rt.pos = (ctx.rt.pos ?? 0) - (8 - d);
    }
    if (ph >= 0) ctx.rt.phase = ph;
    const pos = ctx.rt.pos ?? 0;
    return { powered, coils: eff, steps: pos, angle: ((pos % 4096) / 4096) * 360, run: eff ? 1 : 0 };
  },
};

// ---------------------------------------------------------------- NEMA 17 + A4988 / DRV8825
function stepperDriver(o: { type: string; name: string; short: string; model: string; ms: string[]; table: (bits: number[]) => number; vmotMin: number; maxMicro: number }): PartManifest {
  const pins: PinDef[] = [
    pin('EN', '/EN', 0, 10, 'digital'),
    ...o.ms.map((m, i) => pin(m, m, 0, 20 + i * 10, 'digital')),
    pin('RST', '/RST', 0, 50, 'digital'),
    pin('SLP', '/SLP', 0, 60, 'digital'),
    pin('STEP', 'STEP', 0, 70, 'digital'),
    pin('DIR', 'DIR', 0, 80, 'digital'),
    pin('VMOT', 'VMOT', 100, 10, 'power'),
    pin('GNDM', 'GND (motor)', 100, 20, 'ground'),
    pin('VDD', 'VDD (logic)', 100, 70, 'power'),
    pin('GND', 'GND (logic)', 100, 80, 'ground'),
  ];
  return {
    type: o.type,
    name: o.name,
    short: o.short,
    model: o.model,
    category: 'actuator',
    group: 'Motors & drivers',
    description: `${o.name}: bipolar stepper driver with a NEMA 17 motor (200 steps/rev, 1.8°). One STEP pulse = one (micro)step, DIR sets direction, /EN LOW enables (pulled down on the board). Tie /RST to /SLP. Motor supply ${o.vmotMin}–35 V on VMOT; logic VDD 3.3 V from the Pi. Set the current limit before connecting the motor.`,
    w: 100,
    h: 90,
    pins,
    internal: () => [['GND', 'GNDM']],
    props: [{ key: 'reverse', label: 'Motor wired reversed', type: 'boolean', default: false, group: 'config' }],
    faults: [FAULT.none, { id: 'overheat', label: 'Thermal shutdown' }],
    support: 'full',
    fidelity: 'full',
    limits: `Counts STEP rising edges with direction and the ${o.ms.join('/')} microstep table (up to 1/${o.maxMicro}). Requires VMOT ≥ ${o.vmotMin} V, VDD ≥ 3 V, /EN LOW, /SLP and /RST HIGH. Current regulation, resonance and missed steps are not modelled.`,
    voltage: `VMOT ${o.vmotMin}–35 V, VDD 3–5.5 V`,
    inductive: true,
    python: 'gpiozero.OutputDevice (STEP/DIR) · RPi.GPIO · smartfarm.StepperDriver(step=20, dir=21)',
    drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
    commonErrors: ['/RST left floating: the driver ignores STEP (bridge /RST to /SLP)', 'No motor supply on VMOT', 'STEP pulses too fast for a real motor (> ~1 kHz full-step without acceleration)'],
    stamp(ctx) {
      ctx.R('en', ctx.node('EN'), ctx.node('GND'), 100000);
      for (const m of o.ms) ctx.R(`pd${m}`, ctx.node(m), ctx.node('GND'), 100000);
      ctx.R('slp', ctx.node('SLP'), ctx.node('VDD'), 10000);
      ctx.R('step', ctx.node('STEP'), ctx.node('GND'), 100000);
      ctx.R('vdd', ctx.node('VDD'), ctx.node('GND'), 50000);
      if (ctx.rt.active) ctx.R('mot', ctx.node('VMOT'), ctx.node('GNDM'), 24);
    },
    post(ctx: PostCtx) {
      const vdd = ctx.volt('VDD') - ctx.volt('GND');
      const vmot = ctx.volt('VMOT') - ctx.volt('GNDM');
      const hi = (p: string) => {
        const n = ctx.node(p);
        if (n === -2 || (n >= 0 && !ctx.sol.driven[n])) return null;
        return ctx.volt(p) - ctx.volt('GND') > 0.6 * Math.max(vdd, 1.5) ? 1 : 0;
      };
      const rst = hi('RST');
      const awake = hi('SLP') === 1 && rst === 1;
      const enabled = hi('EN') !== 1;
      const ok = vdd >= 3 && vmot >= o.vmotMin && awake && enabled && ctx.fault !== 'overheat';
      if (vdd >= 3 && rst === null) ctx.issue('W_STEPPER_RESET_FLOATING', 'warning', {}, ['RST']);
      if (vdd >= 3 && enabled && vmot < o.vmotMin) ctx.issue('W_UNPOWERED', 'warning', { v: vmot.toFixed(1), min: o.vmotMin }, ['VMOT']);
      const micro = o.table(o.ms.map((m) => hi(m) ?? 0));
      const step = hi('STEP') === 1;
      if (step && !ctx.rt.pstep && ok) {
        const dir = (hi('DIR') === 1 ? 1 : -1) * (ctx.props.reverse ? -1 : 1);
        ctx.rt.pos32 = (ctx.rt.pos32 ?? 0) + dir * (32 / micro);
      }
      ctx.rt.pstep = step;
      if (!!ctx.rt.active !== ok) {
        ctx.rt.active = ok;
        ctx.rt.dirty = true;
      }
      const steps = (ctx.rt.pos32 ?? 0) / 32;
      return { powered: ok, micro, steps, angle: (((steps * 1.8) % 360) + 360) % 360, run: ok ? 1 : 0 };
    },
  };
}

export const a4988 = stepperDriver({
  type: 'a4988_nema17',
  name: 'A4988 driver + NEMA 17 stepper',
  short: 'A4988',
  model: 'A4988 carrier + NEMA 17 (17HS4401)',
  ms: ['MS1', 'MS2', 'MS3'],
  // MS1 MS2 MS3: 000 full, 100 1/2, 010 1/4, 110 1/8, 111 1/16
  table: ([a, b, c]) => (a && b && c ? 16 : a && b ? 8 : b ? 4 : a ? 2 : 1),
  vmotMin: 8,
  maxMicro: 16,
});

export const drv8825 = stepperDriver({
  type: 'drv8825_nema17',
  name: 'DRV8825 driver + NEMA 17 stepper',
  short: 'DRV8825',
  model: 'DRV8825 carrier + NEMA 17 (17HS4401)',
  ms: ['M0', 'M1', 'M2'],
  // M0 M1 M2: 000 full, 100 1/2, 010 1/4, 110 1/8, 001 1/16, 101/011/111 1/32
  table: ([a, b, c]) => (c ? (a || b ? 32 : 16) : a && b ? 8 : b ? 4 : a ? 2 : 1),
  vmotMin: 8.2,
  maxMicro: 32,
});

// ---------------------------------------------------------------- L298N dual H-bridge
export const l298n: PartManifest = {
  type: 'l298n',
  name: 'L298N dual H-bridge motor driver',
  short: 'L298N',
  model: 'L298N module',
  manufacturer: 'STMicroelectronics (chip)',
  category: 'actuator',
  group: 'Motors & drivers',
  description: 'Drives two DC motors (or one bipolar stepper) up to 2 A each from 5–35 V. IN1/IN2 set direction of OUT1/OUT2, ENA enables it (remove the ENA jumper and apply PWM for speed). The bridge drops ≈2 V. With the 5V-EN jumper the board makes 5 V from the motor supply.',
  w: 110,
  h: 100,
  pins: [
    pin('OUT1', 'OUT1', 0, 20, 'terminal'),
    pin('OUT2', 'OUT2', 0, 30, 'terminal'),
    pin('OUT3', 'OUT3', 110, 20, 'terminal'),
    pin('OUT4', 'OUT4', 110, 30, 'terminal'),
    pin('VS', '+12V', 20, 100, 'power'),
    pin('GND', 'GND', 30, 100, 'ground'),
    pin('V5', '+5V', 40, 100, 'power'),
    pin('ENA', 'ENA', 50, 100, 'digital'),
    pin('IN1', 'IN1', 60, 100, 'digital'),
    pin('IN2', 'IN2', 70, 100, 'digital'),
    pin('IN3', 'IN3', 80, 100, 'digital'),
    pin('IN4', 'IN4', 90, 100, 'digital'),
    pin('ENB', 'ENB', 100, 100, 'digital'),
  ],
  props: [
    { key: 'enaJumper', label: 'ENA jumper fitted (always enabled)', type: 'boolean', default: true, group: 'config' },
    { key: 'enbJumper', label: 'ENB jumper fitted (always enabled)', type: 'boolean', default: true, group: 'config' },
    { key: 'regJumper', label: '5V-EN jumper (on-board 5 V regulator)', type: 'boolean', default: true, group: 'config' },
  ],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  fidelity: 'full',
  limits: 'Each enabled output is a source of VS − 1.4 V (high) or 0.7 V (low) through 0.5 Ω, disabled outputs float. PWM on ENA/ENB is solved per PWM phase. Thermal limits and the sense resistors are not modelled.',
  voltage: '5–35 V motor supply, 5 V logic (3.3 V inputs work)',
  inductive: false,
  python: 'gpiozero.Motor(forward=23, backward=24, enable=12) · smartfarm.DCMotor(...)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  commonErrors: ['Motor supply GND not common with the Pi GND (inputs do nothing)', 'PWM on ENA while the ENA jumper is still fitted', 'Using the +5V pin as input with the 5V-EN jumper fitted and a 12 V supply connected'],
  stamp(ctx) {
    for (const p of ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB']) ctx.R(`r${p}`, ctx.node(p), ctx.node('GND'), 100000);
    if (ctx.fault === 'burned' || ctx.rt.burned) return;
    const vs = ctx.rt.vs ?? 0;
    if (ctx.props.regJumper && vs >= 7) ctx.V('reg', ctx.node('V5'), ctx.node('GND'), 5, 0.2, 0.5);
    const bridge = (en: 0 | 1, a: string, b: string, oa: string, ob: string, tag: string) => {
      if (!en || vs < 4.5) return;
      const la = inLevel(ctx, a);
      const lb = inLevel(ctx, b);
      ctx.V(`${tag}a`, ctx.node(oa), ctx.node('GND'), la ? vs - 1.4 : 0.7, 0.5);
      ctx.V(`${tag}b`, ctx.node(ob), ctx.node('GND'), lb ? vs - 1.4 : 0.7, 0.5);
    };
    bridge(ctx.props.enaJumper ? 1 : inLevel(ctx, 'ENA'), 'IN1', 'IN2', 'OUT1', 'OUT2', 'A');
    bridge(ctx.props.enbJumper ? 1 : inLevel(ctx, 'ENB'), 'IN3', 'IN4', 'OUT3', 'OUT4', 'B');
  },
  post(ctx) {
    const vs = ctx.volt('VS') - ctx.volt('GND');
    if (Math.abs((ctx.rt.vs ?? 0) - vs) > 0.05) {
      ctx.rt.vs = vs;
      ctx.rt.dirty = true;
    }
    if (vs > 46) {
      ctx.rt.burned = true;
      ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vs.toFixed(1), max: 35 }, ['VS']);
    }
    measure(ctx, ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'], 2.0);
    if (!ctx.props.enaJumper && ctx.gpioOf('ENA') === null && ctx.connected('IN1')) ctx.issue('W_LOGIC_INPUT_FLOATING', 'warning', { pin: 'ENA' }, ['ENA']);
    const ia = Math.abs(ctx.cur('Aa'));
    const ib = Math.abs(ctx.cur('Ba'));
    return { vs, powered: vs >= 4.5, ia, ib, a: ctx.volt('OUT1') - ctx.volt('OUT2'), b: ctx.volt('OUT3') - ctx.volt('OUT4') };
  },
};

// ---------------------------------------------------------------- TB6612FNG
export const tb6612: PartManifest = {
  type: 'tb6612',
  name: 'TB6612FNG dual motor driver',
  short: 'TB6612',
  model: 'TB6612FNG carrier',
  manufacturer: 'Toshiba (chip)',
  category: 'actuator',
  group: 'Motors & drivers',
  description: 'MOSFET H-bridge for two DC motors (1.2 A each, 4.5–13.5 V on VM). Logic VCC 2.7–5.5 V. STBY must be HIGH. xIN1/xIN2 select CW/CCW/brake/stop, PWMx sets speed. Much lower losses than an L298N.',
  w: 110,
  h: 90,
  pins: [
    pin('VM', 'VM', 0, 10, 'power'),
    pin('VCC', 'VCC', 0, 20, 'power'),
    pin('GND', 'GND', 0, 30, 'ground'),
    pin('AO1', 'AO1', 0, 50, 'terminal'),
    pin('AO2', 'AO2', 0, 60, 'terminal'),
    pin('BO2', 'BO2', 0, 70, 'terminal'),
    pin('BO1', 'BO1', 0, 80, 'terminal'),
    pin('PWMA', 'PWMA', 110, 10, 'digital'),
    pin('AIN2', 'AIN2', 110, 20, 'digital'),
    pin('AIN1', 'AIN1', 110, 30, 'digital'),
    pin('STBY', 'STBY', 110, 40, 'digital'),
    pin('BIN1', 'BIN1', 110, 50, 'digital'),
    pin('BIN2', 'BIN2', 110, 60, 'digital'),
    pin('PWMB', 'PWMB', 110, 70, 'digital'),
  ],
  props: [],
  faults: [FAULT.none, FAULT.burned],
  support: 'full',
  fidelity: 'full',
  limits: 'Truth table of the datasheet (CW, CCW, short brake, stop, standby) with 0.5 Ω output MOSFETs, solved per PWM phase. Thermal and over-current shutdown are not modelled.',
  voltage: 'VM 4.5–13.5 V, VCC 2.7–5.5 V',
  python: 'gpiozero.Motor(forward=5, backward=6, enable=12) + STBY high · smartfarm.DCMotor(...)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  stamp(ctx) {
    for (const p of ['PWMA', 'AIN1', 'AIN2', 'STBY', 'BIN1', 'BIN2', 'PWMB']) ctx.R(`r${p}`, ctx.node(p), ctx.node('GND'), 200000);
    if (ctx.fault === 'burned' || ctx.rt.burned) return;
    const vm = ctx.rt.vm ?? 0;
    const vcc = ctx.rt.vcc ?? 0;
    if (vm < 2.5 || vcc < 2.7 || !inLevel(ctx, 'STBY')) return;
    const ch = (i1: string, i2: string, pw: string, o1: string, o2: string, tag: string) => {
      const a = inLevel(ctx, i1);
      const b = inLevel(ctx, i2);
      const p = inLevel(ctx, pw);
      if (!a && !b) return; // stop: outputs off (high impedance)
      let h1 = 0;
      let h2 = 0;
      if (a && !b && p) h1 = 1;
      else if (!a && b && p) h2 = 1; // otherwise short brake: both LOW
      ctx.V(`${tag}1`, ctx.node(o1), ctx.node('GND'), h1 ? vm : 0, 0.5);
      ctx.V(`${tag}2`, ctx.node(o2), ctx.node('GND'), h2 ? vm : 0, 0.5);
    };
    ch('AIN1', 'AIN2', 'PWMA', 'AO1', 'AO2', 'A');
    ch('BIN1', 'BIN2', 'PWMB', 'BO1', 'BO2', 'B');
  },
  post(ctx) {
    const vm = ctx.volt('VM') - ctx.volt('GND');
    const vcc = ctx.volt('VCC') - ctx.volt('GND');
    if (Math.abs((ctx.rt.vm ?? 0) - vm) > 0.05 || Math.abs((ctx.rt.vcc ?? 0) - vcc) > 0.05) {
      ctx.rt.vm = vm;
      ctx.rt.vcc = vcc;
      ctx.rt.dirty = true;
    }
    if (vm > 15) {
      ctx.rt.burned = true;
      ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vm.toFixed(1), max: 13.5 }, ['VM']);
    }
    const lv = measure(ctx, ['PWMA', 'AIN1', 'AIN2', 'STBY', 'BIN1', 'BIN2', 'PWMB'], 0.6 * Math.max(vcc, 2));
    if (vcc >= 2.7 && lv.STBY !== 1 && (ctx.connected('AIN1') || ctx.connected('BIN1'))) ctx.issue('W_DRIVER_STANDBY', 'warning', {}, ['STBY']);
    return { vm, vcc, powered: vm >= 2.5 && vcc >= 2.7, a: ctx.volt('AO1') - ctx.volt('AO2'), b: ctx.volt('BO1') - ctx.volt('BO2') };
  },
};

// ---------------------------------------------------------------- extra actuators
export const irrigationValve = {
  ...load({
    type: 'irrigation_valve',
    name: 'Irrigation solenoid valve (24 V)',
    description: 'Normally-closed irrigation valve (garden/greenhouse zone valve). Real zone valves are often 24 V AC — this model uses the DC version; switch it with a relay or MOSFET and a flyback diode.',
    volts: [12, 24],
    vDefault: 24,
    watts: 5,
    polarity: 'none',
    inductive: true,
    roles: ['circulation', 'fresh_water', 'drain', 'none'],
    role: 'circulation',
    rate: { key: 'rate', label: 'Flow when open', unit: 'L/min', default: 6, max: 100 },
    w: 70,
    h: 60,
    faults: PUMP_FAULTS,
  }),
  short: 'Zone valve',
  group: 'Actuators & relays',
  fidelity: 'functional',
} satisfies PartManifest;

export const exhaustFan = {
  ...load({
    type: 'exhaust_fan',
    name: 'Greenhouse exhaust fan (12 V)',
    description: 'Inline duct / exhaust fan for ventilation (12 V DC, 15 W). Drive it with a relay, MOSFET or SSR.',
    volts: [12, 24],
    vDefault: 12,
    watts: 15,
    polarity: 'strict',
    inductive: true,
    roles: ['fan', 'none'],
    role: 'fan',
    w: 80,
    h: 80,
  }),
  short: 'Exhaust',
  group: 'Actuators & relays',
  fidelity: 'functional',
} satisfies PartManifest;

export const MOTION_PARTS: PartManifest[] = [pwmFan, sg90, mg996r, stepper28byj, a4988, drv8825, l298n, tb6612, irrigationValve, exhaustFan];
