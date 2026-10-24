// Ready-to-run example for every component: circuit (wires from the part to the Pi and
// helper parts), Python code using the built-in drivers, the expected output and an
// engine-level verification. The same data powers "Insert Example Code", "Load Complete
// Example", the in-app "Test simulation" button and the automated catalogue tests.
import { CircuitBuilder, WIRE_COLORS as W, newProject } from '../engine/project';
import { getPart, hasPart } from '../engine/parts';
import type { ProjectDoc } from '../engine/types';
import type { Simulator } from '../engine/simulator';

export interface PartExample {
  title: string;
  code: string;
  /** 'dut.VCC>pi.P1' — `dut` is the documented part, helpers: ads, mcp, ps, relay, r1… */
  wires: string[];
  parts?: [id: string, type: string, x: number, y: number, props?: Record<string, any>][];
  helpers?: ('ads' | 'mcp' | 'ps' | 'relay')[];
  /** props of the documented part */
  props?: Record<string, any>;
  /** props of helper parts, keyed by id (e.g. ps volts) */
  helperProps?: Record<string, Record<string, any>>;
  piProps?: Record<string, any>;
  at?: [number, number];
  expect: RegExp;
  seconds?: number;
  events?: { at: number; comp?: string; props?: Record<string, any>; press?: boolean }[];
  verify?: (sim: Simulator) => string | null;
  /** run in the browser only (needs real-time polling) */
  noAutoTest?: boolean;
}

const vis = (s: Simulator, id: string) => s.vis.get(id) ?? {};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const I2C = ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.SCL>pi.P5', 'dut.SDA>pi.P3'];
const ADC_A0 = (pin = 'AO', vcc = 'pi.P1', gnd = 'pi.P9') => [`dut.VCC>${vcc}`, `dut.GND>${gnd}`, `dut.${pin}>ads.A0`];
/** 10 kΩ / 20 kΩ divider from a 5 V-level output to ADS1115 A0 (×2/3) */
const DIVIDER = (from: string) => [`${from}>r1.1`, 'r1.2>ads.A0', 'r2.1>ads.A0', 'r2.2>pi.P25'];
const DIV_PARTS: PartExample['parts'] = [
  ['r1', 'resistor', 420, 420, { ohms: 10000 }],
  ['r2', 'resistor', 420, 480, { ohms: 20000 }],
];
const RELAY_LOAD = ['relay.COM1>ps.P', 'relay.NO1>dut.P', 'dut.N>ps.N'];
const relayCode = (what: string, cls = 'Relay') => `from smartfarm import ${cls}
from time import sleep

# most relay boards are active-LOW: IN1 = LOW switches the relay on
${what.toLowerCase().replace(/[^a-z]/g, '_')} = ${cls}(17, active_high=False)

${what.toLowerCase().replace(/[^a-z]/g, '_')}.on()
print("${what} ON")
sleep(2)
${what.toLowerCase().replace(/[^a-z]/g, '_')}.off()
print("${what} OFF")
`;
const relayVerify = (s: Simulator) => (vis(s, 'relay').ch?.[0]?.energised === false ? null : 'relay should be off at the end');

