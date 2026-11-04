// Runs controller programs (real MicroPython, compiled Arduino sketches) in Node against the
// real Simulator with a virtual wall clock — the same host code the browser worker uses.
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs';
import { Simulator, SimError } from '../../src/engine/simulator';
import type { ProjectDoc } from '../../src/engine/types';
import { mcuCall, mcuPost } from '../../src/runtime/mcu/dispatch';
import { runMicroPython, StopSignal, type McuHostIO, type McuRunResult } from '../../src/runtime/mcu/mpHost';
import { compileArduino, runArduino, type CompileResult } from '../../src/runtime/arduino/arduinoHost';

let clang: any = null;
/** real Clang/LLD (YoWASP, LLVM 22 compiled to WebAssembly) */
export async function runClang(...a: any[]) {
  clang ??= await import('@yowasp/clang');
  return clang.runClang(...a);
}

export class McuHarness {
  wall = 0;
  sim: Simulator;
  t0 = 0;
  limit = 10;
  stdout = '';
  stderr = '';
  stopRequested = false;
  /** called at every waiting step with the elapsed simulation seconds */
  onWait: ((h: McuHarness, elapsed: number) => void) | null = null;

  constructor(doc: ProjectDoc | Simulator) {
    this.sim = doc instanceof Simulator ? doc : new Simulator(doc, Date.UTC(2026, 4, 1, 8, 0, 0));
    const start = this.sim.clock.nowMs();
    (this.sim.clock as any).wall = () => this.wall;
    this.sim.clock.epoch = start;
    this.sim.clock.anchor = 0;
    this.sim.farm.reset(this.sim.doc.farm, this.sim.clock.now());
  }

  now() {
    return this.sim.clock.now();
  }

  elapsed() {
    return this.now() - this.t0;
  }

  advance(s: number) {
    this.wall += s * 1000;
    this.sim.tick();
  }

  io(id: string): McuHostIO {
    const sim = this.sim;
    const hooks = { console: (t: string) => (this.stdout += t) };
    return {
      call: (m, a) => {
        if (this.stopRequested) throw new StopSignal();
        try {
          return mcuCall(sim, id, m, a, this.now(), hooks);
        } catch (e) {
          if (e instanceof SimError) throw { type: e.pyType, message: e.message };
          throw e;
        }
      },
      post: (m, a) => mcuPost(sim, id, m, a, this.now(), hooks),
      wait: (ms) => {
        let rem = Math.max(0, ms) / 1000;
        const io = sim.controller(id);
        if (io.events.length) return 1;
        do {
          const step = Math.max(Math.min(rem, 0.05), 0.0001);
          this.advance(step);
          rem -= step;
          this.onWait?.(this, this.elapsed());
          if (this.elapsed() > this.limit || this.stopRequested) throw new StopSignal();
          if (io.events.length) return 1;
        } while (rem > 1e-9);
        return 0;
      },
      ticksMs: () => this.elapsed() * 1000,
      epoch: () => this.now(),
      tz: () => 0,
      stdout: (t) => (this.stdout += t),
      stderr: (t) => (this.stderr += t),
    };
  }

  /** compile and run the Arduino sketch of controller `id` for at most `seconds` of simulation time */
  async runArduino(id: string, seconds = 10): Promise<McuRunResult & { stdout: string; stderr: string; compile: CompileResult }> {
    const doc = this.sim.doc;
    const prog = doc.controllers?.[id];
    if (!prog) throw new Error(`no program for ${id}`);
    const compile = await compileArduino(runClang, doc.files, prog.main, id);
    if (!compile.ok) return { status: 'error', error: compile.error, stdout: '', stderr: compile.log, compile };
    this.limit = seconds;
    this.t0 = this.now();
    this.stdout = '';
    this.stderr = '';
    this.sim.controllerStart(id);
    let r: McuRunResult;
    try {
      r = await runArduino(compile.wasm!, this.io(id));
    } finally {
      this.sim.controllerEnd(id);
    }
    return { ...r, stdout: this.stdout, stderr: this.stderr, compile };
  }

  /** run the MicroPython program of controller `id` for at most `seconds` of simulation time */
  async runMicroPython(id: string, seconds = 10): Promise<McuRunResult & { stdout: string; stderr: string }> {
    this.limit = seconds;
    this.t0 = this.now();
    this.stdout = '';
    this.stderr = '';
    this.sim.controllerStart(id);
    const doc = this.sim.doc;
    const prog = doc.controllers?.[id];
    if (!prog) throw new Error(`no program for ${id}`);
    let r: McuRunResult;
    try {
      r = await runMicroPython(loadMicroPython as any, doc.files, prog.main, id, this.io(id));
    } finally {
      this.sim.controllerEnd(id);
    }
    return { ...r, stdout: this.stdout, stderr: this.stderr };
  }
}
