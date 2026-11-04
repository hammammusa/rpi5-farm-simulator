// Wiren Board 7.4: power, A1–A4 outputs/inputs/ADC, 1-Wire, Modbus RTU on RS-485, the MQTT
// broker with the wb-mqtt-* drivers, and wb-rules scripts running in QuickJS.
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { Simulator } from '../../src/engine/simulator';
import { WbRulesEngine } from '../../src/runtime/wb/wbRules';
import { McuHarness } from './mcuharness';

/** WB7 on a 24 V supply (common GND) */
const wb = (volts = 24) =>
  new CircuitBuilder()
    .add('wb', 'wb74', 0, 0)
    .add('ps', 'power_supply', 300, 0, { volts, amps: 10 })
    .wire('ps.P', 'wb.VIN1')
    .wire('ps.N', 'wb.GND1');

class WbHarness {
  h: McuHarness;
  logs: string[] = [];
  rules: WbRulesEngine;
  constructor(doc: any) {
    this.h = new McuHarness(doc);
    this.rules = new WbRulesEngine(this.h.sim, 'wb', { log: (lv, t) => this.logs.push(`${lv}: ${t}`) });
    this.h.sim.wb.get('wb')!.onLog = (l) => this.logs.push(`${l.level}: [${l.src}] ${l.msg}`);
  }
  get sim(): Simulator {
    return this.h.sim;
  }
  get broker() {
    return this.sim.wb.get('wb')!.broker;
  }
  value(topic: string) {
    return this.broker.retained.get(topic)?.payload;
  }
  /** advance simulation time in 50 ms steps */
  run(seconds: number, each?: (t: number) => void) {
    const t0 = this.sim.clock.now();
    while (this.sim.clock.now() - t0 < seconds - 1e-9) {
      this.h.advance(0.05);
      this.rules.poll();
      each?.(this.sim.clock.now() - t0);
    }
  }
  send(topic: string, payload: string) {
    this.broker.publish('test', topic, payload, false, this.sim.clock.now());
    this.h.advance(0.05);
  }
}