export const PART_EXAMPLES: Record<string, PartExample> = {
  // -------------------------------------------------------------- boards & basics
  rpi5: {
    title: 'Read the CPU temperature',
    code: `from gpiozero import CPUTemperature\n\ncpu = CPUTemperature()\nprint(f"CPU temperature: {cpu.temperature:.1f} °C")\n`,
    wires: [],
    expect: /CPU temperature: \d+\.\d °C/,
  },
  breadboard: {
    title: 'LED and resistor on a breadboard',
    code: `from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)\nfor i in range(3):\n    led.on()\n    print("LED on")\n    sleep(0.5)\n    led.off()\n    sleep(0.5)\n`,
    parts: [
      ['r1', 'resistor', 530, 330, { ohms: 330 }],
      ['led1', 'led', 600, 300, {}],
    ],
    at: [420, 300],
    wires: ['pi.P11>dut.a12', 'r1.1>dut.c12', 'r1.2>dut.c16', 'led1.A>dut.b16', 'led1.K>dut.b20', 'dut.a20>pi.P6'],
    expect: /LED on/,
    verify: (s) => (s.net.netOf({ comp: 'pi', pin: 'P11' }) === s.net.netOf({ comp: 'r1', pin: '1' }) ? null : 'breadboard columns should connect GPIO17 to R1'),
  },
  led: {
    title: 'Blink an LED (GPIO17 → 330 Ω → LED → GND)',
    code: `from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)\n\nfor i in range(3):\n    led.on()\n    print("LED on")\n    sleep(1)\n    led.off()\n    print("LED off")\n    sleep(1)\n`,
    parts: [['r1', 'resistor', 420, 330, { ohms: 330 }]],
    wires: ['pi.P11>r1.1', 'r1.2>dut.A', 'dut.K>pi.P6'],
    expect: /LED on[\s\S]*LED off/,
  },
  rgb_led: {
    title: 'Cycle colours on a common-cathode RGB LED',
    code: `from gpiozero import RGBLED\nfrom time import sleep\n\nrgb = RGBLED(red=17, green=27, blue=22)\nfor name, colour in [("red", (1, 0, 0)), ("green", (0, 1, 0)), ("blue", (0, 0, 1))]:\n    rgb.color = colour\n    print("colour:", name)\n    sleep(1)\nrgb.off()\n`,
    parts: [
      ['r1', 'resistor', 420, 300, { ohms: 330 }],
      ['r2', 'resistor', 420, 340, { ohms: 330 }],
      ['r3', 'resistor', 420, 380, { ohms: 330 }],
    ],
    wires: ['pi.P11>r1.1', 'r1.2>dut.R', 'pi.P13>r2.1', 'r2.2>dut.G', 'pi.P15>r3.1', 'r3.2>dut.B', 'dut.COM>pi.P14'],
    expect: /colour: red[\s\S]*colour: blue/,
  },
  resistor: {
    title: 'Voltage divider measured with an ADS1115',
    code: `from smartfarm import ADS1115\n\nadc = ADS1115()\nprint(f"divider output: {adc.voltage(0):.2f} V")\n`,
    helpers: ['ads'],
    parts: [['r2', 'resistor', 420, 420, { ohms: 10000 }]],
    props: { ohms: 10000 },
    wires: ['pi.P17>dut.1', 'dut.2>ads.A0', 'r2.1>ads.A0', 'r2.2>pi.P20'],
    expect: /divider output: 1\.6\d V/,
  },
  capacitor: {
    title: 'A capacitor blocks DC (functional model)',
    code: `from smartfarm import ADS1115\n\nadc = ADS1115()\n# in steady state no DC current flows through the capacitor: the node sits at 3.3 V\nprint(f"node voltage: {adc.voltage(0):.2f} V")\n`,
    helpers: ['ads'],
    parts: [['r1', 'resistor', 420, 360, { ohms: 10000 }]],
    wires: ['pi.P17>r1.1', 'r1.2>ads.A0', 'r1.2>dut.P', 'dut.N>pi.P20'],
    expect: /node voltage: 3\.\d\d V/,
  },
  button: {
    title: 'Read a push button (internal pull-up)',
    code: `from gpiozero import Button\nfrom time import sleep\n\nbutton = Button(17)          # GPIO17 with the internal pull-up\nfor i in range(4):\n    print("pressed:", button.is_pressed)\n    sleep(0.5)\n`,
    wires: ['dut.1a>pi.P11', 'dut.2a>pi.P9'],
    expect: /pressed: False[\s\S]*pressed: True/,
    events: [{ at: 1.2, press: true }],
  },
  switch: {
    title: 'Read a slide switch',
    code: `from gpiozero import DigitalInputDevice\n\nsw = DigitalInputDevice(17, pull_up=True)\nprint("switch on side A:", sw.value == 1)\n`,
    props: { position: 'A' },
    wires: ['dut.COM>pi.P11', 'dut.A>pi.P9'],
    expect: /switch on side A: True/,
  },
  potentiometer: {
    title: 'Potentiometer on an ADC channel',
    code: `from smartfarm import ADS1115\n\nadc = ADS1115()\nprint(f"wiper: {adc.voltage(0):.2f} V")\n`,
    helpers: ['ads'],
    props: { position: 50 },
    wires: ['dut.A>pi.P17', 'dut.B>pi.P20', 'dut.W>ads.A0'],
    expect: /wiper: 1\.[56]\d V/,
  },
  buzzer: {
    title: 'Beep an active buzzer',
    code: `from gpiozero import Buzzer\nfrom time import sleep\n\nbz = Buzzer(18)\nbz.on()\nprint("buzzer on")\nsleep(0.5)\nbz.off()\nprint("buzzer off")\n`,
    wires: ['dut.P>pi.P12', 'dut.N>pi.P14'],
    expect: /buzzer on[\s\S]*buzzer off/,
  },
  diode: {
    title: 'Diode in series with an LED (reverse-polarity protection)',
    code: `from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)\nled.on()\nprint("LED through diode: on")\nsleep(1)\n`,
    parts: [
      ['r1', 'resistor', 480, 300, { ohms: 220 }],
      ['led1', 'led', 600, 300, {}],
    ],
    wires: ['pi.P11>dut.A', 'dut.K>r1.1', 'r1.2>led1.A', 'led1.K>pi.P6'],
    expect: /on/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.1 ? null : 'LED should light through the diode'),
  },
  npn: {
    title: 'NPN transistor switching an LED from 5 V',
    code: `from gpiozero import OutputDevice\nfrom time import sleep\n\nq = OutputDevice(17)\nq.on()\nprint("transistor on")\nsleep(1)\n`,
    parts: [
      ['rb', 'resistor', 420, 360, { ohms: 1000 }],
      ['rc', 'resistor', 540, 260, { ohms: 330 }],
      ['led1', 'led', 620, 240, {}],
    ],
    wires: ['pi.P11>rb.1', 'rb.2>dut.B', 'dut.E>pi.P14', 'pi.P2>rc.1', 'rc.2>led1.A', 'led1.K>dut.C'],
    expect: /transistor on/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.1 ? null : 'LED should be on while the base is driven'),
  },
  pnp: {
    title: 'PNP high-side switch (LOW = on)',
    code: `from gpiozero import OutputDevice\nfrom time import sleep\n\nq = OutputDevice(17, active_high=False)   # base pulled LOW turns the PNP on\nq.on()\nprint("PNP on")\nsleep(1)\n`,
    parts: [
      ['rb', 'resistor', 420, 360, { ohms: 1000 }],
      ['rc', 'resistor', 560, 420, { ohms: 330 }],
      ['led1', 'led', 640, 400, {}],
    ],
    wires: ['pi.P11>rb.1', 'rb.2>dut.B', 'dut.E>pi.P1', 'dut.C>rc.1', 'rc.2>led1.A', 'led1.K>pi.P6'],
    expect: /PNP on/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.05 ? null : 'LED should light'),
  },
  mosfet: {
    title: 'Logic-level MOSFET: PWM speed control of a 12 V fan',
    code: `from gpiozero import PWMOutputDevice\nfrom time import sleep\n\nfan = PWMOutputDevice(18, frequency=1000)\nfan.value = 0.6\nprint("fan at 60 %")\nsleep(2)\n`,
    helpers: ['ps'],
    parts: [
      ['rg', 'resistor', 420, 420, { ohms: 100 }],
      ['fan1', 'fan', 700, 260, { vrated: 12 }],
      ['d1', 'diode', 640, 360, {}],
    ],
    wires: ['pi.P12>rg.1', 'rg.2>dut.G', 'dut.S>pi.P14', 'ps.N>pi.P39', 'ps.P>fan1.P', 'fan1.N>dut.D', 'd1.K>fan1.P', 'd1.A>fan1.N'],
    expect: /fan at 60 %/,
    verify: (s) => (near(vis(s, 'fan1').run ?? 0, 0.6, 0.2) ? null : `fan run ${(vis(s, 'fan1').run ?? 0).toFixed(2)} should be ≈0.6`),
  },
  power_supply: {
    title: '12 V supply powering a pump through a relay',
    code: relayCode('Pump', 'Pump'),
    helpers: ['relay'],
    parts: [['pump1', 'water_pump', 840, 260, { vrated: 12 }]],
    wires: ['relay.COM1>dut.P', 'relay.NO1>pump1.P', 'pump1.N>dut.N'],
    expect: /Pump ON[\s\S]*Pump OFF/,
  },
  relay_module: {
    title: 'Switch a 12 V pump with an active-LOW relay',
    code: relayCode('Pump', 'Pump'),
    helpers: ['ps'],
    parts: [['pump1', 'water_pump', 840, 240, { vrated: 12 }]],
    at: [600, 80],
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P14', 'dut.IN1>pi.P11', 'dut.COM1>ps.P', 'dut.NO1>pump1.P', 'pump1.N>ps.N'],
    expect: /Pump ON[\s\S]*Pump OFF/,
    verify: (s) => (vis(s, 'dut').ch?.[0]?.energised === false ? null : 'relay should be off at the end'),
  },
  water_pump: { title: 'Pump on/off with a relay', code: relayCode('Pump', 'Pump'), helpers: ['relay', 'ps'], wires: RELAY_LOAD, expect: /Pump ON[\s\S]*Pump OFF/, verify: relayVerify },
  dosing_pump: {
    title: 'Dose 5 ml with a peristaltic pump',
    code: `from smartfarm import DosingPump\n\npump = DosingPump(17, flow_ml_per_min=100)   # active-LOW relay\npump.dose(5)                                  # 5 ml → 3 s\nprint("dosed 5 ml")\n`,
    helpers: ['relay', 'ps'],
    wires: RELAY_LOAD,
    expect: /dosed 5 ml/,
    seconds: 8,
  },
  solenoid_valve: { title: 'Open a 12 V solenoid valve', code: relayCode('Valve', 'Valve'), helpers: ['relay', 'ps'], wires: RELAY_LOAD, expect: /Valve ON[\s\S]*Valve OFF/, verify: relayVerify },
  fan: { title: 'Ventilation fan on a relay', code: relayCode('Fan', 'Fan'), helpers: ['relay', 'ps'], wires: RELAY_LOAD, expect: /Fan ON[\s\S]*Fan OFF/, verify: relayVerify },
  dc_motor: {
    title: 'DC motor forwards/backwards with an L298N',
    code: `from smartfarm import DCMotor\nfrom time import sleep\n\nmotor = DCMotor(forward=23, backward=24)\nmotor.forward()\nprint("forward")\nsleep(1)\nmotor.backward()\nprint("backward")\nsleep(1)\nmotor.stop()\n`,
    helpers: ['ps'],
    parts: [['drv', 'l298n', 600, 60, {}]],
    props: { vrated: 12 },
    wires: ['drv.VS>ps.P', 'drv.GND>ps.N', 'ps.N>pi.P39', 'drv.IN1>pi.P16', 'drv.IN2>pi.P18', 'drv.OUT1>dut.P', 'drv.OUT2>dut.N'],
    expect: /forward[\s\S]*backward/,
  },
  heater: { title: 'Heater on a relay', code: relayCode('Heater', 'Heater'), helpers: ['relay', 'ps'], helperProps: { ps: { amps: 10 } }, wires: RELAY_LOAD, expect: /Heater ON[\s\S]*Heater OFF/, verify: relayVerify },
  humidifier: { title: 'Humidifier on a relay', code: relayCode('Humidifier', 'Humidifier'), helpers: ['relay', 'ps'], helperProps: { ps: { volts: 5 } }, wires: RELAY_LOAD, expect: /Humidifier ON[\s\S]*Humidifier OFF/, verify: relayVerify },
  grow_light: {
    title: 'Dim a 12 V grow light with PWM through a MOSFET',
    code: `from smartfarm import GrowLight\nfrom time import sleep\n\nlight = GrowLight(18)      # logic-level MOSFET on GPIO18\nlight.on(0.5)\nprint("grow light 50 %")\nsleep(2)\n`,
    helpers: ['ps'],
    parts: [
      ['q1', 'mosfet', 560, 420, {}],
      ['rg', 'resistor', 440, 440, { ohms: 100 }],
    ],
    wires: ['pi.P12>rg.1', 'rg.2>q1.G', 'q1.S>pi.P14', 'ps.N>pi.P39', 'ps.P>dut.P', 'dut.N>q1.D'],
    expect: /grow light 50 %/,
    verify: (s) => (near(vis(s, 'dut').run ?? 0, 0.5, 0.2) ? null : 'light should run at ~50 %'),
  },
  servo: {
    title: 'Move a servo to −45°, 0° and +45°',
    code: `from smartfarm import Servo\nfrom time import sleep\n\ns = Servo(18)\nfor a in (-45, 0, 45):\n    s.angle = a\n    print("angle", a)\n    sleep(0.8)\n`,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.SIG>pi.P12'],
    expect: /angle 45/,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 45, 3) ? null : `servo angle ${vis(s, 'dut').angle}`),
  },
  // -------------------------------------------------------------- environmental sensors
  dht22: {
    title: 'Read temperature and humidity (value changes while running)',
    code: `import time\nimport board\nimport adafruit_dht\n\ndht = adafruit_dht.DHT22(board.D4)   # DATA on GPIO4 (pin 7)\n\nfor i in range(3):\n    try:\n        print(f"Temperature: {dht.temperature:.1f} °C  Humidity: {dht.humidity:.1f} %")\n    except RuntimeError as e:\n        print("read error:", e)\n    time.sleep(2.5)\n`,
    wires: ['dut.VCC>pi.P1', 'dut.DATA>pi.P7', 'dut.GND>pi.P9'],
    props: { temperature: 25, humidity: 60 },
    expect: /Temperature: 25\.0 °C[\s\S]*Temperature: 31\.5 °C/,
    events: [{ at: 4, props: { temperature: 31.5 } }],
    seconds: 9,
  },
  dht11: {
    title: 'DHT11 whole-number readings',
    code: `import board\nimport adafruit_dht\n\ndht = adafruit_dht.DHT11(board.D4)\nprint("T =", dht.temperature, "°C  RH =", dht.humidity, "%")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.DATA>pi.P7', 'dut.GND>pi.P9'],
    props: { temperature: 23.6, humidity: 48 },
    expect: /T = 24 °C\s+RH = 48 %/,
  },
  am2302: {
    title: 'AM2302 (wired DHT22) via smartfarm',
    code: `from smartfarm import AM2302\n\nsensor = AM2302(4)\nt, h = sensor.read()\nprint(f"{t:.1f} °C, {h:.1f} %RH")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.DATA>pi.P7', 'dut.GND>pi.P9'],
    expect: /25\.0 °C, 60\.0 %RH/,
  },
  bme280: {
    title: 'BME280 temperature, humidity and pressure (RPi.bme280)',
    code: `import smbus2\nimport bme280\n\nbus = smbus2.SMBus(1)\ncal = bme280.load_calibration_params(bus, 0x76)\nd = bme280.sample(bus, 0x76, cal)\nprint(f"T {d.temperature:.1f} °C  RH {d.humidity:.1f} %  P {d.pressure:.1f} hPa")\n`,
    wires: I2C,
    expect: /T 24\.0 °C\s+RH 55\.0 %\s+P 1013\.\d hPa/,
  },
  bmp280: {
    title: 'BMP280 pressure (adafruit_bmp280)',
    code: `import board, busio\nimport adafruit_bmp280\n\ni2c = busio.I2C(board.SCL, board.SDA)\nbmp = adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=0x76)\nprint(f"T {bmp.temperature:.1f} °C  P {bmp.pressure:.1f} hPa  alt {bmp.altitude:.0f} m")\n`,
    wires: I2C,
    expect: /T 24\.0 °C\s+P 1013\.\d hPa/,
  },
  sht31: {
    title: 'SHT31 (adafruit_sht31d)',
    code: `import board, busio\nimport adafruit_sht31d\n\ni2c = busio.I2C(board.SCL, board.SDA)\nsht = adafruit_sht31d.SHT31D(i2c)\nprint(f"T {sht.temperature:.1f} °C  RH {sht.relative_humidity:.1f} %")\n`,
    wires: I2C,
    expect: /T 24\.0 °C\s+RH 55\.0 %/,
  },
  sht35: {
    title: 'SHT35 via smartfarm',
    code: `from smartfarm import SHT31\n\nt, h = SHT31(address=0x44).read()\nprint(f"T {t:.1f} °C  RH {h:.1f} %")\n`,
    wires: I2C,
    expect: /T 24\.0 °C\s+RH 55\.0 %/,
  },
  scd30: {
    title: 'SCD30 CO₂ (adafruit_scd30)',
    code: `import time\nimport board, busio\nimport adafruit_scd30\n\nscd = adafruit_scd30.SCD30(busio.I2C(board.SCL, board.SDA))\nwhile not scd.data_available:\n    time.sleep(0.5)\nprint(f"CO2 {scd.CO2:.0f} ppm  T {scd.temperature:.1f} °C  RH {scd.relative_humidity:.0f} %")\n`,
    wires: I2C,
    expect: /CO2 650 ppm\s+T 24\.0 °C\s+RH 55 %/,
    seconds: 8,
  },
  scd40: {
    title: 'SCD40 CO₂ (adafruit_scd4x)',
    code: `import time\nimport board, busio\nimport adafruit_scd4x\n\nscd = adafruit_scd4x.SCD4X(busio.I2C(board.SCL, board.SDA))\nscd.start_periodic_measurement()\nwhile not scd.data_ready:\n    time.sleep(1)\nprint(f"CO2 {scd.CO2} ppm  T {scd.temperature:.1f} °C")\n`,
    wires: I2C,
    expect: /CO2 650 ppm\s+T 24\.0 °C/,
    seconds: 12,
  },
  ccs811: {
    title: 'CCS811 eCO₂/TVOC (WAK tied to GND)',
    code: `import time\nimport board, busio\nimport adafruit_ccs811\n\nccs = adafruit_ccs811.CCS811(busio.I2C(board.SCL, board.SDA))\nwhile not ccs.data_ready:\n    time.sleep(0.2)\nprint(f"eCO2 {ccs.eco2} ppm  TVOC {ccs.tvoc} ppb")\n`,
    wires: [...I2C, 'dut.WAK>pi.P14'],
    expect: /eCO2 450 ppm\s+TVOC 30 ppb/,
  },
  bme680: {
    title: 'BME680 (adafruit_bme680)',
    code: `import board, busio\nimport adafruit_bme680\n\nbme = adafruit_bme680.Adafruit_BME680_I2C(busio.I2C(board.SCL, board.SDA))\nprint(f"T {bme.temperature:.1f} °C  RH {bme.relative_humidity:.1f} %  gas {bme.gas} Ω")\n`,
    wires: I2C,
    expect: /T 24\.0 °C\s+RH 55\.0 %\s+gas 50000 Ω/,
  },
  tsl2561: {
    title: 'TSL2561 lux (adafruit_tsl2561)',
    code: `import board, busio\nimport adafruit_tsl2561\n\ntsl = adafruit_tsl2561.TSL2561(busio.I2C(board.SCL, board.SDA))\nprint(f"lux: {tsl.lux:.0f}")\n`,
    wires: I2C,
    expect: /lux: (29[5-9]|30[0-5])/,
  },
  bh1750: {
    title: 'BH1750 lux (smbus2)',
    code: `from smartfarm import BH1750\n\nprint(f"light: {BH1750().read():.0f} lux")\n`,
    wires: I2C,
    expect: /light: 300 lux/,
  },
  mhz19b: {
    title: 'MH-Z19B CO₂ over UART',
    code: `from smartfarm import MHZ19\n\nprint("CO2:", MHZ19().read(), "ppm")\n`,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.TX>pi.P10', 'dut.RX>pi.P8'],
    expect: /CO2: 650 ppm/,
  },
  pms5003: {
    title: 'PMS5003 particulate matter (adafruit_pm25)',
    code: `from smartfarm import PMS5003\n\npm1, pm25, pm10 = PMS5003().read()\nprint(f"PM1.0 {pm1}  PM2.5 {pm25}  PM10 {pm10} µg/m³")\n`,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.TX>pi.P10', 'dut.RX>pi.P8'],
    expect: /PM1\.0 8\s+PM2\.5 12\s+PM10 18/,
    seconds: 5,
  },
  lm35: {
    title: 'LM35 on an ADS1115 (powered from 5 V)',
    code: `from smartfarm import ADS1115, LM35\n\nt = LM35(ADS1115(), channel=0).read()\nprint(f"LM35: {t:.1f} °C")\n`,
    helpers: ['ads'],
    wires: ADC_A0('AO', 'pi.P2', 'pi.P6'),
    expect: /LM35: 25\.0 °C/,
  },
  tmp36: {
    title: 'TMP36 on an ADS1115',
    code: `from smartfarm import ADS1115, TMP36\n\nprint(f"TMP36: {TMP36(ADS1115(), 0).read():.1f} °C")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /TMP36: 25\.0 °C/,
  },
  ntc: {
    title: 'NTC thermistor in a 10 kΩ divider',
    code: `from smartfarm import ADS1115, Thermistor\n\n# 3.3 V — 10 kΩ — A0 — NTC — GND\nntc = Thermistor(ADS1115(), channel=0, r_fixed=10000, r25=10000, beta=3950)\nprint(f"NTC: {ntc.read():.1f} °C")\n`,
    helpers: ['ads'],
    parts: [['r1', 'resistor', 420, 380, { ohms: 10000 }]],
    wires: ['pi.P17>r1.1', 'r1.2>ads.A0', 'dut.1>ads.A0', 'dut.2>pi.P20'],
    expect: /NTC: 25\.0 °C/,
  },
  pt1000: {
    title: 'PT1000 RTD in a 1 kΩ divider',
    code: `from smartfarm import ADS1115, RTD\n\nrtd = RTD(ADS1115(), channel=0, r0=1000, r_fixed=1000)\nprint(f"RTD: {rtd.read():.0f} °C")\n`,
    helpers: ['ads'],
    parts: [['r1', 'resistor', 420, 380, { ohms: 1000 }]],
    wires: ['pi.P17>r1.1', 'r1.2>ads.A0', 'dut.1>ads.A0', 'dut.2>pi.P20'],
    expect: /RTD: 2[45] °C/,
  },
  mq2: {
    title: 'MQ-2 analog output through a divider',
    code: `from smartfarm import ADS1115, MQSensor\n\nmq = MQSensor(ADS1115(), channel=0, model='mq2', divider=1.5)\nprint(f"MQ-2: {mq.read():.0f} ppm")\n`,
    helpers: ['ads'],
    parts: DIV_PARTS,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.AO')],
    expect: /MQ-2: (19\d|20\d|21\d) ppm/,
  },
  mq7: {
    title: 'MQ-7 CO through a divider',
    code: `from smartfarm import ADS1115, MQSensor\n\nprint(f"MQ-7: {MQSensor(ADS1115(), 0, model='mq7', divider=1.5).read():.0f} ppm")\n`,
    helpers: ['ads'],
    parts: DIV_PARTS,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.AO')],
    expect: /MQ-7: (1[89]|2[0-2]) ppm/,
  },
  mq135: {
    title: 'MQ-135 air quality through a divider',
    code: `from smartfarm import ADS1115, MQSensor\n\nprint(f"MQ-135: {MQSensor(ADS1115(), 0, model='mq135', divider=1.5).read():.0f} ppm")\n`,
    helpers: ['ads'],
    parts: DIV_PARTS,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.AO')],
    expect: /MQ-135: (4[3-6]\d) ppm/,
  },
  rain_sensor: {
    title: 'Rain detection (digital output)',
    code: `from smartfarm import RainSensor\n\nprint("raining:", RainSensor(17).raining)\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.DO>pi.P11'],
    expect: /raining: False/,
  },
  uv_sensor: {
    title: 'UV index (GUVA-S12SD)',
    code: `from smartfarm import ADS1115, UVSensor\n\nprint(f"UV index: {UVSensor(ADS1115(), 0).read():.1f}")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /UV index: 3\.0/,
  },
  ppfd_sensor: {
    title: 'PAR quantum sensor (PPFD)',
    code: `from smartfarm import ADS1115, PPFDSensor\n\nprint(f"PPFD: {PPFDSensor(ADS1115(), 0).read():.0f} µmol/m²/s")\n`,
    helpers: ['ads'],
    wires: ADC_A0('AO', 'pi.P2', 'pi.P6'),
    expect: /PPFD: 400 µmol/,
  },
  pir_sensor: {
    title: 'PIR motion detection',
    code: `from smartfarm import MotionSensor\nfrom time import sleep\n\npir = MotionSensor(17)\nfor i in range(4):\n    print("motion:", pir.motion)\n    sleep(0.5)\n`,
    wires: ['dut.VCC>pi.P2', 'dut.OUT>pi.P11', 'dut.GND>pi.P6'],
    expect: /motion: False[\s\S]*motion: True/,
    events: [{ at: 1.2, props: { motion: true } }],
  },
  ldr_module: {
    title: 'Light module digital output',
    code: `from gpiozero import DigitalInputDevice\n\ndo = DigitalInputDevice(17)\nprint("brighter than threshold:", do.value == 0)\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.DO>pi.P11'],
    expect: /brighter than threshold: False/,
  },
  // -------------------------------------------------------------- water & agriculture
  ds18b20: {
    title: 'DS18B20 water temperature (1-Wire on GPIO4)',
    code: `from w1thermsensor import W1ThermSensor\n\nsensor = W1ThermSensor()\nprint(f"Water temperature: {sensor.get_temperature():.2f} °C")\n`,
    parts: [['r1', 'resistor', 420, 420, { ohms: 4700 }]],
    piProps: { onewire: true },
    wires: ['dut.VCC>pi.P1', 'dut.DQ>pi.P7', 'dut.GND>pi.P9', 'r1.1>dut.DQ', 'r1.2>pi.P17'],
    expect: /Water temperature: 21\.00 °C/,
  },
  ph_sensor: {
    title: 'pH probe on an ADS1115',
    code: `from smartfarm import ADS1115, PHSensor\n\nph = PHSensor(ADS1115(), channel=0)\nprint(f"pH: {ph.read():.2f}")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /pH: 6\.(19|20|21)/,
  },
  ec_sensor: {
    title: 'EC probe on an ADS1115',
    code: `from smartfarm import ADS1115, ECSensor\n\nprint(f"EC: {ECSensor(ADS1115(), 0, temperature=25).read():.2f} mS/cm")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /EC: 1\.(19|20|21) mS\/cm/,
  },
  tds_sensor: {
    title: 'TDS meter on an ADS1115',
    code: `from smartfarm import ADS1115, TDSSensor\n\nprint(f"TDS: {TDSSensor(ADS1115(), 0).read():.0f} ppm")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /TDS: (59\d|60\d) ppm/,
  },
  turbidity_sensor: {
    title: 'Turbidity (5 V output divided down)',
    code: `from smartfarm import ADS1115, TurbiditySensor\n\nprint(f"Turbidity: {TurbiditySensor(ADS1115(), 0, divider=1.5).read():.0f} NTU")\n`,
    helpers: ['ads'],
    parts: DIV_PARTS,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.AO')],
    props: { ntu: 1000 },
    expect: /Turbidity: (9\d\d|10\d\d|11\d\d) NTU/,
  },
  do_sensor: {
    title: 'Dissolved oxygen probe',
    code: `from smartfarm import ADS1115, DOSensor\n\nprint(f"DO: {DOSensor(ADS1115(), 0, temperature=25).read():.1f} mg/L")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /DO: (7\.9|8\.0|8\.1) mg\/L/,
  },
  pressure_transducer: {
    title: 'Pipe pressure (0.5–4.5 V divided down)',
    code: `from smartfarm import ADS1115, PressureSensor\n\nprint(f"Pressure: {PressureSensor(ADS1115(), 0, range_kpa=1200, divider=1.5).read():.0f} kPa")\n`,
    helpers: ['ads'],
    parts: DIV_PARTS,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.AO')],
    expect: /Pressure: (9[5-9]|10[0-5]) kPa/,
  },
  soil_moisture: {
    title: 'Capacitive soil moisture',
    code: `from smartfarm import ADS1115, SoilMoisture\n\nprint(f"Soil moisture: {SoilMoisture(ADS1115(), 0).read():.0f} %")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /Soil moisture: (4[4-6]) %/,
  },
  soil_resistive: {
    title: 'Resistive soil probe (digital output)',
    code: `from gpiozero import DigitalInputDevice\n\ndo = DigitalInputDevice(17)\nprint("soil wetter than threshold:", do.value == 0)\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.DO>pi.P11'],
    expect: /soil wetter than threshold: False/,
  },
  water_level_analog: {
    title: 'Analog water level',
    code: `from smartfarm import ADS1115, WaterLevel\n\nprint(f"Level: {WaterLevel(ADS1115(), 0).read():.0f} %")\n`,
    helpers: ['ads'],
    wires: ADC_A0(),
    expect: /Level: 75 %/,
  },
  hcsr04: {
    title: 'Ultrasonic tank level (ECHO through a 1 k/2 k divider)',
    code: `from smartfarm import Ultrasonic\n\nus = Ultrasonic(trigger=23, echo=24)\nprint(f"distance: {us.read():.1f} cm")\n`,
    parts: [
      ['r1', 'resistor', 420, 420, { ohms: 1000 }],
      ['r2', 'resistor', 420, 480, { ohms: 2000 }],
    ],
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.TRIG>pi.P16', 'dut.ECHO>r1.1', 'r1.2>pi.P18', 'r2.1>pi.P18', 'r2.2>pi.P20'],
    expect: /distance: 25\.0 cm/,
  },
  float_switch: {
    title: 'Float switch (low-water detection)',
    code: `from smartfarm import FloatSwitch\n\nprint("contact closed:", FloatSwitch(27).is_closed)\n`,
    wires: ['dut.1>pi.P13', 'dut.2>pi.P14'],
    expect: /contact closed: True/,
  },
  overflow_switch: {
    title: 'Overflow switch (open until the water reaches it)',
    code: `from smartfarm import FloatSwitch\n\nprint("overflow:", FloatSwitch(27).is_closed)\n`,
    wires: ['dut.1>pi.P13', 'dut.2>pi.P14'],
    expect: /overflow: False/,
  },
  flow_sensor: {
    title: 'YF-S201 flow rate',
    code: `from smartfarm import FlowMeter\n\nflow = FlowMeter(17)\nprint(f"flow: {flow.flow_lpm(window=2):.1f} L/min")\n`,
    props: { flow: 6 },
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.SIG>pi.P11'],
    expect: /flow: (5\.9|6\.0|6\.1) L\/min/,
    seconds: 5,
  },
  leak_sensor: {
    title: 'Leak detection',
    code: `from smartfarm import LeakSensor\n\nprint("water detected:", LeakSensor(17).wet)\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.DO>pi.P11'],
    expect: /water detected: False/,
  },
  acs712: {
    title: 'Pump current feedback with an ACS712',
    code: `from smartfarm import ADS1115, CurrentSensor\n\ncs = CurrentSensor(ADS1115(), 0, divider=1.5)\nprint(f"pump current: {cs.read():.2f} A")\n`,
    helpers: ['ads', 'ps'],
    parts: [...DIV_PARTS!, ['pump1', 'water_pump', 820, 260, { vrated: 12 }]],
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', ...DIVIDER('dut.OUT'), 'ps.P>dut.IPP', 'dut.IPN>pump1.P', 'pump1.N>ps.N', 'ps.N>pi.P39'],
    expect: /pump current: 0\.(4\d|5[0-5]) A/,
  },
  rs485_soil: {
    title: 'RS-485 Modbus soil probe through a MAX485 (auto-direction)',
    code: `from smartfarm import ModbusSoilSensor\n\nprobe = ModbusSoilSensor(baud=9600)\nr = probe.read()\nprint(f"moisture {r['moisture']} %  temp {r['temperature']} °C  EC {r['ec']}  pH {r['ph']}  NPK {r['n']}/{r['p']}/{r['k']}")\n`,
    helpers: ['ps'],
    parts: [['xcvr', 'max485', 560, 80, { auto: true }]],
    wires: ['xcvr.VCC>pi.P1', 'xcvr.GND>pi.P6', 'xcvr.TX>pi.P10', 'xcvr.RX>pi.P8', 'xcvr.A>dut.A', 'xcvr.B>dut.B', 'dut.VCC>ps.P', 'dut.GND>ps.N', 'ps.N>pi.P39'],
    expect: /moisture 32\.0 %\s+temp 22\.0 °C\s+EC 800\s+pH 6\.5\s+NPK 40\/20\/60/,
  },
  // -------------------------------------------------------------- ADC & expanders
  mcp3008: {
    title: 'MCP3008 reading a potentiometer',
    code: `from gpiozero import MCP3008\n\npot = MCP3008(channel=0)\nprint(f"CH0: {pot.voltage:.2f} V")\n`,
    parts: [['pot', 'potentiometer', 420, 420, { position: 50 }]],
    at: [500, 80],
    wires: ['dut.VDD>pi.P17', 'dut.VREF>pi.P17', 'dut.AGND>pi.P20', 'dut.DGND>pi.P25', 'dut.CLK>pi.P23', 'dut.DOUT>pi.P21', 'dut.DIN>pi.P19', 'dut.CS>pi.P24', 'pot.A>pi.P17', 'pot.B>pi.P20', 'pot.W>dut.CH0'],
    expect: /CH0: 1\.6\d V/,
  },
  ads1115: {
    title: 'ADS1115 with a potentiometer (adafruit_ads1x15)',
    code: `import board, busio\nimport adafruit_ads1x15.ads1115 as ADS\nfrom adafruit_ads1x15.analog_in import AnalogIn\n\nads = ADS.ADS1115(busio.I2C(board.SCL, board.SDA))\nchan = AnalogIn(ads, ADS.P0)\nprint(f"A0: raw {chan.value}  {chan.voltage:.3f} V")\n`,
    parts: [['pot', 'potentiometer', 420, 420, { position: 75 }]],
    wires: ['dut.VDD>pi.P1', 'dut.GND>pi.P9', 'dut.SCL>pi.P5', 'dut.SDA>pi.P3', 'pot.A>pi.P17', 'pot.B>pi.P20', 'pot.W>dut.A0'],
    expect: /A0: raw \d+\s+0\.8\d\d V/,
  },
  pcf8574: {
    title: 'PCF8574 sinking an LED on P0',
    code: `from smbus2 import SMBus\n\nbus = SMBus(1)\nbus.write_byte(0x20, 0xFE)        # P0 LOW → LED on, others released\nprint("PCF8574 port:", hex(bus.read_byte(0x20)))\n`,
    parts: [
      ['r1', 'resistor', 420, 320, { ohms: 330 }],
      ['led1', 'led', 400, 240, {}],
    ],
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5', 'pi.P17>r1.1', 'r1.2>led1.A', 'led1.K>dut.P0'],
    expect: /PCF8574 port: 0xfe/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.1 ? null : 'LED on P0 should light'),
  },
  mcp23017: {
    title: 'MCP23017 output GPA0 driving an LED',
    code: `import board, busio\nfrom adafruit_mcp230xx.mcp23017 import MCP23017\n\nmcp = MCP23017(busio.I2C(board.SCL, board.SDA))\nled = mcp.get_pin(0)\nled.switch_to_output(value=True)\nprint("GPA0 =", led.value)\n`,
    parts: [
      ['r1', 'resistor', 420, 330, { ohms: 330 }],
      ['led1', 'led', 520, 320, {}],
    ],
    at: [480, 120],
    wires: ['dut.VDD>pi.P1', 'dut.VSS>pi.P9', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5', 'dut.GPA0>r1.1', 'r1.2>led1.A', 'led1.K>pi.P14'],
    expect: /GPA0 = True/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.1 ? null : 'LED on GPA0 should light'),
  },
  tca9548a: {
    title: 'Two SHT31 with the same address behind a TCA9548A',
    code: `import board, busio\nimport adafruit_tca9548a, adafruit_sht31d\n\ntca = adafruit_tca9548a.TCA9548A(busio.I2C(board.SCL, board.SDA))\ninside = adafruit_sht31d.SHT31D(tca[0])\noutside = adafruit_sht31d.SHT31D(tca[1])\nprint(f"inside {inside.temperature:.1f} °C, outside {outside.temperature:.1f} °C")\n`,
    parts: [
      ['s1', 'sht31', 500, 300, { temperature: 24 }],
      ['s2', 'sht31', 620, 300, { temperature: 31 }],
    ],
    at: [480, 120],
    wires: ['dut.VIN>pi.P1', 'dut.GND>pi.P9', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5', 's1.VCC>pi.P17', 's1.GND>pi.P20', 's1.SDA>dut.SD0', 's1.SCL>dut.SC0', 's2.VCC>pi.P17', 's2.GND>pi.P25', 's2.SDA>dut.SD1', 's2.SCL>dut.SC1'],
    expect: /inside 24\.0 °C, outside 31\.0 °C/,
  },
  ds3231: {
    title: 'Set and read the DS3231 clock',
    code: `import time\nimport board, busio\nimport adafruit_ds3231\n\nrtc = adafruit_ds3231.DS3231(busio.I2C(board.SCL, board.SDA))\nrtc.datetime = time.struct_time((2026, 5, 1, 12, 30, 0, 4, -1, -1))\ntime.sleep(2)\nt = rtc.datetime\nprint(f"RTC: {t.tm_year}-{t.tm_mon:02d}-{t.tm_mday:02d} {t.tm_hour:02d}:{t.tm_min:02d}:{t.tm_sec:02d}  board {rtc.temperature:.2f} °C")\n`,
    wires: I2C,
    expect: /RTC: 2026-05-01 12:30:0[12]\s+board 25\.00 °C/,
  },
  at24c32: {
    title: 'Store and read back bytes in an EEPROM',
    code: `from smartfarm import EEPROM\n\nee = EEPROM(0x50)\nee.write(0x0100, b"pi5-farm")\nprint("EEPROM:", ee.read(0x0100, 8).decode())\n`,
    wires: I2C,
    expect: /EEPROM: pi5-farm/,
  },
  sd_module: {
    title: 'Wiring reference only',
    code: `# The SPI micro-SD module is VISUAL ONLY in the simulator (no SD protocol / file system).\n# On a Raspberry Pi, store data on the boot card instead:\nwith open("log.csv", "a") as f:\n    f.write("time,temperature\\n")\nprint("data written to log.csv")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P20', 'dut.MISO>pi.P21', 'dut.MOSI>pi.P19', 'dut.SCK>pi.P23', 'dut.CS>pi.P24'],
    expect: /data written/,
  },
  // -------------------------------------------------------------- logic & ICs
  hc595: {
    title: 'Drive 8 outputs with a 74HC595',
    code: `from smartfarm import ShiftRegister\n\nsr = ShiftRegister(data=17, clock=27, latch=22)\nsr.write(0b00000001)\nprint("Q0 HIGH, Q1..Q7 LOW")\n`,
    parts: [
      ['r1', 'resistor', 540, 400, { ohms: 330 }],
      ['led1', 'led', 640, 380, {}],
    ],
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.DS>pi.P11', 'dut.SHCP>pi.P13', 'dut.STCP>pi.P15', 'dut.MR>pi.P17', 'dut.OE>pi.P20', 'dut.Q0>r1.1', 'r1.2>led1.A', 'led1.K>pi.P25'],
    expect: /Q0 HIGH/,
    verify: (s) => (vis(s, 'dut').latch === 1 && (vis(s, 'led1').brightness ?? 0) > 0.1 ? null : `latch ${vis(s, 'dut').latch}`),
  },
  hc08: gateExample('AND', (a, b) => a & b),
  hc32: gateExample('OR', (a, b) => a | b),
  hc86: gateExample('XOR', (a, b) => a ^ b),
  hc04: {
    title: 'Inverter truth table',
    code: `from gpiozero import OutputDevice, DigitalInputDevice\nfrom time import sleep\n\na = OutputDevice(17)\ny = DigitalInputDevice(22)\nfor v in (0, 1):\n    a.value = v\n    sleep(0.05)\n    print(f"NOT {v} -> {y.value}")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.1A>pi.P11', 'dut.1Y>pi.P15'],
    expect: /NOT 0 -> 1[\s\S]*NOT 1 -> 0/,
  },
  pc817: {
    title: 'Optocoupler: GPIO17 controls an isolated input on GPIO22',
    code: `from gpiozero import OutputDevice, DigitalInputDevice\nfrom time import sleep\n\nled = OutputDevice(17)\nout = DigitalInputDevice(22, pull_up=True)\nled.on()\nsleep(0.05)\nprint("output transistor conducting:", out.value == 1)\n`,
    parts: [['r1', 'resistor', 420, 360, { ohms: 470 }]],
    wires: ['pi.P11>r1.1', 'r1.2>dut.A', 'dut.K>pi.P14', 'dut.C>pi.P15', 'dut.E>pi.P20'],
    expect: /conducting: True/,
  },
  level_shifter: {
    title: '3.3 V → 5 V level shifting',
    code: `from gpiozero import OutputDevice\nfrom time import sleep\n\nsig = OutputDevice(17)\nsig.on()\nprint("LV1 HIGH → HV1 at 5 V")\nsleep(0.5)\n`,
    wires: ['dut.LV>pi.P1', 'dut.HV>pi.P2', 'dut.GND>pi.P6', 'dut.LV1>pi.P11'],
    expect: /HV1 at 5 V/,
    verify: (s) => {
      const n = s.net.netOf({ comp: 'dut', pin: 'HV1' });
      const v = n >= 0 ? s.netVoltage(n) ?? 0 : 0;
      return v > 4.5 ? null : `HV1 = ${v.toFixed(2)} V`;
    },
  },
  ams1117: {
    title: '5 V → 3.3 V with an AMS1117',
    code: `print("AMS1117 output powers the LED (see the Inspector for VOUT and heat)")\n`,
    helpers: ['ps'],
    helperProps: { ps: { volts: 5 } },
    parts: [
      ['r1', 'resistor', 620, 420, { ohms: 330 }],
      ['led1', 'led', 700, 400, {}],
    ],
    wires: ['ps.P>dut.VIN', 'ps.N>dut.GND', 'dut.VOUT>r1.1', 'r1.2>led1.A', 'led1.K>ps.N'],
    expect: /AMS1117/,
    verify: (s) => (near(vis(s, 'dut').vout ?? 0, 3.3, 0.1) ? null : `VOUT ${vis(s, 'dut').vout}`),
  },
  lm7805: {
    title: '12 V → 5 V with an LM7805',
    code: `print("LM7805 regulates 12 V down to 5 V")\n`,
    helpers: ['ps'],
    parts: [
      ['r1', 'resistor', 620, 420, { ohms: 470 }],
      ['led1', 'led', 700, 400, {}],
    ],
    wires: ['ps.P>dut.VIN', 'ps.N>dut.GND', 'dut.VOUT>r1.1', 'r1.2>led1.A', 'led1.K>ps.N'],
    expect: /LM7805/,
    verify: (s) => (near(vis(s, 'dut').vout ?? 0, 5, 0.1) ? null : `VOUT ${vis(s, 'dut').vout}`),
  },
  buck_converter: {
    title: '12 V → 5 V with a buck converter',
    code: `print("buck converter set to 5.0 V")\n`,
    helpers: ['ps'],
    parts: [
      ['r1', 'resistor', 640, 420, { ohms: 470 }],
      ['led1', 'led', 720, 400, {}],
    ],
    wires: ['ps.P>dut.INP', 'ps.N>dut.INN', 'dut.OUTP>r1.1', 'r1.2>led1.A', 'led1.K>dut.OUTN'],
    expect: /5\.0 V/,
    verify: (s) => (near(vis(s, 'dut').vout ?? 0, 5, 0.1) ? null : `VOUT ${vis(s, 'dut').vout}`),
  },
  mb102_psu: {
    title: 'Breadboard supply powering an LED from its 5 V rail',
    code: `print("MB102 left rail: 5 V")\n`,
    parts: [
      ['r1', 'resistor', 620, 420, { ohms: 470 }],
      ['led1', 'led', 700, 400, {}],
    ],
    wires: ['dut.L+>r1.1', 'r1.2>led1.A', 'led1.K>dut.L-'],
    expect: /5 V/,
    verify: (s) => ((vis(s, 'led1').brightness ?? 0) > 0.1 ? null : 'LED should light from the left rail'),
  },
  terminal_block: {
    title: 'Pump leads through screw terminals',
    code: relayCode('Pump', 'Pump'),
    helpers: ['relay', 'ps'],
    parts: [['pump1', 'water_pump', 900, 260, { vrated: 12 }]],
    wires: ['relay.COM1>ps.P', 'relay.NO1>dut.B1', 'dut.T1>pump1.P', 'pump1.N>dut.T2', 'dut.B2>ps.N'],
    expect: /Pump ON/,
  },
  dip_switch: {
    title: 'Read 4 configuration bits',
    code: `from gpiozero import Button\n\nbits = [Button(p) for p in (17, 27, 22, 23)]   # pull-ups; switch ON pulls to GND\nprint("DIP:", "".join("1" if b.is_pressed else "0" for b in bits))\n`,
    props: { sw1: true, sw3: true },
    wires: ['dut.1>pi.P11', 'dut.2>pi.P13', 'dut.3>pi.P15', 'dut.4>pi.P16', 'dut.8>pi.P9', 'dut.7>pi.P14', 'dut.6>pi.P20', 'dut.5>pi.P25'],
    expect: /DIP: 1010/,
  },
  ssr: {
    title: 'Solid-state relay switching a heater',
    code: `from smartfarm import Relay\nfrom time import sleep\n\nssr = Relay(17, active_high=True)\nssr.on()\nprint("SSR on")\nsleep(1)\n`,
    helpers: ['ps'],
    helperProps: { ps: { amps: 10 } },
    parts: [['heat', 'heater', 840, 260, { vrated: 12 }]],
    wires: ['pi.P11>dut.IN+', 'dut.IN->pi.P14', 'ps.P>dut.L1', 'dut.L2>heat.P', 'heat.N>ps.N'],
    expect: /SSR on/,
    verify: (s) => ((vis(s, 'heat').run ?? 0) > 0.5 ? null : 'heater should run'),
  },
  // -------------------------------------------------------------- motors & drivers
  pwm_fan: {
    title: '4-wire fan: 50 % PWM and tachometer',
    code: `from smartfarm import PWMFan\n\nfan = PWMFan(pwm=18, tach=24)\nfan.speed = 0.5\nprint(f"fan speed: {fan.rpm(window=2):.0f} rpm")\n`,
    helpers: ['ps'],
    parts: [['rt', 'resistor', 420, 420, { ohms: 10000 }]],
    wires: ['dut.V12>ps.P', 'dut.GND>ps.N', 'ps.N>pi.P39', 'dut.PWM>pi.P12', 'dut.TACH>pi.P18', 'rt.1>pi.P18', 'rt.2>pi.P17'],
    expect: /fan speed: 1[45]\d\d rpm/,
    seconds: 6,
  },
  sg90: {
    title: 'SG90 servo sweep',
    code: `from smartfarm import Servo\nfrom time import sleep\n\ns = Servo(18)\nfor a in (-90, 0, 90):\n    s.angle = a\n    print("angle", a)\n    sleep(0.6)\n`,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.SIG>pi.P12'],
    expect: /angle 90/,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 90, 3) ? null : `angle ${vis(s, 'dut').angle}`),
  },
  mg996r: {
    title: 'MG996R on its own 5 V supply',
    code: `from smartfarm import Servo\nfrom time import sleep\n\ns = Servo(18)\ns.angle = 30\nprint("angle 30")\nsleep(1)\n`,
    helpers: ['ps'],
    helperProps: { ps: { volts: 5 } },
    wires: ['dut.VCC>ps.P', 'dut.GND>ps.N', 'ps.N>pi.P39', 'dut.SIG>pi.P12'],
    expect: /angle 30/,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 30, 3) ? null : `angle ${vis(s, 'dut').angle}`),
  },
  stepper_28byj48: {
    title: 'Rotate a 28BYJ-48 by 90°',
    code: `from smartfarm import Stepper28BYJ\n\nm = Stepper28BYJ([17, 18, 27, 22], delay=0.002)\nm.rotate(90)\nprint("rotated 90°")\n`,
    wires: ['dut.IN1>pi.P11', 'dut.IN2>pi.P12', 'dut.IN3>pi.P13', 'dut.IN4>pi.P15', 'dut.VCC>pi.P2', 'dut.GND>pi.P6'],
    expect: /rotated 90°/,
    seconds: 6,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 90, 1) ? null : `angle ${vis(s, 'dut').angle}`),
  },
  a4988_nema17: {
    title: 'NEMA 17: 50 full steps = 90°',
    code: `from smartfarm import StepperDriver\n\nm = StepperDriver(step=20, dir=21)\nm.rotate(90)\nprint("rotated 90°")\n`,
    helpers: ['ps'],
    wires: ['dut.VDD>pi.P1', 'dut.GND>pi.P6', 'dut.STEP>pi.P38', 'dut.DIR>pi.P40', 'dut.RST>dut.SLP', 'dut.VMOT>ps.P', 'dut.GNDM>ps.N'],
    expect: /rotated 90°/,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 90, 0.5) ? null : `angle ${vis(s, 'dut').angle}`),
  },
  drv8825_nema17: {
    title: 'NEMA 17 with DRV8825',
    code: `from smartfarm import StepperDriver\n\nm = StepperDriver(step=20, dir=21)\nm.rotate(45)\nprint("rotated 45°")\n`,
    helpers: ['ps'],
    wires: ['dut.VDD>pi.P1', 'dut.GND>pi.P6', 'dut.STEP>pi.P38', 'dut.DIR>pi.P40', 'dut.RST>dut.SLP', 'dut.VMOT>ps.P', 'dut.GNDM>ps.N'],
    expect: /rotated 45°/,
    verify: (s) => (near(vis(s, 'dut').angle ?? 0, 45, 1) ? null : `angle ${vis(s, 'dut').angle}`),
  },
  l298n: {
    title: 'L298N driving a 12 V DC motor',
    code: `from smartfarm import DCMotor\nfrom time import sleep\n\nm = DCMotor(forward=23, backward=24)\nm.forward()\nprint("motor forward")\nsleep(1)\n`,
    helpers: ['ps'],
    parts: [['mot', 'dc_motor', 860, 300, { vrated: 12 }]],
    at: [600, 80],
    wires: ['dut.VS>ps.P', 'dut.GND>ps.N', 'ps.N>pi.P39', 'dut.IN1>pi.P16', 'dut.IN2>pi.P18', 'dut.OUT1>mot.P', 'dut.OUT2>mot.N'],
    expect: /motor forward/,
    verify: (s) => ((vis(s, 'mot').run ?? 0) > 0.6 ? null : `motor run ${vis(s, 'mot').run}`),
  },
  tb6612: {
    title: 'TB6612FNG: PWM speed on channel A',
    code: `from smartfarm import DCMotor\nfrom time import sleep\n\nm = DCMotor(forward=23, backward=24, enable=12)\nm.forward(0.8)\nprint("motor 80 %")\nsleep(1)\n`,
    helpers: ['ps'],
    parts: [['mot', 'dc_motor', 860, 300, { vrated: 12 }]],
    at: [600, 80],
    wires: ['dut.VM>ps.P', 'dut.GND>ps.N', 'ps.N>pi.P39', 'dut.VCC>pi.P1', 'dut.STBY>pi.P17', 'dut.AIN1>pi.P16', 'dut.AIN2>pi.P18', 'dut.PWMA>pi.P32', 'dut.AO1>mot.P', 'dut.AO2>mot.N'],
    expect: /motor 80 %/,
    verify: (s) => (near(vis(s, 'mot').run ?? 0, 0.8, 0.2) ? null : `motor run ${vis(s, 'mot').run}`),
  },
  irrigation_valve: { title: 'Open an irrigation zone valve', code: relayCode('Valve', 'Valve'), helpers: ['relay', 'ps'], helperProps: { ps: { volts: 24 } }, wires: RELAY_LOAD, expect: /Valve ON[\s\S]*Valve OFF/, verify: relayVerify },
  exhaust_fan: { title: 'Exhaust fan on a relay', code: relayCode('Fan', 'Fan'), helpers: ['relay', 'ps'], wires: RELAY_LOAD, expect: /Fan ON[\s\S]*Fan OFF/, verify: relayVerify },
  // -------------------------------------------------------------- displays & communication
  nextion: {
    title: 'Write a text to the Nextion',
    code: `from smartfarm import Nextion\n\nhmi = Nextion()\nhmi.set_text("t0", "Hello Pi 5")\nprint("sent t0.txt")\n`,
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.TX>pi.P10', 'dut.RX>pi.P8'],
    expect: /sent t0\.txt/,
  },
  lcd1602_i2c: {
    title: 'Write two lines on an I2C LCD',
    code: `from RPLCD.i2c import CharLCD\n\nlcd = CharLCD('PCF8574', 0x27, cols=16, rows=2)\nlcd.clear()\nlcd.write_string("Hello Pi 5")\nlcd.cursor_pos = (1, 0)\nlcd.write_string("Smart farm")\nprint("LCD updated")\n`,
    props: { pullups: 'removed' },
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5'],
    expect: /LCD updated/,
    verify: (s) => {
      const l = (s.device('dut') as any)?.view?.().lines ?? [];
      return /Hello Pi 5/.test(l[0] ?? '') && /Smart farm/.test(l[1] ?? '') ? null : `LCD shows ${JSON.stringify(l)}`;
    },
  },
  lcd2004_i2c: {
    title: 'Four lines on a 20×4 LCD',
    code: `from smartfarm import LCD\n\nlcd = LCD(0x27, cols=20, rows=4)\nlcd.clear()\nfor row, text in enumerate(["Air  24.0 C", "pH   6.20", "EC   1.20 mS/cm", "Pump OFF"]):\n    lcd.write(text, row=row)\nprint("LCD 20x4 updated")\n`,
    props: { pullups: 'removed' },
    wires: ['dut.VCC>pi.P2', 'dut.GND>pi.P6', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5'],
    expect: /LCD 20x4 updated/,
    verify: (s) => {
      const l = (s.device('dut') as any)?.view?.().lines ?? [];
      return l.length === 4 && /Pump OFF/.test(l[3] ?? '') ? null : `LCD shows ${JSON.stringify(l)}`;
    },
  },
  oled_ssd1306: {
    title: 'Text on a 128×64 OLED',
    code: `from smartfarm import OLED\n\noled = OLED()\noled.clear()\noled.text("Pi 5 farm", 0, 0)\noled.show()\nprint("OLED updated")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P6', 'dut.SDA>pi.P3', 'dut.SCL>pi.P5'],
    expect: /OLED updated/,
  },
  seven_segment: {
    title: 'Show a digit on a 7-segment display',
    code: `from smartfarm import SevenSegment\n\nd = SevenSegment(5, 6, 13, 19, 26, 16, 20)   # a b c d e f g\nd.show(7)\nprint("showing 7")\n`,
    parts: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s, i) => [`r${s}`, 'resistor', 420, 240 + i * 30, { ohms: 330 }] as [string, string, number, number, Record<string, any>]),
    at: [560, 300],
    wires: [
      'pi.P29>ra.1', 'ra.2>dut.a', 'pi.P31>rb.1', 'rb.2>dut.b', 'pi.P33>rc.1', 'rc.2>dut.c', 'pi.P35>rd.1', 'rd.2>dut.d',
      'pi.P37>re.1', 're.2>dut.e', 'pi.P36>rf.1', 'rf.2>dut.f', 'pi.P38>rg.1', 'rg.2>dut.g', 'dut.COM>pi.P39',
    ],
    expect: /showing 7/,
    verify: (s) => {
      const g = vis(s, 'dut').seg ?? {};
      return g.a > 0 && g.b > 0 && g.c > 0 && !(g.d > 0) && !(g.g > 0) ? null : `segments ${JSON.stringify(g)}`;
    },
  },
  tm1637: {
    title: 'TM1637: show "1234"',
    code: `import tm1637\n\ndisp = tm1637.TM1637(clk=23, dio=24)\ndisp.show("1234")\nprint("display ACK errors:", disp.ack_errors)\n`,
    wires: ['dut.CLK>pi.P16', 'dut.DIO>pi.P18', 'dut.VCC>pi.P1', 'dut.GND>pi.P6'],
    expect: /display ACK errors: 0/,
    verify: (s) => {
      const d = vis(s, 'dut').digits ?? [];
      return JSON.stringify(d) === JSON.stringify([0x06, 0x5b, 0x4f, 0x66]) && vis(s, 'dut').on ? null : `digits ${JSON.stringify(d)}`;
    },
  },
  ws2812_strip: {
    title: 'Light a NeoPixel strip red',
    code: `import board\nimport neopixel\n\npixels = neopixel.NeoPixel(board.D18, 8, brightness=0.3)\npixels.fill((255, 0, 0))\nprint("strip red")\n`,
    wires: ['dut.DIN>pi.P12', 'dut.VCC>pi.P2', 'dut.GND>pi.P6'],
    expect: /strip red/,
    verify: (s) => (JSON.stringify(vis(s, 'dut').pixels?.[0]) === '[76,0,0]' ? null : `pixel 0 ${JSON.stringify(vis(s, 'dut').pixels?.[0])}`),
  },
  tft_st7735: {
    title: 'TFT: fill and print text (experimental driver)',
    code: `import st7735\n\ntft = st7735.ST7735(dc=24, rst=25)\ntft.fill(st7735.color565(0, 40, 0))\ntft.text("pH 6.2", 4, 4, st7735.color565(255, 255, 0))\nprint("TFT drawn")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P6', 'dut.SCL>pi.P23', 'dut.SDA>pi.P19', 'dut.CS>pi.P24', 'dut.DC>pi.P18', 'dut.RES>pi.P22', 'dut.BL>pi.P17'],
    expect: /TFT drawn/,
    seconds: 20,
    verify: (s) => {
      const v = (s.device('dut') as any)?.view?.();
      return v?.on && v.fb.some((x: number) => x === 0xffe0) ? null : 'frame buffer should contain yellow text';
    },
  },
  max485: {
    title: 'Read a Modbus soil probe through the MAX485',
    code: `import minimalmodbus\n\ninst = minimalmodbus.Instrument("/dev/serial0", 1)\ninst.serial.baudrate = 9600\ninst.serial.timeout = 0.3\nprint("soil moisture:", inst.read_register(0, 1), "%")\n`,
    helpers: ['ps'],
    parts: [['soil', 'rs485_soil', 820, 200, {}]],
    props: { auto: true },
    at: [560, 80],
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P6', 'dut.TX>pi.P10', 'dut.RX>pi.P8', 'dut.A>soil.A', 'dut.B>soil.B', 'soil.VCC>ps.P', 'soil.GND>ps.N', 'ps.N>pi.P39'],
    expect: /soil moisture: 32\.0 %/,
  },
  usb_serial: {
    title: 'Send text to the serial terminal',
    code: `import serial\n\nport = serial.Serial("/dev/serial0", 9600)\nport.write(b"hello from the Pi\\n")\nprint("sent")\n`,
    wires: ['dut.GND>pi.P6', 'dut.TX>pi.P10', 'dut.RX>pi.P8'],
    expect: /sent/,
  },
  // -------------------------------------------------------------- smart farming components
  reservoir_tank: farmExample('Reservoir level read by an analog level sensor in Smart Farm mode'),
  fert_tank_a: farmExample('Tank A is drawn from the farm model'),
  fert_tank_b: farmExample('Tank B is drawn from the farm model'),
  ph_down_tank: farmExample('pH-down tank is drawn from the farm model'),
  grow_channel: farmExample('NFT channel shows the circulation flow'),
};

function gateExample(op: string, fn: (a: number, b: number) => number): PartExample {
  const rows = [0, 1].flatMap((a) => [0, 1].map((b) => `${a} ${op} ${b} -> ${fn(a, b)}`));
  return {
    title: `${op} gate truth table`,
    code: `from gpiozero import OutputDevice, DigitalInputDevice\nfrom time import sleep\n\na, b = OutputDevice(17), OutputDevice(27)\ny = DigitalInputDevice(22)\nfor va in (0, 1):\n    for vb in (0, 1):\n        a.value, b.value = va, vb\n        sleep(0.05)\n        print(f"{va} ${op} {vb} -> {y.value}")\n`,
    wires: ['dut.VCC>pi.P1', 'dut.GND>pi.P9', 'dut.1A>pi.P11', 'dut.1B>pi.P13', 'dut.1Y>pi.P15'],
    expect: new RegExp(rows.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')),
  };
}

function farmExample(title: string): PartExample {
  return {
    title,
    code: `from smartfarm import ADS1115, WaterLevel\n\n# the level sensor's value source is "Smart Farm model": it reads the reservoir\nprint(f"reservoir level: {WaterLevel(ADS1115(), 0).read():.0f} %")\n`,
    helpers: ['ads'],
    parts: [['lvl', 'water_level_analog', 420, 400, { source: 'farm' }]],
    wires: ['lvl.VCC>pi.P1', 'lvl.GND>pi.P9', 'lvl.AO>ads.A0'],
    expect: /reservoir level: 7[45] %/,
  };
}

