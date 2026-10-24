// Environmental sensors (temperature, humidity, pressure, gases, light, particulates).
import type { PropDef } from '../types';
import { FAULT, SENSOR_FAULTS, clamp, pin, sourceProp, type PartManifest, type StampCtx } from './base';
import { analogSensor, comparatorModule, num, powerPost, dht22 } from './sensors';
import { Bme280 } from '../devices/bme280';
import { Bme680, Ccs811, Scd30, Scd4x, Sht3x, Tsl2561 } from '../devices/i2cDevices';
import { Pms5003 } from '../devices/serialDevices';
import type { DeviceHost, DeviceModel } from '../devices/device';

/** Regulated I2C breakout: VCC/GND/SCL/SDA (+ extra pins) with 10 kΩ pull-ups to the on-board 3.3 V. */
export function i2cSensor(o: {
  type: string;
  name: string;
  short: string;
  description: string;
  props: PropDef[];
  vmin: number;
  vmax: number;
  device: (h: DeviceHost) => DeviceModel;
  python: string;
  drivers: string[];
  fidelity: PartManifest['fidelity'];
  limits: string;
  model?: string;
  manufacturer?: string;
  noise?: Record<string, number>;
  farmKeys?: Record<string, string>;
  extraPins?: { id: string; label: string; kind: 'digital' | 'power' | 'ground' }[];
  faults?: PartManifest['faults'];
  w?: number;
  commonErrors?: string[];
}): PartManifest {
  const extra = o.extraPins ?? [];
  const w = o.w ?? Math.max(50, 10 * (4 + extra.length));
  return {
    type: o.type,
    name: o.name,
    short: o.short,
    model: o.model,
    manufacturer: o.manufacturer,
    category: 'sensor',
    group: 'Environmental sensors',
    description: o.description,
    w,
    h: 50,
    pins: [
      pin('VCC', 'VIN', 0, 40, 'power'),
      pin('GND', 'GND', 10, 40, 'ground'),
      pin('SCL', 'SCL', 20, 40, 'digital'),
      pin('SDA', 'SDA', 30, 40, 'digital'),
      ...extra.map((p, i) => pin(p.id, p.label, 40 + i * 10, 40, p.kind)),
    ],
    props: o.props,
    faults: o.faults ?? SENSOR_FAULTS,
    noise: o.noise,
    farmKeys: o.farmKeys,
    support: o.fidelity === 'full' ? 'full' : 'partial',
    fidelity: o.fidelity,
    limits: o.limits,
    voltage: `${o.vmin}–${o.vmax} V`,
    interfaces: ['I2C'],
    python: o.python,
    drivers: o.drivers,
    bus: 'i2c',
    device: o.device,
    insertable: true,
    commonErrors: o.commonErrors ?? ['SDA and SCL swapped (GPIO2 = SDA, GPIO3 = SCL)', 'Two devices with the same I2C address on the bus', 'No common GND with the Pi'],
    stamp(ctx) {
      ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 20000);
      if (ctx.fault === 'disconnected') return;
      for (const s of ['SDA', 'SCL']) ctx.V(`pu${s}`, ctx.node(s), ctx.node('GND'), 3.3, 10000);
    },
    post(ctx) {
      const p = powerPost(ctx, 'VCC', 'GND', o.vmin, o.vmax);
      const vals: Record<string, number> = {};
      for (const d of o.props) if (d.group === 'sensor' && d.type === 'number') vals[d.key] = ctx.value(d.key);
      return { ...p, ...vals };
    },
  };
}

const addr = (def: number, opts: [number, string][]): PropDef => ({
  key: 'address',
  label: 'I2C address',
  type: 'select',
  default: def,
  options: opts.map(([v, l]) => ({ value: v, label: l })),
  group: 'config',
});

const T = (d = 24) => num('temperature', 'Temperature', d, -40, 85, '°C');
const H = (d = 55) => num('humidity', 'Humidity', d, 0, 100, '%');
const AIR = { temperature: 'air.temp', humidity: 'air.humidity' };

