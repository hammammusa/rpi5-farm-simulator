import type { PropDef } from '../types';
import { GND } from '../solver';
import { FAULT, SENSOR_FAULTS, clamp, pin, sourceProp, type PartManifest, type PostCtx, type StampCtx } from './base';

const num = (key: string, label: string, def: number, min: number, max: number, unit: string, step = 0.1): PropDef => ({
  key,
  label,
  type: 'number',
  default: def,
  min,
  max,
  step,
  unit,
  live: true,
  group: 'sensor',
  visible: (p) => p.source !== 'farm',
});

/** Common power-check used by every sensor. Stores the supply voltage for the next stamp pass. */
function powerPost(ctx: PostCtx, vcc: string, gnd: string, min: number, max: number) {
  const vs = ctx.connected(vcc) && ctx.connected(gnd) ? ctx.volt(vcc) - ctx.volt(gnd) : 0;
  const powered = vs >= min && vs <= max + 0.3;
  if (ctx.rt.vs === undefined || Math.abs(ctx.rt.vs - vs) > 0.01) {
    ctx.rt.vs = vs;
    ctx.rt.dirty = true;
  }
  if (!ctx.connected(gnd) && ctx.connected(vcc)) ctx.issue('W_MISSING_GROUND', 'warning', {}, [gnd]);
  else if (!ctx.connected(vcc) && (ctx.connected(gnd) || anySignalConnected(ctx))) ctx.issue('W_UNPOWERED', 'warning', { v: '0', min }, [vcc]);
  else if (ctx.connected(vcc) && vs < min) ctx.issue('W_UNPOWERED', 'warning', { v: vs.toFixed(1), min }, [vcc]);
  if (vs > max + 0.3) {
    ctx.rt.damaged = true;
    ctx.issue('E_DEVICE_OVERVOLTAGE', 'error', { v: vs.toFixed(1), max }, [vcc]);
  }
  return { vs, powered: powered && !ctx.rt.damaged };
}

function anySignalConnected(ctx: PostCtx) {
  return ['DATA', 'OUT', 'AO', 'DO', 'SDA', 'SCL', 'TX', 'RX', 'DQ', 'SIG'].some((p) => {
    try {
      return ctx.connected(p);
    } catch {
      return false;
    }
  });
}

/** Analog output modelled as a Thevenin source (1 kΩ) referenced to the sensor GND. */
function analogOut(ctx: StampCtx, out: string, gnd: string, volts: number) {
  if (ctx.fault === 'disconnected') return;
  const vs = ctx.rt.vs ?? 3.3;
  const powered = vs >= 3.0 && !ctx.rt.damaged;
  ctx.V('ao', ctx.node(out), ctx.node(gnd), powered ? clamp(volts, 0, Math.max(0, vs - 0.05)) : 0, 1000);
}

function analogPost(ctx: PostCtx, out: string, extra: Record<string, any> = {}) {
  const gp = ctx.gpioOf(out);
  if (gp !== null) ctx.issue('E_ANALOG_NO_ADC', 'error', { pin: gp }, [out]);
  else if (!ctx.connected(out) && ctx.connected('VCC')) ctx.issue('W_SENSOR_DISCONNECTED', 'warning', { pin: out }, [out]);
  return { aout: ctx.volt(out) - ctx.volt('GND'), ...extra };
}

const analogLimits = 'Output voltage follows a documented linear calibration; read it with an MCP3008 ADC (Raspberry Pi 5 has no analog inputs).';

