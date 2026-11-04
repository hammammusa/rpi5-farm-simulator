// wb-rules for the simulated Wiren Board: the user's JavaScript runs in a QuickJS sandbox
// (WebAssembly) with the wb-rules API from prelude.js. The sandbox reaches the outside world
// only through the controller's MQTT broker and the host primitives below; every call into it
// has a time budget, so an endless loop is interrupted instead of freezing the page.
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSRuntime, type QuickJSHandle } from 'quickjs-emscripten';
import PRELUDE from './prelude.js?raw';
import type { Simulator } from '../../engine/simulator';
import type { PyErrorInfo } from '../protocol';

export const RULES_CLIENT = 'wb-rules';
const BUDGET_MS = 250;

export interface WbRulesCallbacks {
  log(level: 'info' | 'warning' | 'error' | 'debug', text: string): void;
}

export interface WbRulesResult {
  ok: boolean;
  error?: PyErrorInfo;
}

let quickjs: ReturnType<typeof getQuickJS> | null = null;

/** "    at fn (wb/rules.js:12:5)" → file and line of the first user frame */
export function parseJsError(dump: any, scripts: string[]): PyErrorInfo {
  const stack = String(dump?.stack ?? '');
  let file: string | undefined;
  let line: number | undefined;
  if (dump?.fileName && scripts.includes(dump.fileName) && dump.lineNumber) {
    file = dump.fileName;
    line = Number(dump.lineNumber);
  }
  for (const l of file ? [] : stack.split('\n')) {
    const m = /([^()\s]+?):(\d+)(?::\d+)?\)?$/.exec(l.trim());
    if (m && scripts.includes(m[1])) {
      file = m[1];
      line = Number(m[2]);
      break;
    }
  }
  const type = dump?.name ?? 'Error';
  const message = dump?.message === 'interrupted' ? 'the script ran for too long (endless loop?) and was interrupted' : String(dump?.message ?? dump);
  return { type, message, traceback: `${type}: ${message}\n${stack}`, file, line };
}

export class WbRulesEngine {
  private rt: QuickJSRuntime | null = null;
  private vm: QuickJSContext | null = null;
  private api: QuickJSHandle | null = null;
  private timers = new Map<number, { at: number; ms: number; periodic: boolean }>();
  private nextTimer = 1;
  private lastTick = 0;
  private scripts: string[] = [];
  /** messages that arrive while a rule runs are delivered after it returns (MQTT is asynchronous) */
  private depth = 0;
  private pending: { topic: string; payload: string }[] = [];
  running = false;

  constructor(
    private sim: Simulator,
    readonly id: string,
    private cb: WbRulesCallbacks,
  ) {}

  private get wb() {
    const w = this.sim.wb.get(this.id);
    if (!w) throw new Error('no Wiren Board with id ' + this.id);
    return w;
  }

  private now() {
    return this.sim.clock.now();
  }