// ---------------------------------------------------------------- DHT11 / AM2302
export const dht11: PartManifest = {
  ...dht22,
  type: 'dht11',
  name: 'DHT11 temperature/humidity',
  short: 'DHT11',
  model: 'DHT11',
  group: 'Environmental sensors',
  description: 'Low-cost single-wire sensor (blue). 0–50 °C ±2 °C, 20–90 %RH ±5 %, whole-number readings, 1 Hz max. Module version has the DATA pull-up.',
  props: [sourceProp(), num('temperature', 'Temperature', 24, 0, 50, '°C', 1), num('humidity', 'Humidity', 55, 20, 90, '%', 1), { key: 'module', label: 'Module with pull-up resistor', type: 'boolean', default: true, group: 'config' }],
  noise: { temperature: 2, humidity: 5 },
  voltage: '3.3–5.5 V',
  python: 'adafruit_dht.DHT11(board.D4) · smartfarm.DHT11(4)',
  drivers: ['adafruit_dht', 'Adafruit_DHT', 'smartfarm'],
  fidelity: 'full',
  limits: 'Protocol timing is not bit-banged; readings are whole numbers clipped to 0–50 °C / 20–90 %RH like the real sensor.',
};

export const am2302: PartManifest = {
  ...dht22,
  type: 'am2302',
  name: 'AM2302 (wired DHT22)',
  short: 'AM2302',
  model: 'AM2302',
  manufacturer: 'Aosong',
  group: 'Environmental sensors',
  description: 'DHT22 in a cased, wired version: red = VCC, yellow = DATA, black = GND. A pull-up resistor is built in.',
  props: [sourceProp(), num('temperature', 'Temperature', 25, -40, 80, '°C'), num('humidity', 'Humidity', 60, 0, 100, '%'), { key: 'module', label: 'Built-in pull-up', type: 'boolean', default: true, group: 'config' }],
  drivers: ['adafruit_dht', 'Adafruit_DHT', 'smartfarm'],
  fidelity: 'full',
};

// ---------------------------------------------------------------- I2C sensors
export const bmp280 = i2cSensor({
  type: 'bmp280',
  name: 'BMP280 pressure/temperature',
  short: 'BMP280',
  model: 'BMP280',
  manufacturer: 'Bosch',
  description: 'Barometric pressure + temperature (no humidity — that is the BME280). I2C 0x76 (SDO→GND) or 0x77. Chip-ID 0x58.',
  props: [sourceProp(), T(), num('pressure', 'Pressure', 1013.25, 300, 1100, 'hPa'), addr(0x76, [[0x76, '0x76 (SDO→GND)'], [0x77, '0x77 (SDO→VCC)']])],
  vmin: 1.8,
  vmax: 5.5,
  device: (h) => new Bme280(h, 0x58),
  python: 'adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=0x76) · smartfarm.BMP280()',
  drivers: ['adafruit_bmp280', 'smbus2', 'smartfarm'],
  fidelity: 'full',
  limits: 'Same register model and Bosch compensation as the BME280 (humidity registers absent). IIR filter is not modelled.',
  noise: { temperature: 1, pressure: 2 },
  farmKeys: { temperature: 'air.temp', pressure: 'air.pressure' },
});

const shtLike = (type: string, name: string, model: string, acc: string) =>
  i2cSensor({
    type,
    name,
    short: model,
    model,
    manufacturer: 'Sensirion',
    description: `${model} digital temperature/humidity sensor (${acc}). I2C 0x44 (ADDR→GND) or 0x45. Single-shot command 0x2400, 6-byte answer with CRC-8 per word.`,
    props: [sourceProp(), T(), H(), addr(0x44, [[0x44, '0x44 (ADDR→GND)'], [0x45, '0x45 (ADDR→VCC)']])],
    vmin: 2.4,
    vmax: 5.5,
    device: (h) => new Sht3x(h),
    python: 'adafruit_sht31d.SHT31D(i2c) · smartfarm.SHT31()',
    drivers: ['adafruit_sht31d', 'smbus2', 'smartfarm'],
    fidelity: 'full',
    limits: 'Implements single-shot measurement (0x2400/0x2C06), soft reset, heater on/off, status and serial-number commands with Sensirion CRC-8. Periodic mode is not modelled.',
    noise: { temperature: 0.3, humidity: 2 },
    farmKeys: AIR,
  });
