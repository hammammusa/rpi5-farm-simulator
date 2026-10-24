import { defaultFarmConfig } from './farm';
import { emptyNextionProject } from './devices/nextion';
import type { ComponentInstance, ProjectDoc, Rotation, ViewSettings, Wire } from './types';

let counter = 0;
export function uid(prefix = 'c') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}

export const DEFAULT_CODE = `from gpiozero import LED
from time import sleep

led = LED(17)

while True:
    led.on()
    sleep(1)
    led.off()
    sleep(1)
`;

export function newProject(name = 'Untitled project'): ProjectDoc {
  const now = Date.now();
  return {
    schema: 2,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    components: [{ id: 'pi', type: 'rpi5', x: 40, y: 60, rotation: 0, props: {} }],
    wires: [],
    files: [{ name: 'main.py', content: DEFAULT_CODE }],
    mainFile: 'main.py',
    nextion: emptyNextionProject(),
    farm: { ...defaultFarmConfig(), enabled: false },
    sim: { speed: 1 },
    view: defaultView(),
  };
}

export const CURRENT_SCHEMA = 2 as const;

export function defaultView(): ViewSettings {
  return {
    background: '',
    gridSize: 10,
    showGrid: true,
    snap: true,
    showGpioNumbers: false,
    showNames: true,
    showWireLabels: true,
    showNetNames: false,
    showVoltages: false,
    showCrossings: true,
    wireWidth: 3,
    pinShape: 'square',
    minimap: true,
  };
}

/** Small builder used by examples and tests to describe circuits compactly. */
export class CircuitBuilder {
  components: ComponentInstance[] = [];
  wires: Wire[] = [];
  add(id: string, type: string, x: number, y: number, props: Record<string, any> = {}, rotation: Rotation = 0, label?: string) {
    this.components.push({ id, type, x, y, rotation, props, label });
    return this;
  }
  wire(from: string, to: string, color = '#2b7bd6', label?: string) {
    const [fc, fp] = from.split('.');
    const [tc, tp] = to.split('.');
    this.wires.push({ id: `w${this.wires.length + 1}_${fc}_${tc}`, from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp }, color, label });
    return this;
  }
  doc(base: Partial<ProjectDoc> = {}): ProjectDoc {
    const d = newProject(base.name ?? 'Circuit');
    return { ...d, ...base, components: this.components, wires: this.wires };
  }
}

export const WIRE_COLORS = {
  red: '#e0393e',
  black: '#2b2b2b',
  blue: '#2b7bd6',
  green: '#2e9d4f',
  yellow: '#e6b800',
  orange: '#ef7d22',
  purple: '#8e5bd6',
  white: '#e8e8e8',
  brown: '#8b5a2b',
  gray: '#8a8a8a',
};

export const WIRE_WIDTHS = [1.5, 2, 3, 4, 5];
