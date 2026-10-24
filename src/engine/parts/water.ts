// Agriculture & water sensors (hydroponic nutrient solution, tanks, pipes, soil).
import { FAULT, SENSOR_FAULTS, clamp, pin, sourceProp, type PartManifest } from './base';
import { analogSensor, comparatorModule, floatSwitch, num, powerPost } from './sensors';
import { ModbusSoilSensor } from '../devices/serialDevices';

function bisect(f: (v: number) => number, target: number, lo: number, hi: number) {
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** DFRobot Gravity TDS meter transfer function (V at 25 °C → ppm). */
export const tdsFromV = (v: number) => (133.42 * v ** 3 - 255.86 * v ** 2 + 857.39 * v) * 0.5;

export const tdsSensor = {
  ...analogSensor({
    type: 'tds_sensor',
    name: 'TDS meter (analog)',
    short: 'TDS',
    model: 'Gravity TDS (SEN0244-style)',
    description: 'Total-dissolved-solids probe + board. Output 0–2.3 V. Temperature-compensate with a water temperature probe.',
    quantity: num('tds', 'TDS', 600, 0, 1000, 'ppm', 1),
    farmKey: 'water.tds',
    noise: 15,
    volts: (tds, ctx) => {
      const t = ctx.props.source === 'farm' ? ctx.sim.farm.reservoir.tempC : Number(ctx.props.waterTemp ?? 25);
      return bisect(tdsFromV, clamp(tds, 0, 1000), 0, 2.3) * (1 + 0.02 * (t - 25));
    },
    formula: 'TDS = (133.42·Vc³ − 255.86·Vc² + 857.39·Vc) × 0.5 with Vc = V / (1 + 0.02·(T − 25)).',
    extraProps: [num('waterTemp', 'Solution temperature', 25, 0, 40, '°C')],
    vmin: 3.0,
    rout: 100,
    vmax: 5.5,
  }),
  group: 'Agriculture & water sensors',
  fidelity: 'functional',
} satisfies PartManifest;

export const turbiditySensor = {
  ...analogSensor({
    type: 'turbidity_sensor',
    name: 'Turbidity sensor (analog)',
    short: 'Turbidity',
    model: 'Gravity turbidity (SEN0189-style)',
    description: 'Optical turbidity probe. 5 V supply; clear water ≈ 4.2 V, very cloudy ≈ 2.5 V — use a voltage divider (or a 5 V ADC reference) before the ADC input.',
    quantity: num('ntu', 'Turbidity', 5, 0, 3000, 'NTU', 1),
    noise: 10,
    volts: (ntu) => (5742.3 + Math.sqrt(Math.max(0, 5742.3 ** 2 - 4 * 1120.4 * (4352.9 + clamp(ntu, 0, 3000))))) / (2 * 1120.4),
    formula: 'NTU = −1120.4·V² + 5742.3·V − 4352.9 (2.5 V ≤ V ≤ 4.2 V).',
    vmin: 4.5,
    rout: 100,
    vmax: 5.5,
    voltage: '5 V supply, 2.5–4.2 V out',
  }),
  group: 'Agriculture & water sensors',
  fidelity: 'functional',
} satisfies PartManifest;

const doSat = (T: number) => 14.62 - 0.3898 * T + 0.006969 * T * T - 0.00005897 * T * T * T;

export const doSensor = {
  ...analogSensor({
    type: 'do_sensor',
    name: 'Dissolved oxygen probe (analog)',
    short: 'DO',
    model: 'Gravity DO (SEN0237-style)',
    description: 'Galvanic dissolved-oxygen probe + amplifier. Calibrate the saturation voltage in air-saturated water.',
    quantity: num('do', 'Dissolved O₂', 8, 0, 20, 'mg/L', 0.1),
    farmKey: 'water.do',
    noise: 0.2,
    volts: (dox, ctx) => {
      const t = ctx.props.source === 'farm' ? ctx.sim.farm.reservoir.tempC : Number(ctx.props.waterTemp ?? 25);
      return (dox / doSat(t)) * (Number(ctx.props.vsat) / 1000);
    },
    formula: 'V = DO / DOsat(T) × Vsat (Vsat = saturation calibration voltage, default 1600 mV).',
    extraProps: [num('waterTemp', 'Water temperature', 25, 0, 40, '°C'), { key: 'vsat', label: 'Saturation calibration voltage', type: 'number', default: 1600, min: 200, max: 3000, step: 10, unit: 'mV', group: 'config' }],
    vmin: 3.0,
    rout: 100,
    vmax: 5.5,
  }),
  group: 'Agriculture & water sensors',
  fidelity: 'functional',
} satisfies PartManifest;

export const pressureSensor = {
  ...analogSensor({
    type: 'pressure_transducer',
    name: 'Water pressure transmitter (0.5–4.5 V)',
    short: 'Pressure',
    description: 'Stainless pressure transducer for pipes/tanks, 5 V supply, ratiometric 0.5–4.5 V output over the selected range. Divide the output down for a 3.3 V ADC.',
    quantity: num('kpa', 'Pressure', 100, 0, 1200, 'kPa', 1),
    farmKey: 'pipe.kPa',
    noise: 3,
    volts: (kpa, ctx) => 0.5 + (4 * clamp(kpa, 0, Number(ctx.props.range))) / Number(ctx.props.range),
    formula: 'V = 0.5 + 4.0 × P / Pmax.',
    rout: 100,
    extraProps: [{ key: 'range', label: 'Range (Pmax)', type: 'select', default: 1200, options: [{ value: 500, label: '0–0.5 MPa' }, { value: 1200, label: '0–1.2 MPa' }], group: 'config' }],
    vmin: 4.5,
    vmax: 5.5,
    voltage: '5 V supply, 0.5–4.5 V out',
  }),
  group: 'Agriculture & water sensors',
  fidelity: 'functional',
} satisfies PartManifest;

// ---------------------------------------------------------------- HC-SR04 ultrasonic
export const hcsr04: PartManifest = {
  type: 'hcsr04',
  name: 'Ultrasonic distance sensor HC-SR04',
  short: 'HC-SR04',
  model: 'HC-SR04',
  category: 'sensor',
  group: 'Agriculture & water sensors',
  description: 'Ultrasonic ranger (2–400 cm), used above a tank to measure the water level. 5 V supply. TRIG: 10 µs HIGH pulse. ECHO is a 5 V pulse whose width = round-trip time — put a divider (e.g. 1 kΩ / 2 kΩ) between ECHO and the GPIO!',
  w: 70,
  h: 50,
  pins: [pin('VCC', 'VCC', 10, 40, 'power'), pin('TRIG', 'Trig', 20, 40, 'digital'), pin('ECHO', 'Echo', 30, 40, 'digital'), pin('GND', 'GND', 40, 40, 'ground')],
  props: [sourceProp(), num('distance', 'Distance to target', 25, 2, 450, 'cm', 0.5)],
  faults: [FAULT.none, FAULT.disconnected, FAULT.noise, { id: 'no_echo', label: 'No echo (soft/angled surface)' }],
  noise: { distance: 0.5 },
  farmKeys: { distance: 'water.distanceCm' },
  support: 'full',
  fidelity: 'full',
  limits: 'A ≥ 8 µs TRIG pulse starts an ECHO pulse of width 2·d / 343 m/s (38 ms when out of range), generated in simulation time. Beam angle and temperature dependence of the speed of sound are not modelled.',
  voltage: '5 V supply, 5 V ECHO output',
  interfaces: ['GPIO trigger/echo'],
  python: 'gpiozero.DistanceSensor(echo=24, trigger=23) · smartfarm.Ultrasonic(trigger=23, echo=24)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  commonErrors: ['ECHO wired straight to a GPIO: 5 V on a 3.3 V pin (use a 1 kΩ/2 kΩ divider)', 'TRIG and ECHO swapped', 'Powered from 3.3 V: the module does not range'],
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 1500);
    ctx.R('trig', ctx.node('TRIG'), ctx.node('GND'), 10000);
    if (ctx.fault === 'disconnected') return;
    const vs = ctx.rt.vs ?? 0;
    const now = ctx.sim.now;
    const high = vs >= 4.5 && (ctx.rt.echoFrom ?? 1e18) <= now && now < (ctx.rt.echoUntil ?? 0);
    ctx.V('echo', ctx.node('ECHO'), ctx.node('GND'), high ? vs : 0, 100);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 5.5);
    const trig = ctx.volt('TRIG') - ctx.volt('GND') > 2.0;
    const now = ctx.sim.now;
    if (trig && !ctx.rt.trigHigh) ctx.rt.trigStart = now;
    if (!trig && ctx.rt.trigHigh && p.powered && now - (ctx.rt.trigStart ?? now) >= 8e-6 && !(ctx.rt.echoUntil > now)) {
      const d = ctx.value('distance');
      const width = ctx.fault === 'no_echo' || d > 400 ? 0.038 : (2 * clamp(d, 2, 400)) / 34300;
      ctx.rt.echoFrom = now + 0.0005;
      ctx.rt.echoUntil = ctx.rt.echoFrom + width;
      ctx.rt.dirty = true;
    }
    ctx.rt.trigHigh = trig;
    const g = ctx.gpioOf('ECHO');
    if (g !== null && p.powered) ctx.issue('E_ECHO_5V', 'error', { pin: g }, ['ECHO']);
    return { ...p, distance: ctx.value('distance'), echo: (ctx.rt.echoFrom ?? 1e18) <= now && now < (ctx.rt.echoUntil ?? 0) };
  },
};