export const sht31 = shtLike('sht31', 'SHT31 temperature/humidity', 'SHT31', '±0.3 °C, ±2 %RH');
export const sht35 = shtLike('sht35', 'SHT35 temperature/humidity', 'SHT35', '±0.1 °C, ±1.5 %RH');

export const scd30 = i2cSensor({
  type: 'scd30',
  name: 'SCD30 NDIR CO₂ / T / RH',
  short: 'SCD30',
  model: 'SCD30',
  manufacturer: 'Sensirion',
  description: 'NDIR CO₂ sensor module, I2C 0x61. Measurements every 2 s after "start continuous measurement" (0x0010); results are big-endian float32 split into CRC-protected words.',
  props: [sourceProp(), num('co2', 'CO₂', 650, 0, 10000, 'ppm', 1), T(), H()],
  vmin: 3.0,
  vmax: 5.5,
  device: (h) => new Scd30(h),
  python: 'adafruit_scd30.SCD30(i2c) · smartfarm.SCD30()',
  drivers: ['adafruit_scd30', 'smartfarm'],
  fidelity: 'full',
  limits: 'Commands 0x0010, 0x0104, 0x0202, 0x0300, 0x4600, 0xD100, 0xD304. Clock stretching, ASC/FRC calibration and the PWM/UART modes are not modelled.',
  noise: { co2: 30, temperature: 0.4, humidity: 3 },
  farmKeys: { co2: 'air.co2', ...AIR },
});

export const scd40 = i2cSensor({
  type: 'scd40',
  name: 'SCD40 / SCD41 photoacoustic CO₂',
  short: 'SCD4x',
  model: 'SCD40',
  manufacturer: 'Sensirion',
  description: 'Miniature CO₂ sensor, I2C 0x62. start_periodic_measurement (0x21B1) → new data every 5 s; read_measurement (0xEC05) returns CO₂ ppm, T and RH words with CRC. SCD41 adds single-shot (0x219D).',
  props: [
    sourceProp(),
    num('co2', 'CO₂', 650, 0, 40000, 'ppm', 1),
    T(),
    H(),
    { key: 'model', label: 'Model', type: 'select', default: 'SCD40', options: [{ value: 'SCD40', label: 'SCD40' }, { value: 'SCD41', label: 'SCD41 (single-shot)' }], group: 'config' },
  ],
  vmin: 2.4,
  vmax: 5.5,
  device: (h) => new Scd4x(h),
  python: 'adafruit_scd4x.SCD4X(i2c) · smartfarm.SCD4X()',
  drivers: ['adafruit_scd4x', 'smartfarm'],
  fidelity: 'full',
  limits: 'Periodic, low-power periodic and single-shot measurement, data-ready, read and serial-number commands with CRC. Calibration commands are accepted but ignored.',
  noise: { co2: 40, temperature: 0.8, humidity: 6 },
  farmKeys: { co2: 'air.co2', ...AIR },
});