  /** load the prelude and every .js file of the controller's folder (main first, like /etc/wb-rules) */
  async start(files: { name: string; content: string }[], main: string): Promise<WbRulesResult> {
    this.stop();
    if (!this.wb.powered()) return { ok: false, error: { type: 'PowerError', message: 'the Wiren Board is not powered (connect 9…48 V DC to V+ and GND)', traceback: '' } };
    quickjs ??= getQuickJS();
    const Q = await quickjs;
    const rt = Q.newRuntime();
    rt.setMemoryLimit(64 * 1024 * 1024);
    rt.setMaxStackSize(1024 * 1024);
    const vm = rt.newContext();
    this.rt = rt;
    this.vm = vm;
    this.running = true;
    const fn = (name: string, f: (...a: any[]) => any) => {
      const h = vm.newFunction(name, (...args: QuickJSHandle[]) => {
        const r = f(...args.map((a) => vm.dump(a)));
        if (typeof r === 'number') return vm.newNumber(r);
        return undefined;
      });
      vm.setProp(vm.global, name, h);
      h.dispose();
    };
    fn('__host_publish', (topic: string, payload: string, retain: boolean) => {
      try {
        this.wb.broker.publish(RULES_CLIENT, topic, payload, !!retain, this.now());
      } catch (e: any) {
        this.cb.log('error', `publish("${topic}"): ${e.message}`);
      }
    });
    fn('__host_subscribe', (filter: string) => {
      try {
        this.wb.broker.subscribe(RULES_CLIENT, filter, this.now());
      } catch (e: any) {
        this.cb.log('error', `trackMqtt("${filter}"): ${e.message}`);
      }
    });
    fn('__host_log', (level: any, text: string) => this.cb.log(level, text));
    fn('__host_timer', (ms: number, periodic: boolean) => {
      const id = this.nextTimer++;
      this.timers.set(id, { at: this.now() + ms / 1000, ms, periodic: !!periodic });
      return id;
    });
    fn('__host_cancel', (id: number) => void this.timers.delete(id));
    fn('__host_now', () => this.now() * 1000);
    const pre = vm.evalCode(PRELUDE, 'wb-rules-prelude.js');
    if (pre.error) {
      const d = vm.dump(pre.error);
      pre.error.dispose();
      this.stop();
      return { ok: false, error: { type: 'InternalError', message: String(d?.message ?? d), traceback: String(d?.stack ?? '') } };
    }
    pre.value.dispose();
    this.api = vm.getProp(vm.global, '__wb');
    // the engine sees every control (retained values arrive at once, before the scripts load)
    this.wb.broker.connect(RULES_CLIENT, (m) => {
      if (this.depth > 0) this.pending.push({ topic: m.topic, payload: m.payload });
      else this.call('onMessage', m.topic, m.payload);
    });
    this.wb.broker.subscribe(RULES_CLIENT, '/devices/#', this.now());
    const scripts = files.filter((f) => f.name.startsWith(this.id + '/') && f.name.endsWith('.js')).sort((a, b) => (a.name === main ? -1 : b.name === main ? 1 : a.name.localeCompare(b.name)));
    this.scripts = scripts.map((s) => s.name);
    for (const s of scripts) {
      rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 2000));
      const r = vm.evalCode(s.content, s.name);
      if (r.error) {
        const err = parseJsError(vm.dump(r.error), this.scripts);
        r.error.dispose();
        this.stop();
        return { ok: false, error: err };
      }
      r.value.dispose();
    }
    const n = this.call('ruleCount') as number;
    this.cb.log('info', `wb-rules: loaded ${scripts.length} script(s), ${n} rule(s)`);
    this.call('start');
    this.lastTick = this.now();
    return { ok: true };
  }

  /** call an entry point of the sandbox with a time budget */
  private call(name: string, ...args: (string | number)[]): any {
    const vm = this.vm;
    if (!vm || !this.api) return undefined;
    this.rt!.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + BUDGET_MS));
    const f = vm.getProp(this.api, name);
    const hs = args.map((a) => (typeof a === 'number' ? vm.newNumber(a) : vm.newString(a)));
    this.depth++;
    let r;
    try {
      r = vm.callFunction(f, vm.undefined, ...hs);
    } finally {
      this.depth--;
      f.dispose();
      hs.forEach((h) => h.dispose());
    }
    if (this.depth === 0) this.drain();
    if (r.error) {
      const e = parseJsError(vm.dump(r.error), this.scripts);
      r.error.dispose();
      this.cb.log('error', `ERROR: ${e.type}: ${e.message}${e.file ? ` (${e.file}:${e.line})` : ''}`);
      return undefined;
    }
    const v = vm.dump(r.value);
    r.value.dispose();
    return v;
  }

  private drain() {
    for (let guard = 0; this.pending.length && this.vm && guard < 10000; guard++) {
      const m = this.pending.shift()!;
      this.call('onMessage', m.topic, m.payload);
    }
  }

  /** advance timers and cron to simulation time t (called on every simulation step) */
  poll(t = this.now()) {
    if (!this.running) return;
    if (!this.wb.powered()) {
      this.cb.log('error', 'wb-rules stopped: the controller lost power');
      this.stop();
      return;
    }
    for (let guard = 0; guard < 1000; guard++) {
      let due: number | null = null;
      let at = Infinity;
      for (const [id, tm] of this.timers) if (tm.at <= t && tm.at < at) (due = id), (at = tm.at);
      if (due === null) break;
      const tm = this.timers.get(due)!;
      if (tm.periodic) tm.at += Math.max(tm.ms, 1) / 1000;
      else this.timers.delete(due);
      this.call('onTimer', due);
      if (!this.running) return;
    }
    if (Math.floor(t) !== Math.floor(this.lastTick)) this.call('onTick', Math.floor(t) * 1000);
    this.lastTick = t;
  }

  stop() {
    this.running = false;
    this.timers.clear();
    this.pending = [];
    try {
      this.sim.wb.get(this.id)?.broker.disconnect(RULES_CLIENT);
    } catch {
      /* gone */
    }
    this.api?.dispose();
    this.api = null;
    this.vm?.dispose();
    this.vm = null;
    this.rt?.dispose();
    this.rt = null;
  }
}