// ---------------------------------------------------------------- DHT22
export const dht22: PartManifest = {
  type: 'dht22',
  name: 'DHT22 temperature/humidity',
  category: 'sensor',
  description: 'DHT22 / AM2302 module (+, out, −). Single-wire digital protocol; the module has a 10 kΩ pull-up on DATA to VCC. Power it from 3.3 V on a Pi!',
  w: 40,
  h: 60,
  pins: [pin('VCC', '+', 0, 50, 'power'), pin('DATA', 'out', 10, 50, 'digital'), pin('GND', '−', 20, 50, 'ground')],
  props: [
    sourceProp(),
    num('temperature', 'Temperature', 25, -40, 80, '°C'),
    num('humidity', 'Humidity', 60, 0, 100, '%'),
    { key: 'module', label: 'Module with pull-up resistor', type: 'boolean', default: true, group: 'config' },
  ],
  faults: SENSOR_FAULTS,
  noise: { temperature: 1.5, humidity: 4 },
  farmKeys: { temperature: 'air.temp', humidity: 'air.humidity' },
  support: 'full',
  limits: 'Protocol timing is not bit-banged; the adafruit_dht shim returns the value of the sensor wired to the requested GPIO, with real-library errors and the 2 s minimum read interval.',
  voltage: '3.3–6 V',
  interfaces: ['1-wire DHT protocol'],
  python: 'adafruit_dht.DHT22(board.D4) · Adafruit_DHT (legacy)',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 3300);
    if (ctx.props.module && ctx.fault !== 'disconnected') ctx.R('pu', ctx.node('DATA'), ctx.node('VCC'), 10000);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 3.0, 6.0);
    if (ctx.connected('VCC') && !ctx.connected('DATA')) ctx.issue('W_SENSOR_DISCONNECTED', 'warning', { pin: 'DATA' }, ['DATA']);
    return { ...p, temperature: ctx.value('temperature'), humidity: ctx.value('humidity') };
  },
};

// ---------------------------------------------------------------- BME280
export const bme280: PartManifest = {
  type: 'bme280',
  name: 'BME280 temp/humidity/pressure',
  category: 'sensor',
  description: 'Bosch BME280 on a GY-BME280 breakout, I2C (address 0x76 or 0x77). Register-level model: chip-ID 0x60, calibration registers and raw ADC data.',
  w: 50,
  h: 50,
  pins: [pin('VCC', 'VIN', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), pin('SCL', 'SCL', 20, 40, 'digital'), pin('SDA', 'SDA', 30, 40, 'digital')],
  props: [
    sourceProp(),
    num('temperature', 'Temperature', 24, -40, 85, '°C'),
    num('humidity', 'Humidity', 55, 0, 100, '%'),
    num('pressure', 'Pressure', 1013.25, 300, 1100, 'hPa'),
    { key: 'address', label: 'I2C address', type: 'select', default: 0x76, options: [{ value: 0x76, label: '0x76 (SDO→GND)' }, { value: 0x77, label: '0x77 (SDO→VCC)' }], group: 'config' },
    {
      key: 'board',
      label: 'Board',
      type: 'select',
      default: '3v3',
      options: [
        { value: '3v3', label: '3.3 V only (no regulator)' },
        { value: 'reg', label: '3.3–5 V (with regulator)' },
      ],
      group: 'config',
    },
  ],
  faults: SENSOR_FAULTS,
  noise: { temperature: 1, humidity: 3, pressure: 2 },
  farmKeys: { temperature: 'air.temp', humidity: 'air.humidity', pressure: 'air.pressure' },
  support: 'full',
  limits: 'Register map covers chip-ID, reset, ctrl_hum/ctrl_meas/config, calibration and data registers. IIR filter and oversampling noise are not modelled.',
  voltage: '3.3 V (or 5 V with regulator)',
  interfaces: ['I2C'],
  python: 'smbus2 + bme280 (RPi.bme280 API)',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 10000);
    if (ctx.fault === 'disconnected') return;
    const ref = ctx.props.board === 'reg' ? null : ctx.node('VCC');
    for (const s of ['SDA', 'SCL']) {
      if (ref === null) ctx.V(`pu${s}`, ctx.node(s), ctx.node('GND'), 3.3, 10000);
      else ctx.R(`pu${s}`, ctx.node(s), ref, 10000);
    }
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 1.8, ctx.props.board === 'reg' ? 5.5 : 3.6);
    return { ...p, temperature: ctx.value('temperature'), humidity: ctx.value('humidity'), pressure: ctx.value('pressure') };
  },
};