// ------------------------------------------------------------------ circuit builder
const GND_PINS = new Set(['P6', 'P9', 'P14', 'P20', 'P25', 'P30', 'P34', 'P39']);
const PALETTE = [W.yellow, W.green, W.blue, W.purple, W.white, W.orange, W.brown];

function colourFor(a: string, b: string, i: number) {
  const ends = [a, b];
  if (ends.some((e) => /^pi\.P(1|17)$/.test(e))) return W.orange;
  if (ends.some((e) => /^pi\.P(2|4)$/.test(e) || /\.(VCC|VIN|VDD|VS|VM|V12|P|INP|L\+|VMOT)$/.test(e) && /^ps\./.test(e))) return W.red;
  if (ends.some((e) => (e.startsWith('pi.') && GND_PINS.has(e.slice(3))) || /^ps\.N$/.test(e))) return W.black;
  return PALETTE[i % PALETTE.length];
}

export function exampleFor(type: string): PartExample | null {
  return PART_EXAMPLES[type] ?? null;
}

/** Build the complete example project for a component type. */
export function buildPartExample(type: string): ProjectDoc {
  const ex = PART_EXAMPLES[type];
  const m = getPart(type);
  const b = new CircuitBuilder();
  b.add('pi', 'rpi5', 20, 60, ex?.piProps ?? {}, 0, 'Raspberry Pi 5');
  const [x, y] = ex?.at ?? (type === 'rpi5' ? [0, 0] : [500, 320]);
  if (type !== 'rpi5') b.add('dut', type, x, y, ex?.props ?? {}, 0, m.short ?? m.name);
  const hp = ex?.helperProps ?? {};
  for (const h of ex?.helpers ?? []) {
    if (h === 'ads') {
      b.add('ads', 'ads1115', 480, 20, hp.ads ?? {}, 0, 'ADS1115');
      b.wire('ads.VDD', 'pi.P1', W.orange).wire('ads.GND', 'pi.P9', W.black).wire('ads.SDA', 'pi.P3', W.blue).wire('ads.SCL', 'pi.P5', W.yellow);
    } else if (h === 'mcp') {
      b.add('mcp', 'mcp3008', 500, 30, hp.mcp ?? {}, 0, 'MCP3008');
      for (const [p, q] of [['VDD', 'P17'], ['VREF', 'P17'], ['AGND', 'P20'], ['DGND', 'P25'], ['CLK', 'P23'], ['DOUT', 'P21'], ['DIN', 'P19'], ['CS', 'P24']]) b.wire(`mcp.${p}`, `pi.${q}`, colourFor(`mcp.${p}`, `pi.${q}`, 0));
    } else if (h === 'ps') {
      b.add('ps', 'power_supply', 760, 460, { volts: 12, ...(hp.ps ?? {}) }, 0, `${hp.ps?.volts ?? 12} V supply`);
    } else if (h === 'relay') {
      b.add('relay', 'relay_module', 640, 60, hp.relay ?? {}, 0, 'Relay');
      b.wire('relay.VCC', 'pi.P2', W.red).wire('relay.GND', 'pi.P14', W.black).wire('relay.IN1', 'pi.P11', W.yellow, 'GPIO17');
    }
  }
  for (const [id, t, px, py, props] of ex?.parts ?? []) if (hasPart(t)) b.add(id, t, px, py, props ?? {}, 0, getPart(t).short);
  (ex?.wires ?? []).forEach((w, i) => {
    const [a, c] = w.split('>');
    b.wire(a, c, colourFor(a, c, i));
  });
  const d = b.doc({ name: `${m.short ?? m.name} example` });
  d.files = [{ name: 'main.py', content: ex?.code ?? `# ${m.name}\n# No ready-made program: see the inspector for the pin-out and drivers.\n` }];
  d.mainFile = 'main.py';
  d.exampleId = `part:${type}`;
  d.description = ex?.title ?? m.description;
  if (!PART_EXAMPLES[type]) d.farm = { ...newProject().farm };
  return d;
}