describe('Wiren Board 7.4 hardware and drivers', () => {
  it('starts only with 9…48 V: at 5 V it stays off with a warning', () => {
    const off = new WbHarness(wb(5).doc());
    off.run(1);
    expect(off.sim.vis.get('wb')?.powered).toBe(false);
    expect(off.sim.issues.some((i) => i.code === 'W_WB_UNDERVOLTAGE')).toBe(true);
    const on = new WbHarness(wb(24).doc());
    on.run(1);
    expect(on.sim.vis.get('wb')?.powered).toBe(true);
    expect(on.value('/devices/wb-adc/controls/Vin')).toBe('24');
    expect(on.value('/devices/wb-gpio/controls/A1_OUT/meta/type')).toBe('switch');
  });

  it('A1_OUT switches a 12 V pump to GND (open collector); over-current protection trips above 1 A', () => {
    const d = wb(12).add('pump', 'water_pump', 300, 200).wire('pump.P', 'ps.P').wire('pump.N', 'wb.A1').add('heater', 'heater', 400, 200, { watts: 60 }).wire('heater.P', 'ps.P').wire('heater.N', 'wb.A2').doc();
    const w = new WbHarness(d);
    w.run(0.5);
    expect(w.sim.vis.get('pump')?.run ?? 0).toBeLessThan(0.1);
    w.send('/devices/wb-gpio/controls/A1_OUT/on', '1');
    w.run(0.3);
    expect(w.value('/devices/wb-gpio/controls/A1_OUT')).toBe('1');
    expect(w.sim.vis.get('pump')?.run).toBeGreaterThan(0.8);
    w.send('/devices/wb-gpio/controls/A1_OUT/on', '0');
    w.run(0.3);
    expect(w.sim.vis.get('pump')?.run ?? 0).toBeLessThan(0.1);
    // 60 W heater = 5 A: far above the 1 A output rating
    w.send('/devices/wb-gpio/controls/A2_OUT/on', '1');
    w.run(0.5);
    expect(w.sim.vis.get('wb')?.a[1].trip).toBe(true);
    expect(w.value('/devices/wb-gpio/controls/A2_OUT')).toBe('0');
    expect(w.logs.join('\n')).toMatch(/A2: over-current protection/);
    expect(w.sim.getRuntimeIssues().some((i) => i.code === 'W_WB_OUT_OVERCURRENT')).toBe(true);
  });

  it('A2 reads a dry contact (closed = 0) and A3 measures a voltage divider through wb-adc', () => {
    const d = wb(24)
      .add('btn', 'button', 300, 300)
      .wire('btn.1a', 'wb.A2')
      .wire('btn.2a', 'wb.GND2')
      .add('r1', 'resistor', 400, 300, { ohms: 10000 })
      .add('r2', 'resistor', 400, 400, { ohms: 10000 })
      .wire('ps.P', 'r1.1')
      .wire('r1.2', 'wb.A3')
      .wire('wb.A3', 'r2.1')
      .wire('r2.2', 'ps.N')
      .doc();
    const w = new WbHarness(d);
    w.run(0.5);
    expect(w.value('/devices/wb-gpio/controls/A2_IN')).toBe('1');
    w.sim.pressButton('btn', true);
    w.run(0.2);
    expect(w.value('/devices/wb-gpio/controls/A2_IN')).toBe('0');
    const v = Number(w.value('/devices/wb-adc/controls/A3'));
    expect(v).toBeGreaterThan(11);
    expect(v).toBeLessThan(12.2);
  });

  it('DS18B20 on W1 appears as wb-w1/28-… with its temperature', () => {
    const d = wb(24).add('t', 'ds18b20', 300, 300, { temperature: 18.25 }).wire('t.DQ', 'wb.W1').wire('t.GND', 'wb.GND3').wire('t.VCC', 'wb.W2').doc();
    // VCC from W2's 5 V pull-up is too weak: power the probe in parasite-free mode from a 5 V supply instead
    d.components.push({ id: 'ps5', type: 'power_supply', x: 500, y: 300, rotation: 0, props: { volts: 5, amps: 1 } });
    d.wires = d.wires.filter((x) => !(x.from.comp === 't' && x.from.pin === 'VCC'));
    d.wires.push({ id: 'wv', from: { comp: 't', pin: 'VCC' }, to: { comp: 'ps5', pin: 'P' }, color: '#e00' }, { id: 'wg', from: { comp: 'ps5', pin: 'N' }, to: { comp: 'wb', pin: 'GND3' }, color: '#000' });
    const w = new WbHarness(d);
    w.run(1.5);
    const topic = [...w.broker.retained.keys()].find((k) => /^\/devices\/wb-w1\/controls\/28-[0-9a-f]{12}$/.test(k));
    expect(topic).toBeDefined();
    expect(Number(w.value(topic!))).toBeCloseTo(18.25, 1);
  });

  it('wb-mqtt-serial: WB-MR6C on RS-485-1 (Modbus RTU coils) and a soil probe; swapped A/B and baud mismatch time out', () => {
    const d = wb(12)
      .add('mr', 'wb_mr6c', 300, 200, { slave: 32 })
      .wire('mr.VIN', 'ps.P').wire('mr.GND', 'ps.N').wire('mr.A', 'wb.RS1_A').wire('mr.B', 'wb.RS1_B')
      .add('pump', 'water_pump', 500, 200, { role: 'circulation' })
      .wire('ps.P', 'mr.COM1').wire('mr.NO1', 'pump.P').wire('pump.N', 'ps.N')
      .add('soil', 'rs485_soil', 300, 400, { slave: 1, moisture: 37.5, temperature: -2.5 })
      .wire('soil.VCC', 'ps.P').wire('soil.GND', 'ps.N').wire('soil.A', 'wb.RS1_A').wire('soil.B', 'wb.RS1_B')
      .doc();
    const w = new WbHarness(d);
    w.run(1.5);
    expect(w.value('/devices/wb-mr6c_32/controls/K1')).toBe('0');
    expect(w.value('/devices/soil-probe_1/controls/Moisture')).toBe('37.5');
    expect(w.value('/devices/soil-probe_1/controls/Temperature')).toBe('-2.5');
    w.send('/devices/wb-mr6c_32/controls/K1/on', '1');
    w.run(0.3);
    expect(w.value('/devices/wb-mr6c_32/controls/K1')).toBe('1');
    expect(w.sim.vis.get('pump')?.run).toBeGreaterThan(0.8);
    expect(w.sim.vis.get('mr')?.ch[0]).toBe(true);
    // the probe now answers at another baud rate: timeouts, /meta/error = "r"
    const doc2 = { ...w.sim.doc, components: w.sim.doc.components.map((c) => (c.id === 'soil' ? { ...c, props: { ...c.props, baud: 4800 } } : c)) };
    w.sim.setDoc(doc2);
    w.run(2);
    expect(w.value('/devices/soil-probe_1/controls/Moisture/meta/error')).toBe('r');
    expect(w.logs.join('\n')).toMatch(/modbus: request timed out \(slave 1, soil-probe_1\)/);
  });

  it('A and B swapped on the relay module: logged as swapped, the module never appears', () => {
    const d = wb(24).add('mr', 'wb_mr6c', 300, 200, { slave: 32 }).wire('mr.VIN', 'ps.P').wire('mr.GND', 'ps.N').wire('mr.A', 'wb.RS1_B').wire('mr.B', 'wb.RS1_A').doc();
    const w = new WbHarness(d);
    w.run(1.5);
    expect(w.logs.join('\n')).toMatch(/A and B are swapped/);
    expect(w.value('/devices/wb-mr6c_32/controls/K1')).toBeUndefined();
  });
});

