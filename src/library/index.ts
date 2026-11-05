// The example library: the original 20 guided examples plus the project collection.
// Every entry opens as a complete, arranged project and has an automatic test.
import { EXAMPLES, type Example } from '../examples';
import type { ProjectDoc } from '../engine/types';
import { arrangeCircuit } from '../engine/layout';
import { getPart, hasPart } from '../engine/parts';
import type { Scenario } from '../tests/host';
import { buildLibDoc, libScenario } from './build';
import type { Bi, Cat, LibExample, Level } from './dsl';
import { GPIO_EXAMPLES } from './gpio';
import { SENSOR_EXAMPLES } from './sensors';
import { MOTOR_EXAMPLES } from './motors';
import { DISPLAY_EXAMPLES } from './displays';
import { COMMS_EXAMPLES } from './comms';
import { SMARTHOME_EXAMPLES } from './smarthome';
import { SECURITY_EXAMPLES } from './security';
import { ROBOTICS_EXAMPLES } from './robotics';
import { INDUSTRIAL_EXAMPLES } from './industrial';
import { FARMING_EXAMPLES } from './farming';
import { ENERGY_EXAMPLES } from './energy';
import { LOGIC_EXAMPLES } from './logic';
import { DATA_EXAMPLES } from './data';
import { CHALLENGE_EXAMPLES } from './challenges';
import { ADVANCED_EXAMPLES } from './advanced';
import { MCU_SPECS, type McuSpec } from './controllers';
import { currentSim } from '../catalog/examples';
import { MASTER_PROJECTS, type MasterProject } from './masters/study';
import { masterInAppScenarios } from './masters/inapp';

export interface LibraryEntry {
  id: string;
  n: number;
  cat: Cat;
  level: Level;
  minutes: number;
  title: Bi;
  goal: Bi;
  result: Bi;
  steps: Bi[];
  explain: Bi;
  /** component types used (for the component filter) */
  types: string[];
  /** number of parts, Pi included */
  partCount: number;
  code: string;
  spec?: LibExample;
  legacy?: Example;
  /** ESP32 / Wiren Board project */
  mcu?: McuSpec;
  /** one of the three COMPETITION MASTER study projects */
  master?: MasterProject;
  build(): ProjectDoc;
  scenarios(): Scenario[];
}