export const ccs811 = i2cSensor({
  type: 'ccs811',
  name: 'CCS811 eCO₂ / TVOC',
  short: 'CCS811',
  model: 'CCS811',
  manufacturer: 'ams',
  description: 'Metal-oxide gas sensor reporting equivalent CO₂ (400–8192 ppm) and TVOC (0–1187 ppb). I2C 0x5A. The WAK (nWAKE) pin must be tied LOW or the chip ignores the bus.',
  props: [sourceProp(), num('eco2', 'eCO₂', 450, 400, 8192, 'ppm', 1), num('tvoc', 'TVOC', 30, 0, 1187, 'ppb', 1), { key: 'addr', label: 'I2C address', type: 'select', default: 0x5a, options: [{ value: 0x5a, label: '0x5A (ADDR→GND)' }, { value: 0x5b, label: '0x5B (ADDR→VCC)' }], group: 'config' }],
  vmin: 1.8,
  vmax: 5.5,
  device: (h) => new Ccs811(h),
  python: 'adafruit_ccs811.CCS811(i2c) · smartfarm.CCS811()',
  drivers: ['adafruit_ccs811', 'smartfarm'],
  fidelity: 'functional',
  limits: 'Registers HW_ID, STATUS, MEAS_MODE, ALG_RESULT_DATA, APP_START and SW_RESET. eCO₂/TVOC come from the sliders (the metal-oxide chemistry and the 20-minute burn-in are not modelled).',
  extraPins: [{ id: 'WAK', label: 'WAK (nWAKE)', kind: 'digital' }],
  commonErrors: ['WAK pin left floating: the sensor never answers (tie WAK to GND)', 'SDA/SCL swapped'],
});

export const bme680 = i2cSensor({
  type: 'bme680',
  name: 'BME680 gas/T/RH/pressure',
  short: 'BME680',
  model: 'BME680',
  manufacturer: 'Bosch',
  description: '4-in-1 environmental sensor: temperature, humidity, pressure and VOC gas resistance. I2C 0x77 (SDO→VCC) or 0x76. Chip-ID 0x61.',
  props: [sourceProp(), T(), H(), num('pressure', 'Pressure', 1013.25, 300, 1100, 'hPa'), num('gas', 'Gas resistance', 50000, 1000, 500000, 'Ω', 100), addr(0x77, [[0x77, '0x77 (SDO→VCC)'], [0x76, '0x76 (SDO→GND)']])],
  vmin: 1.7,
  vmax: 5.5,
  device: (h) => new Bme680(h),
  python: 'adafruit_bme680.Adafruit_BME680_I2C(i2c) · smartfarm.BME680()',
  drivers: ['adafruit_bme680', 'smartfarm'],
  fidelity: 'functional',
  limits: 'Chip-ID, soft reset, forced-mode trigger and new-data flag follow the datasheet, but compensated values are stored in a simplified register layout read by the simulator driver — the Bosch calibration and the gas heater profile are not reproduced.',
  noise: { temperature: 0.5, humidity: 3, pressure: 1, gas: 2000 },
  farmKeys: { temperature: 'air.temp', humidity: 'air.humidity', pressure: 'air.pressure' },
});

export const tsl2561 = i2cSensor({
  type: 'tsl2561',
  name: 'TSL2561 luminosity sensor',
  short: 'TSL2561',
  model: 'TSL2561',
  manufacturer: 'ams',
  description: 'Two-channel (broadband + IR) light sensor, I2C 0x39 (ADDR floating), 0x29 (GND) or 0x49 (VCC). Lux is computed from CH0/CH1 with the datasheet formula.',
  props: [sourceProp(), num('lux', 'Illuminance', 300, 0, 40000, 'lux', 1), { key: 'addr', label: 'I2C address', type: 'select', default: 0x39, options: [{ value: 0x39, label: '0x39 (float)' }, { value: 0x29, label: '0x29 (GND)' }, { value: 0x49, label: '0x49 (VCC)' }], group: 'config' }],
  vmin: 2.7,
  vmax: 3.6,
  device: (h) => new Tsl2561(h),
  python: 'adafruit_tsl2561.TSL2561(i2c) · smartfarm.TSL2561()',
  drivers: ['adafruit_tsl2561', 'smartfarm'],
  fidelity: 'full',
  limits: 'Command register, power, timing (gain 1×/16×, 13.7/101/402 ms) and the two ADC channels. A fixed IR ratio CH1/CH0 = 0.25 (daylight-like) is used.',
  noise: { lux: 20 },
  farmKeys: { lux: 'air.lux' },
});

