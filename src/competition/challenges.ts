// City Farming practice challenges. Modelled on the published structure of the
// competition (Module A: controller + web interface, Module B: Nextion, hardware
// faults). These are training tasks, NOT official competition tasks.
import { farmCircuit } from '../examples/farmCircuit';
import { CFG_PY, HW_PY, INDEX_HTML, MAIN_PY, NX_PY, WEB_PY } from '../examples/competitionCode';
import { farmNextionTemplate } from '../examples/nextionTemplates';
import { defaultFarmConfig } from '../engine/farm';
import { WIRE_COLORS as W, uid } from '../engine/project';
import type { NextionRuntime } from '../engine/devices/nextion';
import type { ProjectDoc } from '../engine/types';
import { base, finish } from '../examples/types';
import { sim } from '../state/engine';
import type { Scenario, TestHost } from '../tests/host';
import type { Bi } from '../examples/types';

export interface Challenge {
  id: string;
  title: Bi;
  minutes: number;
  brief: Bi;
  tasks: Bi[];
  build(): ProjectDoc;
  checkpoints: Scenario[];
}

/** Replace the body of `def name(self...)` inside class Controller with `body` (4-space class indent). */
function stub(src: string, name: string, body: string) {
  const re = new RegExp(`(\\n    def ${name}\\(self[^\\n]*\\):\\n)([\\s\\S]*?)(?=\\n    def |\\n    # -{10}|\\n\\n\\S)`);
  if (!re.test(src)) throw new Error(`stub: ${name} not found`);
  return src.replace(re, (_m, head) => `${head}${body.replace(/^/gm, '        ')}\n`);
}

function setClock(hh: number, mm: number) {
  const d = new Date(sim.clock.nowMs());
  d.setHours(hh, mm, 0, 0);
  sim.clock.set(d.getTime());
  sim.farm.state.t = sim.clock.now();
  sim.evaluate();
}

function setLevel(pct: number) {
  sim.farm.state.reservoir.volumeL = (sim.doc.farm.reservoir.capacityL * pct) / 100;
  sim.evaluate();
}

const nx = () => sim.device('nx') as NextionRuntime | null;
const nxAttr = (page: number, name: string, attr = 'txt') => nx()?.liveOf(page, name)?.attrs[attr];

async function touch(h: TestHost, name: string) {
  sim.nextionTouch('nx', name, true);
  await h.waitSim(0.15);
  sim.nextionTouch('nx', name, false);
  await h.waitSim(0.6);
}

async function json(h: TestHost, method: string, path: string, body?: any) {
  const r = await h.http(method, path, body ? JSON.stringify(body) : '', body ? { 'Content-Type': 'application/json' } : {});
  let j: any = null;
  try {
    j = JSON.parse(r.body);
  } catch {
    /* not json */
  }
  return { status: r.status, j, body: r.body };
}

const farmOn = () => ({ ...defaultFarmConfig(), enabled: true });
/** every checkpoint starts from default settings (settings.json persists between runs) */
const FRESH = { 'settings.json': '{}' };

function farmDoc(files: Record<string, string>, name: string, id: string): ProjectDoc {
  const b = farmCircuit({ nextion: true, co2: true, dosing: true });
  const d = finish(b, name, id, files, { nextion: farmNextionTemplate(), farm: farmOn() });
  d.id = uid('p');
  return d;
}

const TODO_A = {
  protection: `# TODO A1: if the float switch reports low water (self.values["water_ok"] is False)
# or the analog level is below thresholds["level_min"], switch the pump OFF
# and return True. Otherwise return False.
return False`,
  automatic: `# TODO A2: grow light ON inside the photoperiod (self.light_wanted())
# TODO A3: pump ON during an irrigation window (self.irrigation_wanted()) unless low_water
# TODO A6: fan ON above temp_max / hum_max / co2_max, heater ON below temp_min (use hysteresis)
pass`,
  run_test: `# TODO A5: switch every channel in TEST_SEQUENCE on for 2 s, one after another,
# then set self.settings["mode"] = "AUTO". (Hint: use self.test_step / self.test_until.)
self.settings["mode"] = "AUTO"`,
};

