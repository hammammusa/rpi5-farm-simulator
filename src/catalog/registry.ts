// Component Registry: fills in the catalogue metadata (library group, simulation
// fidelity, drivers, short names, BOM references) for every part. New parts set
// these fields in their own manifest; the table below covers the original parts.
import type { Fidelity, LibraryGroup, PartManifest } from '../engine/parts/base';

interface Meta {
  group: LibraryGroup;
  fidelity: Fidelity;
  drivers: string[];
  short?: string;
  model?: string;
  manufacturer?: string;
  commonErrors?: string[];
}

const GPIO_OUT = ['gpiozero', 'RPi.GPIO', 'lgpio', 'smartfarm'];
const GPIO_IN = ['gpiozero', 'RPi.GPIO', 'lgpio', 'smartfarm'];
const ADC = ['smartfarm', 'gpiozero', 'adafruit_ads1x15', 'spidev'];

export const BASE_META: Record<string, Meta> = {
  rpi5: { group: 'Boards', fidelity: 'full', drivers: ['gpiozero', 'RPi.GPIO', 'lgpio', 'smbus2', 'spidev', 'serial', 'board', 'busio', 'digitalio'], short: 'Pi 5', model: 'Raspberry Pi 5 Model B 8GB', manufacturer: 'Raspberry Pi Ltd' },
  breadboard: { group: 'Breadboard & wiring', fidelity: 'full', drivers: [], short: 'Breadboard', model: '400/830-point solderless breadboard' },
  led: { group: 'LEDs & indicators', fidelity: 'full', drivers: GPIO_OUT, short: 'LED', model: '5 mm LED', commonErrors: ['No series resistor (LED burns, GPIO over-current)', 'LED reversed (cathode/flat side to GND)', 'Wired to a different GPIO than the code uses'] },
  rgb_led: { group: 'LEDs & indicators', fidelity: 'full', drivers: GPIO_OUT, short: 'RGB LED', model: '5 mm RGB LED' },
  resistor: { group: 'Passive components', fidelity: 'full', drivers: [], short: 'R', model: '¼ W carbon-film resistor' },
  capacitor: { group: 'Passive components', fidelity: 'functional', drivers: [], short: 'C' },
  button: { group: 'Inputs & switches', fidelity: 'full', drivers: GPIO_IN, short: 'Button', model: '6×6 mm tactile switch', commonErrors: ['No pull-up/pull-down: the input floats', 'Both legs on the same side of the button (always connected)'] },
  switch: { group: 'Inputs & switches', fidelity: 'full', drivers: GPIO_IN, short: 'Switch', model: 'SPDT slide switch' },
  potentiometer: { group: 'Inputs & switches', fidelity: 'full', drivers: ADC, short: 'Pot', model: '10 kΩ linear potentiometer' },
  buzzer: { group: 'LEDs & indicators', fidelity: 'full', drivers: GPIO_OUT, short: 'Buzzer', model: 'Active buzzer 3–5 V' },
  diode: { group: 'Semiconductors', fidelity: 'full', drivers: [], short: 'D', model: '1N4007' },
  npn: { group: 'Semiconductors', fidelity: 'functional', drivers: [], short: 'NPN', model: '2N2222 / BC547' },
  pnp: { group: 'Semiconductors', fidelity: 'functional', drivers: [], short: 'PNP', model: '2N2907 / BC557' },
  mosfet: { group: 'Semiconductors', fidelity: 'functional', drivers: [], short: 'MOSFET', model: 'IRLZ44N (logic-level)' },
  power_supply: { group: 'Power', fidelity: 'full', drivers: [], short: 'PSU', model: 'Bench / adapter DC supply' },
  relay_module: { group: 'Actuators & relays', fidelity: 'full', drivers: GPIO_OUT, short: 'Relay', model: 'SRD-05VDC-SL-C opto relay module', commonErrors: ['Active-LOW board driven with active_high=True (relay inverted)', 'Load wired to NC instead of NO', 'Relay VCC from 3.3 V (coil does not pull in)'] },
  water_pump: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Pump', model: '12 V DC pump' },
  dosing_pump: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Dosing', model: '12 V peristaltic pump' },
  solenoid_valve: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Valve', model: '12 V NC solenoid valve' },
  fan: { group: 'Motors & drivers', fidelity: 'functional', drivers: GPIO_OUT, short: 'Fan', model: '12 V DC fan' },
  dc_motor: { group: 'Motors & drivers', fidelity: 'functional', drivers: GPIO_OUT, short: 'Motor', model: 'DC hobby motor' },
  heater: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Heater', model: '12 V PTC heater' },
  humidifier: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Humidifier', model: 'Ultrasonic mist module' },
  grow_light: { group: 'Actuators & relays', fidelity: 'functional', drivers: GPIO_OUT, short: 'Grow light', model: '12 V LED grow bar' },
  servo: { group: 'Motors & drivers', fidelity: 'functional', drivers: ['gpiozero', 'RPi.GPIO', 'smartfarm'], short: 'Servo', model: 'SG90' },
  dht22: { group: 'Environmental sensors', fidelity: 'full', drivers: ['adafruit_dht', 'Adafruit_DHT', 'smartfarm'], short: 'DHT22', model: 'DHT22 / AM2302 module', manufacturer: 'Aosong', commonErrors: ['DATA pin wired to a different GPIO than the code uses', 'No pull-up on DATA (bare sensor)', 'Powered from 5 V while DATA goes to a GPIO without a module'] },
  bme280: { group: 'Environmental sensors', fidelity: 'full', drivers: ['bme280', 'smbus2', 'adafruit_bme280', 'smartfarm'], short: 'BME280', model: 'GY-BME280', manufacturer: 'Bosch' },
  ds18b20: { group: 'Agriculture & water sensors', fidelity: 'full', drivers: ['w1thermsensor', 'smartfarm'], short: 'DS18B20', model: 'DS18B20 waterproof probe', manufacturer: 'Analog Devices (Maxim)', commonErrors: ['1-Wire overlay not enabled (dtoverlay=w1-gpio)', 'Missing 4.7 kΩ pull-up between DQ and 3.3 V', 'DQ not on GPIO4'] },
  mhz19b: { group: 'Environmental sensors', fidelity: 'full', drivers: ['serial', 'smartfarm'], short: 'MH-Z19B', model: 'MH-Z19B', manufacturer: 'Winsen' },
  ph_sensor: { group: 'Agriculture & water sensors', fidelity: 'functional', drivers: ADC, short: 'pH', model: 'Analog pH probe + board (SEN0161-style)', commonErrors: ['AO wired straight to a GPIO (the Pi 5 has no ADC)', 'Probe not calibrated with buffer solutions'] },
  ec_sensor: { group: 'Agriculture & water sensors', fidelity: 'functional', drivers: ADC, short: 'EC', model: 'Analog EC probe + board' },
  soil_moisture: { group: 'Agriculture & water sensors', fidelity: 'functional', drivers: ADC, short: 'Soil (C)', model: 'Capacitive soil moisture v1.2' },
  water_level_analog: { group: 'Agriculture & water sensors', fidelity: 'functional', drivers: ADC, short: 'Level', model: 'Analog water-level sensor' },
  float_switch: { group: 'Agriculture & water sensors', fidelity: 'full', drivers: GPIO_IN, short: 'Float', model: 'Reed float switch' },
  flow_sensor: { group: 'Agriculture & water sensors', fidelity: 'full', drivers: GPIO_IN, short: 'Flow', model: 'YF-S201' },
  ldr_module: { group: 'Environmental sensors', fidelity: 'functional', drivers: GPIO_IN, short: 'LDR', model: 'LDR + LM393 module' },
  bh1750: { group: 'Environmental sensors', fidelity: 'full', drivers: ['smbus2', 'smartfarm'], short: 'BH1750', model: 'GY-302 (BH1750)', manufacturer: 'ROHM' },
  leak_sensor: { group: 'Agriculture & water sensors', fidelity: 'full', drivers: GPIO_IN, short: 'Leak', model: 'Water sensor + LM393' },
  mcp3008: { group: 'ADC & I/O expanders', fidelity: 'full', drivers: ['gpiozero', 'spidev', 'smartfarm'], short: 'MCP3008', model: 'MCP3008-I/P', manufacturer: 'Microchip', commonErrors: ['DIN/DOUT swapped (MOSI/MISO)', 'VDD at 5 V: DOUT drives 5 V into GPIO9', 'CS not on CE0/CE1'] },
  nextion: { group: 'Displays', fidelity: 'full', drivers: ['serial', 'smartfarm'], short: 'Nextion', model: 'NX3224K028', manufacturer: 'ITEAD', commonErrors: ['TX/RX not crossed', 'Command not terminated with FF FF FF', 'Baud rate different from the HMI setting'] },
  lcd1602_i2c: { group: 'Displays', fidelity: 'full', drivers: ['RPLCD', 'smbus2', 'smartfarm'], short: 'LCD1602', model: 'LCD1602 + PCF8574' },
  oled_ssd1306: { group: 'Displays', fidelity: 'full', drivers: ['ssd1306', 'adafruit_ssd1306', 'smbus2', 'smartfarm'], short: 'OLED', model: 'SSD1306 0.96" 128×64' },
  usb_serial: { group: 'Communication', fidelity: 'full', drivers: ['serial'], short: 'USB-UART', model: 'CP2102 / CH340 USB-TTL adapter' },
};