// ---------------------------------------------------------------- DS18B20
export const ds18b20: PartManifest = {
  type: 'ds18b20',
  name: 'DS18B20 waterproof temperature probe',
  category: 'sensor',
  description: '1-Wire digital thermometer (red VDD, yellow DQ, black GND). Needs a 4.7 kΩ pull-up from DQ to 3.3 V unless you use a breakout module. Default bus pin: GPIO4.',
  w: 40,
  h: 60,
  pins: [pin('VCC', 'VDD (red)', 0, 50, 'power'), pin('DQ', 'DQ (yellow)', 10, 50, 'digital'), pin('GND', 'GND (black)', 20, 50, 'ground')],
  props: [
    sourceProp(),
    num('temperature', 'Water temperature', 21, -55, 125, '°C'),
    { key: 'module', label: 'Breakout module with pull-up', type: 'boolean', default: false, group: 'config' },
  ],
  faults: [...SENSOR_FAULTS, { id: 'reset85', label: 'Power-on-reset value (85 °C)', help: 'Classic DS18B20 fault: reads 85.000 °C after a brown-out.' }],
  noise: { temperature: 0.5 },
  farmKeys: { temperature: 'water.temp' },
  support: 'full',
  limits: 'Exposed through the Linux w1 sysfs interface (/sys/bus/w1/devices/28-*/w1_slave) and the w1thermsensor shim. ROM search timing is not simulated.',
  voltage: '3.0–5.5 V',
  interfaces: ['1-Wire'],
  python: 'w1thermsensor, or reading /sys/bus/w1/devices/28-*/w1_slave',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 50000);
    if (ctx.props.module && ctx.fault !== 'disconnected') ctx.R('pu', ctx.node('DQ'), ctx.node('VCC'), 4700);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 3.0, 5.5);
    return { ...p, temperature: ctx.value('temperature') };
  },
};

// ---------------------------------------------------------------- MH-Z19B
export const mhz19b: PartManifest = {
  type: 'mhz19b',
  name: 'MH-Z19B CO₂ sensor',
  category: 'sensor',
  description: 'NDIR CO₂ sensor, UART 9600 8N1, 3.3 V logic, powered from 5 V. Command FF 01 86 00 00 00 00 00 79 reads the concentration. Connect sensor TX → Pi RX (GPIO15) and sensor RX → Pi TX (GPIO14).',
  w: 70,
  h: 50,
  pins: [pin('VCC', 'Vin', 0, 10, 'power'), pin('GND', 'GND', 0, 20, 'ground'), pin('TX', 'TX', 0, 30, 'digital'), pin('RX', 'RX', 0, 40, 'digital')],
  props: [sourceProp(), num('co2', 'CO₂', 650, 0, 5000, 'ppm', 1), num('temperature', 'Internal temp', 25, -20, 60, '°C')],
  faults: [...SENSOR_FAULTS, FAULT.uartLoss],
  noise: { co2: 60, temperature: 1 },
  farmKeys: { co2: 'air.co2', temperature: 'air.temp' },
  support: 'full',
  limits: 'Implements 0x86 read, 0x87 zero-point, 0x79 ABC and 0x99 range commands with real checksums. Pre-heat and NDIR physics are not modelled.',
  voltage: '4.5–5.5 V supply, 3.3 V UART',
  interfaces: ['UART 9600'],
  python: 'serial.Serial("/dev/serial0", 9600)',
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 100);
    const vs = ctx.rt.vs ?? 0;
    if (vs >= 4.5 && ctx.fault !== 'disconnected' && !ctx.rt.damaged) ctx.V('tx', ctx.node('TX'), ctx.node('GND'), 3.3, 200);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 5.5);
    return { ...p, co2: ctx.value('co2') };
  },
};