// ---------------------------------------------------------------- analog temperature
export const lm35 = analogSensor({
  type: 'lm35',
  name: 'LM35 analog temperature',
  short: 'LM35',
  model: 'LM35DZ',
  manufacturer: 'Texas Instruments',
  description: 'Precision analog temperature sensor, 10 mV/°C. Needs a 4–30 V supply (use the Pi 5 V pin); output 0–1.5 V goes to an ADC.',
  quantity: num('temperature', 'Temperature', 25, 0, 100, '°C'),
  farmKey: 'air.temp',
  noise: 0.5,
  volts: (t) => t * 0.01,
  formula: 'V = 0.010 × T  →  T = V / 0.010.',
  vmin: 4,
  vmax: 30,
  voltage: '4–30 V supply, 10 mV/°C',
  pinLabels: ['+Vs', 'GND', 'Vout'],
});

export const tmp36 = analogSensor({
  type: 'tmp36',
  name: 'TMP36 analog temperature',
  short: 'TMP36',
  model: 'TMP36',
  manufacturer: 'Analog Devices',
  description: 'Low-voltage analog temperature sensor, 10 mV/°C with a 500 mV offset. Works from 2.7–5.5 V.',
  quantity: num('temperature', 'Temperature', 25, -40, 125, '°C'),
  farmKey: 'air.temp',
  noise: 0.5,
  volts: (t) => 0.5 + t * 0.01,
  formula: 'V = 0.5 + 0.010 × T  →  T = (V − 0.5) / 0.010.',
  vmin: 2.7,
  vmax: 5.5,
  voltage: '2.7–5.5 V',
  pinLabels: ['+Vs', 'GND', 'Vout'],
});

/** Two-terminal resistive temperature sensors: the resistance really changes, so read them with a divider + ADC. */
function resistiveTemp(o: { type: string; name: string; short: string; description: string; r: (t: number, p: Record<string, any>) => number; props: PropDef[]; formula: string; model?: string }): PartManifest {
  return {
    type: o.type,
    name: o.name,
    short: o.short,
    model: o.model,
    category: 'sensor',
    group: 'Environmental sensors',
    description: `${o.description} ${o.formula}`,
    w: 40,
    h: 20,
    pins: [pin('1', 'Lead 1', 0, 10, 'passive'), pin('2', 'Lead 2', 40, 10, 'passive')],
    props: [sourceProp(), num('temperature', 'Temperature', 25, -50, 200, '°C'), ...o.props],
    faults: [FAULT.none, { id: 'disconnected', label: 'Open lead' }, FAULT.stuck, FAULT.noise],
    noise: { temperature: 0.4 },
    farmKeys: { temperature: 'water.temp' },
    support: 'full',
    fidelity: 'full',
    limits: 'The element is stamped as a real resistance (Ω) into the circuit solver, so the voltage at the divider/ADC follows it. Self-heating is not modelled.',
    voltage: 'passive (any divider voltage)',
    interfaces: ['Resistive → voltage divider → ADC'],
    python: 'smartfarm.Thermistor(adc_channel) / gpiozero.MCP3008 + Steinhart–Hart',
    drivers: ['smartfarm', 'gpiozero', 'adafruit_ads1x15'],
    insertable: true,
    stamp(ctx) {
      if (ctx.fault === 'disconnected') return;
      ctx.R('r', ctx.node('1'), ctx.node('2'), o.r(ctx.value('temperature'), ctx.props));
    },
    post(ctx) {
      const t = ctx.value('temperature');
      return { temperature: t, ohms: o.r(t, ctx.props), ma: Math.abs(ctx.cur('r')) * 1000 };
    },
  };
}

export const ntc = resistiveTemp({
  type: 'ntc',
  name: 'NTC thermistor 10 kΩ',
  short: 'NTC 10k',
  model: 'NTC 10k B3950',
  description: 'Negative-temperature-coefficient thermistor (10 kΩ @ 25 °C, β = 3950). Put it in a divider with a 10 kΩ resistor and read the midpoint with an ADC.',
  r: (t, p) => Number(p.r25) * Math.exp(Number(p.beta) * (1 / (t + 273.15) - 1 / 298.15)),
  props: [
    { key: 'r25', label: 'R at 25 °C', type: 'number', default: 10000, min: 100, max: 1e6, step: 100, unit: 'Ω', group: 'config' },
    { key: 'beta', label: 'β constant', type: 'number', default: 3950, min: 2000, max: 5000, step: 1, unit: 'K', group: 'config' },
  ],
  formula: 'R(T) = R25 · exp(β · (1/T − 1/298.15 K)).',
});

