// The 10 test scenarios of every COMPETITION MASTER project. A scenario changes only what a person
// could change on a real farm (air temperature, reservoir volume, a button, a sensor fault, a loose
// wire, the time of day) and then judges the REAL program output (Pyodide, MicroPython or wb-rules)
// and the simulated circuit. Nothing is pre-recorded: the same definitions run in the Node tests
// and in the browser (Tests button of the study panel).
import type { ProjectDoc } from '../../engine/types';
import type { Simulator } from '../../engine/simulator';
import type { Bi } from '../dsl';

export type MasterBoard = 'pi' | 'esp' | 'wb';

/** what a scenario may do while the program runs */
export interface MasterCtl {
  sim: Simulator;
  board: MasterBoard;
  /** change the circuit (props, faults, wires) the way the editor does */
  editDoc(fn: (d: ProjectDoc) => ProjectDoc): void;
  /** what the sampler and the events noted during the run */
  mem: MasterMem;
}

export interface MasterMem {
  [k: string]: any;
}

export interface MasterScenario {
  id: string;
  name: Bi;
  /** what the scenario does, step by step */
  does: Bi;
  expected: Bi;
  seconds: number;
  /** time of day at the start [h, m, s]; default 08:00:00 */
  start?: [number, number, number];
  /** `run` returning false means "not possible yet": it is tried again at the next sample */
  events: { at: number; run: (c: MasterCtl) => void | boolean }[];
  /** judged on the combined program output and what was sampled during the run; null = pass */
  verify: (out: string, mem: MasterMem, c: MasterCtl) => string | null;
}

// ---------------------------------------------------------------- helpers
const run = (s: Simulator, id: string) => Math.abs(s.vis.get(id)?.run ?? 0) > 0.5;
const lampOn = (s: Simulator) => (s.vis.get('lamp')?.brightness ?? 0) > 0.1;

/** the time-of-day the programs see: UTC in the Node tests (time zone 0), local time in the browser */
export function startAt(sim: Simulator, hms: [number, number, number], utc: boolean) {
  const now = new Date(sim.clock.nowMs());
  // always a later moment than now (the farm only integrates forward): the next day at h:m:s
  const ms = utc
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, hms[0], hms[1], hms[2])
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hms[0], hms[1], hms[2]).getTime();
  sim.clock.set(ms);
  sim.farm.reset(sim.doc.farm, sim.clock.now());
}

/** DOSING / TEST command: a hardware button on the Pi and the ESP32, a virtual pushbutton (MQTT) on the WB */
function command(c: MasterCtl, which: 'dosing' | 'test', down: boolean): boolean {
  if (c.board === 'wb') {
    if (!down) return true;
    const wb = c.sim.wb.get('wb');
    const control = `/devices/farm/controls/${which === 'dosing' ? 'start_dosing' : 'start_test'}`;
    // a pushbutton message is not retained: it is only heard once the rules have created the
    // "farm" device, so wait for that like a person waits for the controller to boot
    if (!wb || ![...wb.broker.retained.keys()].some((k) => k.startsWith(control))) return false;
    wb.broker.publish('ui', `${control}/on`, '1', false, c.sim.clock.now());
    return true;
  }
  c.sim.pressButton(which === 'dosing' ? 'btnDose' : 'btnTest', down);
  return true;
}

/** run the events that are due, in order; one that is not possible yet stays first in the queue */
export function runDueEvents(events: MasterScenario['events'], t: number, c: MasterCtl) {
  while (events.length && t >= events[0].at) {
    if (events[0].run(c) === false) break;
    events.shift();
  }
}

/** hold a button for 1.5 s (the main loop looks at the buttons once per second) */
const press = (which: 'dosing' | 'test', at: number) => [
  { at, run: (c: MasterCtl) => command(c, which, true) },
  { at: at + 1.5, run: (c: MasterCtl) => command(c, which, false) },
];

const setAir = (temp: number) => (c: MasterCtl) => {
  c.sim.farm.state.air.temp = temp;
};
const setLevel = (pct: number) => (c: MasterCtl) => {
  c.sim.farm.state.reservoir.volumeL = (c.sim.doc.farm.reservoir.capacityL * pct) / 100;
};
const setProps = (id: string, props: Record<string, any>) => (c: MasterCtl) =>
  c.editDoc((d) => ({ ...d, components: d.components.map((k) => (k.id === id ? { ...k, props: { ...k.props, ...props } } : k)) }));

