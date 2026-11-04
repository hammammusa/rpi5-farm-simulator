// Runs a MicroPython program for one simulated ESP32. The real MicroPython 1.29 interpreter
// (official WebAssembly port) executes the user's code; the simulator's MicroPython modules
// (machine, time, dht, onewire, ds18x20, neopixel …) reach the engine through the `_hw`
// JavaScript module. The same code runs inside the browser worker and in the Node tests.
import SCHED from '../micropython/_sched.py?raw';
import MACHINE from '../micropython/machine.py?raw';
import TIME from '../micropython/time.py?raw';
import UTIME from '../micropython/utime.py?raw';
import DHT from '../micropython/dht.py?raw';
import ONEWIRE from '../micropython/onewire.py?raw';
import DS18X20 from '../micropython/ds18x20.py?raw';
import NEOPIXEL from '../micropython/neopixel.py?raw';
import NETWORK from '../micropython/network.py?raw';
import UMQTT_SIMPLE from '../micropython/umqtt_simple.py?raw';
import type { PyErrorInfo } from '../protocol';

export const MP_MODULES: Record<string, string> = {
  '_sched.py': SCHED,
  'machine.py': MACHINE,
  'time.py': TIME,
  'utime.py': UTIME,
  'dht.py': DHT,
  'onewire.py': ONEWIRE,
  'ds18x20.py': DS18X20,
  'neopixel.py': NEOPIXEL,
  'network.py': NETWORK,
  'umqtt/__init__.py': '',
  'umqtt/simple.py': UMQTT_SIMPLE,
};

/** thrown out of the interpreter when the user presses Stop (cannot be caught by `except`) */
export class StopSignal extends Error {
  constructor() {
    super('stopped');
  }
}

export interface McuHostIO {
  /** synchronous engine call: returns the value, or throws {type, message} */
  call(method: string, args: any): any;
  post(method: string, args: any): void;
  /** wait up to `ms` of simulation time; 1 = events are pending. Throws StopSignal on Stop. */
  wait(ms: number): 0 | 1;
  /** simulation milliseconds since the program started */
  ticksMs(): number;
  /** simulation time, seconds since the Unix epoch */
  epoch(): number;
  /** local time zone offset in seconds */
  tz(): number;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface McuRunResult {
  status: 'ok' | 'error' | 'stopped' | 'reset';
  error?: PyErrorInfo;
}

export type LoadMicroPython = (opts: { stdout: (l: string) => void; stderr: (l: string) => void; heapsize?: number }) => Promise<any>;

/** controller folder prefix (e.g. "esp1/") is removed: the board's filesystem starts there */
function boardFiles(files: { name: string; content: string }[], folder: string) {
  const pre = folder ? `${folder}/` : '';
  return files.filter((f) => !pre || f.name.startsWith(pre)).map((f) => ({ name: f.name.slice(pre.length), content: f.content }));
}

export function parseMpError(text: string, folder: string): PyErrorInfo {
  const lines = text.trim().split('\n');
  const last = lines[lines.length - 1] ?? '';
  const m = /^(\w+(?:\.\w+)*)(?::\s*(.*))?$/.exec(last.trim());
  const type = m?.[1] ?? 'Error';
  const message = m?.[2] ?? last;
  let file: string | undefined;
  let line: number | undefined;
  for (const l of lines) {
    const f = /File "([^"]+)", line (\d+)/.exec(l);
    if (f && !f[1].startsWith('<') && !f[1].startsWith('/lib/')) {
      file = (folder ? `${folder}/` : '') + f[1].replace(/^\.?\//, '');
      line = Number(f[2]);
    }
  }
  const clean = lines.filter((l) => !/File "<stdin>"/.test(l) && !/File "\/lib\//.test(l)).join('\n');
  return { type, message, traceback: clean + '\n', file, line };
}

export async function runMicroPython(load: LoadMicroPython, files: { name: string; content: string }[], main: string, folder: string, io: McuHostIO): Promise<McuRunResult> {
  let reset = false;
  const mp = await load({ stdout: (l) => io.stdout(l + '\n'), stderr: (l) => io.stderr(l + '\n'), heapsize: 8 * 1024 * 1024 });
  mp.registerJsModule('_hw', {
    call: (method: string, argsJson: string) => {
      try {
        return JSON.stringify({ v: io.call(method, JSON.parse(argsJson)) ?? null });
      } catch (e: any) {
        if (e instanceof StopSignal) throw e;
        if (e?.type === 'SystemExit') reset = true;
        return JSON.stringify({ e: e?.type ?? 'OSError', m: e?.message ?? String(e) });
      }
    },
    post: (method: string, argsJson: string) => io.post(method, JSON.parse(argsJson)),
    wait: (ms: number) => io.wait(Number(ms)),
    ticks_ms: () => io.ticksMs(),
    epoch: () => io.epoch(),
    tz: () => io.tz(),
  });
  const FS = mp.FS;
  const mkdirs = (path: string) => {
    const parts = path.split('/').slice(0, -1);
    let cur = '';
    for (const p of parts) {
      if (!p) continue;
      cur += `/${p}`;
      try {
        FS.mkdir(cur);
      } catch {
        /* exists */
      }
    }
  };
  for (const [name, src] of Object.entries(MP_MODULES)) {
    mkdirs(`/lib/${name}`);
    FS.writeFile(`/lib/${name}`, src);
  }
  const own = boardFiles(files, folder);
  for (const f of own) {
    mkdirs(`/${f.name}`);
    FS.writeFile(`/${f.name}`, f.content);
  }
  const entry = main.startsWith(`${folder}/`) ? main.slice(folder.length + 1) : main;
  try {
    mp.runPython(`
import sys
sys.path.insert(0, '/lib')
for _m in ('time', 'utime'):
    if _m in sys.modules:
        del sys.modules[_m]
import _sched
exec(compile(open(${JSON.stringify(entry)}).read(), ${JSON.stringify(entry)}, 'exec'), {'__name__': '__main__'})
while _sched.busy():
    _sched.wait_ms(1000)
`);
    return { status: 'ok' };
  } catch (e: any) {
    if (e instanceof StopSignal || e?.message === 'stopped') return { status: 'stopped' };
    if (reset) return { status: 'reset' };
    const text = String(e?.message ?? e);
    if (/KeyboardInterrupt/.test(text)) return { status: 'stopped' };
    return { status: 'error', error: parseMpError(text, folder) };
  }
}
