// The 15 mandatory acceptance tests (PART 16 of the specification).
// Each one runs the real runtime/simulator; results are never hard-coded.
import { EXAMPLES } from '../examples';
import { CircuitBuilder } from '../engine/project';
import { WIRE_COLORS as W } from '../engine/project';
import { sim } from '../state/engine';
import { deleteProject, loadProject, saveProject } from '../state/persist';
import type { Scenario } from './host';
import { getRuntime } from '../state/engine';

const ex = (n: number) => EXAMPLES[n - 1];

export const ACCEPTANCE: Scenario[] = [
  {
    id: 'T01',
    name: 'Basic GPIO — LED on GPIO17 blinks',
    expected: 'LED with 330 Ω on GPIO17 lights according to the code (1 s on / 1 s off)',
    run: (h) => ex(1).checks[0].run(h),
  },
  {
    id: 'T02',
    name: 'Incorrect GPIO wiring',
    expected: 'Wire moved to GPIO18 while code uses GPIO17 → LED does not follow GPIO17',
    async run(h) {
      const d = ex(1).build();
      d.wires = d.wires.map((w) => (w.from.pin === 'P11' ? { ...w, from: { ...w.from, pin: 'P12' } } : w));
      await h.load(d);
      await h.run();
      let lit = false;
      await h.waitSim(3.5, () => (lit ||= (h.vis('led1').brightness ?? 0) > 0.2));
      const codes = h.issueCodes();
      h.note(`issues: ${codes.join(', ')}`);
      return { pass: !lit && codes.includes('I_GPIO_NOT_IN_CODE'), actual: `LED lit: ${lit}; note "GPIO18 wired but not used": ${codes.includes('I_GPIO_NOT_IN_CODE')}` };
    },
  },
  {
    id: 'T03',
    name: 'Missing ground',
    expected: 'GND wire removed → LED stays dark and an open-circuit note is shown',
    async run(h) {
      const d = ex(1).build();
      d.wires = d.wires.filter((w) => !(w.from.pin === 'P6' || w.to.pin === 'P6'));
      await h.load(d);
      await h.run();
      let lit = false;
      await h.waitSim(2.5, () => (lit ||= (h.vis('led1').brightness ?? 0) > 0.2));
      const codes = h.issueCodes();
      return { pass: !lit && codes.includes('W_OPEN_CIRCUIT'), actual: `LED lit: ${lit}; issues: ${codes.join(', ')}` };
    },
  },
  {
    id: 'T04',
    name: 'Sensor data update (DHT22 25 → 35 °C)',
    expected: 'The running program reads the new temperature and switches the fan on',
    async run(h) {
      await h.load(ex(5).build());
      await h.run();
      await h.waitSim(2.5);
      const fanBefore = h.vis('fan').run ?? 0;
      h.setProp('dht', 'temperature', 35);
      await h.waitSim(4.5);
      const t = h.term();
      const fanAfter = h.vis('fan').run ?? 0;
      return { pass: t.includes('25.0 °C') && t.includes('35.0 °C') && fanBefore === 0 && fanAfter > 0.9, actual: `printed 25.0: ${t.includes('25.0 °C')}, printed 35.0: ${t.includes('35.0 °C')}, fan ${fanBefore} → ${fanAfter.toFixed(2)}` };
    },
  },
  { id: 'T05', name: 'Water safety', expected: 'Low water → protection code stops the pump and prints a warning', run: (h) => ex(6).checks[0].run(h) },
  {
    id: 'T06',
    name: 'UART and Nextion',
    expected: 'Python updates a Nextion element; a screen touch reaches Python and drives the pump',
    run: (h) => ex(13).checks[0].run(h),
  },
  {
    id: 'T07',
    name: 'Python runtime error',
    expected: 'print(1 / 0) → ZeroDivisionError: division by zero, line 1',
    async run(h) {
      await h.load(ex(1).build());
      await h.run('print(1 / 0)\n');
      await h.until(() => !!h.pyError(), 10);
      const e = h.pyError();
      return { pass: !!e && e.type === 'ZeroDivisionError' && e.message === 'division by zero' && e.line === 1 && h.term().includes('ZeroDivisionError: division by zero'), actual: e ? `${e.type}: ${e.message} (line ${e.line})` : 'no error reported' };
    },
  },
  {
    id: 'T08',
    name: 'Stop an infinite loop',
    expected: 'while True loop (no sleep) stops on Stop without freezing the UI',
    async run(h) {
      await h.load(ex(1).build());
      await h.run('n = 0\nwhile True:\n    n += 1\n');
      // the page must stay responsive while Python spins
      const t0 = performance.now();
      let late = 0;
      for (let i = 0; i < 10; i++) {
        const s = performance.now();
        await h.realWait(30);
        late = Math.max(late, performance.now() - s - 30);
      }
      const rt = getRuntime()!;
      const stopStart = performance.now();
      await h.stop();
      const stopMs = performance.now() - stopStart;
      await rt.whenReady();
      // runtime must be usable again
      await h.run('print("alive after stop")\n');
      await h.until(() => h.term().includes('alive after stop'), 10);
      void t0;
      return { pass: stopMs < 3000 && late < 250 && h.term().includes('alive after stop'), actual: `stopped in ${Math.round(stopMs)} ms, max UI timer delay ${Math.round(late)} ms, runtime reusable: ${h.term().includes('alive after stop')}` };
    },
  },
  {
    id: 'T09',
    name: 'Project persistence (IndexedDB round-trip)',
    expected: 'Saved project loads back with the same parts, wires, code and settings (page reload is covered by the browser e2e test)',
    async run(h) {
      const d = ex(5).build();
      d.id = `test-persist-${Date.now()}`;
      d.components = d.components.map((c) => (c.id === 'dht' ? { ...c, props: { ...c.props, temperature: 27.5 } } : c));
      d.files = [...d.files, { name: 'helper.py', content: 'X = 42\n' }];
      await saveProject(d);
      const back = await loadProject(d.id);
      await deleteProject(d.id);
      const same = !!back && JSON.stringify([back.components, back.wires, back.files, back.nextion, back.farm]) === JSON.stringify([d.components, d.wires, d.files, d.nextion, d.farm]);
      void h;
      return { pass: same, actual: same ? `${back!.components.length} parts, ${back!.wires.length} wires, ${back!.files.length} files identical` : 'mismatch after reload from IndexedDB' };
    },
  },
  {
    id: 'T10',
    name: 'GPIO safety (12 V on a GPIO)',
    expected: 'Clear electrical error; the connection is not treated as safe',
    async run(h) {
      const d = new CircuitBuilder().add('pi', 'rpi5', 20, 60).add('ps', 'power_supply', 500, 300, { volts: 12 }).wire('ps.P', 'pi.P11', W.red).wire('ps.N', 'pi.P6', W.black).doc({ name: 'T10' });
      await h.load(d);
      const codes = h.issueCodes();
      return { pass: codes.includes('E_GPIO_OVERVOLTAGE') && codes.includes('E_GPIO_EXTERNAL_SUPPLY'), actual: codes.join(', ') };
    },
  },
  {
    id: 'T11',
    name: 'Analog sensor needs an ADC',
    expected: 'pH sensor on a GPIO → error; through MCP3008 → valid pH reading',
    async run(h) {
      const direct = new CircuitBuilder()
        .add('pi', 'rpi5', 20, 60)
        .add('ph', 'ph_sensor', 500, 300)
        .wire('pi.P2', 'ph.VCC', W.red)
        .wire('pi.P6', 'ph.GND', W.black)
        .wire('ph.AO', 'pi.P15', W.yellow)
        .doc({ name: 'T11a' });
      await h.load(direct);
      const err = h.issueCodes().includes('E_ANALOG_NO_ADC');
      const r = await ex(8).checks[0].run(h);
      return { pass: err && r.pass, actual: `direct wiring error: ${err}; with MCP3008: ${r.actual}` };
    },
  },
  { id: 'T12', name: 'Relay control', expected: 'Python switches a correctly wired relay; contacts and pump follow', run: (h) => ex(7).checks[0].run(h) },
  { id: 'T13', name: 'Fertilizer pump interlock', expected: 'Conflicting request refused; A and B never run together', run: (h) => ex(17).checks[0].run(h) },
  {
    id: 'T14',
    name: 'Smart-farming integration',
    expected: 'Sensors → Python → GPIO → relay → pump → tank → Nextion → web, all linked',
    run: (h) => ex(20).checks[0].run(h),
  },
  {
    id: 'T15',
    name: 'Production deployment',
    expected: 'Runs on the HTTPS deployment: cross-origin isolated, Pyodide loaded, GPIO + farm tests pass',
    async run(h) {
      const https = location.protocol === 'https:';
      const local = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname);
      const iso = (globalThis as any).crossOriginIsolated === true;
      const rt = await h.ready();
      const gpio = await ex(1).checks[0].run(h);
      const farm = await ex(6).checks[0].run(h);
      const details = [`origin ${location.origin}`, `HTTPS ${https}`, `crossOriginIsolated ${iso}`, `Python ${rt.python} / Pyodide ${rt.version}`, `GPIO: ${gpio.actual}`, `farm: ${farm.actual}`];
      return {
        pass: https && !local && iso && gpio.pass && farm.pass,
        actual: local ? `running locally (${location.origin}) — open the deployed site and run this test there` : details.join('; '),
        details,
      };
    },
  },
];

void sim;
