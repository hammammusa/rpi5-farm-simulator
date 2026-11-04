// Calls from a microcontroller program (MicroPython or Arduino) to the simulation engine.
// Every call is bound to ONE controller (its component id): the program can only touch the
// pins and buses of its own board.
import { SimError, type Simulator } from '../../engine/simulator';
import type { McuEvent } from '../../engine/controllers';

export interface McuHooks {
  /** text the program sends to its serial console (Serial / print) */
  console?(text: string): void;
  /** the program asked for a board reset (machine.reset / ESP.restart) */
  reset?(): void;
}

function hash32(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Synchronous request; returns a JSON-serialisable value or throws SimError. */
export function mcuCall(sim: Simulator, id: string, method: string, a: any, t: number, hooks: McuHooks = {}): any {
  switch (method) {
    case 'pin.setup':
      sim.mcuSetup(id, a.pin, a.mode, a.pull ?? 'none', a.owner ?? `GPIO${a.pin}`, a.value ?? 0, t);
      return null;
    case 'pin.write':
      sim.mcuWrite(id, a.pin, a.v, t);
      return null;
    case 'pin.read':
      return sim.mcuRead(id, a.pin, t).value;
    case 'pin.release':
      sim.mcuRelease(id, a.pin, t);
      return null;
    case 'pin.irq':
      sim.mcuWatch(id, a.pin, !!a.on, a.bounce ?? 0);
      return null;
    case 'pwm.set':
      sim.mcuPwm(id, a.pin, a.freq, a.duty, t);
      return null;
    case 'adc.check':
      sim.boardPin(sim.controller(id), a.pin, 'adc');
      return null;
    case 'adc.read':
      return sim.mcuAdc(id, a.pin, a.atten ?? 11, t);
    case 'i2c.open':
      return null;
    case 'i2c.scan':
      return sim.mcuI2cScan(id, a.sda, a.scl);
    case 'i2c.xfer':
      return sim.mcuI2c(id, a.sda, a.scl, a.addr, a.w ?? null, a.n ?? 0);
    case 'dht.read': {
      const r = sim.mcuDht(id, a.pin, a.kind) as any;
      if (r.error) throw new SimError('OSError', '[Errno 110] ETIMEDOUT');
      return { t: r.temperature, h: r.humidity };
    }
    case 'ow.open':
      return null;
    case 'ow.scan':
      return sim.mcuW1Scan(id, a.pin);
    case 'ow.temp': {
      const txt = sim.mcuW1Read(id, a.pin, a.rom);
      if (!txt || !/YES/.test(txt)) throw new SimError('OSError', '[Errno 5] EIO: CRC error or sensor not found');
      return Number(/t=(-?\d+)/.exec(txt)![1]) / 1000;
    }
    case 'uart.open':
      sim.mcuUartOpen(id, a.n, a.tx, a.rx, a.baud, t);
      return null;
    case 'uart.close':
      sim.mcuUartClose(id, a.n);
      return null;
    case 'uart.write':
      sim.mcuUartWrite(id, a.n, a.d, t);
      return a.d.length;
    case 'uart.read':
      return { d: sim.mcuUartRead(id, a.n, a.max ?? 4096, t), any: sim.mcuUartAny(id, a.n, t) };
    case 'uart.any':
      return sim.mcuUartAny(id, a.n, t);
    case 'np.write':
      sim.mcuNeopixel(id, a.pin, a.px);
      return null;
    case 'events.take':
      return sim.controller(id).takeEvents().filter((e: McuEvent) => e.k !== 'stop');
    case 'board.uid': {
      const h = hash32(id);
      return [0x24, 0x0a, 0xc4, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
    }
    case 'board.reset':
      hooks.reset?.();
      throw new SimError('SystemExit', 'machine.reset()');
    case 'console':
      hooks.console?.(String(a.text ?? ''));
      return null;
    default:
      throw new SimError('NotImplementedError', `${method} is not available on this controller`);
  }
}

/** Fire-and-forget request (writes); errors become a console warning instead of an exception. */
export function mcuPost(sim: Simulator, id: string, method: string, a: any, t: number, hooks: McuHooks = {}) {
  try {
    mcuCall(sim, id, method, a, t, hooks);
  } catch (e: any) {
    hooks.console?.(`\n[simulator] ${e?.message ?? e}\n`);
  }
}