const TODO_B = {
  update_screen: `# TODO B1: when self.nx.page == 0 send tTime, tTemp, tHum, tCO2, tPH, tEC, jLevel,
#          nLevel, nDay, tMode, tNext and tAlarm (red bco 63488 when there are alerts)
# TODO B2: page 1 -> btPump/btLight/btFan/btHeat .val = relay state, tMode
# TODO B3: page 2 -> tCrop, tThr, nDay
pass`,
  handle_touch: `# TODO B2: for ev in self.nx.events(): toggle relays in MANUAL mode,
#          "auto"/"manual" change the mode, "reset_day" resets the grow-day counter
self.nx.events()`,
};

export const CHALLENGES: Challenge[] = [
  {
    id: 'module-a',
    title: { en: 'Module A — controller & web interface', ar: 'الوحدة A — المتحكم وواجهة الويب' },
    minutes: 60,
    brief: {
      en: 'The hardware, drivers (hardware.py, nextion.py), settings and the Flask web interface are provided. Implement the control logic in main.py (look for TODO A1–A6). The web API contract is fixed: GET /api/state, POST /api/mode, /api/dose {"A": ml, "B": ml}, /api/test, /api/settings.',
      ar: 'العتاد والمشغلات (hardware.py وnextion.py) والإعدادات وواجهة Flask جاهزة. نفّذ منطق التحكم في main.py (ابحث عن TODO A1–A6). عقد واجهة الويب ثابت: GET /api/state، وPOST إلى /api/mode و/api/dose و/api/test و/api/settings.',
    },
    tasks: [
      { en: 'A1 Water-level protection stops the pump', ar: 'A1 حماية مستوى الماء توقف المضخة' },
      { en: 'A2 Grow-light photoperiod', ar: 'A2 فترة إضاءة النمو' },
      { en: 'A3 Irrigation schedule', ar: 'A3 جدول الري' },
      { en: 'A4 Dosing A then B with ±1 ml accuracy and interlock (provided Dosing class)', ar: 'A4 ضخ A ثم B بدقة ±1 مل مع قفل (صنف Dosing جاهز)' },
      { en: 'A5 Relay test mode', ar: 'A5 وضع اختبار المرحلات' },
      { en: 'A6 Climate: fan and heater by thresholds', ar: 'A6 المناخ: المروحة والسخان حسب الحدود' },
    ],
    build() {
      let main = MAIN_PY;
      for (const [k, v] of Object.entries(TODO_A)) main = stub(main, k, v);
      return farmDoc({ 'main.py': main, 'config.py': CFG_PY, 'hardware.py': HW_PY, 'nextion.py': NX_PY, 'web.py': WEB_PY, 'templates/index.html': INDEX_HTML }, 'Challenge · Module A', 'challenge-a');
    },
    checkpoints: [
      {
        id: 'A1',
        name: 'Water-level protection',
        expected: 'pump runs in an irrigation window with water, stops within 4 s when water is low',
        async run(h) {
          await h.load(null as any);
          setLevel(75);
          setClock(6, 1);
          await h.run(undefined, FRESH);
          await h.waitSim(4);
          const on = h.vis('pump').run ?? 0;
          setLevel(8);
          await h.waitSim(4);
          const off = h.vis('pump').run ?? 0;
          return { pass: on > 0.9 && off === 0, actual: `pump with water ${on.toFixed(2)}, after low water ${off}` };
        },
      },
      {
        id: 'A2',
        name: 'Grow-light photoperiod',
        expected: 'light ON at 12:00, OFF at 23:30 (defaults 06:00 + 16 h)',
        async run(h) {
          await h.load(null as any);
          setClock(12, 0);
          await h.run(undefined, FRESH);
          await h.waitSim(3);
          const day = h.vis('light').run ?? 0;
          setClock(23, 30);
          await h.waitSim(3);
          const night = h.vis('light').run ?? 0;
          return { pass: day > 0.9 && night === 0, actual: `12:00 → ${day.toFixed(2)}, 23:30 → ${night}` };
        },
      },
      {
        id: 'A3',
        name: 'Irrigation schedule',
        expected: 'pump ON at 10:02, OFF at 10:30 (window 10:00 + 5 min)',
        async run(h) {
          await h.load(null as any);
          setLevel(75);
          setClock(10, 2);
          await h.run(undefined, FRESH);
          await h.waitSim(3);
          const inWin = h.vis('pump').run ?? 0;
          setClock(10, 30);
          await h.waitSim(3);
          const outWin = h.vis('pump').run ?? 0;
          return { pass: inWin > 0.9 && outWin === 0, actual: `10:02 → ${inWin.toFixed(2)}, 10:30 → ${outWin}` };
        },
      },
      {
        id: 'A4',
        name: 'Dosing accuracy and interlock',
        expected: 'POST /api/dose {A:10,B:5} → 10±1 ml A, 5±1 ml B, never together',
        async run(h) {
          h.speed = 2;
          await h.load(null as any);
          await h.run(undefined, FRESH);
          await h.waitSim(3);
          const r = await json(h, 'POST', '/api/dose', { A: 10, B: 5 });
          await h.waitSim(14);
          const a = sim.farm.state.totals.doseAml;
          const b = sim.farm.state.totals.doseBml;
          const ab = sim.farm.state.alarms.some((x) => x.id === 'AB_SIMULTANEOUS');
          return { pass: r.status === 200 && Math.abs(a - 10) <= 1 && Math.abs(b - 5) <= 1 && !ab, actual: `HTTP ${r.status}, A ${a.toFixed(1)} ml, B ${b.toFixed(1)} ml, A+B overlap ${ab}` };
        },
      },
      {
        id: 'A5',
        name: 'Relay test mode',
        expected: 'POST /api/test switches pump, light, fan, heater, A and B on in turn',
        async run(h) {
          await h.load(null as any);
          setLevel(75);
          setClock(23, 30);
          await h.run(undefined, FRESH);
          await h.waitSim(2);
          await json(h, 'POST', '/api/test', {});
          const seen = new Set<string>();
          await h.waitSim(14, () => {
            for (const id of ['pump', 'light', 'fan', 'heater', 'doseA', 'doseB']) if (Math.abs(h.vis(id).run ?? 0) > 0.5) seen.add(id);
          });
          return { pass: seen.size === 6, actual: `channels seen ON: ${[...seen].join(', ')}` };
        },
      },
      {
        id: 'A6',
        name: 'Climate control',
        expected: 'fan ON when air > 26 °C; heater ON when air < 18 °C',
        async run(h) {
          await h.load(null as any);
          await h.run(undefined, FRESH);
          sim.farm.state.air.temp = 31;
          sim.evaluate();
          await h.waitSim(5);
          const fan = h.vis('fan').run ?? 0;
          sim.farm.state.air.temp = 14;
          sim.evaluate();
          await h.waitSim(5);
          const heater = h.vis('heater').run ?? 0;
          return { pass: fan > 0.9 && heater > 0.9, actual: `fan at 31 °C ${fan.toFixed(2)}, heater at 14 °C ${heater.toFixed(2)}` };
        },
      },
      {
        id: 'A7',
        name: 'Web interface state',
        expected: 'GET /api/state returns mode, values, relays, grow_day, alerts',
        async run(h) {
          await h.load(null as any);
          await h.run(undefined, FRESH);
          await h.waitSim(3);
          const r = await json(h, 'GET', '/api/state');
          const keys = ['mode', 'values', 'relays', 'grow_day', 'alerts', 'next_irrigation'];
          const missing = r.j ? keys.filter((k) => !(k in r.j)) : keys;
          return { pass: r.status === 200 && missing.length === 0, actual: `HTTP ${r.status}, missing: ${missing.join(', ') || 'none'}` };
        },
      },
    ],
  },
  {
    id: 'module-b',
    title: { en: 'Module B — Nextion interface', ar: 'الوحدة B — واجهة Nextion' },
    minutes: 45,
    brief: {
      en: 'The control logic is finished; the Nextion layout (4 pages) is loaded. Implement update_screen() and handle_touch() in main.py (TODO B1–B4) so the display shows live data and controls the farm.',
      ar: 'منطق التحكم جاهز وتصميم Nextion (4 صفحات) محمّل. نفّذ update_screen() وhandle_touch() في main.py (TODO B1–B4) لتعرض الشاشة البيانات الحية وتتحكم بالمزرعة.',
    },
    tasks: [
      { en: 'B1 Main page: time, sensors, level bar, grow day, mode, alarm', ar: 'B1 الصفحة الرئيسية: الوقت والحساسات وشريط المستوى ويوم النمو والوضع والإنذار' },
      { en: 'B2 Control page: MANUAL mode and relay buttons', ar: 'B2 صفحة التحكم: الوضع اليدوي وأزرار المرحلات' },
      { en: 'B3 Settings page: grow-day reset', ar: 'B3 صفحة الإعدادات: تصفير يوم النمو' },
      { en: 'B4 Alarm: LOW WATER in red', ar: 'B4 الإنذار: LOW WATER باللون الأحمر' },
    ],
    build() {
      let main = MAIN_PY;
      for (const [k, v] of Object.entries(TODO_B)) main = stub(main, k, v);
      return farmDoc({ 'main.py': main, 'config.py': CFG_PY, 'hardware.py': HW_PY, 'nextion.py': NX_PY, 'web.py': WEB_PY, 'templates/index.html': INDEX_HTML }, 'Challenge · Module B', 'challenge-b');
    },
    checkpoints: [
      {
        id: 'B1',
        name: 'Main page shows live data',
        expected: 'tTime = HH:MM:SS, tTemp = air temperature, nDay set, tMode = AUTO',
        async run(h) {
          await h.load(null as any);
          await h.run(undefined, FRESH);
          await h.waitSim(4);
          const time = String(nxAttr(0, 'tTime') ?? '');
          const temp = String(nxAttr(0, 'tTemp') ?? '');
          const mode = String(nxAttr(0, 'tMode') ?? '');
          const air = sim.farm.state.air.temp;
          return { pass: /^\d\d:\d\d:\d\d$/.test(time) && Math.abs(Number(temp) - air) < 1.5 && mode === 'AUTO', actual: `tTime="${time}", tTemp="${temp}" (air ${air.toFixed(1)}), tMode="${mode}"` };
        },
      },
      {
        id: 'B2',
        name: 'Manual relay control from the screen',
        expected: 'Control → MANUAL → Pump button switches the pump relay on',
        async run(h) {
          await h.load(null as any);
          setLevel(75);
          setClock(23, 30);
          await h.run(undefined, FRESH);
          await h.waitSim(2);
          await touch(h, 'bControl');
          await touch(h, 'bManual');
          await touch(h, 'btPump');
          await h.waitSim(1.5);
          const pump = h.vis('pump').run ?? 0;
          const val = nxAttr(1, 'btPump', 'val');
          return { pass: nx()?.page === 1 && pump > 0.9 && val === 1, actual: `page ${nx()?.page}, pump ${pump.toFixed(2)}, btPump.val ${val}` };
        },
      },
      {
        id: 'B3',
        name: 'Grow-day reset',
        expected: 'Settings → Reset day sets the counter to 0',
        async run(h) {
          await h.load(null as any);
          const start = new Date(sim.clock.nowMs() - 5 * 86400_000);
          const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
          await h.run(undefined, { 'settings.json': JSON.stringify({ grow_start: iso }) });
          await h.waitSim(3);
          const before = nxAttr(0, 'nDay', 'val');
          await touch(h, 'bSettings');
          await touch(h, 'bResetDay');
          await h.waitSim(1.5);
          const after = nxAttr(2, 'nDay', 'val');
          return { pass: before === 5 && after === 0, actual: `day before ${before}, after reset ${after}` };
        },
      },
      {
        id: 'B4',
        name: 'Low-water alarm on screen',
        expected: 'tAlarm shows LOW WATER with red background (63488)',
        async run(h) {
          await h.load(null as any);
          await h.run(undefined, FRESH);
          await h.waitSim(2);
          setLevel(8);
          await h.waitSim(4);
          const txt = String(nxAttr(0, 'tAlarm') ?? '');
          const bco = nxAttr(0, 'tAlarm', 'bco');
          return { pass: txt.includes('LOW WATER') && bco === 63488, actual: `tAlarm="${txt}", bco=${bco}` };
        },
      },
    ],
  },
  {
    id: 'faults',
    title: { en: 'Hardware fault hunt', ar: 'البحث عن أعطال العتاد' },
    minutes: 20,
    brief: {
      en: 'This pump station has 6 hardware faults: a short circuit, a wrong polarity, a missing power wire, wrong relay contact wiring, a disconnected sensor and a pump that does not respond. The code is correct — fix the circuit (use the Problems tab, hover pins, check the Inspector and the fault settings).',
      ar: 'في محطة الضخ هذه 6 أعطال: قصر كهربائي، قطبية معكوسة، سلك تغذية مفقود، توصيل خاطئ لتلامس المرحل، حساس مفصول، ومضخة لا تستجيب. الكود صحيح — أصلح الدائرة (استخدم تبويب المشكلات وتفحص الأطراف ولوحة الخصائص وإعدادات الأعطال).',
    },
    tasks: [
      { en: 'Find and remove the short circuit', ar: 'اعثر على القصر وأزله' },
      { en: 'Fix the status LED polarity', ar: 'أصلح قطبية LED الحالة' },
      { en: 'Power the relay board', ar: 'غذِّ وحدة المرحل' },
      { en: 'Pump on NO, not NC', ar: 'المضخة على NO لا NC' },
      { en: 'Reconnect the DHT22 data line', ar: 'أعد توصيل خط بيانات DHT22' },
      { en: 'Replace the failed pump (clear its fault)', ar: 'استبدل المضخة المعطلة (أزل العطل)' },
    ],
    build() {
      const b = base('Faults');
      b.add('dht', 'dht22', 480, 400, { temperature: 24, humidity: 55 }, 0, 'DHT22');
      b.add('r1', 'resistor', 450, 320, { ohms: 330 }, 0, '330 Ω');
      b.add('led1', 'led', 520, 290, { color: 'green' }, 0, 'Status LED');
      b.add('rl', 'relay_module', 620, 60, { channels: 1, trigger: 'low' }, 0, 'Relay');
      b.add('ps', 'power_supply', 620, 420, { volts: 12 }, 0, '12 V');
      b.add('pump', 'water_pump', 850, 220, { role: 'none', fault: 'open_winding' }, 0, 'Pump');
      b.wire('pi.P1', 'dht.VCC', W.red).wire('pi.P9', 'dht.GND', W.black);
      b.wire('pi.P13', 'r1.1', W.yellow, 'GPIO27').wire('r1.2', 'led1.K', W.yellow).wire('led1.A', 'pi.P20', W.black);
      b.wire('pi.P17', 'pi.P25', W.white, 'extra wire');
      b.wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
      b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NC1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
      const code = `import time
import board
import adafruit_dht
from gpiozero import LED, OutputDevice

pump = OutputDevice(17, active_high=False, initial_value=False)
status = LED(27)
dht = adafruit_dht.DHT22(board.D4)

while True:
    try:
        print("T=%.1f" % dht.temperature)
    except RuntimeError as e:
        print("sensor error:", e)
    pump.on()
    status.on()
    print("pump ON")
    time.sleep(3)
    pump.off()
    status.off()
    print("pump OFF")
    time.sleep(3)
`;
      const d = finish(b, 'Challenge · Fault hunt', 'challenge-faults', { 'main.py': code });
      d.id = uid('p');
      return d;
    },
    checkpoints: [
      { id: 'F1', name: 'No short circuit', expected: 'no short-circuit error', async run(h) { await h.load(null as any); const c = h.issueCodes(); return { pass: !c.includes('E_SHORT_RAIL') && !c.includes('E_GPIO_SHORT'), actual: c.filter((x) => x.startsWith('E_')).join(', ') || 'no errors' }; } },
      {
        id: 'F2',
        name: 'Status LED works',
        expected: 'LED lights while GPIO27 is HIGH',
        async run(h) {
          await h.load(null as any);
          await h.run();
          let lit = false;
          await h.waitSim(2.5, () => (lit ||= (h.vis('led1').brightness ?? 0) > 0.2));
          return { pass: lit, actual: `LED lit during ON phase: ${lit}` };
        },
      },
      {
        id: 'F3',
        name: 'Relay powered and switching',
        expected: 'relay energises during the ON phase',
        async run(h) {
          await h.load(null as any);
          await h.run();
          let en = false;
          await h.waitSim(2.5, () => (en ||= !!h.vis('rl').ch?.[0]?.energised));
          return { pass: en, actual: `relay energised: ${en}` };
        },
      },
      {
        id: 'F4',
        name: 'Pump only runs when commanded',
        expected: 'pump ON during ON phase, OFF during OFF phase',
        async run(h) {
          await h.load(null as any);
          await h.run();
          await h.waitSim(1.5);
          const on = h.vis('pump').run ?? 0;
          await h.waitSim(3);
          const off = h.vis('pump').run ?? 0;
          return { pass: on > 0.9 && off === 0, actual: `ON phase ${on.toFixed(2)}, OFF phase ${off.toFixed(2)}` };
        },
      },
      {
        id: 'F5',
        name: 'DHT22 connected',
        expected: 'program prints T=…',
        async run(h) {
          await h.load(null as any);
          await h.run();
          await h.waitSim(1);
          return { pass: /T=\d/.test(h.term()), actual: h.term().split('\n').find((l) => l.startsWith('T=') || l.startsWith('sensor error')) ?? '' };
        },
      },
      {
        id: 'F6',
        name: 'Circuit is clean',
        expected: 'no electrical errors or warnings left',
        async run(h) {
          await h.load(null as any);
          await h.run();
          await h.waitSim(1);
          const bad = sim.issues.filter((i) => i.severity !== 'info').map((i) => i.code);
          return { pass: bad.length === 0, actual: bad.join(', ') || 'clean' };
        },
      },
    ],
  },
];

