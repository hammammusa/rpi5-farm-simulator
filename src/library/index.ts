// The example library: the original 20 guided examples plus the project collection.
// Every entry opens as a complete, arranged project and has an automatic test.
import { EXAMPLES, type Example } from '../examples';
import type { ProjectDoc } from '../engine/types';
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
  run: ['Press ▶ Run and watch the terminal, the parts and the GPIO monitor.', 'اضغط ▶ تشغيل وراقب الطرفية والقطع ومراقب GPIO.'] as Bi,
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

const SPECS: LibExample[] = [...GPIO_EXAMPLES, ...SENSOR_EXAMPLES, ...MOTOR_EXAMPLES, ...DISPLAY_EXAMPLES, ...COMMS_EXAMPLES, ...SMARTHOME_EXAMPLES, ...SECURITY_EXAMPLES, ...ROBOTICS_EXAMPLES, ...INDUSTRIAL_EXAMPLES, ...FARMING_EXAMPLES, ...ENERGY_EXAMPLES, ...LOGIC_EXAMPLES, ...DATA_EXAMPLES, ...CHALLENGE_EXAMPLES, ...ADVANCED_EXAMPLES];

export const LIBRARY: LibraryEntry[] = [...EXAMPLES.map(fromLegacy), ...SPECS.map(fromSpec)];
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