// ---------------------------------------------------------------- switches
export const overflowSwitch: PartManifest = {
  ...floatSwitch,
  type: 'overflow_switch',
  name: 'Tank overflow float switch',
  short: 'Overflow',
  group: 'Agriculture & water sensors',
  description: 'Float switch mounted near the top of a tank. Closes when the water reaches it — use it as a hard overflow stop for fill valves.',
  props: floatSwitch.props.map((p) => (p.key === 'trigger' ? { ...p, default: 92 } : p)),
  fidelity: 'full',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
};

export const soilResistive = {
  ...comparatorModule({
    type: 'soil_resistive',
    name: 'Resistive soil moisture probe (YL-69)',
    description: 'Two-prong resistive probe on an LM393 board. DO goes LOW when the soil is wetter than the threshold; AO falls as moisture rises. The prongs corrode if powered continuously — switch VCC from a GPIO/transistor.',
    quantity: num('moisture', 'Soil moisture', 40, 0, 100, '%', 1),
    farmKey: 'tray.moisture',
    activeWhen: (m, p) => m >= Number(p.threshold),
    aout: (m) => 3.2 - 2.4 * (clamp(m, 0, 100) / 100),
    extra: [{ key: 'threshold', label: 'DO threshold (wet above)', type: 'number', default: 50, min: 1, max: 100, unit: '%', group: 'config' }],
  }),
  short: 'Soil (R)',
  model: 'YL-69 + LM393',
  group: 'Agriculture & water sensors',
  fidelity: 'full',
  drivers: ['gpiozero', 'smartfarm', 'adafruit_ads1x15'],
  python: 'gpiozero.DigitalInputDevice(pin) (DO) · ADC (AO)',
} satisfies PartManifest;

