// Example-library format. Each example is a complete project: a circuit described
// with a few helpers (wires are 'part.PIN>part.PIN'), Python code that uses the
// built-in libraries, bilingual teaching text and an automatic test (expected
// output, sensor/button events while it runs and an engine-level check).
import { BCM_TO_PHYS } from '../engine/pi5';
import type { Simulator } from '../engine/simulator';

export type Cat =
  | 'gpio'
  | 'sensors'
  | 'motors'
  | 'displays'
  | 'comms'
  | 'smarthome'
  | 'robotics'
  | 'security'
  | 'industrial'
  | 'farming'
  | 'energy'
  | 'logic'
  | 'data'
  | 'challenges'
  | 'advanced';
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Bi = [en: string, ar: string];

export const CATEGORIES: { id: Cat; en: string; ar: string; icon: string }[] = [
  { id: 'gpio', en: 'GPIO basics', ar: 'أساسيات GPIO', icon: '💡' },
  { id: 'sensors', en: 'Sensors', ar: 'الحساسات', icon: '🌡' },
  { id: 'motors', en: 'Motors & actuators', ar: 'المحركات والمشغلات', icon: '⚙' },
  { id: 'displays', en: 'Displays', ar: 'الشاشات', icon: '🖥' },
  { id: 'comms', en: 'Communication', ar: 'الاتصالات', icon: '🔌' },
  { id: 'smarthome', en: 'Smart home', ar: 'المنزل الذكي', icon: '🏠' },
  { id: 'robotics', en: 'Robotics', ar: 'الروبوتات', icon: '🤖' },
  { id: 'security', en: 'Security systems', ar: 'أنظمة الأمان', icon: '🔒' },
  { id: 'industrial', en: 'Industrial automation', ar: 'الأتمتة الصناعية', icon: '🏭' },
  { id: 'farming', en: 'Smart farming', ar: 'الزراعة الذكية', icon: '🌱' },
  { id: 'energy', en: 'Energy & power', ar: 'الطاقة والقدرة', icon: '🔋' },
  { id: 'logic', en: 'Digital logic & ICs', ar: 'المنطق الرقمي والدوائر المتكاملة', icon: '🔣' },
  { id: 'data', en: 'Data, time & logging', ar: 'البيانات والوقت والتسجيل', icon: '🗂' },
  { id: 'challenges', en: 'Python challenges', ar: 'تحديات بايثون', icon: '🧩' },
  { id: 'advanced', en: 'Advanced integrated projects', ar: 'مشاريع متكاملة متقدمة', icon: '🚀' },
];

export interface TestEvent {
  /** simulation seconds after the start */
  at: number;
  comp: string;
  props?: Record<string, any>;
  press?: boolean;
}

export interface LibTest {
  expect: RegExp;
  seconds?: number;
  events?: TestEvent[];
  /** null = OK, otherwise what is wrong; evaluated while the program's final state is applied */
  verify?: (sim: Simulator) => string | null;
  /** lines typed into input() */
  stdin?: string[];
  /** electrical errors the example shows on purpose (none by default) */
  allowErrors?: string[];
}

export type PartSpec = [id: string, type: string, props: Record<string, any>, label?: string];

export interface LibExample {
  id: string;
  cat: Cat;
  level: Level;
  minutes: number;
  title: Bi;
  goal: Bi;
  result: Bi;
  tryIt: Bi;
  modify: Bi;
  explain: Bi;
  parts: PartSpec[];
  wires: string[];
  code: string;
  files?: Record<string, string>;
  piProps?: Record<string, any>;
  test: LibTest;
}

// ------------------------------------------------------------------ circuit helpers
const GND = [6, 9, 14, 20, 25, 30, 34, 39];
export const phys = (bcm: number) => {
  const p = BCM_TO_PHYS[bcm];
  if (!p) throw new Error(`GPIO${bcm} is not on the header`);
  return `pi.P${p}`;
};