export const pt1000 = resistiveTemp({
  type: 'pt1000',
  name: 'PT100 / PT1000 RTD',
  short: 'RTD',
  model: 'PT1000 class B',
  description: 'Platinum RTD probe. PT1000 can be read with a divider + ADC (≈3.85 Ω/°C); PT100 needs a bridge amplifier or an RTD converter for useful resolution.',
  r: (t, p) => Number(p.r0) * (1 + 0.00385 * t),
  props: [{ key: 'r0', label: 'Type', type: 'select', default: 1000, options: [{ value: 100, label: 'PT100 (100 Ω @ 0 °C)' }, { value: 1000, label: 'PT1000 (1000 Ω @ 0 °C)' }], group: 'config' }],
  formula: 'R(T) = R0 · (1 + 0.00385 · T) (linear IEC 60751 approximation).',
});

// ---------------------------------------------------------------- MQ gas sensors (heater + comparator board)
function mq(type: string, gas: string, name: string, k: number, defPpm: number, maxPpm: number) {
  const base = comparatorModule({
    type,
    name,
    description: `${name}: tin-dioxide gas sensor on an LM393 board. The heater needs 5 V (~150 mA) and 24–48 h burn-in on real hardware. AO rises with ${gas} concentration (needs an ADC; at 5 V it can exceed 3.3 V); DO goes LOW above the threshold.`,
    quantity: num('ppm', `${gas} concentration`, defPpm, 0, maxPpm, 'ppm', 1),
    farmKey: 'air.co2',
    activeWhen: (v, p) => v >= Number(p.threshold),
    aout: (v) => clamp((5 * (v / k)) / (1 + v / k), 0.1, 4.9) * (3.3 / 5),
    extra: [{ key: 'threshold', label: 'DO threshold (potentiometer)', type: 'number', default: Math.round(maxPpm / 5), min: 1, max: maxPpm, unit: 'ppm', group: 'config' }],
  });
  return {
    ...base,
    short: type.toUpperCase().replace('_', '-'),
    model: type.toUpperCase().replace('_', '-'),
    group: 'Environmental sensors' as const,
    farmKeys: type === 'mq135' ? { ppm: 'air.co2' } : undefined,
    fidelity: 'functional' as const,
    voltage: '5 V heater',
    limits: `Functional model: AO = Vcc·(c/${k})/(1 + c/${k}) — a monotonic curve standing in for the datasheet log-log Rs/R0 curve; DO is the LM393 comparator. Heater warm-up and cross-sensitivity are not modelled.`,
    python: 'gpiozero.DigitalInputDevice (DO) · ADC + smartfarm.MQSensor (AO)',
    drivers: ['gpiozero', 'smartfarm', 'adafruit_ads1x15'],
    post(ctx: any) {
      const r = base.post!(ctx);
      const vs = ctx.connected('VCC') && ctx.connected('GND') ? ctx.volt('VCC') - ctx.volt('GND') : 0;
      if (vs > 0.5 && vs < 4.5) ctx.issue('W_UNPOWERED', 'warning', { v: vs.toFixed(1), min: 4.9 }, ['VCC']);
      return r;
    },
  } satisfies PartManifest;
}
export const mq2 = mq('mq2', 'LPG/smoke', 'MQ-2 smoke/LPG sensor', 1000, 200, 10000);
export const mq7 = mq('mq7', 'CO', 'MQ-7 carbon monoxide sensor', 300, 20, 2000);
export const mq135 = mq('mq135', 'CO₂/NH₃ (air quality)', 'MQ-135 air-quality sensor', 2000, 450, 5000);

