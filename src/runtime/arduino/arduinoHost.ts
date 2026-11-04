// Arduino C++ for the simulated ESP32: the sketch is compiled by the real Clang/LLD
// (LLVM 22, WebAssembly build from YoWASP) together with the simulator's Arduino-ESP32 core
// subset, then the resulting WebAssembly module runs with its hardware calls bound to the
// simulator. The same code runs in the browser worker and in the Node tests.
import HAL_H from './core/hal.h?raw';
import ARDUINO_H from './core/Arduino.h?raw';
import WSTRING_H from './core/WString.h?raw';
import PRINT_H from './core/Print.h?raw';
import SERIAL_H from './core/HardwareSerial.h?raw';
import WIRE_H from './core/Wire.h?raw';
import DHT_H from './core/DHT.h?raw';
import ONEWIRE_H from './core/OneWire.h?raw';
import DALLAS_H from './core/DallasTemperature.h?raw';
import NEOPIXEL_H from './core/Adafruit_NeoPixel.h?raw';
import WIFI_H from './core/WiFi.h?raw';
import PUBSUB_H from './core/PubSubClient.h?raw';
import CORE_CPP from './core/core.cpp?raw';
import { StopSignal, type McuHostIO, type McuRunResult } from '../mcu/mpHost';
import type { PyErrorInfo } from '../protocol';

export const ARDUINO_CORE: Record<string, string> = {
  'hal.h': HAL_H,
  'Arduino.h': ARDUINO_H,
  'WString.h': WSTRING_H,
  'Print.h': PRINT_H,
  'HardwareSerial.h': SERIAL_H,
  'Wire.h': WIRE_H,
  'DHT.h': DHT_H,
  'OneWire.h': ONEWIRE_H,
  'DallasTemperature.h': DALLAS_H,
  'Adafruit_NeoPixel.h': NEOPIXEL_H,
  'WiFi.h': WIFI_H,
  'PubSubClient.h': PUBSUB_H,
  'core.cpp': CORE_CPP,
};

/** headers a sketch may include (everything else fails with "file not found", as on a real toolchain without that library) */
export const ARDUINO_LIBRARIES = ['Arduino.h', 'Wire.h', 'DHT.h', 'OneWire.h', 'DallasTemperature.h', 'Adafruit_NeoPixel.h', 'WiFi.h', 'PubSubClient.h'];

export type RunClang = (args: string[], files: Record<string, any>, opts?: { stdout?: (b: Uint8Array | null) => void; stderr?: (b: Uint8Array | null) => void }) => Promise<Record<string, any>>;

// ------------------------------------------------------------------ .ino → C++
/** blank out comments, string and character literals (keeps line breaks and offsets) */
function maskCode(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(i, end);
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      blank(i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
    } else if (c === '#' && (i === 0 || /\n\s*$/.test(src.slice(Math.max(0, i - 80), i)))) {
      // preprocessor line (with continuations)
      let k = i;
      for (;;) {
        const e = src.indexOf('\n', k);
        if (e < 0) {
          k = src.length;
          break;
        }
        if (src[e - 1] === '\\') k = e + 1;
        else {
          k = e;
          break;
        }
      }
      blank(i, k);
      i = k;
    } else i++;
  }
  return out.join('');
}

const NOT_FUNCTIONS = new Set(['if', 'while', 'for', 'switch', 'return', 'else', 'do', 'catch', 'sizeof']);

/**
 * The Arduino IDE adds a prototype for every function of the .ino before the first function
 * definition (so functions can be called before they are defined). This finds top-level
 * function definitions in the masked source the same way: `<type> name(args) {` at brace
 * depth 0, outside class/struct/namespace bodies.
 */
export function sketchPrototypes(src: string): { prototypes: string[]; firstLine: number } {
  const m = maskCode(src);
  const prototypes: string[] = [];
  let firstLine = -1;
  let depth = 0;
  let start = 0; // start of the current top-level declaration
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '{') {
      if (depth === 0) {
        const head = m.slice(start, i).trim().replace(/\s+/g, ' ');
        const fn = /^((?:[\w:<>,*&\s]|\[\[[^\]]*\]\])+?[\s*&]+)(\w+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(const\s*)?$/.exec(head);
        if (fn && !NOT_FUNCTIONS.has(fn[2]) && !/^(struct|class|union|enum|namespace|typedef|template)\b/.test(head) && !/=/.test(fn[3]) && !/\b(operator)\b/.test(head)) {
          prototypes.push(`${fn[1].trim()} ${fn[2]}(${fn[3].trim()})${fn[4] ? ' const' : ''};`);
          if (firstLine < 0) {
            // line where this definition's header starts
            const headStart = start + (m.slice(start, i).length - m.slice(start, i).trimStart().length);
            firstLine = m.slice(0, headStart).split('\n').length;
          }
        }
      }
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) start = i + 1;
  }
  return { prototypes, firstLine };
}