const CATEGORY_GROUP: Record<string, LibraryGroup> = {
  board: 'Boards',
  basic: 'Breadboard & wiring',
  passive: 'Passive components',
  semiconductor: 'Semiconductors',
  input: 'Inputs & switches',
  output: 'LEDs & indicators',
  power: 'Power',
  sensor: 'Environmental sensors',
  actuator: 'Actuators & relays',
  display: 'Displays',
  interface: 'Communication',
};

export function fidelityOf(m: PartManifest): Fidelity {
  return m.fidelity ?? (m.support === 'full' ? 'functional' : 'experimental');
}

export function groupOf(m: PartManifest): LibraryGroup {
  return m.group ?? CATEGORY_GROUP[m.category] ?? 'Communication';
}

/** Parts listed (also) in the Smart Farming Components group. */
export function isFarmPart(m: PartManifest) {
  return groupOf(m) === 'Smart Farming Components' || m.props.some((p) => p.key === 'role') || !!m.farmKeys;
}

export function applyCatalog(parts: PartManifest[]) {
  for (const m of parts) {
    const meta = BASE_META[m.type];
    if (meta) {
      m.group ??= meta.group;
      m.fidelity ??= meta.fidelity;
      m.drivers ??= meta.drivers;
      m.short ??= meta.short;
      m.model ??= meta.model;
      m.manufacturer ??= meta.manufacturer;
      m.commonErrors ??= meta.commonErrors;
    }
    m.group ??= groupOf(m);
    m.fidelity ??= fidelityOf(m);
    m.drivers ??= [];
  }
}

export const GROUP_ORDER: LibraryGroup[] = [
  'Boards',
  'Smart Farming Components',
  'Environmental sensors',
  'Agriculture & water sensors',
  'ADC & I/O expanders',
  'Actuators & relays',
  'Motors & drivers',
  'Displays',
  'Communication',
  'LEDs & indicators',
  'Inputs & switches',
  'Passive components',
  'Semiconductors',
  'Logic & memory ICs',
  'Power',
  'Breadboard & wiring',
];

export const FIDELITY_LABEL: Record<Fidelity, { en: string; ar: string; help: string }> = {
  full: { en: 'Fully Simulated', ar: 'محاكاة كاملة', help: 'The documented functions are modelled and covered by automated tests.' },
  functional: { en: 'Functional Model', ar: 'نموذج وظيفي', help: 'Documented behavioural model with simplified physics (see the limits).' },
  experimental: { en: 'Experimental', ar: 'تجريبي', help: 'Partial support — see the limits before relying on it.' },
  visual: { en: 'Visual Only', ar: 'عرض فقط', help: 'Drawing and documentation only: not driven by the simulation or by Python.' },
};