// ---------------------------------------------------------------- analog sensors
function analogSensor(o: {
  type: string;
  name: string;
  description: string;
  quantity: PropDef;
  farmKey: string;
  noise: number;
  volts: (value: number, ctx: StampCtx) => number;
  formula: string;
  extraProps?: PropDef[];
  w?: number;
}): PartManifest {
  return {
    type: o.type,
    name: o.name,
    category: 'sensor',
    description: `${o.description} Calibration used by the simulator: ${o.formula}`,
    w: o.w ?? 50,
    h: 60,
    pins: [pin('VCC', 'VCC', 0, 50, 'power'), pin('GND', 'GND', 10, 50, 'ground'), pin('AO', 'AO (analog)', 20, 50, 'analog')],
    props: [sourceProp(), o.quantity, ...(o.extraProps ?? [])],
    faults: SENSOR_FAULTS.filter((f) => f.id !== 'timeout'),
    noise: { [o.quantity.key]: o.noise },
    farmKeys: { [o.quantity.key]: o.farmKey },
    support: 'full',
    limits: analogLimits,
    voltage: '3.3–5 V',
    interfaces: ['Analog → MCP3008'],
    python: 'gpiozero.MCP3008(channel=N).voltage',
    insertable: true,
    stamp(ctx) {
      ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 5000);
      const v = ctx.fault === 'invalid' ? 0 : o.volts(ctx.value(o.quantity.key), ctx);
      analogOut(ctx, 'AO', 'GND', v);
    },
    post(ctx) {
      const p = powerPost(ctx, 'VCC', 'GND', 3.0, 5.5);
      return { ...p, ...analogPost(ctx, 'AO'), value: ctx.value(o.quantity.key) };
    },
  };
}

export const phSensor = analogSensor({
  type: 'ph_sensor',
  name: 'pH sensor (analog)',
  description: 'Analog pH probe + signal board (DFRobot SEN0161 style).',
  quantity: num('ph', 'pH', 6.2, 0, 14, 'pH'),
  farmKey: 'water.ph',
  noise: 0.25,
  volts: (ph) => ph / 3.5,
  formula: 'V = pH / 3.5  →  pH = 3.5 × V (pH 7 ≈ 2.0 V).',
});

export const ecSensor = analogSensor({
  type: 'ec_sensor',
  name: 'EC conductivity sensor (analog)',
  description: 'Analog electrical-conductivity probe + board, temperature-dependent.',
  quantity: num('ec', 'EC @25 °C', 1.2, 0, 6, 'mS/cm', 0.01),
  farmKey: 'water.ec',
  noise: 0.15,
  volts: (ec, ctx) => {
    const t = ctx.props.source === 'farm' ? ctx.sim.farm.reservoir.tempC : Number(ctx.props.waterTemp ?? 25);
    return 0.5 * ec * (1 + 0.02 * (t - 25));
  },
  formula: 'V = 0.5 × EC25 × (1 + 0.02·(T − 25))  →  EC25 = V / 0.5 / (1 + 0.02·(T − 25)).',
  extraProps: [num('waterTemp', 'Solution temperature', 25, 0, 40, '°C')],
});

export const soilMoisture = analogSensor({
  type: 'soil_moisture',
  name: 'Capacitive soil moisture sensor',
  description: 'Capacitive soil/substrate moisture sensor v1.2.',
  quantity: num('moisture', 'Moisture', 45, 0, 100, '%', 1),
  farmKey: 'tray.moisture',
  noise: 4,
  volts: (m) => 2.9 - 1.6 * (clamp(m, 0, 100) / 100),
  formula: 'V = 2.9 − 1.6 × moisture/100 (dry 2.9 V, wet 1.3 V).',
});

export const waterLevelAnalog = analogSensor({
  type: 'water_level_analog',
  name: 'Water level sensor (analog)',
  description: 'Resistive/pressure water-level sensor giving a voltage proportional to level.',
  quantity: num('level', 'Water level', 75, 0, 100, '%', 1),
  farmKey: 'water.levelPct',
  noise: 3,
  volts: (l) => (3.0 * clamp(l, 0, 100)) / 100,
  formula: 'V = 3.0 × level/100.',
});