describe('wb-rules in QuickJS', () => {
  const withRules = (b: CircuitBuilder, code: string) => {
    const d = b.doc();
    d.files.push({ name: 'wb/rules.js', content: code });
    d.controllers = { wb: { language: 'wbrules', main: 'wb/rules.js' } };
    return d;
  };

  it('whenChanged: a dry contact on A2 switches the pump on A1; virtual device, log formatting', async () => {
    const d = withRules(
      wb(12).add('btn', 'button', 300, 300).wire('btn.1a', 'wb.A2').wire('btn.2a', 'wb.GND2').add('pump', 'water_pump', 300, 200).wire('pump.P', 'ps.P').wire('pump.N', 'wb.A1'),
      `defineVirtualDevice("irrigation", {
  title: "Irrigation",
  cells: {
    enabled: { type: "switch", value: true },
    runs: { type: "value", value: 0, readonly: true }
  }
});

defineRule("button_to_pump", {
  whenChanged: "wb-gpio/A2_IN",
  then: function (newValue, devName, cellName) {
    var pressed = !newValue;            // closed contact reads 0
    if (!dev["irrigation/enabled"]) return;
    dev["wb-gpio/A1_OUT"] = pressed;
    if (pressed) dev.irrigation.runs = dev.irrigation.runs + 1;
    log("{}/{} = {} -> pump {}", devName, cellName, newValue, pressed ? "ON" : "OFF");
  }
});
`,
    );
    const w = new WbHarness(d);
    w.run(0.3);
    const r = await w.rules.start(d.files, 'wb/rules.js');
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    w.run(0.3);
    w.sim.pressButton('btn', true);
    w.run(0.3);
    expect(w.sim.vis.get('pump')?.run).toBeGreaterThan(0.8);
    expect(w.value('/devices/irrigation/controls/runs')).toBe('1');
    expect(w.logs.join('\n')).toContain('wb-gpio/A2_IN = false -> pump ON');
    w.sim.pressButton('btn', false);
    w.run(0.3);
    expect(w.sim.vis.get('pump')?.run ?? 0).toBeLessThan(0.1);
    // switching the virtual device off from MQTT (like the web UI) disables the rule
    w.send('/devices/irrigation/controls/enabled/on', '0');
    w.sim.pressButton('btn', true);
    w.run(0.3);
    expect(w.sim.vis.get('pump')?.run ?? 0).toBeLessThan(0.1);
    w.rules.stop();
  });

  it('timers: setTimeout, setInterval, startTimer/timers.x.firing, asSoonAs and cron @every', async () => {
    const d = withRules(
      wb(24),
      `defineVirtualDevice("t", { title: "t", cells: { level: { type: "value", value: 0 }, ticks: { type: "value", value: 0 }, alarm: { type: "switch", value: false }, cronRuns: { type: "value", value: 0 } } });
var n = 0;
setTimeout(function () { log("timeout after 1 s"); }, 1000);
var iv = setInterval(function () { n++; dev["t/ticks"] = n; if (n === 3) clearInterval(iv); }, 500);
startTimer("delay", 2000);
defineRule({ when: function () { return timers.delay.firing; }, then: function () { log("named timer fired"); } });
defineRule("high_level", { asSoonAs: function () { return dev["t/level"] > 80; }, then: function () { dev["t/alarm"] = true; log.warning("level high: {}", dev["t/level"]); } });
defineRule("every2", { cron: "@every 2s", then: function () { dev["t/cronRuns"] = dev["t/cronRuns"] + 1; } });
`,
    );
    const w = new WbHarness(d);
    w.run(0.3);
    const r = await w.rules.start(d.files, 'wb/rules.js');
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    w.run(2.6);
    expect(w.logs.join('\n')).toContain('timeout after 1 s');
    expect(w.logs.join('\n')).toContain('named timer fired');
    expect(w.value('/devices/t/controls/ticks')).toBe('3');
    w.send('/devices/t/controls/level/on', '50');
    w.run(0.2);
    expect(w.value('/devices/t/controls/alarm')).toBe('0');
    w.send('/devices/t/controls/level/on', '90');
    w.run(0.2);
    expect(w.value('/devices/t/controls/alarm')).toBe('1');
    expect(w.logs.join('\n')).toContain('warning: level high: 90');
    w.run(4);
    expect(Number(w.value('/devices/t/controls/cronRuns'))).toBeGreaterThanOrEqual(2);
    w.rules.stop();
  });

  it('syntax errors stop loading with file and line; runtime errors are logged and the engine keeps running; endless loops are interrupted', async () => {
    const bad = withRules(wb(24), `defineRule("x", {\n  whenChanged: "wb-gpio/A1_IN",\n  then: function () {\n    log("a"\n  }\n});\n`);
    const w1 = new WbHarness(bad);
    w1.run(0.3);
    const r1 = await w1.rules.start(bad.files, 'wb/rules.js');
    expect(r1.ok).toBe(false);
    expect(r1.error?.type).toBe('SyntaxError');
    expect(r1.error?.file).toBe('wb/rules.js');
    expect(r1.error?.line).toBeGreaterThanOrEqual(4);
    const d = withRules(
      wb(24),
      `defineVirtualDevice("v", { title: "v", cells: { x: { type: "value", value: 0 }, y: { type: "value", value: 0 } } });
defineRule("broken", { whenChanged: "v/x", then: function () { var o = null; o.field = 1; } });
defineRule("spin", { whenChanged: "v/y", then: function () { while (true) {} } });
`,
    );
    const w = new WbHarness(d);
    w.run(0.3);
    expect((await w.rules.start(d.files, 'wb/rules.js')).ok).toBe(true);
    w.send('/devices/v/controls/x/on', '5');
    w.run(0.1);
    expect(w.logs.join('\n')).toMatch(/ERROR in rule "broken": TypeError: cannot set property 'field' of null[\s\S]*wb\/rules\.js:2/);
    const t0 = Date.now();
    w.send('/devices/v/controls/y/on', '1');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(w.logs.join('\n')).toMatch(/interrupted|too long/);
    // still alive
    expect(w.rules.running).toBe(true);
    w.rules.stop();
  });

  it('Modbus relay through wb-rules: dev["wb-mr6c_32/K1"] = true closes K1 after the driver answers', async () => {
    const d = withRules(
      wb(12)
        .add('mr', 'wb_mr6c', 300, 200, { slave: 32 })
        .wire('mr.VIN', 'ps.P').wire('mr.GND', 'ps.N').wire('mr.A', 'wb.RS1_A').wire('mr.B', 'wb.RS1_B')
        .add('pump', 'water_pump', 500, 200).wire('ps.P', 'mr.COM2').wire('mr.NO2', 'pump.P').wire('pump.N', 'ps.N'),
      `setTimeout(function () { dev["wb-mr6c_32/K2"] = true; log("K2 right after the write: {}", dev["wb-mr6c_32/K2"]); }, 1500);
defineRule({ whenChanged: "wb-mr6c_32/K2", then: function (v) { log("driver confirmed K2 = {}", v); } });
`,
    );
    const w = new WbHarness(d);
    w.run(0.3);
    expect((await w.rules.start(d.files, 'wb/rules.js')).ok).toBe(true);
    w.run(2.5);
    const log = w.logs.join('\n');
    // like on a real controller the value changes only when wb-mqtt-serial confirms the write
    expect(log).toContain('K2 right after the write: false');
    expect(log).toContain('driver confirmed K2 = true');
    expect(w.sim.vis.get('pump')?.run).toBeGreaterThan(0.8);
    w.rules.stop();
  });
});
