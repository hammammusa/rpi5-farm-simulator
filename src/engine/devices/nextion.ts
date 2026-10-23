// Nextion Enhanced (NX3224K028 reference: 2.8", 320x240) behavioural model.
//
// Supported instruction subset (each terminated by 0xFF 0xFF 0xFF):
//   page <id|name>            vis <obj>,<0|1>        tsw <obj>,<0|1>
//   click <obj>,<0|1>         get <expr>             sendme
//   ref <obj>  cls <color>    rest                   covx <src>,<dst>,<len>,<fmt>
//   <obj>.<attr>=<expr>       <obj>.<attr>++ / -- / += / -=
//   sys0..sys2=, dim=, dims=, sleep=, bkcmd=, baud=, bauds=
//   printh / prints / print   (in touch-event code)
// Expressions are evaluated left-to-right like the real device (no precedence).
// Return data: 0x65 touch, 0x66 page, 0x70 string, 0x71 number, 0x88 ready,
// error codes 0x00 0x02 0x03 0x1A 0x1B 0x1C 0x11 depending on bkcmd.

import type { DeviceHost, DeviceModel } from './device';

export type NxType =
  | 'text'
  | 'button'
  | 'number'
  | 'xfloat'
  | 'progress'
  | 'gauge'
  | 'picture'
  | 'dualstate'
  | 'checkbox'
  | 'slider'
  | 'qr'
  | 'variable'
  | 'hotspot'
  | 'timer';

export interface NxEvent {
  sendId: boolean;
  code: string;
}

export interface NxComponent {
  id: number;
  name: string;
  type: NxType;
  x: number;
  y: number;
  w: number;
  h: number;
  attrs: Record<string, string | number>;
  press?: NxEvent;
  release?: NxEvent;
  timer?: NxEvent;
}

export interface NxPage {
  id: number;
  name: string;
  bco: number;
  components: NxComponent[];
}

export interface NextionProject {
  model: string;
  width: number;
  height: number;
  pages: NxPage[];
}

export const NX_COLORS: Record<string, number> = {
  RED: 63488,
  BLUE: 31,
  GRAY: 33840,
  BLACK: 0,
  WHITE: 65535,
  GREEN: 2016,
  BROWN: 48192,
  YELLOW: 65504,
};

export const NX_PREFIX: Record<NxType, string> = {
  text: 't',
  button: 'b',
  number: 'n',
  xfloat: 'x',
  progress: 'j',
  gauge: 'z',
  picture: 'p',
  dualstate: 'bt',
  checkbox: 'c',
  slider: 'h',
  qr: 'qr',
  variable: 'va',
  hotspot: 'm',
  timer: 'tm',
};

export const NX_DEFAULTS: Record<NxType, { w: number; h: number; attrs: Record<string, string | number> }> = {
  text: { w: 100, h: 30, attrs: { txt: 'text', bco: 65535, pco: 0, font: 1, xcen: 1, ycen: 1, sta: 1, vscope: 0, txt_maxl: 20 } },
  button: { w: 100, h: 36, attrs: { txt: 'Button', bco: 50712, pco: 0, bco2: 1024, pco2: 65535, font: 1, vscope: 0 } },
  number: { w: 80, h: 30, attrs: { val: 0, bco: 65535, pco: 0, font: 1, xcen: 1, length: 0, vscope: 0 } },
  xfloat: { w: 80, h: 30, attrs: { val: 0, bco: 65535, pco: 0, font: 1, xcen: 1, vvs0: 0, vvs1: 1, vscope: 0 } },
  progress: { w: 150, h: 24, attrs: { val: 0, bco: 50712, pco: 1024, vscope: 0 } },
  gauge: { w: 100, h: 100, attrs: { val: 0, bco: 65535, pco: 63488, vscope: 0 } },
  picture: { w: 48, h: 48, attrs: { pic: 0, vscope: 0 } },
  dualstate: { w: 100, h: 36, attrs: { val: 0, txt: 'OFF', bco: 50712, bco2: 2016, pco: 0, pco2: 65535, font: 1, vscope: 0 } },
  checkbox: { w: 30, h: 30, attrs: { val: 0, bco: 65535, pco: 0, vscope: 0 } },
  slider: { w: 150, h: 30, attrs: { val: 50, minval: 0, maxval: 100, bco: 50712, pco: 1024, vscope: 0 } },
  qr: { w: 100, h: 100, attrs: { txt: 'http://raspberrypi.local:5000', bco: 65535, pco: 0, vscope: 0 } },
  variable: { w: 30, h: 30, attrs: { val: 0, txt: '', vscope: 0 } },
  hotspot: { w: 60, h: 60, attrs: { vscope: 0 } },
  timer: { w: 30, h: 30, attrs: { tim: 1000, en: 0, vscope: 0 } },
};