const LEGACY_CAT: Record<number, Cat> = { 1: 'gpio', 2: 'gpio', 3: 'gpio', 4: 'sensors', 5: 'smarthome', 6: 'industrial', 7: 'motors', 8: 'sensors', 9: 'comms', 10: 'sensors', 11: 'comms', 12: 'displays', 13: 'displays', 14: 'farming', 15: 'farming', 16: 'farming', 17: 'farming', 18: 'farming', 19: 'advanced', 20: 'advanced' };
const LEVEL: Record<Example['level'], Level> = { beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced', competition: 'advanced' };

const bi = (b: { en: string; ar: string }): Bi => [b.en, b.ar];

function fromLegacy(ex: Example): LibraryEntry {
  let types: string[] | null = null;
  return {
    id: ex.id,
    n: 0,
    cat: LEGACY_CAT[ex.n] ?? 'gpio',
    level: LEVEL[ex.level],
    minutes: ex.level === 'beginner' ? 15 : ex.level === 'intermediate' ? 25 : 45,
    title: bi(ex.title),
    goal: bi(ex.objective),
    result: bi(ex.expected),
    steps: [bi(ex.instructions), ...ex.breakIt.map(bi)],
    explain: bi(ex.objective),
    get types() {
      types ??= [...new Set(ex.build().components.map((c) => c.type))];
      return types;
    },
    get partCount() {
      return ex.build().components.length;
    },
    get code() {
      const d = ex.build();
      return d.files.find((f) => f.name === d.mainFile)?.content ?? '';
    },
    legacy: ex,
    build: () => ex.build(),
    scenarios: () => ex.checks,
  };
}

const STEP = {
  open: ['Open the example: the circuit is already wired and the code is in main.py.', 'افتح المثال: الدائرة موصولة مسبقاً والكود موجود في main.py.'] as Bi,
  run: ['Press ▶ Run and watch the terminal, the parts and the GPIO monitor. The program keeps running and reacting to your inputs until you press ■ Stop.', 'اضغط ▶ تشغيل وراقب الطرفية والقطع ومراقب GPIO. يستمر البرنامج في العمل والاستجابة لمدخلاتك حتى تضغط ■ إيقاف.'] as Bi,
};

function fromSpec(e: LibExample): LibraryEntry {
  return {
    id: e.id,
    n: 0,
    cat: e.cat,
    level: e.level,
    minutes: e.minutes,
    title: e.title,
    goal: e.goal,
    result: e.result,
    steps: [STEP.open, STEP.run, e.tryIt, e.modify],
    explain: e.explain,
    types: ['rpi5', ...new Set(e.parts.map((p) => p[1]))],
    partCount: e.parts.length + 1,
    code: e.code,
    spec: e,
    build: () => buildLibDoc(e),
    scenarios: () => [libScenario(e)],
  };
}

/** in-app test of a controller project: run every program, apply the events, judge output and circuit */
function mcuScenario(e: McuSpec): Scenario {
  return {
    id: `lib-${e.id}`,
    name: e.title[0],
    expected: `Output matches ${e.test.expect}${e.test.verify ? ' and the circuit check passes' : ''}`,
    async run(h) {
      await h.load(e.build());
      await h.run();
      const events = [...(e.test.events ?? [])].sort((a, b) => a.at - b.at);
      let verdict: string | null = e.test.verify ? 'not checked' : null;
      await h.waitSim(e.test.seconds, (now) => {
        while (events.length && now >= events[0].at) {
          const ev = events.shift()!;
          if (ev.press !== undefined) currentSim().pressButton(ev.comp, ev.press);
          if (ev.props) for (const [k, v] of Object.entries(ev.props)) h.setProp(ev.comp, k, v);
        }
        if (e.test.verify && now >= e.test.seconds - 0.6) verdict = e.test.verify(currentSim());
      });
      const out = h.term();
      const pass = e.test.expect.test(out) && verdict === null && !h.pyError();
      return { pass, actual: pass ? 'output and circuit as expected' : `${verdict ?? ''} ${h.pyError()?.message ?? ''}\n${out.slice(-600)}`.trim() };
    },
  };
}

function fromMcu(e: McuSpec): LibraryEntry {
  let doc: ProjectDoc | null = null;
  // opens with its default layout: Auto Arrange (sections per controller, routed wires; the
  // example's own wire colours are kept). Only geometry changes; pins, props and code do not.
  const d = () => (doc ??= arrangeCircuit(e.build()));
  return {
    id: e.id,
    n: 0,
    cat: 'controllers',
    level: e.level,
    minutes: e.minutes,
    title: e.title,
    goal: e.goal,
    result: e.result,
    steps: [STEP_MCU, STEP.run, e.tryIt, e.modify],
    explain: e.explain,
    get types() {
      return [...new Set(d().components.map((c) => c.type))];
    },
    get partCount() {
      return d().components.length;
    },
    code: e.code,
    mcu: e,
    build: () => structuredClone(d()),
    scenarios: () => [mcuScenario(e)],
  };
}

function fromMaster(m: MasterProject): LibraryEntry {
  let types: string[] | null = null;
  let count = 0;
  const parts = () => {
    if (!types) {
      const d = m.build();
      types = [...new Set(d.components.map((c) => c.type))];
      count = d.components.length;
    }
  };
  return {
    id: m.id,
    n: 0,
    cat: 'masters',
    level: 'advanced',
    minutes: 120,
    title: m.title,
    goal: m.goal,
    result: [
      'AUTO, DOSING and TEST modes, five alarms and a status display, checked by 10 scenarios that run the real program.',
      'أوضاع AUTO وDOSING وTEST وخمسة إنذارات ولوحة حالة، تتحقق منها 10 سيناريوهات تشغّل البرنامج الحقيقي.',
    ],
    steps: [STEP.open, STEP.run],
    explain: m.summary,
    get types() {
      parts();
      return types!;
    },
    get partCount() {
      parts();
      return count;
    },
    code: m.code,
    master: m,
    build: () => m.build(),
    scenarios: () => masterInAppScenarios(m),
  };
}

const STEP_MCU: Bi = [
  'Open the example: the circuit is wired and each controller has its program in its own folder (choose the controller in the Code bar).',
  'افتح المثال: الدائرة موصولة ولكل متحكم برنامجه في مجلده الخاص (اختر المتحكم من شريط الكود).',
];

const SPECS: LibExample[] = [...GPIO_EXAMPLES, ...SENSOR_EXAMPLES, ...MOTOR_EXAMPLES, ...DISPLAY_EXAMPLES, ...COMMS_EXAMPLES, ...SMARTHOME_EXAMPLES, ...SECURITY_EXAMPLES, ...ROBOTICS_EXAMPLES, ...INDUSTRIAL_EXAMPLES, ...FARMING_EXAMPLES, ...ENERGY_EXAMPLES, ...LOGIC_EXAMPLES, ...DATA_EXAMPLES, ...CHALLENGE_EXAMPLES, ...ADVANCED_EXAMPLES];

// the three master projects are numbered after the 161 examples (numbers of the existing examples
// stay the same) and shown first, in their own category
export const LIBRARY: LibraryEntry[] = [...EXAMPLES.map(fromLegacy), ...SPECS.map(fromSpec), ...MCU_SPECS.map(fromMcu), ...MASTER_PROJECTS.map(fromMaster)];
LIBRARY.forEach((e, i) => (e.n = i + 1));

export function libraryEntry(id: string) {
  return LIBRARY.find((e) => e.id === id) ?? null;
}

/** names of the component types used in the library (component filter) */
export function libraryTypes(): { type: string; name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of LIBRARY) for (const t of e.types) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].filter(([t]) => hasPart(t)).map(([type, count]) => ({ type, name: getPart(type).name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export { CATEGORIES } from './dsl';
export type { Cat, Level, Bi } from './dsl';

// handle for automated browser checks (screenshots of every example's default layout)
(globalThis as any).__rpi5lib = { LIBRARY, libraryEntry };