/** Reference solutions used by the self-test (they must pass every checkpoint). */
export function referenceDoc(id: string): ProjectDoc {
  if (id === 'module-a' || id === 'module-b') return farmDoc({ 'main.py': MAIN_PY, 'config.py': CFG_PY, 'hardware.py': HW_PY, 'nextion.py': NX_PY, 'web.py': WEB_PY, 'templates/index.html': INDEX_HTML }, 'Reference', 'challenge-ref');
  const d = CHALLENGES[2].build();
  d.wires = d.wires.filter((w) => w.label !== 'extra wire');
  d.wires = d.wires.map((w) => {
    if (w.from.comp === 'r1' && w.to.pin === 'K') return { ...w, to: { comp: 'led1', pin: 'A' } };
    if (w.from.comp === 'led1' && w.from.pin === 'A') return { ...w, from: { comp: 'led1', pin: 'K' } };
    if (w.from.pin === 'NC1') return { ...w, from: { ...w.from, pin: 'NO1' } };
    return w;
  });
  d.wires.push({ id: 'fix1', from: { comp: 'pi', pin: 'P2' }, to: { comp: 'rl', pin: 'VCC' }, color: W.red }, { id: 'fix2', from: { comp: 'pi', pin: 'P7' }, to: { comp: 'dht', pin: 'DATA' }, color: W.yellow });
  d.components = d.components.map((c) => (c.id === 'pump' ? { ...c, props: { ...c.props, fault: 'none' } } : c));
  return d;
}

// exposed for the browser end-to-end tests (self-test of the challenges against reference solutions)
(globalThis as any).__rpi5challenges = { CHALLENGES, referenceDoc };