// ---------------------------------------------------------------- digital switch sensors
export const floatSwitch: PartManifest = {
  type: 'float_switch',
  name: 'Float switch',
  category: 'sensor',
  description: 'Reed float switch (2 wires). Wire one lead to a GPIO with pull-up, the other to GND. "Closed when water is low" mode = closed below the trigger level.',
  w: 40,
  h: 60,
  pins: [pin('1', 'Lead 1', 0, 50, 'passive'), pin('2', 'Lead 2', 20, 50, 'passive')],
  props: [
    sourceProp(),
    num('level', 'Water level', 75, 0, 100, '%', 1),
    { key: 'trigger', label: 'Mounting height (trigger level)', type: 'number', default: 20, min: 0, max: 100, step: 1, unit: '%', group: 'config' },
    {
      key: 'mode',
      label: 'Contact',
      type: 'select',
      default: 'closed_high',
      options: [
        { value: 'closed_high', label: 'Closed when water ABOVE trigger' },
        { value: 'closed_low', label: 'Closed when water BELOW trigger' },
      ],
      group: 'config',
    },
  ],
  faults: [FAULT.none, FAULT.stuck, { id: 'disconnected', label: 'Cable broken (always open)' }],
  farmKeys: { level: 'water.levelPct' },
  support: 'full',
  insertable: true,
  python: 'gpiozero.Button(pin) / DigitalInputDevice(pin, pull_up=True)',
  stamp(ctx) {
    const above = ctx.value('level') >= Number(ctx.props.trigger);
    const closed = ctx.fault === 'disconnected' ? false : ctx.props.mode === 'closed_high' ? above : !above;
    ctx.SW('sw', ctx.node('1'), ctx.node('2'), 0.1, closed);
  },
  post(ctx) {
    const above = ctx.value('level') >= Number(ctx.props.trigger);
    return { level: ctx.value('level'), closed: ctx.fault === 'disconnected' ? false : ctx.props.mode === 'closed_high' ? above : !above };
  },
};

function comparatorModule(o: { type: string; name: string; description: string; quantity: PropDef; farmKey: string; activeWhen: (v: number, p: Record<string, any>) => boolean; aout: (v: number) => number; extra?: PropDef[] }): PartManifest {
  return {
    type: o.type,
    name: o.name,
    category: 'sensor',
    description: o.description,
    w: 50,
    h: 60,
    pins: [pin('VCC', 'VCC', 0, 50, 'power'), pin('GND', 'GND', 10, 50, 'ground'), pin('DO', 'DO (digital)', 20, 50, 'digital'), pin('AO', 'AO (analog)', 30, 50, 'analog')],
    props: [sourceProp(), o.quantity, ...(o.extra ?? [])],
    faults: SENSOR_FAULTS.filter((f) => f.id !== 'timeout'),
    farmKeys: { [o.quantity.key]: o.farmKey },
    noise: { [o.quantity.key]: 0 },
    support: 'full',
    limits: 'LM393 comparator module: DO is open-collector with a 10 kΩ pull-up to VCC (so power it from 3.3 V when DO goes to a GPIO). AO needs an ADC.',
    voltage: '3.3–5 V',
    insertable: true,
    stamp(ctx) {
      ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 5000);
      if (ctx.fault === 'disconnected') return;
      const v = ctx.value(o.quantity.key);
      ctx.R('pu', ctx.node('DO'), ctx.node('VCC'), 10000);
      const vs = ctx.rt.vs ?? 3.3;
      ctx.SW('oc', ctx.node('DO'), ctx.node('GND'), 50, vs > 2.5 && o.activeWhen(v, ctx.props));
      analogOut(ctx, 'AO', 'GND', o.aout(v) * (vs / 3.3));
    },
    post(ctx) {
      const p = powerPost(ctx, 'VCC', 'GND', 3.0, 5.5);
      const ao = ctx.gpioOf('AO');
      if (ao !== null) ctx.issue('E_ANALOG_NO_ADC', 'error', { pin: ao }, ['AO']);
      const v = ctx.value(o.quantity.key);
      return { ...p, value: v, doLow: p.powered && o.activeWhen(v, ctx.props) };
    },
  };
}