// ---------------------------------------------------------------- PMS5003 particulate matter (UART)
export const pms5003: PartManifest = {
  type: 'pms5003',
  name: 'PMS5003 particulate sensor',
  short: 'PMS5003',
  model: 'PMS5003',
  manufacturer: 'Plantower',
  category: 'sensor',
  group: 'Environmental sensors',
  description: 'Laser PM1.0/PM2.5/PM10 sensor. 5 V supply, 3.3 V UART 9600 8N1. In active mode it sends a 32-byte frame (42 4D …, checksum) every second. SET LOW = sleep.',
  w: 80,
  h: 50,
  pins: [pin('VCC', 'VCC 5V', 0, 10, 'power'), pin('GND', 'GND', 0, 20, 'ground'), pin('TX', 'TX', 0, 30, 'digital'), pin('RX', 'RX', 0, 40, 'digital'), pin('SET', 'SET', 10, 40, 'digital')],
  props: [sourceProp(), num('pm1', 'PM1.0', 8, 0, 1000, 'µg/m³', 1), num('pm25', 'PM2.5', 12, 0, 1000, 'µg/m³', 1), num('pm10', 'PM10', 18, 0, 1000, 'µg/m³', 1)],
  faults: [...SENSOR_FAULTS, FAULT.uartLoss],
  noise: { pm1: 2, pm25: 3, pm10: 4 },
  support: 'full',
  fidelity: 'full',
  limits: 'Active-mode frames every second, passive mode (42 4D E1/E2) and SET sleep. Particle counts are derived from PM values with a fixed size distribution.',
  voltage: '5 V supply, 3.3 V logic',
  interfaces: ['UART 9600'],
  python: 'adafruit_pm25.uart.PM25_UART(serial.Serial("/dev/serial0", 9600)) · smartfarm.PMS5003()',
  drivers: ['adafruit_pm25', 'serial', 'smartfarm'],
  bus: 'uart',
  device: (h) => new Pms5003(h),
  stamp(ctx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 50);
    const vs = ctx.rt.vs ?? 0;
    if (vs >= 4.5 && ctx.fault !== 'disconnected' && !ctx.rt.damaged) {
      ctx.V('tx', ctx.node('TX'), ctx.node('GND'), 3.3, 200);
      ctx.V('set', ctx.node('SET'), ctx.node('GND'), 3.3, 10000);
    }
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 5.5);
    return { ...p, pm1: ctx.value('pm1'), pm25: ctx.value('pm25'), pm10: ctx.value('pm10') };
  },
};

// ---------------------------------------------------------------- simple modules
export const rainSensor = {
  ...comparatorModule({
    type: 'rain_sensor',
    name: 'Rain sensor (YL-83 + LM393)',
    description: 'Rain plate with an LM393 comparator board. DO goes LOW when water bridges the traces; AO falls as the plate gets wetter.',
    quantity: num('wetness', 'Rain intensity', 0, 0, 100, '%', 1),
    farmKey: 'leak',
    activeWhen: (w, p) => w >= Number(p.threshold),
    aout: (w) => 3.2 - 2.6 * (w / 100),
    extra: [{ key: 'threshold', label: 'DO threshold', type: 'number', default: 30, min: 1, max: 100, unit: '%', group: 'config' }],
  }),
  short: 'Rain',
  group: 'Environmental sensors',
  fidelity: 'full',
  python: 'gpiozero.DigitalInputDevice(pin) (DO) · ADC (AO)',
  drivers: ['gpiozero', 'smartfarm'],
  farmKeys: undefined,
} satisfies PartManifest;

export const uvSensor = analogSensor({
  type: 'uv_sensor',
  name: 'UV index sensor (GUVA-S12SD)',
  short: 'UV',
  model: 'GUVA-S12SD',
  description: 'Analog UV photodiode module. Output ≈ 0.1 V per UV-index step.',
  quantity: num('uvi', 'UV index', 3, 0, 11, '', 0.1),
  noise: 0.2,
  volts: (u) => clamp(u, 0, 11) * 0.1,
  formula: 'V = 0.1 × UVI  →  UVI = V / 0.1.',
  vmin: 2.7,
  vmax: 5.5,
});