const STRING_ATTRS = new Set(['txt']);
const ALLOWED: Record<NxType, string[]> = {
  text: ['txt', 'bco', 'pco', 'font', 'xcen', 'ycen', 'sta', 'txt_maxl', 'vscope'],
  button: ['txt', 'bco', 'pco', 'bco2', 'pco2', 'font', 'vscope'],
  number: ['val', 'bco', 'pco', 'font', 'xcen', 'length', 'vscope'],
  xfloat: ['val', 'bco', 'pco', 'font', 'xcen', 'vvs0', 'vvs1', 'vscope'],
  progress: ['val', 'bco', 'pco', 'vscope'],
  gauge: ['val', 'bco', 'pco', 'vscope'],
  picture: ['pic', 'vscope'],
  dualstate: ['val', 'txt', 'bco', 'bco2', 'pco', 'pco2', 'font', 'vscope'],
  checkbox: ['val', 'bco', 'pco', 'vscope'],
  slider: ['val', 'minval', 'maxval', 'bco', 'pco', 'vscope'],
  qr: ['txt', 'bco', 'pco', 'vscope'],
  variable: ['val', 'txt', 'vscope'],
  hotspot: ['vscope'],
  timer: ['tim', 'en', 'vscope'],
};

export function rgb565ToCss(c: number) {
  const r = ((c >> 11) & 0x1f) << 3;
  const g = ((c >> 5) & 0x3f) << 2;
  const b = (c & 0x1f) << 3;
  return `rgb(${r | (r >> 5)},${g | (g >> 6)},${b | (b >> 5)})`;
}