export const ldrModule = comparatorModule({
  type: 'ldr_module',
  name: 'Light sensor module (LDR)',
  description: 'Photoresistor + LM393 comparator. DO goes LOW when light exceeds the threshold; AO voltage falls as light increases.',
  quantity: num('lux', 'Illuminance', 300, 0, 50000, 'lux', 1),
  farmKey: 'air.lux',
  activeWhen: (lux, p) => lux >= Number(p.threshold),
  aout: (lux) => 3.3 * (1 - Math.min(1, Math.log10(1 + lux) / 4.7)),
  extra: [{ key: 'threshold', label: 'DO threshold (potentiometer)', type: 'number', default: 500, min: 1, max: 50000, unit: 'lux', group: 'config' }],
});

export const leakSensor = comparatorModule({
  type: 'leak_sensor',
  name: 'Water leak sensor',
  description: 'Water/rain detection board + LM393. DO goes LOW when water bridges the traces.',
  quantity: { key: 'wet', label: 'Water present', type: 'number', default: 0, min: 0, max: 1, step: 1, unit: '', live: true, group: 'sensor', visible: (p) => p.source !== 'farm' },
  farmKey: 'leak',
  activeWhen: (w) => w >= 0.5,
  aout: (w) => (w >= 0.5 ? 0.8 : 3.2),
});

// ---------------------------------------------------------------- flow sensor
export const flowSensor: PartManifest = {
  type: 'flow_sensor',
  name: 'Water flow sensor YF-S201',
  category: 'sensor',
  description: 'Hall-effect flow meter: f(Hz) = 7.5 × Q(L/min). Open-collector output with pull-up to VCC — use a divider or power it so that SIG never exceeds 3.3 V.',
  w: 70,
  h: 50,
  pins: [pin('VCC', 'VCC (red)', 0, 20, 'power'), pin('GND', 'GND (black)', 0, 30, 'ground'), pin('SIG', 'Signal (yellow)', 0, 40, 'digital')],
  props: [sourceProp(), num('flow', 'Flow', 0, 0, 30, 'L/min')],
  faults: [FAULT.none, FAULT.disconnected, FAULT.stuck, FAULT.noise],
  noise: { flow: 0.3 },
  farmKeys: { flow: 'flow.lpm' },
  support: 'full',
  limits: 'Pulse edges are generated analytically from simulation time (max 400 Hz delivered to Python callbacks).',
  voltage: '4.5–18 V (works from 3.3 V in the simulator with reduced accuracy)',
  python: 'gpiozero.DigitalInputDevice(pin).when_activated / RPi.GPIO.add_event_detect',
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 1000);
    if (ctx.fault === 'disconnected') return;
    ctx.R('pu', ctx.node('SIG'), ctx.node('VCC'), 10000);
    const hz = 7.5 * Math.max(0, ctx.value('flow'));
    const low = hz > 0 && (ctx.sim.now * hz) % 1 < 0.5;
    ctx.SW('oc', ctx.node('SIG'), ctx.node('GND'), 50, low);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 3.0, 18);
    return { ...p, flow: ctx.value('flow'), hz: 7.5 * Math.max(0, ctx.value('flow')) };
  },
};

// ---------------------------------------------------------------- BH1750
export const bh1750: PartManifest = {
  type: 'bh1750',
  name: 'BH1750 light sensor (I2C)',
  category: 'sensor',
  description: 'Digital lux meter, I2C address 0x23 (ADDR→GND) or 0x5C. Commands: 0x01 power on, 0x10 continuous H-res, 0x20 one-time H-res. lux = raw / 1.2.',
  w: 50,
  h: 50,
  pins: [pin('VCC', 'VCC', 0, 40, 'power'), pin('GND', 'GND', 10, 40, 'ground'), pin('SCL', 'SCL', 20, 40, 'digital'), pin('SDA', 'SDA', 30, 40, 'digital')],
  props: [sourceProp(), num('lux', 'Illuminance', 300, 0, 65000, 'lux', 1), { key: 'address', label: 'I2C address', type: 'select', default: 0x23, options: [{ value: 0x23, label: '0x23' }, { value: 0x5c, label: '0x5C' }], group: 'config' }],
  faults: SENSOR_FAULTS,
  noise: { lux: 30 },
  farmKeys: { lux: 'air.lux' },
  support: 'full',
  voltage: '3.3–5 V (regulated board)',
  interfaces: ['I2C'],
  python: 'smbus2.SMBus(1).read_i2c_block_data(0x23, 0x20, 2)',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 20000);
    if (ctx.fault === 'disconnected') return;
    for (const s of ['SDA', 'SCL']) ctx.V(`pu${s}`, ctx.node(s), ctx.node('GND'), 3.3, 10000);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 2.4, 5.5);
    return { ...p, lux: ctx.value('lux') };
  },
};

