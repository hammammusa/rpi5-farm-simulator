// Project report data for export: wiring table (one row per physical connection,
// every member of every net listed), GPIO allocation, BOM, power summary,
// warnings and assembly checklist. Everything is derived from the stored
// document and the simulator; nothing is invented (no prices, no part numbers
// that the component definitions do not contain).
import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER, PHYS_TO_BCM, HARDWARE_PWM_PINS, UART_PORTS } from '../engine/pi5';
import { Simulator } from '../engine/simulator';
import type { ComponentInstance, Issue, PinDef, ProjectDoc, Severity } from '../engine/types';
import { FIDELITY_LABEL } from '../catalog/registry';
import { realHardwareNotes } from '../catalog/drivers';
import { issueText, translate, type Lang } from '../i18n';
import { WIRE_COLORS } from '../engine/project';

export interface WiringRow {
  wireId: string;
  color: string;
  colorName: string;
  srcComp: string;
  srcId: string;
  srcPin: string;
  srcBcm: string;
  srcPhys: string;
  dstComp: string;
  dstId: string;
  dstPin: string;
  net: string;
  signal: string;
  supply: string;
  status: 'OK' | 'Warning' | 'Error' | 'Broken';
  notes: string;
}

export interface NetRow {
  net: string;
  signal: string;
  supply: string;
  members: string[];
  wires: string[];
}

export interface GpioRow {
  bcm: string;
  phys: number;
  name: string;
  func: string;
  direction: string;
  devices: string;
  purpose: string;
  notes: string;
}

export interface BomRow {
  item: number;
  name: string;
  model: string;
  manufacturer: string;
  qty: number;
  properties: string;
  voltage: string;
  fidelity: string;
  ids: string;
  notes: string;
}

export interface PowerRow {
  rail: string;
  source: string;
  consumers: string;
  current: string;
  budget: string;
}

export interface WarningRow {
  severity: Severity;
  title: string;
  explain: string;
  comps: string;
}

export interface ProjectReport {
  lang: Lang;
  title: string;
  description: string;
  date: string;
  piModel: string;
  wiring: WiringRow[];
  nets: NetRow[];
  gpio: GpioRow[];
  bom: BomRow[];
  power: PowerRow[];
  warnings: WarningRow[];
  libraries: { module: string; install: string; note?: string; simulatorOnly: boolean }[];
  instructions: string[];
  limitations: string[];
  checklist: string[];
  files: { name: string; content: string }[];
}

export const WIRING_COLUMNS: [keyof WiringRow, string][] = [
  ['wireId', 'Wire ID'],
  ['colorName', 'Wire colour'],
  ['srcComp', 'Source component'],
  ['srcId', 'Source ID'],
  ['srcPin', 'Source pin'],
  ['srcBcm', 'BCM GPIO'],
  ['srcPhys', 'Physical pin'],
  ['dstComp', 'Destination component'],
  ['dstId', 'Destination ID'],
  ['dstPin', 'Destination pin'],
  ['net', 'Net'],
  ['signal', 'Signal type'],
  ['supply', 'Supply voltage'],
  ['status', 'Connection status'],
  ['notes', 'Notes / warnings'],
];
export const NET_COLUMNS: [keyof NetRow, string][] = [
  ['net', 'Net'],
  ['signal', 'Signal type'],
  ['supply', 'Supply voltage'],
  ['members', 'All connected pins'],
  ['wires', 'Wires'],
];
export const GPIO_COLUMNS: [keyof GpioRow, string][] = [
  ['bcm', 'BCM'],
  ['phys', 'Physical'],
  ['func', 'Function in this project'],
  ['direction', 'Direction'],
  ['devices', 'Connected device'],
  ['purpose', 'Purpose'],
  ['notes', 'Notes'],
];
export const BOM_COLUMNS: [keyof BomRow, string][] = [
  ['item', '#'],
  ['name', 'Component'],
  ['model', 'Model / reference'],
  ['qty', 'Qty'],
  ['properties', 'Key properties'],
  ['voltage', 'Voltage'],
  ['fidelity', 'Simulation level'],
  ['ids', 'IDs'],
  ['notes', 'Assembly notes'],
];
export const POWER_COLUMNS: [keyof PowerRow, string][] = [
  ['rail', 'Rail'],
  ['source', 'Source'],
  ['consumers', 'Connected parts'],
  ['current', 'Simulated current'],
  ['budget', 'Simulator budget'],
];

const COLOR_NAME = new Map(Object.entries(WIRE_COLORS).map(([n, c]) => [c.toLowerCase(), n]));
export const colorName = (c: string) => COLOR_NAME.get(c.toLowerCase()) ?? c;

// ------------------------------------------------------------------ code analysis
export interface CodeUse {
  bcm: number;
  dir: 'Output' | 'Input' | 'PWM output' | 'Bidirectional';
  api: string;
  name?: string;
  file: string;
}