/** Small builder for the circuit of one example. Pins are BCM numbers; power pins rotate. */
export class Circuit {
  parts: PartSpec[] = [];
  wires: string[] = [];
  private g = 0;
  private v3 = 0;
  private v5 = 0;
  piProps: Record<string, any> = {};

  gnd() {
    return `pi.P${GND[this.g++ % GND.length]}`;
  }
  v33() {
    return `pi.P${[1, 17][this.v3++ % 2]}`;
  }
  v50() {
    return `pi.P${[2, 4][this.v5++ % 2]}`;
  }
  has(id: string) {
    return this.parts.some((p) => p[0] === id);
  }
  part(id: string, type: string, props: Record<string, any> = {}, label?: string) {
    if (!this.has(id)) this.parts.push([id, type, props, label]);
    return this;
  }
  w(...pairs: string[]) {
    for (const p of pairs) this.wires.push(p);
    return this;
  }
  /** GPIO → 330 Ω → LED → GND */
  led(id: string, bcm: number, color = 'red', label?: string, ohms = 330) {
    this.part(`r_${id}`, 'resistor', { ohms }).part(id, 'led', { color }, label);
    return this.w(`${phys(bcm)}>r_${id}.1`, `r_${id}.2>${id}.A`, `${id}.K>${this.gnd()}`);
  }
  /** push button to GND (use the internal pull-up) */
  button(id: string, bcm: number, label?: string) {
    return this.part(id, 'button', {}, label).w(`${id}.1a>${phys(bcm)}`, `${id}.2a>${this.gnd()}`);
  }
  buzzer(id: string, bcm: number) {
    return this.part(id, 'buzzer').w(`${id}.P>${phys(bcm)}`, `${id}.N>${this.gnd()}`);
  }
  rgb(id: string, r: number, g: number, b: number) {
    this.part(id, 'rgb_led');
    for (const [c, bcm] of [
      ['R', r],
      ['G', g],
      ['B', b],
    ] as const)
      this.part(`r_${id}${c}`, 'resistor', { ohms: 330 }).w(`${phys(bcm)}>r_${id}${c}.1`, `r_${id}${c}.2>${id}.${c}`);
    return this.w(`${id}.COM>${this.gnd()}`);
  }
  /** I2C device on bus 1 (SDA GPIO2 / SCL GPIO3) */
  i2c(id: string, type: string, props: Record<string, any> = {}, label?: string, pins = { vcc: 'VCC', gnd: 'GND' }) {
    return this.part(id, type, props, label).w(`${id}.${pins.vcc}>${this.v33()}`, `${id}.${pins.gnd}>${this.gnd()}`, `${id}.SCL>pi.P5`, `${id}.SDA>pi.P3`);
  }
  /** 5 V I2C module (LCD backpacks) */
  i2c5(id: string, type: string, props: Record<string, any> = {}, label?: string) {
    return this.part(id, type, props, label).w(`${id}.VCC>${this.v50()}`, `${id}.GND>${this.gnd()}`, `${id}.SCL>pi.P5`, `${id}.SDA>pi.P3`);
  }
  dht(id: string, bcm: number, type = 'dht22', props: Record<string, any> = {}) {
    return this.part(id, type, props).w(`${id}.VCC>${this.v33()}`, `${id}.DATA>${phys(bcm)}`, `${id}.GND>${this.gnd()}`);
  }
  ds18b20(id = 'probe', props: Record<string, any> = {}) {
    this.piProps.onewire = true;
    return this.part(id, 'ds18b20', props)
      .part(`r_${id}`, 'resistor', { ohms: 4700 })
      .w(`${id}.VCC>${this.v33()}`, `${id}.DQ>pi.P7`, `${id}.GND>${this.gnd()}`, `r_${id}.1>${id}.DQ`, `r_${id}.2>${this.v33()}`);
  }
  /** ADS1115 on I2C (address 0x48) */
  ads(id = 'ads', props: Record<string, any> = {}) {
    if (this.has(id)) return this;
    return this.part(id, 'ads1115', props, 'ADS1115').w(`${id}.VDD>${this.v33()}`, `${id}.GND>${this.gnd()}`, `${id}.SCL>pi.P5`, `${id}.SDA>pi.P3`);
  }
  /** 3.3 V analog module → ADS1115 channel */
  analog(id: string, type: string, ch: number, props: Record<string, any> = {}, label?: string, out = 'AO') {
    this.ads();
    return this.part(id, type, props, label).w(`${id}.VCC>${this.v33()}`, `${id}.GND>${this.gnd()}`, `${id}.${out}>ads.A${ch}`);
  }
  /** 5 V analog module whose output is divided by 1.5 (10 k / 20 k) into an ADS1115 channel */
  analog5(id: string, type: string, ch: number, props: Record<string, any> = {}, label?: string, out = 'AO') {
    this.ads();
    return this.part(id, type, props, label)
      .part(`r_${id}a`, 'resistor', { ohms: 10000 })
      .part(`r_${id}b`, 'resistor', { ohms: 20000 })
      .w(`${id}.VCC>${this.v50()}`, `${id}.GND>${this.gnd()}`, `${id}.${out}>r_${id}a.1`, `r_${id}a.2>ads.A${ch}`, `r_${id}b.1>ads.A${ch}`, `r_${id}b.2>${this.gnd()}`);
  }
  /** potentiometer between GND (A) and 3.3 V (B): a higher position gives a higher wiper voltage */
  pot(id: string, ch: number, props: Record<string, any> = {}, label?: string) {
    this.ads();
    return this.part(id, 'potentiometer', props, label).w(`${id}.A>${this.gnd()}`, `${id}.B>${this.v33()}`, `${id}.W>ads.A${ch}`);
  }
  /** MCP3008 on SPI0 CE0 */
  mcp(id = 'mcp') {
    if (this.has(id)) return this;
    return this.part(id, 'mcp3008', {}, 'MCP3008').w(
      `${id}.VDD>pi.P17`,
      `${id}.VREF>pi.P17`,
      `${id}.AGND>${this.gnd()}`,
      `${id}.DGND>${this.gnd()}`,
      `${id}.CLK>pi.P23`,
      `${id}.DOUT>pi.P21`,
      `${id}.DIN>pi.P19`,
      `${id}.CS>pi.P24`,
    );
  }
  /** external DC supply; its − is tied to the Pi ground */
  supply(id = 'ps', volts = 12, amps = 5) {
    if (this.has(id)) return this;
    return this.part(id, 'power_supply', { volts, amps }, `${volts} V supply`).w(`${id}.N>${this.gnd()}`);
  }
  /** relay board (active-LOW inputs) */
  relay(id: string, ins: number[], props: Record<string, any> = {}, label?: string) {
    this.part(id, 'relay_module', { channels: ins.length > 2 ? 4 : ins.length, ...props }, label).w(`${id}.VCC>${this.v50()}`, `${id}.GND>${this.gnd()}`);
    ins.forEach((bcm, i) => this.w(`${id}.IN${i + 1}>${phys(bcm)}`));
    return this;
  }
  /** load on relay channel `ch`, powered from the supply */
  load(id: string, type: string, relay: string, ch: number, props: Record<string, any> = {}, label?: string, ps = 'ps') {
    return this.part(id, type, { vrated: 12, ...props }, label).w(`${relay}.COM${ch}>${ps}.P`, `${relay}.NO${ch}>${id}.P`, `${id}.N>${ps}.N`);
  }
  pir(id: string, bcm: number, props: Record<string, any> = {}) {
    return this.part(id, 'pir_sensor', props).w(`${id}.VCC>${this.v50()}`, `${id}.OUT>${phys(bcm)}`, `${id}.GND>${this.gnd()}`);
  }
  /** HC-SR04 with a 1 k / 2 k divider on ECHO */
  ultrasonic(id: string, trig: number, echo: number, props: Record<string, any> = {}) {
    return this.part(id, 'hcsr04', props)
      .part(`r_${id}a`, 'resistor', { ohms: 1000 })
      .part(`r_${id}b`, 'resistor', { ohms: 2000 })
      .w(`${id}.VCC>${this.v50()}`, `${id}.GND>${this.gnd()}`, `${id}.TRIG>${phys(trig)}`, `${id}.ECHO>r_${id}a.1`, `r_${id}a.2>${phys(echo)}`, `r_${id}b.1>${phys(echo)}`, `r_${id}b.2>${this.gnd()}`);
  }
  servo(id: string, bcm: number, type = 'servo', props: Record<string, any> = {}) {
    return this.part(id, type, props).w(`${id}.VCC>${this.v50()}`, `${id}.GND>${this.gnd()}`, `${id}.SIG>${phys(bcm)}`);
  }
  /** digital-output module (rain, leak, LDR, sound…) */
  digital(id: string, type: string, bcm: number, props: Record<string, any> = {}, label?: string) {
    return this.part(id, type, props, label).w(`${id}.VCC>${this.v33()}`, `${id}.GND>${this.gnd()}`, `${id}.DO>${phys(bcm)}`);
  }
  /** two-wire contact to GND (float switch, reed-like contacts) */
  contact(id: string, type: string, bcm: number, props: Record<string, any> = {}, label?: string) {
    return this.part(id, type, props, label).w(`${id}.1>${phys(bcm)}`, `${id}.2>${this.gnd()}`);
  }
  /** UART0 device (TX→RX crossed) */
  uart(id: string, type: string, props: Record<string, any> = {}, label?: string, vcc5 = true) {
    return this.part(id, type, props, label).w(`${id}.VCC>${vcc5 ? this.v50() : this.v33()}`, `${id}.GND>${this.gnd()}`, `${id}.TX>pi.P10`, `${id}.RX>pi.P8`);
  }
  /** L298N with a 12 V supply; motors on OUT1/2 (and OUT3/4) */
  l298n(id: string, in1: number, in2: number, in3?: number, in4?: number) {
    this.supply();
    this.part(id, 'l298n', {}, 'L298N').w(`${id}.VS>ps.P`, `${id}.GND>ps.N`, `${id}.IN1>${phys(in1)}`, `${id}.IN2>${phys(in2)}`);
    if (in3 !== undefined && in4 !== undefined) this.w(`${id}.IN3>${phys(in3)}`, `${id}.IN4>${phys(in4)}`);
    return this;
  }
  /** MOSFET low-side switch for a 12 V load (GPIO → 100 Ω → gate), flyback diode for inductive loads */
  mosfetLoad(id: string, type: string, bcm: number, props: Record<string, any> = {}, label?: string, flyback = true) {
    this.supply();
    this.part(`q_${id}`, 'mosfet', {}).part(`rg_${id}`, 'resistor', { ohms: 100 }).part(id, type, { vrated: 12, ...props }, label);
    this.w(`${phys(bcm)}>rg_${id}.1`, `rg_${id}.2>q_${id}.G`, `q_${id}.S>${this.gnd()}`, `ps.P>${id}.P`, `${id}.N>q_${id}.D`);
    if (flyback) this.part(`d_${id}`, 'diode').w(`d_${id}.K>${id}.P`, `d_${id}.A>${id}.N`);
    return this;
  }
}

/** Define one example: `circuit` builds the parts and wires. */
export function ex(meta: Omit<LibExample, 'parts' | 'wires' | 'piProps'> & { piProps?: Record<string, any> }, circuit: (c: Circuit) => void): LibExample {
  const c = new Circuit();
  circuit(c);
  return { ...meta, parts: c.parts, wires: c.wires, piProps: { ...c.piProps, ...(meta.piProps ?? {}) } };
}

export const vis = (s: Simulator, id: string): Record<string, any> => s.vis.get(id) ?? {};
export const lit = (s: Simulator, id: string) => (vis(s, id).brightness ?? 0) > 0.2;
export const running = (s: Simulator, id: string) => (vis(s, id).run ?? 0) > 0.5;
export const energised = (s: Simulator, id: string, ch = 0) => !!vis(s, id).ch?.[ch]?.energised;
export const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
export const check = (ok: boolean, msg: string) => (ok ? null : msg);