// ---------------------------------------------------------------- ACS712 current sensor (pump feedback)
export const acs712: PartManifest = {
  type: 'acs712',
  name: 'ACS712 current sensor (5 A)',
  short: 'ACS712',
  model: 'ACS712ELCTR-05B',
  manufacturer: 'Allegro',
  category: 'sensor',
  group: 'Agriculture & water sensors',
  description: 'Hall-effect current sensor in series with a load (IP+ → IP−). 5 V supply, OUT = VCC/2 + 0.185 V/A. Use it to confirm a pump really draws current (dry-run / blocked-motor detection).',
  w: 70,
  h: 50,
  pins: [pin('IPP', 'IP+', 0, 10, 'terminal'), pin('IPN', 'IP−', 0, 30, 'terminal'), pin('VCC', 'VCC', 70, 10, 'power'), pin('OUT', 'OUT', 70, 20, 'analog'), pin('GND', 'GND', 70, 30, 'ground')],
  props: [{ key: 'range', label: 'Version', type: 'select', default: 5, options: [{ value: 5, label: '5 A (185 mV/A)' }, { value: 20, label: '20 A (100 mV/A)' }, { value: 30, label: '30 A (66 mV/A)' }], group: 'config' }],
  faults: [FAULT.none, FAULT.noise, { id: 'disconnected', label: 'Output disconnected' }],
  support: 'full',
  fidelity: 'full',
  limits: 'The measured current is the real branch current computed by the circuit solver through IP+ → IP− (1.2 mΩ). Bandwidth/offset drift are not modelled.',
  voltage: '5 V supply',
  interfaces: ['Analog → ADC'],
  python: 'ADC (ADS1115 / MCP3008) + smartfarm.CurrentSensor',
  drivers: ['smartfarm', 'adafruit_ads1x15', 'gpiozero'],
  stamp(ctx) {
    ctx.R('ip', ctx.node('IPP'), ctx.node('IPN'), 0.0012);
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 500);
    const vs = ctx.rt.vs ?? 0;
    if (vs < 4.5 || ctx.fault === 'disconnected') return;
    const sens = { 5: 0.185, 20: 0.1, 30: 0.066 }[Number(ctx.props.range) as 5 | 20 | 30] ?? 0.185;
    ctx.V('out', ctx.node('OUT'), ctx.node('GND'), clamp(vs / 2 + sens * (ctx.rt.i ?? 0), 0, vs), 100);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 5.5);
    let i = ctx.cur('ip');
    if (ctx.fault === 'noise') i += (Math.random() - 0.5) * 0.1;
    if (Math.abs((ctx.rt.i ?? 0) - i) > 0.002) {
      ctx.rt.i = i;
      ctx.rt.dirty = true;
    }
    const g = ctx.gpioOf('OUT');
    if (g !== null) ctx.issue('E_ANALOG_NO_ADC', 'error', { pin: g }, ['OUT']);
    return { ...p, amps: i, aout: ctx.volt('OUT') - ctx.volt('GND') };
  },
};