/** Plain-language wiring guide derived from the example circuit. */
export function wiringGuide(type: string): string[] {
  const ex = PART_EXAMPLES[type];
  if (!ex) return [];
  const doc = buildPartExample(type);
  const nameOf = (id: string) => (id === 'dut' ? getPart(type).short ?? getPart(type).name : doc.components.find((c) => c.id === id)?.label ?? id);
  const pinOf = (id: string, pin: string) => {
    if (id === 'pi') return `pin ${pin.slice(1)}`;
    return pin;
  };
  return doc.wires.map((w) => `${nameOf(w.from.comp)} ${pinOf(w.from.comp, w.from.pin)} → ${nameOf(w.to.comp)} ${pinOf(w.to.comp, w.to.pin)}`);
}

// ------------------------------------------------------------------ in-app "Test simulation"
import type { Scenario } from '../tests/host';

/** Scenario that loads the part's example circuit, runs its code in the real worker and checks it. */
export function partScenario(type: string): Scenario | null {
  const ex = PART_EXAMPLES[type];
  if (!ex) return null;
  return {
    id: `part-${type}`,
    name: ex.title,
    expected: `Output matches ${ex.expect}${ex.verify ? ' and the circuit verification passes' : ''}`,
    async run(h) {
      await h.load(buildPartExample(type));
      await h.run();
      const events = [...(ex.events ?? [])].sort((a, b) => a.at - b.at);
      const seconds = ex.seconds ?? 6;
      let verdict: string | null = ex.verify ? 'not checked' : null;
      let elapsed = 0;
      await h.waitSim(seconds, (t) => {
        elapsed = t;
        while (events.length && t >= events[0].at) {
          const e = events.shift()!;
          const id = e.comp ?? 'dut';
          if (e.press !== undefined) {
            void h.press(id, 0.6);
          }
          if (e.props) for (const [k, v] of Object.entries(e.props)) h.setProp(id, k, v);
        }
        if (ex.verify && ex.expect.test(h.term())) {
          const r = ex.verify(simRef());
          if (verdict !== null) verdict = r;
        }
      });
      const out = h.term();
      const ok = ex.expect.test(out) && verdict === null && !h.pyError();
      return {
        pass: ok,
        actual: `${out.trim().split('\n').slice(-3).join(' | ')}${verdict ? ` — ${verdict}` : ''} (${elapsed.toFixed(1)} s)`,
      };
    },
  };
}

let simGetter: () => Simulator = () => {
  throw new Error('simulator not attached');
};
export function attachSim(get: () => Simulator) {
  simGetter = get;
}
const simRef = () => simGetter();
/** the app simulator (attached by state/engine.ts) */
export const currentSim = () => simGetter();