export function cssToRgb565(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

export function emptyNextionProject(): NextionProject {
  return { model: 'NX3224K028', width: 320, height: 240, pages: [{ id: 0, name: 'page0', bco: 65535, components: [] }] };
}

export function nextFreeName(page: NxPage, type: NxType) {
  const pre = NX_PREFIX[type];
  for (let i = 0; ; i++) if (!page.components.some((c) => c.name === `${pre}${i}`)) return `${pre}${i}`;
}

export function makeComponent(page: NxPage, type: NxType, x = 10, y = 10, extra: Partial<NxComponent> = {}): NxComponent {
  const d = NX_DEFAULTS[type];
  const id = page.components.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  return {
    id,
    name: nextFreeName(page, type),
    type,
    x,
    y,
    w: d.w,
    h: d.h,
    attrs: { ...d.attrs },
    press: { sendId: type === 'button' || type === 'dualstate' || type === 'hotspot', code: '' },
    release: { sendId: false, code: '' },
    ...extra,
  };
}

const TERM = [0xff, 0xff, 0xff];

interface Live {
  attrs: Record<string, string | number>;
  visible: boolean;
  touch: boolean;
}

export class NextionRuntime implements DeviceModel {
  page = 0;
  live = new Map<string, Live>(); // key `${pageId}.${name}`
  sys = [0, 0, 0];
  dim = 100;
  sleep = false;
  bkcmd = 2;
  baud = 9600;
  powered = false;
  pressed: string | null = null;
  private rx: number[] = [];
  private lastTimer = new Map<string, number>();
  log: string[] = [];
  version = 0;

  constructor(private host: DeviceHost, private project: () => NextionProject) {
    this.baud = Number(host.props().baud) || 9600;
  }

  uartBaud() {
    return this.baud;
  }

  private proj() {
    return this.project();
  }

  private pageObj(id = this.page) {
    return this.proj().pages.find((p) => p.id === id) ?? this.proj().pages[0];
  }

  reset() {
    this.page = 0;
    this.live.clear();
    this.sys = [0, 0, 0];
    this.dim = 100;
    this.sleep = false;
    this.bkcmd = 2;
    this.baud = Number(this.host.props().baud) || 9600;
    this.rx = [];
    this.pressed = null;
    this.loadPage(0, true);
  }

  powerChanged(on: boolean, t: number) {
    this.powered = on;
    if (on) {
      this.reset();
      this.host.send([0x00, 0x00, 0x00, ...TERM, 0x88, ...TERM], t + 0.3);
    }
    this.bump();
  }

  private bump() {
    this.version++;
    this.host.changed();
  }

  /** (re)initialise live state of a page; local-scope components revert to designer values */
  private loadPage(id: number, all = false) {
    for (const pg of this.proj().pages) {
      if (!all && pg.id !== id) continue;
      for (const c of pg.components) {
        const key = `${pg.id}.${c.name}`;
        const existing = this.live.get(key);
        if (existing && Number(c.attrs.vscope) === 1) continue;
        this.live.set(key, { attrs: { ...NX_DEFAULTS[c.type].attrs, ...c.attrs }, visible: true, touch: true });
      }
    }
  }

  liveOf(pageId: number, name: string): Live | undefined {
    const pg = this.proj().pages.find((p) => p.id === pageId);
    const c = pg?.components.find((x) => x.name === name);
    if (!c) return undefined;
    const key = `${pageId}.${name}`;
    let l = this.live.get(key);
    if (!l) {
      l = { attrs: { ...NX_DEFAULTS[c.type].attrs, ...c.attrs }, visible: true, touch: true };
      this.live.set(key, l);
    }
    return l;
  }

  private send(bytes: number[], t: number) {
    this.host.send(bytes, t);
  }

  private reply(code: number, ok: boolean, t: number) {
    if (ok && (this.bkcmd === 1 || this.bkcmd === 3)) this.send([0x01, ...TERM], t);
    if (!ok && (this.bkcmd === 2 || this.bkcmd === 3)) this.send([code, ...TERM], t);
  }

  uartReceive(bytes: number[], t: number) {
    if (!this.powered) return;
    if (this.host.fault() === 'uart_loss') return;
    for (const b of bytes) {
      this.rx.push(b);
      const n = this.rx.length;
      if (n >= 3 && this.rx[n - 1] === 0xff && this.rx[n - 2] === 0xff && this.rx[n - 3] === 0xff) {
        const cmdBytes = this.rx.slice(0, n - 3);
        this.rx = [];
        if (cmdBytes.length === 0) continue;
        const cmd = decode(cmdBytes);
        const res = this.exec(cmd, t, false);
        this.log.push(`${res.ok ? '✓' : '✗ 0x' + res.code.toString(16).padStart(2, '0')} ${cmd}`);
        if (this.log.length > 200) this.log.shift();
        this.reply(res.code, res.ok, t);
      }
      if (this.rx.length > 1024) {
        this.rx = [];
        this.send([0x24, ...TERM], t);
      }
    }
    this.bump();
  }

  // ------------------------------------------------------------ interpreter
  exec(raw: string, t: number, local: boolean): { ok: boolean; code: number } {
    const cmd = raw.trim();
    if (!cmd) return { ok: true, code: 1 };
    let m: RegExpExecArray | null;
    if ((m = /^page\s+(\S+)$/i.exec(cmd))) {
      const target = this.resolvePage(m[1]);
      if (target === null) return { ok: false, code: 0x03 };
      this.page = target;
      this.loadPage(target);
      this.pressed = null;
      return { ok: true, code: 1 };
    }
    if ((m = /^(vis|tsw)\s+([^,]+)\s*,\s*([01])$/i.exec(cmd))) {
      const name = m[2].trim();
      const on = m[3] === '1';
      const targets = name === '255' ? this.pageObj().components.map((c) => c.name) : [this.resolveName(name)];
      for (const nm of targets) {
        const l = nm ? this.liveOf(this.page, nm) : undefined;
        if (!l) return { ok: false, code: 0x02 };
        if (m[1].toLowerCase() === 'vis') l.visible = on;
        else l.touch = on;
      }
      return { ok: true, code: 1 };
    }
    if ((m = /^click\s+([^,]+)\s*,\s*([01])$/i.exec(cmd))) {
      const nm = this.resolveName(m[1].trim());
      if (!nm) return { ok: false, code: 0x02 };
      this.touch(nm, m[2] === '1', t, true);
      return { ok: true, code: 1 };
    }
    if ((m = /^get\s+(.+)$/i.exec(cmd))) {
      const v = this.evalExpr(m[1]);
      if (v === undefined) return { ok: false, code: 0x1a };
      if (typeof v === 'string') this.send([0x70, ...encode(v), ...TERM], t);
      else {
        const x = v | 0;
        this.send([0x71, x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >> 24) & 0xff, ...TERM], t);
      }
      return { ok: true, code: 1 };
    }
    if (/^sendme$/i.test(cmd)) {
      this.send([0x66, this.page & 0xff, ...TERM], t);
      return { ok: true, code: 1 };
    }
    if (/^rest$/i.test(cmd)) {
      this.powerChanged(true, t);
      return { ok: true, code: 1 };
    }
    if ((m = /^cls\s+(\S+)$/i.exec(cmd))) {
      const c = this.evalExpr(m[1]);
      return { ok: typeof c === 'number', code: typeof c === 'number' ? 1 : 0x1a };
    }
    if (/^(ref|ref_stop|ref_star|doevents|code_c|wept|com_stop|com_star)\b/i.test(cmd)) return { ok: true, code: 1 };
    if ((m = /^covx\s+([^,]+),([^,]+),(\d+),(\d+)$/i.exec(cmd))) {
      const v = this.evalExpr(m[1].trim());
      if (v === undefined) return { ok: false, code: 0x1a };
      const len = Number(m[3]);
      const out = typeof v === 'number' ? (len ? String(v).padStart(len, '0').slice(-len) : String(v)) : parseInt(v, 10) || 0;
      return this.assign(m[2].trim(), out);
    }
    if ((m = /^printh\s+(.+)$/i.exec(cmd))) {
      const bytes = m[1].trim().split(/\s+/).map((h) => parseInt(h, 16) & 0xff);
      this.send(bytes, t);
      return { ok: true, code: 1 };
    }
    if ((m = /^prints\s+(.+),(\d+)$/i.exec(cmd)) || (m = /^print\s+(.+)$/i.exec(cmd))) {
      const v = this.evalExpr(m[1].trim());
      if (v === undefined) return { ok: false, code: 0x1a };
      const len = m[2] ? Number(m[2]) : 0;
      if (typeof v === 'string') {
        const b = encode(v);
        this.send(len ? b.slice(0, len) : b, t);
      } else {
        const x = v | 0;
        const b = [x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >> 24) & 0xff];
        this.send(len ? b.slice(0, len) : b, t);
      }
      return { ok: true, code: 1 };
    }
    if ((m = /^([\w.]+)\s*(\+\+|--)$/.exec(cmd))) {
      const cur = this.evalExpr(m[1]);
      if (typeof cur !== 'number') return { ok: false, code: 0x1a };
      return this.assign(m[1], cur + (m[2] === '++' ? 1 : -1));
    }
    if ((m = /^([\w.]+)\s*([+\-*/]?)=\s*(.*)$/.exec(cmd))) {
      const target = m[1];
      let v = this.evalExpr(m[3]);
      if (v === undefined) return { ok: false, code: 0x1a };
      if (m[2]) {
        const cur = this.evalExpr(target);
        if (cur === undefined) return { ok: false, code: 0x1a };
        v = applyOp(cur, m[2], v);
        if (v === undefined) return { ok: false, code: 0x1b };
      }
      return this.assign(target, v);
    }
    return { ok: false, code: 0x00 };
  }

  private resolvePage(s: string): number | null {
    const pages = this.proj().pages;
    if (/^\d+$/.test(s)) return pages.some((p) => p.id === Number(s)) ? Number(s) : null;
    return pages.find((p) => p.name === s)?.id ?? null;
  }

  private resolveName(s: string): string | null {
    const pg = this.pageObj();
    if (/^\d+$/.test(s)) return pg.components.find((c) => c.id === Number(s))?.name ?? null;
    return pg.components.find((c) => c.name === s)?.name ?? null;
  }

  /** resolve "t0.txt" or "page1.t0.txt" to a live attribute holder */
  private ref(path: string): { l: Live; attr: string; type: NxType } | 'sys' | null {
    const parts = path.split('.');
    let pageId = this.page;
    if (parts.length === 3) {
      const p = this.resolvePage(parts[0]);
      if (p === null) return null;
      pageId = p;
      parts.shift();
    }
    if (parts.length !== 2) return null;
    const pg = this.proj().pages.find((p) => p.id === pageId);
    const comp = pg?.components.find((c) => c.name === parts[0]);
    if (!comp) return null;
    if (pageId !== this.page && Number(comp.attrs.vscope) !== 1) return null; // local objects of other pages are not accessible
    if (!ALLOWED[comp.type].includes(parts[1])) return null;
    const l = this.liveOf(pageId, comp.name)!;
    return { l, attr: parts[1], type: comp.type };
  }

  private assign(target: string, v: string | number): { ok: boolean; code: number } {
    const sysm = /^sys([012])$/.exec(target);
    if (sysm) {
      if (typeof v !== 'number') return { ok: false, code: 0x1c };
      this.sys[Number(sysm[1])] = v | 0;
      return { ok: true, code: 1 };
    }
    if (/^dims?$/.test(target)) {
      if (typeof v !== 'number') return { ok: false, code: 0x1c };
      this.dim = Math.max(0, Math.min(100, v));
      return { ok: true, code: 1 };
    }
    if (target === 'sleep') {
      this.sleep = v === 1;
      return { ok: true, code: 1 };
    }
    if (target === 'bkcmd') {
      this.bkcmd = Number(v) & 3;
      return { ok: true, code: 1 };
    }
    if (/^bauds?$/.test(target)) {
      const b = Number(v);
      if (![2400, 4800, 9600, 19200, 31250, 38400, 57600, 115200, 230400, 250000, 256000, 512000, 921600].includes(b)) return { ok: false, code: 0x11 };
      this.baud = b;
      return { ok: true, code: 1 };
    }
    if (/^(thsp|thup|ussp|usup|wup|sendxy|spax|spay|recmod|tch\d)$/.test(target)) return { ok: true, code: 1 };
    const r = this.ref(target);
    if (!r || r === 'sys') return { ok: false, code: 0x1a };
    const wantsString = STRING_ATTRS.has(r.attr);
    if (wantsString !== (typeof v === 'string')) return { ok: false, code: 0x1c };
    if (typeof v === 'number') {
      v = v | 0;
      if (r.attr === 'val' && r.type === 'progress') v = Math.max(0, Math.min(100, v));
      if (r.attr === 'val' && r.type === 'slider') v = Math.max(Number(r.l.attrs.minval), Math.min(Number(r.l.attrs.maxval), v));
      if (r.attr === 'val' && r.type === 'gauge') v = ((v % 360) + 360) % 360;
    } else if (r.attr === 'txt' && r.l.attrs.txt_maxl) {
      v = v.slice(0, Number(r.l.attrs.txt_maxl) || 255);
    }
    r.l.attrs[r.attr] = v;
    return { ok: true, code: 1 };
  }

  evalExpr(src: string): string | number | undefined {
    const toks = tokenize(src);
    if (!toks) return undefined;
    let acc: string | number | undefined;
    let op: string | null = null;
    for (const tk of toks) {
      if (tk.k === 'op') {
        if (acc === undefined && tk.v === '-') {
          acc = 0;
        }
        op = tk.v;
        continue;
      }
      let val: string | number | undefined;
      if (tk.k === 'str') val = tk.v;
      else if (tk.k === 'num') val = Number(tk.v);
      else val = this.readVar(tk.v);
      if (val === undefined) return undefined;
      if (acc === undefined) acc = val;
      else if (op) {
        acc = applyOp(acc, op, val);
        if (acc === undefined) return undefined;
        op = null;
      } else return undefined;
    }
    return acc;
  }

  private readVar(name: string): string | number | undefined {
    if (name in NX_COLORS) return NX_COLORS[name];
    const sysm = /^sys([012])$/.exec(name);
    if (sysm) return this.sys[Number(sysm[1])];
    if (name === 'dim' || name === 'dims') return this.dim;
    if (name === 'dp') return this.page;
    if (name === 'bkcmd') return this.bkcmd;
    if (name === 'baud' || name === 'bauds') return this.baud;
    const r = this.ref(name);
    if (!r || r === 'sys') return undefined;
    return r.l.attrs[r.attr];
  }

  // ------------------------------------------------------------ touch
  touch(name: string, press: boolean, t: number, viaClick = false) {
    if (!this.powered) return;
    if (!viaClick && this.host.fault() === 'touch_dead') return;
    const pg = this.pageObj();
    const comp = pg.components.find((c) => c.name === name);
    if (!comp) return;
    const l = this.liveOf(pg.id, name)!;
    if (!viaClick && (!l.visible || !l.touch)) return;
    if (press) {
      this.pressed = name;
      if (comp.type === 'dualstate' || comp.type === 'checkbox') l.attrs.val = Number(l.attrs.val) ? 0 : 1;
    } else this.pressed = null;
    const ev = press ? comp.press : comp.release;
    if (ev?.sendId) this.send([0x65, pg.id & 0xff, comp.id & 0xff, press ? 0x01 : 0x00, ...TERM], t);
    if (ev?.code) for (const line of ev.code.split(/\r?\n/)) this.exec(line, t, true);
    this.bump();
  }

  setSlider(name: string, val: number) {
    const l = this.liveOf(this.page, name);
    if (!l) return;
    l.attrs.val = Math.round(val);
    this.bump();
  }

  tick(t: number) {
    if (!this.powered) return;
    const pg = this.pageObj();
    for (const c of pg.components) {
      if (c.type !== 'timer') continue;
      const l = this.liveOf(pg.id, c.name)!;
      const key = `${pg.id}.${c.name}`;
      if (Number(l.attrs.en) !== 1) {
        this.lastTimer.delete(key);
        continue;
      }
      const last = this.lastTimer.get(key) ?? t;
      const period = Math.max(50, Number(l.attrs.tim)) / 1000;
      if (t - last >= period) {
        this.lastTimer.set(key, t);
        if (c.timer?.code) for (const line of c.timer.code.split(/\r?\n/)) this.exec(line, t, true);
        this.bump();
      } else if (!this.lastTimer.has(key)) this.lastTimer.set(key, t);
    }
  }

  view() {
    return { page: this.page, powered: this.powered, dim: this.dim, sleep: this.sleep, pressed: this.pressed, version: this.version, baud: this.baud };
  }
}

function applyOp(a: string | number, op: string, b: string | number): string | number | undefined {
  if (typeof a === 'string' || typeof b === 'string') {
    if (op !== '+' || typeof a !== 'string' || typeof b !== 'string') return undefined;
    return a + b;
  }
  switch (op) {
    case '+':
      return (a + b) | 0;
    case '-':
      return (a - b) | 0;
    case '*':
      return Math.imul(a, b);
    case '/':
      return b === 0 ? undefined : Math.trunc(a / b);
  }
  return undefined;
}

type Tok = { k: 'str' | 'num' | 'id' | 'op'; v: string };
function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let v = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && s[j + 1] === '"') {
          v += '"';
          j += 2;
        } else if (s[j] === '\\' && s[j + 1] === 'r') {
          v += '\r';
          j += 2;
        } else v += s[j++];
      }
      if (j >= s.length) return null;
      out.push({ k: 'str', v });
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      out.push({ k: 'num', v: s.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[\w.]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) });
      i = j;
    } else if ('+-*/'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
    } else return null;
  }
  return out;
}

function decode(bytes: number[]) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function encode(s: string) {
  return Array.from(new TextEncoder().encode(s));
}