/** the air-temperature / humidity sensor of each board */
const airSensor = (b: MasterBoard) => (b === 'wb' ? 'air' : 'dht');
/** the relay contact that feeds the pump through the ACS712 */
const pumpWire = (b: MasterBoard) => (b === 'wb' ? ['mr', 'NO1'] : ['rl4', 'NO1']);

const count = (out: string, re: RegExp) => (out.match(new RegExp(re.source, 'g')) ?? []).length;
const need = (out: string, ...res: RegExp[]) => {
  let at = 0;
  for (const re of res) {
    const m = new RegExp(re.source).exec(out.slice(at));
    if (!m) return `missing "${re.source}" in the program output`;
    at += m.index + m[0].length;
  }
  return null;
};
const all = (...r: (string | null)[]) => r.find((x) => x) ?? null;

/** the sampler used by every scenario: what ran, when, and whether A and B ever ran together */
export function sampleMaster(sim: Simulator, t: number, mem: MasterMem, dt: number) {
  for (const id of ['pump', 'fan', 'light', 'doseA', 'doseB']) {
    if (run(sim, id)) {
      mem[`${id}On`] = (mem[`${id}On`] ?? 0) + dt;
      mem[`${id}First`] ??= t;
      mem[`${id}Last`] = t;
    }
    mem[`${id}Now`] = run(sim, id);
  }
  if (run(sim, 'doseA') && run(sim, 'doseB')) mem.together = true;
  if (lampOn(sim)) mem.lampSeen = true;
  mem.lampNow = lampOn(sim);
  // exact amounts integrated by the farm model, independent of how often the page samples:
  // the main pump moves 4 L/min, so its running time is litres ÷ (4/60)
  mem.pumpSec = sim.farm.state.totals.circulatedL / (4 / 60);
  mem.doseA = sim.farm.state.totals.doseAml;
  mem.doseB = sim.farm.state.totals.doseBml;
  (mem.lightTrace ??= [] as [number, boolean][]).push([t, run(sim, 'light')]);
}

const near = (v: number, want: number, tol: number, what: string) => (Math.abs(v - want) <= tol ? null : `${what} was ${v.toFixed(1)}, expected ${want} ± ${tol}`);

