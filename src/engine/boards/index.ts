// Registry of programmable controller boards.
import { PI5_HEADER } from '../pi5';
import type { ComponentInstance, ProjectDoc } from '../types';
import { ESP32_DEVKITC } from './esp32';
import { LANGUAGES, type BoardDefinition, type LanguageId } from './types';
import { WB74 } from './wb74';

export const RPI5_BOARD: BoardDefinition = {
  type: 'rpi5',
  family: 'sbc',
  vendor: 'Raspberry Pi Ltd',
  model: 'Raspberry Pi 5 Model B',
  languages: ['python'],
  defaultLanguage: 'python',
  logicV: 3.3,
  absMaxV: 3.6,
  pinMa: { recommended: 16, max: 50 },
  pins: PI5_HEADER.map((h) => ({
    pin: `P${h.physical}`,
    label: h.name,
    num: h.bcm ?? undefined,
    kind: h.kind === 'gpio' ? 'gpio' : h.kind === 'ground' ? 'ground' : 'power',
    caps: h.kind === 'gpio' ? { input: true, output: true, pullUp: true, pullDown: true, pwm: true, defaultFn: h.alts[0] } : {},
  })),
  sources: ['Raspberry Pi 5 product brief and GPIO documentation (40-pin header)'],
  limits: 'Functional GPIO/bus model. The BCM2712 CPU and Raspberry Pi OS are not emulated; Python runs in Pyodide (CPython 3.13, WebAssembly).',
};

export const BOARDS: BoardDefinition[] = [RPI5_BOARD, ESP32_DEVKITC, WB74];
const BY_TYPE = new Map(BOARDS.map((b) => [b.type, b]));

export function boardDef(type: string): BoardDefinition | null {
  return BY_TYPE.get(type) ?? null;
}

export const isController = (type: string) => BY_TYPE.has(type);

/** programmable controllers placed in the project, in workspace order */
export function controllersIn(doc: Pick<ProjectDoc, 'components'>): ComponentInstance[] {
  return doc.components.filter((c) => isController(c.type));
}

/** language a controller runs: the saved choice, else the board default */
export function languageOf(doc: Pick<ProjectDoc, 'controllers'>, c: ComponentInstance): LanguageId {
  const def = boardDef(c.type)!;
  const saved = doc.controllers?.[c.id]?.language;
  return saved && def.languages.includes(saved) ? saved : def.defaultLanguage;
}

export type { BoardDefinition, BoardPin, LanguageId, PinCaps } from './types';
export { LANGUAGES } from './types';
export { ESP32_DEVKITC } from './esp32';
export { WB74 } from './wb74';

/** languages this build can actually run (a board only gets a program in one of these) */
export const RUNNABLE_LANGUAGES: LanguageId[] = ['python', 'micropython'];

export const DEFAULT_PROGRAMS: Partial<Record<LanguageId, string>> = {
  micropython: `# ESP32-DevKitC V4 - MicroPython
# Blink an LED on GPIO23 (GPIO23 -> 330 ohm -> LED -> GND)
from machine import Pin
import time

led = Pin(23, Pin.OUT)
while True:
    led.on()
    print("LED on")
    time.sleep(1)
    led.off()
    print("LED off")
    time.sleep(1)
`,
};

/**
 * Every programmable controller other than the Raspberry Pi gets a program: an entry in
 * `doc.controllers` and a main file inside the folder named after its component id.
 * Returns the same object when nothing had to change.
 */
export function ensureControllers<T extends Pick<ProjectDoc, 'components' | 'files' | 'controllers'>>(doc: T): T {
  let controllers = doc.controllers;
  let files = doc.files;
  for (const c of controllersIn(doc)) {
    if (c.type === 'rpi5') continue;
    const def = boardDef(c.type)!;
    const prog = controllers?.[c.id];
    if (prog && def.languages.includes(prog.language)) continue;
    const lang = def.languages.find((l) => RUNNABLE_LANGUAGES.includes(l));
    if (!lang) continue;
    const main = `${c.id}/main${LANGUAGES[lang].ext}`;
    controllers = { ...(controllers ?? {}), [c.id]: { language: lang, main } };
    if (!files.some((f) => f.name === main)) files = [...files, { name: main, content: DEFAULT_PROGRAMS[lang] ?? '' }];
  }
  return controllers === doc.controllers && files === doc.files ? doc : { ...doc, controllers, files };
}