const OUT_CLASSES = 'LED|Buzzer|OutputDevice|DigitalOutputDevice|TonalBuzzer|LEDBoard|LEDCharDisplay';
const PWM_CLASSES = 'PWMLED|PWMOutputDevice|Servo|AngularServo|PWMLEDBoard';
const IN_CLASSES = 'Button|DigitalInputDevice|MotionSensor|LineSensor|LightSensor|InputDevice|SmoothedInputDevice';

/** GPIO pins the Python code claims, with direction (gpiozero, RPi.GPIO-style, lgpio, Blinka). */
export function codeGpioUsage(files: { name: string; content: string }[]): CodeUse[] {
  const out: CodeUse[] = [];
  const py = files.filter((f) => f.name.endsWith('.py')).map((f) => ({ name: f.name, code: f.content.replace(/#.*$/gm, '') }));
  // simple integer constants and {name: pin} dicts from every file (config modules)
  const consts = new Map<string, number>();
  const dicts = new Map<string, [string, number][]>();
  for (const f of py) {
    for (const m of f.code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*$/gm)) consts.set(m[1], Number(m[2]));
    for (const m of f.code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*\{([^{}]*)\}/gm)) {
      const pairs = [...m[2].matchAll(/["'](\w+)["']\s*:\s*(\d+)/g)].map((x) => [x[1], Number(x[2])] as [string, number]);
      if (pairs.length) dicts.set(m[1], pairs);
    }
  }
  for (const f of py) {
    const code = f.code;
    const board = /setmode\(\s*GPIO\.BOARD\s*\)/.test(code);
    const pinOf = (tok: string | undefined): number | null => {
      if (!tok) return null;
      const t = tok.trim().replace(/^['"]|['"]$/g, '');
      let m = /^(?:GPIO|BCM)?(\d+)$/i.exec(t);
      if (m) return Number(m[1]);
      m = /^BOARD(\d+)$/i.exec(t);
      if (m) return PHYS_TO_BCM[Number(m[1])] ?? null;
      m = /^board\.D(\d+)$/.exec(t);
      if (m) return Number(m[1]);
      const bare = t.replace(/^(?:\w+\.)+/, '');
      if (consts.has(bare)) return consts.get(bare)!;
      return null;
    };
    const push = (bcm: number | null, dir: CodeUse['dir'], api: string, name?: string) => {
      if (bcm === null || bcm < 0 || bcm > 27) return;
      out.push({ bcm, dir, api, name, file: f.name });
    };
    const call = (classes: string, dir: CodeUse['dir']) => {
      for (const m of code.matchAll(new RegExp(`\\b(?:gpiozero\\.)?(${classes})\\(([^)]*)\\)`, 'g'))) {
        const lineStart = code.lastIndexOf('\n', m.index) + 1;
        const lineEnd = code.indexOf('\n', m.index);
        const before = code.slice(lineStart, m.index);
        const line = code.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        const name = /(\w+(?:\.\w+)?)\s*=\s*$/.exec(before)?.[1] ?? /["'](\w+)["']\s*:\s*$/.exec(before)?.[1];
        const args = m[2].split(',').map((a) => a.trim());
        const first = args[0] && !args[0].includes('=') ? args[0] : args.find((a) => /^pin\s*=/.test(a))?.split('=')[1];
        const pin = pinOf(first);
        if (pin !== null) {
          push(pin, dir, m[1], name);
          continue;
        }
        // {n: Class(p) for n, p in PINS.items()}
        if (!first || !/^\w+$/.test(first)) continue;
        const loop = new RegExp(`for\\s+(\\w+)\\s*,\\s*${first}\\s+in\\s+(?:self\\.)?(\\w+)\\.items\\(\\)`).exec(line);
        if (loop && dicts.has(loop[2])) for (const [k, v] of dicts.get(loop[2])!) push(v, dir, m[1], k);
      }
    };
    call(OUT_CLASSES, 'Output');
    call(PWM_CLASSES, 'PWM output');
    call(IN_CLASSES, 'Input');
    // multi-pin gpiozero classes with keyword pins
    for (const m of code.matchAll(/(?:(\w+)\s*=\s*)?(?:gpiozero\.)?(DistanceSensor|Motor|PhaseEnableMotor|RGBLED)\(([^)]*)\)/g)) {
      const kw = new Map<string, string>();
      const pos: string[] = [];
      for (const a of m[3].split(',')) {
        const [k, v] = a.split('=').map((x) => x.trim());
        if (v !== undefined) kw.set(k, v);
        else if (k) pos.push(k);
      }
      if (m[2] === 'DistanceSensor') {
        push(pinOf(kw.get('echo') ?? pos[0]), 'Input', 'DistanceSensor echo', m[1]);
        push(pinOf(kw.get('trigger') ?? pos[1]), 'Output', 'DistanceSensor trigger', m[1]);
      } else if (m[2] === 'RGBLED') {
        ['red', 'green', 'blue'].forEach((k, i) => push(pinOf(kw.get(k) ?? pos[i]), 'PWM output', `RGBLED ${k}`, m[1]));
      } else {
        ['forward', 'backward'].forEach((k, i) => push(pinOf(kw.get(k) ?? pos[i]), 'PWM output', `${m[2]} ${k}`, m[1]));
        if (kw.get('enable')) push(pinOf(kw.get('enable')), 'PWM output', `${m[2]} enable`, m[1]);
      }
    }
    // RPi.GPIO-compatible API
    for (const m of code.matchAll(/GPIO\.setup\(\s*(\w+)\s*,\s*GPIO\.(OUT|IN)/g)) {
      const p = pinOf(m[1]);
      push(board && p !== null ? PHYS_TO_BCM[p] ?? null : p, m[2] === 'OUT' ? 'Output' : 'Input', `GPIO.setup ${m[2]}`);
    }
    for (const m of code.matchAll(/GPIO\.PWM\(\s*(\w+)/g)) {
      const p = pinOf(m[1]);
      push(board && p !== null ? PHYS_TO_BCM[p] ?? null : p, 'PWM output', 'GPIO.PWM');
    }
    // lgpio
    for (const m of code.matchAll(/gpio_claim_(output|input|alert)\(\s*\w+\s*,\s*(\w+)/g)) push(pinOf(m[2]), m[1] === 'output' ? 'Output' : 'Input', `lgpio.gpio_claim_${m[1]}`);
    for (const m of code.matchAll(/tx_pwm\(\s*\w+\s*,\s*(\w+)/g)) push(pinOf(m[1]), 'PWM output', 'lgpio.tx_pwm');
    // Blinka / CircuitPython
    for (const m of code.matchAll(/(\w+)\s*=\s*adafruit_dht\.(DHT\d+)\(\s*board\.D(\d+)/g)) push(Number(m[3]), 'Bidirectional', `adafruit_dht.${m[2]}`, m[1]);
    for (const m of code.matchAll(/(\w+)\s*=\s*digitalio\.DigitalInOut\(\s*board\.D(\d+)\s*\)/g)) {
      const v = m[1];
      const out = new RegExp(`${v}\\.(direction\\s*=\\s*digitalio\\.Direction\\.OUTPUT|switch_to_output)`).test(code);
      push(Number(m[2]), out ? 'Output' : 'Input', 'digitalio.DigitalInOut', v);
    }
    for (const m of code.matchAll(/neopixel\.NeoPixel\(\s*board\.D(\d+)/g)) push(Number(m[1]), 'Output', 'neopixel.NeoPixel');
  }
  return out;
}

// ------------------------------------------------------------------ helpers
const isBoard = (c: ComponentInstance | undefined) => !!c && (c.type === 'breadboard' || c.type === 'rpi5');

function displayName(c: ComponentInstance | undefined, id: string) {
  if (!c) return id;
  if (c.label) return c.label;
  return hasPart(c.type) ? getPart(c.type).name : c.type;
}

function shortName(c: ComponentInstance | undefined, id: string) {
  if (!c) return id;
  if (c.label) return c.label;
  if (c.type === 'rpi5') return 'Pi';
  if (c.type === 'breadboard') return `Breadboard ${id}`;
  return `${hasPart(c.type) ? getPart(c.type).short ?? getPart(c.type).name : c.type} ${id}`;
}

function pinDef(c: ComponentInstance, pin: string): PinDef | undefined {
  if (!hasPart(c.type)) return undefined;
  const m = getPart(c.type);
  return pinsOf(m, withDefaults(m, c.props)).find((p) => p.id === pin);
}

export function pinText(c: ComponentInstance | undefined, pin: string) {
  if (!c) return pin;
  if (c.type === 'rpi5') {
    const h = PI5_HEADER[Number(pin.slice(1)) - 1];
    return h ? h.name : pin;
  }
  if (c.type === 'breadboard') return `hole ${pin}`;
  return pinDef(c, pin)?.label ?? pin;
}

// ------------------------------------------------------------------ build
export function buildReport(doc: ProjectDoc, opts: { lang?: Lang; sim?: Simulator; date?: Date } = {}): ProjectReport {
  const lang = opts.lang ?? 'en';
  const t = (s: string, p?: Record<string, string | number>) => translate(lang, s, p);
  const sim = opts.sim ?? new Simulator(doc);
  const net = sim.net;
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const pi = doc.components.find((c) => c.type === 'rpi5');
  const code = codeGpioUsage(doc.files);
  const codeByBcm = new Map<number, CodeUse[]>();
  for (const u of code) codeByBcm.set(u.bcm, [...(codeByBcm.get(u.bcm) ?? []), u]);
  const issues: Issue[] = sim.issues;

  // ---- net classification
  const netName = (id: number) => {
    if (id < 0) return '—';
    const n = net.nets[id];
    if (id === net.groundNet) return 'GND';
    if (!/^Net \d+$/.test(n.name)) return n.name;
    return `N${id}`;
  };
  // Pi header pins count as net members only when something is plugged into them
  const wired = new Set<string>([...doc.wires.flatMap((w) => [net.key(w.from), net.key(w.to)]), ...net.insertions.map((i) => `${i.comp}:${i.pin}`)]);
  const piWired = (phys: number) => !!pi && wired.has(`${pi.id}:P${phys}`);
  const membersOf = (id: number) =>
    id < 0
      ? []
      : net.nets[id].pins
          .filter((p) => byId.get(p.comp)?.type !== 'breadboard' && (byId.get(p.comp)?.type !== 'rpi5' || wired.has(net.key(p))))
          .map((p) => {
            const c = byId.get(p.comp);
            if (c?.type === 'rpi5') {
              const h = PI5_HEADER[Number(p.pin.slice(1)) - 1];
              return `Pi pin ${h.physical} (${h.name})`;
            }
            return `${shortName(c, p.comp)}.${pinText(c, p.pin)}`;
          });
  const devicePins = (id: number) =>
    id < 0
      ? []
      : net.nets[id].pins
          .map((p) => ({ c: byId.get(p.comp)!, pin: p.pin }))
          .filter((x) => x.c && !isBoard(x.c) && hasPart(x.c.type))
          .map((x) => ({ ...x, def: pinDef(x.c, x.pin), m: getPart(x.c.type) }));
  const busFunc = (bcm: number, id: number): string | null => {
    const labels = devicePins(id).map((d) => (d.def?.label ?? d.pin).toUpperCase());
    const has = (re: RegExp) => labels.some((l) => re.test(l));
    if (bcm === 2 && has(/SDA/)) return 'I2C1 SDA';
    if (bcm === 3 && has(/SCL/)) return 'I2C1 SCL';
    for (const u of new Set(Object.values(UART_PORTS).map((p) => p.label))) {
      const port = Object.values(UART_PORTS).find((p) => p.label === u)!;
      if (bcm === port.tx && has(/^(RX|RXD|R|RO|DI)\b/)) return `${u} TX`;
      if (bcm === port.rx && has(/^(TX|TXD|T|DI|RO)\b/)) return `${u} RX`;
    }
    if (bcm === 10 && has(/MOSI|DIN|SDA|DI$/)) return 'SPI0 MOSI';
    if (bcm === 9 && has(/MISO|DOUT|DO$/)) return 'SPI0 MISO';
    if (bcm === 11 && has(/SCLK|CLK|SCK/)) return 'SPI0 SCLK';
    if (bcm === 8 && has(/CS|CE|SS/)) return 'SPI0 CE0';
    if (bcm === 7 && has(/CS|CE|SS/)) return 'SPI0 CE1';
    if (bcm === 4 && pi && withDefaults(getPart('rpi5'), pi.props).onewire && devicePins(id).some((d) => d.c.type === 'ds18b20')) return '1-Wire data';
    return null;
  };
  const volts = (id: number) => {
    if (id < 0) return null;
    try {
      return sim.netVoltage(id);
    } catch {
      return null;
    }
  };
  const classify = (id: number): { signal: string; supply: string } => {
    if (id < 0) return { signal: t('Not connected'), supply: '—' };
    if (id === net.groundNet) return { signal: t('Ground'), supply: '0 V' };
    const n = net.nets[id];
    const piNames = new Set(n.piPins.map((p) => PI5_HEADER[p - 1].name));
    if (piNames.has('3V3')) return { signal: t('Power'), supply: '3.3 V' };
    if (piNames.has('5V')) return { signal: t('Power'), supply: '5 V' };
    const gpio = n.piPins.map((p) => PI5_HEADER[p - 1].bcm).find((b) => b !== null) ?? null;
    if (gpio !== null) {
      const bus = busFunc(gpio, id);
      if (bus) return { signal: bus.startsWith('1-Wire') ? '1-Wire' : bus.replace(/\d? .*/, '') + ` (${bus})`, supply: t('3.3 V logic') };
      const use = codeByBcm.get(gpio)?.[0];
      if (use) return { signal: `GPIO ${t(use.dir).toLowerCase()}`, supply: t('3.3 V logic') };
      return { signal: 'GPIO', supply: t('3.3 V logic') };
    }
    const dps = devicePins(id);
    if (dps.some((d) => d.c.type === 'power_supply' && d.pin === 'P')) {
      const ps = dps.find((d) => d.c.type === 'power_supply')!;
      return { signal: t('Power'), supply: `${withDefaults(ps.m, ps.c.props).volts} V` };
    }
    if (dps.some((d) => d.c.type === 'power_supply' && d.pin === 'N')) return { signal: t('Ground'), supply: '0 V' };
    if (dps.some((d) => d.def?.kind === 'power')) {
      const v = volts(id);
      return { signal: t('Power'), supply: v !== null && Math.abs(v) > 0.05 ? `≈${v.toFixed(2)} V` : '—' };
    }
    if (dps.some((d) => d.def?.kind === 'analog')) return { signal: t('Analog'), supply: '—' };
    if (dps.some((d) => d.def?.kind === 'terminal')) return { signal: t('Load / switched'), supply: '—' };
    if (dps.some((d) => d.def?.kind === 'digital')) return { signal: t('Digital signal'), supply: '—' };
    return { signal: t('Signal'), supply: '—' };
  };

  const issuesFor = (pins: { comp: string; pin: string }[], comps: string[]) =>
    issues.filter((i) => (i.pins?.length ? i.pins.some((p) => pins.some((q) => net.netOf(q) >= 0 && net.netOf(q) === net.netOf(p))) : i.comps.some((c) => comps.includes(c))));
  const worst = (is: Issue[]): WiringRow['status'] => (is.some((i) => i.severity === 'error') ? 'Error' : is.some((i) => i.severity === 'warning') ? 'Warning' : 'OK');

  // ---- wiring rows (one per wire, Pi end first), then breadboard insertions
  const wiring: WiringRow[] = [];
  for (const w of doc.wires) {
    let [a, b] = [w.from, w.to];
    if (byId.get(b.comp)?.type === 'rpi5' && byId.get(a.comp)?.type !== 'rpi5') [a, b] = [b, a];
    const ca = byId.get(a.comp);
    const cb = byId.get(b.comp);
    const broken = !ca || !cb || !hasPart(ca.type) || !hasPart(cb.type) || (ca.type !== 'breadboard' && !pinDef(ca, a.pin)) || (cb.type !== 'breadboard' && !pinDef(cb, b.pin));
    const nid = broken ? -1 : net.netOf(a);
    const cls = classify(nid);
    const h = ca?.type === 'rpi5' ? PI5_HEADER[Number(a.pin.slice(1)) - 1] : null;
    const iss = broken ? [] : issuesFor([a, b], [a.comp, b.comp]);
    const others = membersOf(nid).filter((m) => m !== `${shortName(ca, a.comp)}.${pinText(ca, a.pin)}` && m !== `${shortName(cb, b.comp)}.${pinText(cb, b.pin)}` && !(h && m.startsWith(`Pi pin ${h.physical} `)));
    const notes: string[] = [];
    if (broken) notes.push(t('A connected component or pin no longer exists — this wire is not part of the circuit.'));
    if (others.length) notes.push(`${t('Same net also')}: ${others.length > 6 ? `${others.slice(0, 5).join(', ')} ${t('+{n} more (see the nets table)', { n: others.length - 5 })}` : others.join(', ')}`);
    for (const i of iss) notes.push(`${i.severity === 'error' ? '⛔' : i.severity === 'warning' ? '⚠' : 'ℹ'} ${issueText(lang, i.code, i.params).title}`);
    if (w.label) notes.unshift(`${t('Label')}: ${w.label}`);
    wiring.push({
      wireId: w.id,
      color: w.color,
      colorName: lang === 'ar' ? `${t(colorName(w.color))} (${w.color})` : `${colorName(w.color)} (${w.color})`,
      srcComp: displayName(ca, a.comp),
      srcId: a.comp,
      srcPin: pinText(ca, a.pin),
      srcBcm: h?.bcm !== null && h?.bcm !== undefined ? `GPIO${h.bcm}` : '—',
      srcPhys: h ? String(h.physical) : '—',
      dstComp: displayName(cb, b.comp),
      dstId: b.comp,
      dstPin: pinText(cb, b.pin),
      net: netName(nid),
      signal: cls.signal,
      supply: cls.supply,
      status: broken ? 'Broken' : worst(iss),
      notes: notes.join(' · '),
    });
  }
  net.insertions.forEach((ins, i) => {
    const c = byId.get(ins.comp);
    const nid = net.netOf({ comp: ins.comp, pin: ins.pin });
    const cls = classify(nid);
    const others = membersOf(nid).filter((m) => m !== `${shortName(c, ins.comp)}.${pinText(c, ins.pin)}`);
    wiring.push({
      wireId: `bb-${i + 1}`,
      color: '',
      colorName: t('(inserted in breadboard)'),
      srcComp: displayName(c, ins.comp),
      srcId: ins.comp,
      srcPin: pinText(c, ins.pin),
      srcBcm: '—',
      srcPhys: '—',
      dstComp: displayName(byId.get(ins.board), ins.board),
      dstId: ins.board,
      dstPin: `hole ${ins.hole}`,
      net: netName(nid),
      signal: cls.signal,
      supply: cls.supply,
      status: 'OK',
      notes: others.length ? `${t('Same net also')}: ${others.join(', ')}` : '',
    });
  });

  // ---- nets
  const nets: NetRow[] = [];
  for (const n of net.nets) {
    const members = membersOf(n.id);
    if (members.length < 2) continue;
    const cls = classify(n.id);
    const wires = doc.wires.filter((w) => net.netOf(w.from) === n.id).map((w) => w.id);
    nets.push({ net: netName(n.id), signal: cls.signal, supply: cls.supply, members, wires });
  }

  // ---- GPIO allocation (every header pin that reaches another part)
  const reach = (id: number) => {
    const out: string[] = [];
    for (const d of devicePins(id)) {
      if (['resistor', 'diode'].includes(d.c.type)) {
        const other = pinsOf(d.m, withDefaults(d.m, d.c.props)).find((p) => p.id !== d.pin);
        const beyond = other ? devicePins(net.netOf({ comp: d.c.id, pin: other.id })).filter((x) => x.c.id !== d.c.id && x.c.type !== 'rpi5') : [];
        out.push(beyond.length ? `${shortName(d.c, d.c.id)} → ${beyond.map((x) => `${shortName(x.c, x.c.id)}.${x.def?.label ?? x.pin}`).join(', ')}` : shortName(d.c, d.c.id));
      } else out.push(`${shortName(d.c, d.c.id)}.${d.def?.label ?? d.pin}`);
    }
    return out;
  };
  const gpio: GpioRow[] = [];
  if (pi) {
    for (const h of PI5_HEADER) {
      const id = net.netOf({ comp: pi.id, pin: `P${h.physical}` });
      if (id < 0 || !piWired(h.physical)) continue;
      const devs = reach(id);
      if (!devs.length) continue;
      if (h.bcm === null) {
        // power pins: show what is wired to this very pin; the rest of the rail goes in the notes
        const pinKey = `${pi.id}:P${h.physical}`;
        const direct = doc.wires
          .filter((w) => net.key(w.from) === pinKey || net.key(w.to) === pinKey)
          .map((w) => (net.key(w.from) === pinKey ? w.to : w.from))
          .map((r) => `${shortName(byId.get(r.comp), r.comp)}.${pinText(byId.get(r.comp), r.pin)}`);
        gpio.push({
          bcm: '—',
          phys: h.physical,
          name: h.name,
          func: h.name === 'GND' ? t('Ground') : `${t('Power')} ${h.name === '3V3' ? '3.3 V' : '5 V'}`,
          direction: '—',
          devices: direct.join(', '),
          purpose: t('Supply / return'),
          notes: `${t('Whole rail')}: ${devs.join(', ')}`,
        });
        continue;
      }
      const uses = codeByBcm.get(h.bcm) ?? [];
      const bus = busFunc(h.bcm, id);
      const notes: string[] = [];
      let direction = uses[0] ? t(uses[0].dir) : '—';
      if (bus) direction = /TX|MOSI|SCLK|CE|SCL/.test(bus) ? t('Output') : /RX|MISO/.test(bus) ? t('Input') : t('Bidirectional');
      if (!uses.length && !bus) notes.push(t('Not used by the Python code'));
      if (uses.length > 1 && new Set(uses.map((u) => u.name ?? u.api)).size > 1) notes.push(t('Claimed more than once in the code: {list}', { list: uses.map((u) => u.name ?? u.api).join(', ') }));
      if (uses.some((u) => u.dir === 'PWM output') && !HARDWARE_PWM_PINS.includes(h.bcm)) notes.push(t('Software PWM (not a hardware PWM pin)'));
      if (bus && uses.length) notes.push(t('Also used as plain GPIO in the code: conflicts with {bus}', { bus }));
      const g = sim.gpio[h.bcm];
      if (g && g.mode !== 'input') notes.push(`${t('Simulator state')}: ${g.mode}${g.mode === 'output' ? ` = ${g.value}` : g.mode === 'pwm' ? ` ${Math.round(g.pwmDuty * 100)}%` : ''}`);
      for (const i of issuesFor([{ comp: pi.id, pin: `P${h.physical}` }], [])) notes.push(`${i.severity === 'error' ? '⛔' : '⚠'} ${issueText(lang, i.code, i.params).title}`);
      const alts = h.alts.filter((a) => a !== bus && !(bus === '1-Wire data' && a.startsWith('1-Wire')));
      const alt = alts.length ? ` [${t('alt')}: ${alts.join(', ')}]` : '';
      gpio.push({
        bcm: `GPIO${h.bcm}`,
        phys: h.physical,
        name: h.name,
        func: (bus ?? 'GPIO') + alt,
        direction,
        devices: devs.join(', '),
        purpose: uses.length ? uses.map((u) => `${u.name ? `${u.name} = ` : ''}${u.api}`).join('; ') : '—',
        notes: notes.join(' · '),
      });
    }
  }

  // ---- BOM
  const groups = new Map<string, ComponentInstance[]>();
  for (const c of doc.components) {
    if (!hasPart(c.type)) continue;
    const m = getPart(c.type);
    const p = withDefaults(m, c.props);
    const sig = c.type + '|' + m.props.filter((d) => d.group === 'config' && !/role|calibration|rate/.test(d.key)).map((d) => `${d.key}=${p[d.key]}`).join(',');
    groups.set(sig, [...(groups.get(sig) ?? []), c]);
  }
  const bom: BomRow[] = [];
  for (const cs of groups.values()) {
    const m = getPart(cs[0].type);
    const p = withDefaults(m, cs[0].props);
    const props = m.props
      .filter((d) => d.group === 'config' && !/role|calibration|rate/.test(d.key) && (!d.visible || d.visible(p)))
      .map((d) => {
        const v = p[d.key];
        const opt = d.options?.find((o) => o.value === v);
        return `${d.label}: ${opt ? opt.label : typeof v === 'boolean' ? (v ? 'yes' : 'no') : `${v}${d.unit ? ' ' + d.unit : ''}`}`;
      });
    bom.push({
      item: bom.length + 1,
      name: m.name,
      model: [m.model, m.manufacturer].filter(Boolean).join(' · ') || '—',
      manufacturer: m.manufacturer ?? '',
      qty: cs.length,
      properties: props.join('; ') || '—',
      voltage: m.voltage ?? '—',
      fidelity: lang === 'ar' ? FIDELITY_LABEL[m.fidelity ?? 'functional'].ar : FIDELITY_LABEL[m.fidelity ?? 'functional'].en,
      ids: cs.map((c) => c.id).join(', '),
      notes: (m.assembly ?? []).join(' ') || '',
    });
  }
  const byColor = new Map<string, number>();
  for (const w of doc.wires) byColor.set(colorName(w.color), (byColor.get(colorName(w.color)) ?? 0) + 1);
  if (doc.wires.length)
    bom.push({
      item: bom.length + 1,
      name: t('Jumper wires'),
      model: '—',
      manufacturer: '',
      qty: doc.wires.length,
      properties: [...byColor.entries()].map(([c, n]) => `${n}× ${lang === 'ar' ? t(c) : c}`).join(', '),
      voltage: '—',
      fidelity: '—',
      ids: '',
      notes: t('Use male–female jumpers for the Pi header; keep power wires short.'),
    });

  // ---- power
  const power: PowerRow[] = [];
  const piVis = pi ? sim.vis.get(pi.id) : undefined;
  const fmtA = (a: unknown) => (typeof a === 'number' && Number.isFinite(a) ? (a < 1 ? `${(a * 1000).toFixed(1)} mA` : `${a.toFixed(2)} A`) : '—');
  if (pi) {
    const railNet = (phys: number) => net.netOf({ comp: pi.id, pin: `P${phys}` });
    for (const [rail, phys, cur, budget] of [
      ['3.3 V', 1, piVis?.i3v3, '500 mA'],
      ['5 V', 2, piVis?.i5v, '1.6 A'],
    ] as const) {
      const devs = reach(railNet(phys));
      if (!devs.length) continue;
      power.push({ rail, source: t('Raspberry Pi 5 header'), consumers: devs.join(', '), current: fmtA(cur), budget });
    }
  }
  for (const c of doc.components.filter((x) => x.type === 'power_supply')) {
    const p = withDefaults(getPart(c.type), c.props);
    const devs = reach(net.netOf({ comp: c.id, pin: 'P' })).filter((d) => !d.startsWith(`${shortName(c, c.id)}.`));
    power.push({ rail: `${p.volts} V`, source: `${displayName(c, c.id)} (${c.id})`, consumers: devs.join(', ') || '—', current: fmtA(sim.vis.get(c.id)?.amps), budget: `${p.amps} A` });
  }

  // ---- warnings
  const warnings: WarningRow[] = issues.map((i) => {
    const tx = issueText(lang, i.code, i.params);
    return { severity: i.severity, title: tx.title, explain: tx.explain, comps: i.comps.map((id) => shortName(byId.get(id), id)).join(', ') };
  });

  // ---- libraries, instructions, limitations, checklist
  const allCode = doc.files.filter((f) => f.name.endsWith('.py')).map((f) => f.content).join('\n');
  const libraries = realHardwareNotes(allCode);
  const usesBus = (b: string) => gpio.some((g) => g.func.startsWith(b));
  const instructions = [
    t('Use Raspberry Pi OS (64-bit, Bookworm or newer) on the Raspberry Pi 5 and update it: sudo apt update && sudo apt full-upgrade'),
    ...(usesBus('I2C') ? [t('Enable I2C: sudo raspi-config → Interface Options → I2C (check with: i2cdetect -y 1)')] : []),
    ...(usesBus('SPI') ? [t('Enable SPI: sudo raspi-config → Interface Options → SPI')] : []),
    ...(usesBus('UART') ? [t('Enable the serial port: sudo raspi-config → Interface Options → Serial Port (login shell: No, hardware: Yes)')] : []),
    ...(usesBus('1-Wire') ? [t('Enable 1-Wire: add dtoverlay=w1-gpio to /boot/firmware/config.txt and reboot')] : []),
    t('Create a virtual environment: python3 -m venv --system-site-packages ~/farm-env && source ~/farm-env/bin/activate'),
    ...libraries.filter((l) => !l.simulatorOnly).map((l) => `${l.module}: ${l.install}`),
    t('Copy the project files to the Pi (for example to ~/project) and run: python3 {main}', { main: doc.mainFile }),
    t('Power the circuit only after checking every row of the wiring table against the real board.'),
  ];
  const limitations = [
    t('The CPU, Raspberry Pi OS and kernel drivers are not emulated: Python runs in Pyodide (CPython compiled to WebAssembly) with simulator implementations of the hardware libraries.'),
    t('Electrical values come from a DC nodal solver with simplified part models; PWM is averaged and fast transients, noise and timing jitter are not reproduced exactly.'),
    t('Bus timing (I2C/SPI/UART/1-Wire) is modelled at the transaction level, not bit-by-bit with real clock edges.'),
    ...doc.components
      .filter((c, i, a) => hasPart(c.type) && (getPart(c.type).fidelity ?? 'functional') !== 'full' && a.findIndex((x) => x.type === c.type) === i)
      .map((c) => {
        const m = getPart(c.type);
        const f = FIDELITY_LABEL[m.fidelity ?? 'functional'];
        return `${m.name} — ${lang === 'ar' ? f.ar : f.en}${m.limits ? `: ${m.limits}` : ''}`;
      }),
    ...libraries.filter((l) => l.simulatorOnly).map((l) => t('{m} exists only in the simulator: {note}', { m: l.module, note: l.note ?? l.install })),
  ];
  const checklist = [
    t('Disconnect power from the Raspberry Pi and all external supplies before wiring.'),
    t('Connect every ground together (Pi GND, external supply −, module GND).'),
    t('Never connect 5 V or more to a GPIO pin; use a level shifter or divider for 5 V signals.'),
    ...wiring.filter((r) => r.status !== 'Broken').map((r) => `${r.wireId}: ${r.srcComp} ${r.srcPin}${r.srcPhys !== '—' ? ` (pin ${r.srcPhys})` : ''} → ${r.dstComp} ${r.dstPin}`),
    ...[...new Set(doc.components.filter((c) => hasPart(c.type)).flatMap((c) => getPart(c.type).assembly ?? []))],
    t('Check the polarity of LEDs, diodes, electrolytic capacitors and supply connections.'),
    t('Inductive loads (pumps, valves, relays, motors) need a flyback diode or a driver module that includes one.'),
    t('Power up and check the supply voltages with a multimeter before running the program.'),
  ];

  const date = opts.date ?? new Date();
  return {
    lang,
    title: doc.name,
    description: doc.description ?? '',
    date: date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    piModel: pi ? getPart('rpi5').name : t('No Raspberry Pi in this circuit'),
    wiring,
    nets,
    gpio,
    bom,
    power,
    warnings,
    libraries,
    instructions,
    limitations,
    checklist,
    files: doc.files.map((f) => ({ name: f.name, content: f.content })),
  };
}

// ------------------------------------------------------------------ text formats
const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T>(rows: T[], cols: [keyof T, string][], lang: Lang = 'en'): string {
  const head = cols.map(([, h]) => csvCell(translate(lang, h))).join(',');
  // BOM so spreadsheet apps detect UTF-8 (Arabic, °, Ω)
  return '﻿' + [head, ...rows.map((r) => cols.map(([k]) => csvCell(r[k])).join(','))].join('\r\n') + '\r\n';
}

export function toMarkdownTable<T>(rows: T[], cols: [keyof T, string][], lang: Lang = 'en'): string {
  const esc = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${cols.map(([, h]) => translate(lang, h)).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map(([k]) => esc(r[k])).join(' | ')} |`)].join('\n');
}

export function reportMarkdown(r: ProjectReport): string {
  const t = (s: string) => translate(r.lang, s);
  return [
    `# ${r.title}`,
    '',
    r.description,
    '',
    `- ${t('Export date')}: ${r.date}`,
    `- ${t('Raspberry Pi model')}: ${r.piModel}`,
    '',
    `## ${t('Wiring table')}`,
    '',
    toMarkdownTable(r.wiring, WIRING_COLUMNS, r.lang),
    '',
    `## ${t('Electrical nets')}`,
    '',
    toMarkdownTable(r.nets, NET_COLUMNS, r.lang),
    '',
    `## ${t('Raspberry Pi 5 GPIO allocation')}`,
    '',
    toMarkdownTable(r.gpio, GPIO_COLUMNS, r.lang),
    '',
    `## ${t('Bill of materials')}`,
    '',
    toMarkdownTable(r.bom, BOM_COLUMNS, r.lang),
    '',
    `## ${t('Power requirements')}`,
    '',
    toMarkdownTable(r.power, POWER_COLUMNS, r.lang),
    '',
    `## ${t('Electrical warnings')}`,
    '',
    ...(r.warnings.length ? r.warnings.map((w) => `- **${w.severity.toUpperCase()}** ${w.title} (${w.comps}) — ${w.explain}`) : [`- ${t('No electrical problems found.')}`]),
    '',
  ].join('\n');
}
