// Python → simulator call table, shared by the browser bridge and the Node test harness.
import { SimError, type Simulator } from '../engine/simulator';

export interface DispatchHooks {
  serve(port: number): void;
  stdin(): Promise<string> | string;
  httpResponse(a: { id: number; status: number; headers?: Record<string, string>; body?: string }): void;
}

/** Synchronous (request/response) calls. May return a Promise (stdin). */
export function dispatchRpc(s: Simulator, method: string, a: any, t: number, hooks: DispatchHooks): any {
  switch (method) {
    case 'gpio.setup':
      return s.gpioSetup(a.pin, a.mode, a.pull ?? 'none', a.owner ?? 'Python', a.initial ?? 0, t);
    case 'gpio.release':
      return s.gpioRelease(a.pin, t);
    case 'gpio.read':
      return s.gpioRead(a.pin, t);
    case 'gpio.write':
      return s.gpioWrite(a.pin, a.value, t);
    case 'gpio.watch':
      return s.gpioWatch(a.pin, a.on, a.bounce ?? 0);
    case 'gpio.pin':
      return s.checkPin(a.spec);
    case 'events.take':
      return s.takeEvents();
    case 'uart.open':
      return s.uartOpen(a.port, a.baud);
    case 'uart.close':
      return s.uartClose(a.port);
    case 'uart.read':
      return { d: s.uartRead(a.port, a.max, t), next: s.uartNext(a.port) };
    case 'uart.available':
      return s.uartAvailable(a.port, t);
    case 'uart.flush_input':
      return s.uartFlushInput(a.port);
    case 'uart.write':
      return s.uartWrite(a.port, a.data, t);
    case 'uart.baud':
      return s.uartSetBaud(a.port, a.baud);
    case 'i2c':
      return s.i2c(a.bus, a.addr, a.write ?? null, a.read ?? 0);
    case 'i2c.scan':
      return s.i2cScan();
    case 'spi.open':
      return s.spiOpen(a.bus, a.dev);
    case 'spi.xfer':
      return s.spiXfer(a.dev, a.data);
    case 'dht.read':
      return s.dhtRead(a.pin, a.kind);
    case 'w1.list':
      return s.w1List();
    case 'sim.hold_on_exit':
      return s.holdOnExit;
    case 'w1.read':
      return s.w1Read(a.id);
    case 'cpu.temp':
      return s.cpuTemp();
    case 'ultra.ping':
      return s.ultrasonicPing(a.trigger, a.echo, t);
    case 'ws2812.show':
      return s.ws2812Show(a.pin, a.pixels);
    case 'sim.read':
      return s.noteRead(String(a.comp ?? ''), String(a.what ?? ''), String(a.value ?? ''));
    case 'driver.loaded':
      s.pyEvent('import', `import ${a.module} (${a.kind === 'simulator' ? 'simulator-only module' : 'built-in, no installation'})`);
      return s.log(`Python driver loaded: ${a.module} (${a.kind})`);
    case 'http.serve':
      hooks.serve(a.port ?? 5000);
      s.log(`Web server listening on http://raspberrypi.local:${a.port ?? 5000}/`);
      return true;
    case 'stdin.readline':
      return hooks.stdin();
    case 'sim.log':
      return s.log(String(a.msg), a.level ?? 'info');
    default:
      throw new SimError('NotImplementedError', `Simulator call ${method} is not supported`);
  }
}

/** Fire-and-forget calls (ordered with RPCs because they share the message channel). */
export function dispatchPost(s: Simulator, method: string, a: any, t: number, hooks: DispatchHooks) {
  switch (method) {
    case 'gpio.write':
      return s.gpioWrite(a.pin, a.value, t);
    case 'gpio.pwm':
      return s.gpioPwm(a.pin, a.freq, a.duty, t);
    case 'gpio.pattern':
      return s.gpioPattern(a.pin, a.pattern, t);
    case 'uart.write':
      return s.uartWrite(a.port, a.data, t);
    case 'http.response':
      return hooks.httpResponse(a);
    case 'sim.log':
      return s.log(String(a.msg), a.level ?? 'info');
    case 'driver.loaded':
      s.pyEvent('import', `import ${a.module} (${a.kind === 'simulator' ? 'simulator-only module' : 'built-in, no installation'})`);
      return s.log(`Python driver loaded: ${a.module} (${a.kind})`);
  }
}

export function rpcResult(fn: () => any): any {
  try {
    return { ok: true, v: fn() ?? null };
  } catch (e: any) {
    if (e instanceof SimError) return { ok: false, type: e.pyType, msg: e.message };
    return { ok: false, type: 'RuntimeError', msg: String(e?.message ?? e) };
  }
}