/** the C++ translation unit the IDE builds from a .ino file (line numbers map back with #line) */
export function inoToCpp(src: string, file: string): string {
  const { prototypes, firstLine } = sketchPrototypes(src);
  const lines = src.split('\n');
  const q = JSON.stringify(file);
  if (!prototypes.length || firstLine < 1) return `#include <Arduino.h>\n#line 1 ${q}\n${src}\n`;
  const before = lines.slice(0, firstLine - 1).join('\n');
  const after = lines.slice(firstLine - 1).join('\n');
  return `#include <Arduino.h>\n#line 1 ${q}\n${before}\n${prototypes.join('\n')}\n#line ${firstLine} ${q}\n${after}\n`;
}

// ------------------------------------------------------------------ compile
export interface CompileResult {
  ok: boolean;
  wasm?: Uint8Array;
  error?: PyErrorInfo;
  log: string;
  ms: number;
}

const MATH: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  pow: Math.pow,
  fmod: (a, b) => a % b,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)),
  sqrt: Math.sqrt,
  fabs: Math.abs,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  hypot: Math.hypot,
  cbrt: Math.cbrt,
  trunc: Math.trunc,
};
for (const k of Object.keys(MATH)) MATH[k + 'f'] = MATH[k];

/** first `file:line:col: error: message` of the clang/lld output, with the whole log as traceback */
export function parseCompileErrors(log: string, folder: string): PyErrorInfo {
  const lines = log.split('\n');
  const e = lines.map((l) => /^(.+?):(\d+):(\d+): (?:fatal )?error: (.*)$/.exec(l)).find(Boolean);
  if (e) {
    const file = e[1].replace(/^\.?\//, '');
    return { type: 'CompileError', message: e[4], traceback: log, file: file.startsWith(folder + '/') ? file : undefined, line: Number(e[2]) };
  }
  const ld = lines.find((l) => /wasm-ld: error:/.test(l));
  if (ld) return { type: 'LinkError', message: ld.replace(/^.*wasm-ld: error: /, ''), traceback: log };
  return { type: 'CompileError', message: lines.find((l) => /error/.test(l)) ?? 'compilation failed', traceback: log };
}

/** compile the controller's sketch (main .ino plus any .cpp/.c/.h files in its folder) */
export async function compileArduino(runClang: RunClang, files: { name: string; content: string }[], main: string, folder: string): Promise<CompileResult> {
  const t0 = performance.now();
  const own = files.filter((f) => f.name.startsWith(folder + '/'));
  const tree: Record<string, any> = { core: { ...ARDUINO_CORE } };
  const dir: Record<string, string> = {};
  tree[folder] = dir;
  const sources: string[] = [];
  for (const f of own) {
    const rel = f.name.slice(folder.length + 1);
    if (rel.includes('/')) continue; // sketch sub-folders are not compiled (like the Arduino IDE)
    if (f.name === main) {
      dir[rel + '.cpp'] = inoToCpp(f.content, f.name);
      sources.push(`${folder}/${rel}.cpp`);
    } else if (/\.(h|hpp)$/.test(rel)) dir[rel] = f.content;
    else if (/\.(cpp|c|cc)$/.test(rel)) {
      dir[rel] = `#line 1 ${JSON.stringify(f.name)}\n${f.content}`;
      sources.push(f.name);
    } else if (/\.ino$/.test(rel)) {
      // extra .ino tabs are appended to the main sketch by the IDE; here they are compiled as their own unit
      dir[rel + '.cpp'] = inoToCpp(f.content, f.name);
      sources.push(`${folder}/${rel}.cpp`);
    }
  }
  if (!sources.length) return { ok: false, log: '', ms: 0, error: { type: 'CompileError', message: `main sketch ${main} not found`, traceback: '' } };
  const args = [
    'clang++',
    '--target=wasm32',
    '-O2',
    '-std=gnu++17',
    '-nostdlib',
    '-nostdinc++',
    '-ffreestanding',
    '-fno-exceptions',
    '-fno-rtti',
    '-fno-threadsafe-statics',
    '-Wall',
    '-Wno-unused-variable',
    '-Wno-unused-function',
    '-fdiagnostics-absolute-paths',
    '-fno-color-diagnostics',
    '-Icore',
    `-I${folder}`,
    '-Wl,--no-entry',
    '-Wl,--allow-undefined',
    '-Wl,--export=__wasm_call_ctors',
    '-Wl,-z,stack-size=131072',
    ...sources,
    'core/core.cpp',
    '-o',
    'sketch.wasm',
  ];
  let log = '';
  const dec = new TextDecoder();
  const collect = (b: Uint8Array | null) => {
    if (b) log += dec.decode(b);
  };
  let out: Record<string, any>;
  try {
    out = await runClang(args, tree, { stdout: collect, stderr: collect });
  } catch {
    const cleaned = cleanLog(log);
    return { ok: false, log: cleaned, ms: performance.now() - t0, error: parseCompileErrors(cleaned, folder) };
  }
  const wasm = out['sketch.wasm'] as Uint8Array | undefined;
  if (!wasm) return { ok: false, log: cleanLog(log), ms: performance.now() - t0, error: parseCompileErrors(cleanLog(log), folder) };
  // functions the sketch calls but nobody defines: a real linker stops with "undefined reference"
  const mod = await WebAssembly.compile(wasm as BufferSource);
  const missing = WebAssembly.Module.imports(mod)
    .filter((i) => i.module === 'env' && i.kind === 'function' && !MATH[i.name])
    .map((i) => i.name);
  if (missing.length) {
    const msg = missing.map((n) => `undefined reference to '${n}'`).join('\n');
    return {
      ok: false,
      log: cleanLog(log) + msg,
      ms: performance.now() - t0,
      error: { type: 'LinkError', message: `${msg.split('\n')[0]} — the function is not defined in the sketch and not part of the simulator's Arduino core`, traceback: msg },
    };
  }
  return { ok: true, wasm, log: cleanLog(log), ms: performance.now() - t0 };
}

/** drop the driver's `-###` command echo and keep the diagnostics */
function cleanLog(log: string) {
  return log
    .split('\n')
    .filter((l) => !/^ "|^clang version|^Target:|^Thread model:|^InstalledDir:|^Build config:/.test(l))
    .join('\n');
}

// ------------------------------------------------------------------ run
const PIN_IRQ_MODE = { RISING: 1, FALLING: 2, CHANGE: 3, ONLOW: 4, ONHIGH: 5 };

class ResetSignal extends Error {}
class SketchError extends Error {
  constructor(
    readonly pyType: string,
    message: string,
  ) {
    super(message);
  }
}

function owRom(rid: string): number[] {
  const serial = rid.slice(3).match(/../g)!.map((h) => parseInt(h, 16));
  const body = [parseInt(rid.slice(0, 2), 16), ...serial.reverse()];
  let crc = 0;
  for (let b of body)
    for (let k = 0; k < 8; k++) {
      const mix = (crc ^ b) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      b >>= 1;
    }
  return [...body, crc];
}

function owId(rom: number[]) {
  return rom[0].toString(16).padStart(2, '0') + '-' + rom.slice(1, 7).reverse().map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** run a compiled sketch: setup() once, then loop() forever (until Stop or reset) */
export async function runArduino(wasm: Uint8Array, io: McuHostIO): Promise<McuRunResult> {
  let ex: any = null;
  const mem = () => new Uint8Array(ex.memory.buffer);
  const view = () => new DataView(ex.memory.buffer);
  const dec = new TextDecoder();
  const str = (p: number) => {
    if (!p) return '';
    const m = mem();
    let e = p;
    while (m[e]) e++;
    return dec.decode(m.subarray(p, e));
  };
  const irqMode = new Map<number, number>();
  const wires = new Map<number, { sda: number; scl: number }>();
  const call = (method: string, args: any) => {
    try {
      return io.call(method, args);
    } catch (e: any) {
      if (e instanceof StopSignal) throw e;
      if (e?.type === 'SystemExit') throw new ResetSignal();
      throw new SketchError(e?.type ?? 'RuntimeError', e?.message ?? String(e));
    }
  };
  const tryCall = (method: string, args: any): { ok: boolean; v?: any } => {
    try {
      return { ok: true, v: call(method, args) };
    } catch (e) {
      if (e instanceof SketchError) return { ok: false };
      throw e;
    }
  };
  const serviceEvents = () => {
    for (const e of call('events.take', {}) as any[]) {
      if (e.k !== 'edge') continue;
      const mode = irqMode.get(e.pin);
      if (!mode) continue;
      const fire = mode === PIN_IRQ_MODE.CHANGE || (mode === PIN_IRQ_MODE.RISING && e.v === 1) || (mode === PIN_IRQ_MODE.FALLING && e.v === 0) || (mode === PIN_IRQ_MODE.ONHIGH && e.v === 1) || (mode === PIN_IRQ_MODE.ONLOW && e.v === 0);
      if (fire) ex.arduino_isr(e.pin);
    }
  };
  const delayMs = (ms: number) => {
    const end = io.ticksMs() + Math.max(0, ms);
    for (;;) {
      const rem = end - io.ticksMs();
      if (rem <= 1e-3) {
        if (ms === 0 && io.wait(0) === 1) serviceEvents();
        return;
      }
      if (io.wait(rem) === 1) serviceEvents();
    }
  };
  const serialPins: Record<number, [number, number]> = { 1: [26, 27], 2: [16, 17] }; // default RX, TX (Arduino-ESP32 3.x)
  const hal: Record<string, (...a: number[]) => any> = {
    pin_mode: (pin, mode) => {
      if ((mode & 0xc0) === 0xc0) return call('adc.check', { pin });
      const out = (mode & 0x02) !== 0;
      const pull = mode & 0x04 ? 'up' : mode & 0x08 ? 'down' : 'none';
      call('pin.setup', { pin, mode: out ? 'output' : 'input', pull, owner: `pinMode(${pin})`, value: 0 });
    },
    digital_write: (pin, v) => call('pin.write', { pin, v: v ? 1 : 0 }),
    digital_read: (pin) => call('pin.read', { pin }),
    analog_read: (pin, bits, atten) => {
      const r = call('adc.read', { pin, atten: atten === 2 ? 2.5 : atten });
      return r.raw >> (12 - bits);
    },
    analog_read_mv: (pin, atten) => Math.round(call('adc.read', { pin, atten: atten === 2 ? 2.5 : atten }).volts * 1000),
    pwm_set: (pin, freq, duty) => call('pwm.set', { pin, freq, duty }),
    pwm_stop: (pin) => call('pin.release', { pin }),
    dac_write: (pin, v) => call('dac.write', { pin, v }),
    delay_ms: (ms) => delayMs(ms),
    millis: () => Math.floor(io.ticksMs()),
    micros: () => Math.floor(io.ticksMs() * 1000),
    serial_begin: (port, baud, rx, tx) => {
      if (port === 0) return;
      const [drx, dtx] = serialPins[port];
      call('uart.open', { n: port, rx: rx >= 0 ? rx : drx, tx: tx >= 0 ? tx : dtx, baud });
    },
    serial_end: (port) => port !== 0 && call('uart.close', { n: port }),
    serial_write: (port, p, n) => {
      const bytes = mem().slice(p, p + n);
      if (port === 0) io.stdout(dec.decode(bytes));
      else call('uart.write', { n: port, d: [...bytes] });
    },
    serial_available: (port) => (port === 0 ? 0 : call('uart.any', { n: port })),
    serial_read: (port) => {
      if (port === 0) return -1;
      const r = call('uart.read', { n: port, max: 1 });
      return r.d.length ? r.d[0] : -1;
    },
    wire_begin: (bus, sda, scl) => {
      wires.set(bus, { sda, scl });
      call('i2c.open', { sda, scl });
      return 0;
    },
    wire_xfer: (bus, addr, w, wlen, r, rlen) => {
      const b = wires.get(bus) ?? { sda: 21, scl: 22 };
      const res = tryCall('i2c.xfer', { sda: b.sda, scl: b.scl, addr, w: wlen ? [...mem().slice(w, w + wlen)] : null, n: rlen });
      if (!res.ok) return 2; // address NACK
      if (rlen) mem().set((res.v as number[]).slice(0, rlen), r);
      return 0;
    },
    dht_read: (pin, type, tp, hp) => {
      const res = tryCall('dht.read', { pin, kind: type === 11 ? 'DHT11' : 'DHT22' });
      if (!res.ok) return 1;
      const dv = view();
      dv.setFloat32(tp, res.v.t, true);
      dv.setFloat32(hp, res.v.h, true);
      return 0;
    },
    ow_scan: (pin, roms, max) => {
      const ids = call('ow.scan', { pin }) as string[];
      const m = mem();
      ids.slice(0, max).forEach((id, i) => m.set(owRom(id), roms + i * 8));
      return Math.min(ids.length, max);
    },
    ow_temp: (pin, rom, tp) => {
      const res = tryCall('ow.temp', { pin, rom: owId([...mem().slice(rom, rom + 8)]) });
      if (!res.ok) return 1;
      view().setFloat32(tp, res.v, true);
      return 0;
    },
    neopixel_show: (pin, p, n) => {
      const m = mem();
      const px: number[][] = [];
      for (let i = 0; i < n; i++) px.push([m[p + i * 3], m[p + i * 3 + 1], m[p + i * 3 + 2]]);
      call('np.write', { pin, px });
    },
    attach_interrupt: (pin, mode) => {
      irqMode.set(pin, mode);
      call('pin.irq', { pin, on: true });
    },
    detach_interrupt: (pin) => {
      irqMode.delete(pin);
      call('pin.irq', { pin, on: false });
    },
    random_u32: () => (Math.random() * 0x100000000) >>> 0,
    restart: () => call('board.reset', {}),
  };
  // Wi-Fi / MQTT calls go to the simulator's virtual network
  const net: Record<string, (...a: number[]) => any> = {
    wifi_begin: (ssid, pass) => {
      call('wifi.connect', { ssid: str(ssid), password: str(pass) });
      return 0;
    },
    wifi_status: () => call('wifi.status', {}).wl,
    wifi_disconnect: () => call('wifi.disconnect', {}),
    wifi_ip: (buf, max) => {
      const ip = new TextEncoder().encode(String(call('wifi.ip', {}) ?? '0.0.0.0'));
      const n = Math.min(ip.length, max - 1);
      mem().set(ip.slice(0, n), buf);
      mem()[buf + n] = 0;
      return n;
    },
    wifi_rssi: () => call('wifi.rssi', {}),
    mqtt_connect: (host, port, client, user, pass) => (tryCall('mqtt.connect', { host: str(host), port, client: str(client), user: str(user) || null, password: str(pass) || null }).ok ? 1 : 0),
    mqtt_connected: () => (call('mqtt.connected', {}) ? 1 : 0),
    mqtt_disconnect: () => call('mqtt.disconnect', {}),
    mqtt_publish: (topic, p, n, retain) => (tryCall('mqtt.publish', { topic: str(topic), payload: dec.decode(mem().slice(p, p + n)), retain: !!retain }).ok ? 1 : 0),
    mqtt_subscribe: (topic) => (tryCall('mqtt.subscribe', { topic: str(topic) }).ok ? 1 : 0),
    mqtt_unsubscribe: (topic) => (tryCall('mqtt.unsubscribe', { topic: str(topic) }).ok ? 1 : 0),
    mqtt_next: (tbuf, tmax, pbuf, pmax) => {
      const m = call('mqtt.next', {}) as { topic: string; payload: string } | null;
      if (!m) return -1;
      const enc = new TextEncoder();
      const t = enc.encode(m.topic).slice(0, tmax - 1);
      const p = enc.encode(m.payload).slice(0, pmax);
      const mm = mem();
      mm.set(t, tbuf);
      mm[tbuf + t.length] = 0;
      mm.set(p, pbuf);
      return p.length;
    },
    mqtt_state: () => call('mqtt.state', {}),
  };
  Object.assign(hal, net);
  const mod = await WebAssembly.compile(wasm as BufferSource);
  const env: Record<string, any> = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    if (i.module === 'env' && i.kind === 'function') env[i.name] = MATH[i.name] ?? (() => { throw new SketchError('LinkError', `undefined reference to '${i.name}'`); });
  }
  const inst = await WebAssembly.instantiate(mod, { arduino: hal, env });
  ex = inst.exports;
  try {
    ex.__wasm_call_ctors?.();
    ex.arduino_setup();
    for (;;) {
      ex.arduino_loop();
      // between two loop() calls the core yields: Stop, interrupts and the clock are serviced
      if (io.wait(0) === 1) serviceEvents();
    }
  } catch (e: any) {
    if (e instanceof StopSignal) return { status: 'stopped' };
    if (e instanceof ResetSignal) return { status: 'reset' };
    if (e instanceof SketchError) return { status: 'error', error: { type: e.pyType, message: e.message, traceback: `${e.pyType}: ${e.message}\n(Arduino sketch stopped by the simulator; on a real ESP32 the call would fail or log an error)\n` } };
    if (e instanceof WebAssembly.RuntimeError) {
      const msg = /unreachable/.test(e.message) ? 'abort() / pure virtual call' : e.message;
      return { status: 'error', error: { type: 'Guru Meditation Error', message: `${msg} (the program crashed: out-of-bounds memory, null pointer, stack overflow or division by zero)`, traceback: String(e.stack ?? e.message) } };
    }
    throw e;
  }
}
