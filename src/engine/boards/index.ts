// Registry of programmable controller boards.
import { PI5_HEADER } from '../pi5';
import type { ComponentInstance, ProjectDoc } from '../types';
import { ESP32_DEVKITC } from './esp32';
import type { BoardDefinition, LanguageId } from './types';
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