export const ppfdSensor = analogSensor({
  type: 'ppfd_sensor',
  name: 'PAR / PPFD quantum sensor (analog)',
  short: 'PPFD',
  description: 'Photosynthetic photon flux density sensor with a 0–2.5 V output for 0–2500 µmol/m²/s (analog-output quantum sensors of this type are common in greenhouses). In farm mode PPFD ≈ lux × 0.0185.',
  quantity: num('ppfd', 'PPFD', 400, 0, 2500, 'µmol/m²/s', 1),
  farmKey: 'air.lux',
  noise: 10,
  volts: (q, ctx) => clamp((ctx.props.source === 'farm' ? q * 0.0185 : q) / 1000, 0, 2.5),
  formula: 'V = PPFD / 1000  →  PPFD = 1000 × V (µmol/m²/s).',
  vmin: 4.5,
  vmax: 24,
  voltage: '5–24 V supply, 0–2.5 V out',
});

export const pirSensor: PartManifest = {
  type: 'pir_sensor',
  name: 'PIR motion sensor (HC-SR501)',
  short: 'PIR',
  model: 'HC-SR501',
  category: 'sensor',
  group: 'Environmental sensors',
  description: 'Passive-infrared motion detector. 5 V supply, OUT is a 3.3 V push-pull output: HIGH while motion is detected (plus the hold time set by the potentiometer).',
  w: 50,
  h: 50,
  pins: [pin('VCC', 'VCC (5V)', 0, 40, 'power'), pin('OUT', 'OUT', 10, 40, 'digital'), pin('GND', 'GND', 20, 40, 'ground')],
  props: [{ key: 'motion', label: 'Motion detected', type: 'boolean', default: false, live: true, group: 'sensor' }, { key: 'hold', label: 'Hold time', type: 'number', default: 3, min: 0.5, max: 300, step: 0.5, unit: 's', group: 'config' }],
  faults: [FAULT.none, FAULT.disconnected, FAULT.stuck],
  support: 'full',
  fidelity: 'full',
  limits: 'OUT goes HIGH immediately while "Motion detected" is on and stays HIGH for the hold time after it turns off. Detection range and warm-up are not modelled.',
  voltage: '4.5–20 V supply, 3.3 V output',
  python: 'gpiozero.MotionSensor(pin) · smartfarm.MotionSensor(pin)',
  drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'],
  insertable: true,
  stamp(ctx: StampCtx) {
    ctx.R('idd', ctx.node('VCC'), ctx.node('GND'), 100000);
    const vs = ctx.rt.vs ?? 0;
    if (vs < 4.5 || ctx.fault === 'disconnected') return;
    const now = ctx.sim.now;
    // the hold time runs from the moment the motion ends (HC-SR501 retriggering mode)
    if (ctx.props.motion) ctx.rt.moving = true;
    else if (ctx.rt.moving) {
      ctx.rt.moving = false;
      ctx.rt.holdUntil = now + Number(ctx.props.hold);
    }
    const holding = (ctx.rt.holdUntil ?? 0) > now;
    // cleared one evaluation after it expires, so the simulator re-evaluates until OUT has fallen
    if (ctx.rt.holdUntil !== undefined && !holding) delete ctx.rt.holdUntil;
    const high = ctx.fault === 'stuck' ? !!ctx.rt.stuckHigh : !!ctx.props.motion || holding;
    ctx.V('out', ctx.node('OUT'), ctx.node('GND'), high ? 3.3 : 0, 100);
  },
  post(ctx) {
    const p = powerPost(ctx, 'VCC', 'GND', 4.5, 20);
    const high = p.powered && ctx.volt('OUT') - ctx.volt('GND') > 1.65;
    if (ctx.fault !== 'stuck') ctx.rt.stuckHigh = high;
    return { ...p, motion: high };
  },
};

export const ENV_PARTS: PartManifest[] = [dht11, am2302, bmp280, sht31, sht35, scd30, scd40, ccs811, bme680, tsl2561, lm35, tmp36, ntc, pt1000, mq2, mq7, mq135, pms5003, rainSensor, uvSensor, ppfdSensor, pirSensor];