// ---------------------------------------------------------------- RS-485 Modbus soil probe
export const rs485Soil: PartManifest = {
  type: 'rs485_soil',
  name: 'RS-485 soil sensor (Modbus RTU, 7-in-1)',
  short: 'Soil 485',
  category: 'sensor',
  group: 'Agriculture & water sensors',
  description:
    'Industrial soil probe with an RS-485 Modbus-RTU interface (moisture, temperature, EC, pH, N, P, K). 12 V supply (5–30 V). Connect A/B to a MAX485 transceiver. Registers (function 03/04): 0 moisture×10, 1 temp×10, 2 EC µS/cm, 3 pH×10, 4 N, 5 P, 6 K (mg/kg). Vendor maps differ — check the datasheet of the real probe.',
  w: 70,
  h: 50,
  pins: [pin('VCC', 'VCC (brown)', 0, 10, 'power'), pin('GND', 'GND (black)', 0, 20, 'ground'), pin('A', 'A+ (yellow)', 0, 30, 'digital'), pin('B', 'B− (blue)', 0, 40, 'digital')],
  props: [
    num('moisture', 'Moisture', 32, 0, 100, '%'),
    num('temperature', 'Temperature', 22, -40, 80, '°C'),
    num('ec', 'EC', 800, 0, 20000, 'µS/cm', 1),
    num('ph', 'pH', 6.5, 3, 9, 'pH'),
    num('n', 'Nitrogen N', 40, 0, 1999, 'mg/kg', 1),
    num('p', 'Phosphorus P', 20, 0, 1999, 'mg/kg', 1),
    num('k', 'Potassium K', 60, 0, 1999, 'mg/kg', 1),
    { key: 'slave', label: 'Modbus address', type: 'number', default: 1, min: 1, max: 247, step: 1, unit: '', group: 'config' },
    { key: 'baud', label: 'Baud rate', type: 'select', default: 9600, options: [2400, 4800, 9600].map((b) => ({ value: b, label: `${b}` })), group: 'config' },
  ],
  faults: [FAULT.none, FAULT.disconnected, FAULT.invalid, FAULT.uartLoss],
  support: 'full',
  fidelity: 'functional',
  limits: 'Modbus RTU functions 03/04 with CRC-16, exception codes 01/02 and a documented register map. Electrical RS-485 levels are not solved — A/B connectivity and termination are checked by topology only.',
  voltage: '5–30 V (12 V typical)',
  interfaces: ['RS-485 Modbus RTU'],
  python: 'minimalmodbus.Instrument("/dev/serial0", 1) via MAX485 · smartfarm.ModbusSoilSensor',
  drivers: ['minimalmodbus', 'serial', 'smartfarm'],
  device: (h) => new ModbusSoilSensor(h),
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 1200);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 30);
    return { ...p, moisture: ctx.value('moisture'), ph: ctx.value('ph'), ec: ctx.value('ec') };
  },
};

export const WATER_PARTS: PartManifest[] = [tdsSensor, turbiditySensor, doSensor, pressureSensor, hcsr04, overflowSwitch, soilResistive, acs712, rs485Soil];

void SENSOR_FAULTS;