// ---------------------------------------------------------------- the 10 scenarios
export function masterScenarios(board: MasterBoard): MasterScenario[] {
  const sensor = airSensor(board);
  const [relay, contact] = pumpWire(board);
  const dosingHow: Bi = board === 'wb' ? ['press farm/start_dosing (MQTT)', 'اضغط farm/start_dosing ‏(MQTT)'] : ['press the DOSING button for 1.5 s', 'اضغط زر DOSING لمدة 1.5 ثانية'];
  const testHow: Bi = board === 'wb' ? ['press farm/start_test (MQTT)', 'اضغط farm/start_test ‏(MQTT)'] : ['press the TEST button for 1.5 s', 'اضغط زر TEST لمدة 1.5 ثانية'];
  return [
    {
      id: 'normal',
      name: ['1 · Normal', '1 · التشغيل العادي'],
      does: ['08:00, 25 °C, water 75 %: run for 12 s without touching anything.', 'الساعة 08:00، الحرارة 25 °م، الماء 75٪: شغّل 12 ثانية دون أي تدخل.'],
      expected: ['STATUS lines with all readings, mode AUTO, light ON (06–20 h), fan and pump OFF, alarm NONE, alarm lamp off.', 'أسطر STATUS بكل القراءات، الوضع AUTO، الإضاءة تعمل (06–20)، المروحة والمضخة متوقفتان، الإنذار NONE، مصباح الإنذار مطفأ.'],
      seconds: 12,
      events: [],
      verify: (out, m, c) =>
        all(
          need(out, /STATUS mode=AUTO temp=25(\.0)? hum=60(\.0)? co2=6\d\d ph=6\.\d+ ec=1\.\d+ level=7\d pump=OFF fan=OFF light=ON alarm=NONE day=1/),
          /ALARM (?!NONE)/.test(out) ? 'an alarm was raised in normal conditions' : null,
          m.pumpOn || m.fanOn ? 'the pump or the fan ran in normal conditions' : null,
          m.lightNow ? null : 'the grow light should be on at 08:00',
          m.lampSeen ? 'the alarm lamp lit in normal conditions' : null,
          board === 'esp' ? nextionText(c.sim, 'tMode', 'AUTO') ?? nextionText(c.sim, 'tAlarm', 'NONE') : null,
        ),
    },
    {
      id: 'high_temp',
      name: ['2 · High temperature (25 → 35 °C)', '2 · ارتفاع الحرارة (25 ← 35 °م)'],
      does: ['At 3 s the air goes to 35 °C, at 9 s to 28.5 °C (between the two thresholds), at 15 s to 25 °C.', 'عند 3 ث تصبح الحرارة 35 °م، وعند 9 ث تصبح 28.5 °م (بين الحدين)، وعند 15 ث تصبح 25 °م.'],
      expected: ['Fan ON and HIGH TEMPERATURE alarm above 30 °C; at 28.5 °C the alarm clears but the fan stays ON (hysteresis); below 27 °C the fan stops.', 'تعمل المروحة ويظهر إنذار HIGH TEMPERATURE فوق 30 °م؛ عند 28.5 °م يزول الإنذار وتبقى المروحة تعمل (هامش التخلّف)؛ وتحت 27 °م تتوقف المروحة.'],
      seconds: 21,
      events: [
        { at: 3, run: setAir(35) },
        { at: 8.5, run: (c) => (c.mem.fanAt8 = run(c.sim, 'fan')) },
        { at: 9, run: setAir(28.5) },
        { at: 14.5, run: (c) => (c.mem.fanAt14 = run(c.sim, 'fan')) },
        { at: 15, run: setAir(25) },
      ],
      verify: (out, m) =>
        all(
          need(out, /ALARM HIGH TEMPERATURE/, /ALARM NONE/),
          m.fanAt8 ? null : 'the fan should run at 35 °C',
          m.fanAt14 ? null : 'the fan should keep running at 28.5 °C (it stops only below 27 °C)',
          m.fanNow ? 'the fan should stop at 25 °C' : null,
          m.lampSeen ? null : 'the alarm lamp should light at 35 °C',
        ),
    },
    {
      id: 'water_low',
      name: ['3 · Water low', '3 · انخفاض الماء'],
      does: ['11:59:55 — at 2 s the reservoir drops to 10 %; the 12:00 irrigation comes 3 s later.', 'الساعة 11:59:55 — عند 2 ث ينخفض الخزان إلى 10٪؛ وموعد ري 12:00 بعد 3 ثوانٍ.'],
      expected: ['LOW WATER alarm, alarm lamp ON, "IRRIGATION skipped: LOW WATER": the pump never runs.', 'إنذار LOW WATER، مصباح الإنذار يعمل، و"IRRIGATION skipped: LOW WATER": المضخة لا تعمل أبداً.'],
      seconds: 12,
      start: [11, 59, 55],
      events: [{ at: 2, run: setLevel(10) }],
      verify: (out, m) => all(need(out, /ALARM LOW WATER/), need(out, /IRRIGATION skipped: LOW WATER/), m.pumpOn ? 'the pump ran with a low reservoir' : null, m.lampNow ? null : 'the alarm lamp should be on'),
    },
    {
      id: 'irrigation',
      name: ['4 · Irrigation at 12:00', '4 · الري الساعة 12:00'],
      does: ['Start at 11:59:56 and run 25 s.', 'ابدأ الساعة 11:59:56 وشغّل 25 ثانية.'],
      expected: ['"IRRIGATION start", the pump runs about 5 s (current measured every second), "IRRIGATION end", and only once in that hour.', '"IRRIGATION start"، تعمل المضخة نحو 5 ثوانٍ (مع قياس التيار كل ثانية)، ثم "IRRIGATION end"، ومرة واحدة فقط في تلك الساعة.'],
      seconds: 25,
      start: [11, 59, 56],
      events: [],
      verify: (out, m) =>
        all(
          need(out, /IRRIGATION start/, /IRRIGATION end/),
          count(out, /IRRIGATION start/) === 1 ? null : 'irrigation must run only once per irrigation hour',
          near(m.pumpSec ?? 0, 5, 1, 'pump running time (s)'),
          /PUMP FAILURE/.test(out) ? 'a working pump was reported as failed' : null,
        ),
    },
    {
      id: 'dosing',
      name: ['5 · Dosing A then B', '5 · الجرعات A ثم B'],
      does: [`At 2 s ${dosingHow[0]}.`, `عند 2 ث ${dosingHow[1]}.`],
      expected: ['DOSING A 10 ml (5 s), then DOSING B 5 ml (2.5 s), never together, then DOSING DONE and back to AUTO. Volumes come from the farm model of the pumps (2 ml/s).', 'DOSING A ‏10 مل (5 ث)، ثم DOSING B ‏5 مل (2.5 ث)، ولا تعملان معاً أبداً، ثم DOSING DONE والعودة إلى AUTO. الكميات من نموذج المضخات في المزرعة (2 مل/ث).'],
      seconds: 16,
      events: press('dosing', 2),
      verify: (out, m) =>
        all(
          need(out, /DOSING A 10 ml/, /DOSING B 5 ml/, /DOSING DONE/),
          m.together ? 'dosing pumps A and B ran at the same time' : null,
          m.doseAFirst !== undefined && m.doseBFirst !== undefined && m.doseAFirst < m.doseBFirst && m.doseALast <= m.doseBFirst + 0.2 ? null : 'pump B must start only after pump A has stopped',
          near(m.doseA ?? 0, 10, 1.5, 'dose A (ml)'),
          near(m.doseB ?? 0, 5, 1, 'dose B (ml)'),
        ),
    },
    {
      id: 'test_mode',
      name: ['6 · Test mode', '6 · وضع الاختبار'],
      does: [`21:00 (light off by schedule): at 2 s ${testHow[0]}.`, `الساعة 21:00 (الإضاءة مطفأة حسب الجدول): عند 2 ث ${testHow[1]}.`],
      expected: ['TEST FAN, TEST LIGHT, TEST DOSE A, TEST DOSE B, TEST PUMP (only because the water is OK), TEST DONE; every load runs once, then AUTO switches the light off again.', 'TEST FAN ثم TEST LIGHT ثم TEST DOSE A ثم TEST DOSE B ثم TEST PUMP (لأن الماء كافٍ فقط)، ثم TEST DONE؛ يعمل كل حمل مرة واحدة، ثم يطفئ AUTO الإضاءة من جديد.'],
      seconds: 18,
      start: [21, 0, 0],
      events: press('test', 2),
      verify: (out, m) =>
        all(
          need(out, /TEST FAN/, /TEST LIGHT/, /TEST DOSE A/, /TEST DOSE B/, /TEST PUMP/, /TEST DONE/),
          ...['fan', 'light'].map((id) => (m[`${id}First`] !== undefined ? null : `${id} did not run during the test`)),
          m.pumpSec > 1 ? null : 'the pump did not run during the test',
          m.doseA > 2 && m.doseB > 2 ? null : 'a dosing pump did not run during the test',
          m.together ? 'dose A and dose B ran together during the test' : null,
          m.lightNow ? 'after the test the light must follow the schedule (off at 21:00)' : null,
        ),
    },
    {
      id: 'sensor_failure',
      name: ['7 · Sensor failure', '7 · عطل حساس'],
      does: [`At 3 s the air sensor (${board === 'wb' ? 'RS-485, address 2' : 'DHT22'}) gets the fault "Sensor disconnected"; at 10 s the fault is cleared.`, `عند 3 ث يُضبط عطل "Sensor disconnected" على حساس الهواء (${board === 'wb' ? 'RS-485، العنوان 2' : 'DHT22'})؛ وعند 10 ث يُزال العطل.`],
      expected: ['SENSOR ERROR alarm, temp=None/null in STATUS, the fan runs (safe side) while the reading is missing; the alarm clears after repair.', 'إنذار SENSOR ERROR، وقيمة temp=None/null في STATUS، وتعمل المروحة (الجانب الآمن) ما دامت القراءة مفقودة؛ ويزول الإنذار بعد الإصلاح.'],
      seconds: 18,
      events: [
        { at: 3, run: setProps(sensor, { fault: 'disconnected' }) },
        { at: 9.5, run: (c) => (c.mem.fanAt9 = run(c.sim, 'fan')) },
        { at: 10, run: setProps(sensor, { fault: 'none' }) },
      ],
      verify: (out, m) => all(need(out, /ALARM SENSOR ERROR/, /ALARM NONE/), need(out, /temp=(None|null)/), m.fanAt9 ? null : 'the fan should run while the temperature is unknown'),
    },
    {
      id: 'lighting',
      name: ['8 · Lighting schedule', '8 · جدول الإضاءة'],
      does: ['Start at 19:59:50 and run 18 s.', 'ابدأ الساعة 19:59:50 وشغّل 18 ثانية.'],
      expected: ['The grow light is ON before 20:00 and switches OFF after 20:00 (LIGHT_OFF_HOUR).', 'الإضاءة تعمل قبل 20:00 وتنطفئ بعد 20:00 ‏(LIGHT_OFF_HOUR).'],
      seconds: 18,
      start: [19, 59, 50],
      events: [],
      verify: (_out, m) => {
        const tr: [number, boolean][] = m.lightTrace ?? [];
        // 19:59:56–19:59:59.5 (the controllers have had 6 s to start and switch the relay), then from 20:00:03
        const before = tr.filter(([t]) => t > 6 && t < 9.5).every(([, on]) => on);
        const after = tr.filter(([t]) => t > 13).every(([, on]) => !on);
        return all(before ? null : 'the light should be on before 20:00', after ? null : 'the light should be off after 20:00');
      },
    },
    {
      id: 'wiring_error',
      name: ['9 · Wiring error (pump wire loose)', '9 · خطأ توصيل (سلك المضخة مفصول)'],
      does: [`The wire from relay contact ${contact} to the ACS712 is removed, then the 12:00 irrigation starts (start 11:59:56).`, `يُزال السلك من تلامس المرحل ${contact} إلى ACS712، ثم يبدأ ري 12:00 ‏(البداية 11:59:56).`],
      expected: ['The relay clicks but no current flows: "PUMP FAILURE: no current", PUMP FAILURE alarm, the relay is switched off at once.', 'يعمل المرحل لكن لا يمر تيار: "PUMP FAILURE: no current"، وإنذار PUMP FAILURE، ويُطفأ المرحل فوراً.'],
      seconds: 12,
      start: [11, 59, 56],
      events: [{ at: 0.5, run: (c) => c.editDoc((d) => ({ ...d, wires: d.wires.filter((w) => !((w.from.comp === relay && w.from.pin === contact) || (w.to.comp === relay && w.to.pin === contact))) })) }],
      verify: (out, m) => all(need(out, /IRRIGATION start/, /PUMP FAILURE: no current/), need(out, /ALARM PUMP FAILURE/), m.lampNow ? null : 'the alarm lamp should be on', m.pumpOn ? 'the pump cannot run without its wire' : null),
    },
    {
      id: 'full_system',
      name: ['10 · Full system', '10 · النظام الكامل'],
      does: [`11:59:52: irrigation at 12:00, at 14 s the air reaches 35 °C, at 18 s ${dosingHow[0]}, at 32 s the air is back to 25 °C.`, `الساعة 11:59:52: ري الساعة 12:00، وعند 14 ث تصل الحرارة إلى 35 °م، وعند 18 ث ${dosingHow[1]}، وعند 32 ث تعود الحرارة إلى 25 °م.`],
      expected: ['Irrigation (≈5 s), fan + HIGH TEMPERATURE alarm, dosing A then B, then every alarm clears and the fan stops: the system returns to normal AUTO.', 'ري (نحو 5 ث)، ثم المروحة وإنذار HIGH TEMPERATURE، ثم الجرعات A ثم B، ثم تزول كل الإنذارات وتتوقف المروحة: يعود النظام إلى AUTO العادي.'],
      seconds: 42,
      start: [11, 59, 52],
      events: [{ at: 14, run: setAir(35) }, ...press('dosing', 18), { at: 32, run: setAir(25) }],
      verify: (out, m) =>
        all(
          need(out, /IRRIGATION start/, /IRRIGATION end/),
          need(out, /ALARM HIGH TEMPERATURE/),
          need(out, /DOSING A 10 ml/, /DOSING B 5 ml/, /DOSING DONE/),
          need(out, /ALARM HIGH TEMPERATURE[\s\S]*ALARM NONE/),
          m.together ? 'A and B ran together' : null,
          m.fanNow ? 'the fan should be off at the end' : null,
          m.lampNow ? 'no alarm should be left at the end' : null,
          near(m.doseA ?? 0, 10, 1.5, 'dose A (ml)'),
        ),
    },
  ];
}

function nextionText(sim: Simulator, name: string, want: string) {
  const nx = sim.device('nx') as any;
  const txt = nx?.liveOf?.(0, name)?.attrs?.txt;
  return String(txt) === want ? null : `Nextion ${name} shows "${txt}", expected "${want}"`;
}