// ---------------------------------------------------------------- MCP3008
const mcpPins = [
  // bottom row: pins 1..8 = CH0..CH7 (left → right)
  ...Array.from({ length: 8 }, (_, i) => pin(`CH${i}`, `CH${i}`, i * 10, 30, 'analog', `pin ${i + 1}`)),
  // top row: pins 16..9 (left → right)
  pin('VDD', 'VDD', 0, 0, 'power', 'pin 16'),
  pin('VREF', 'VREF', 10, 0, 'power', 'pin 15'),
  pin('AGND', 'AGND', 20, 0, 'ground', 'pin 14'),
  pin('CLK', 'CLK', 30, 0, 'digital', 'pin 13 → GPIO11 SCLK'),
  pin('DOUT', 'DOUT', 40, 0, 'digital', 'pin 12 → GPIO9 MISO'),
  pin('DIN', 'DIN', 50, 0, 'digital', 'pin 11 → GPIO10 MOSI'),
  pin('CS', 'CS/SHDN', 60, 0, 'digital', 'pin 10 → GPIO8 CE0'),
  pin('DGND', 'DGND', 70, 0, 'ground', 'pin 9'),
];

export const mcp3008: PartManifest = {
  type: 'mcp3008',
  name: 'MCP3008 8-channel 10-bit ADC',
  category: 'interface',
  description: 'SPI analog-to-digital converter (DIP-16, straddle the breadboard gap). Power VDD and VREF from 3.3 V so DOUT never exceeds the Pi’s 3.3 V logic.',
  w: 70,
  h: 30,
  pins: mcpPins,
  props: [],
  faults: [FAULT.none, FAULT.noise],
  support: 'full',
  limits: 'Bit-accurate SPI model: start bit, SGL/DIFF, D2..D0, null bit and 10-bit result (MSB first). Conversion timing is not modelled.',
  voltage: '2.7–5.5 V',
  interfaces: ['SPI0 (CE0/CE1)'],
  python: 'gpiozero.MCP3008, spidev',
  insertable: true,
  stamp(ctx) {
    ctx.R('idd', ctx.node('VDD'), ctx.node('DGND'), 10000);
    ctx.R('vref', ctx.node('VREF'), ctx.node('AGND'), 50000);
  },
  post(ctx) {
    const vdd = ctx.volt('VDD') - ctx.volt('DGND');
    const powered = ctx.connected('VDD') && ctx.connected('DGND') && vdd >= 2.7;
    if (ctx.connected('VDD') && !powered) ctx.issue('W_UNPOWERED', 'warning', { v: vdd.toFixed(1), min: 2.7 }, ['VDD']);
    if (powered && vdd > 3.6 && ctx.gpioOf('DOUT') !== null) ctx.issue('E_MCP_DOUT_5V', 'error', { v: vdd.toFixed(1) }, ['DOUT', 'VDD']);
    if (powered && !ctx.connected('VREF')) ctx.issue('W_MCP_NO_VREF', 'warning', {}, ['VREF']);
    if (powered && !ctx.connected('AGND')) ctx.issue('W_MISSING_GROUND', 'warning', {}, ['AGND']);
    const ch: number[] = [];
    for (let i = 0; i < 8; i++) ch.push(ctx.volt(`CH${i}`) - ctx.volt('AGND'));
    return { powered, vdd, vref: ctx.volt('VREF') - ctx.volt('AGND'), ch };
  },
};

export { GND };
