// Controller boards: what a programmable board offers, independent of how it is drawn.
// A board definition describes every terminal of one specific product (pin id on the part,
// the number the firmware uses, electrical capabilities and restrictions). The simulator keeps
// one pin-state table per placed controller, keyed by the component id and that number —
// never by a global GPIO number.

/** programming environments the simulator can actually execute */
export type LanguageId = 'python' | 'micropython' | 'arduino' | 'wbrules';

export const LANGUAGES: Record<LanguageId, { label: string; ext: string; engine: string }> = {
  python: { label: 'Python 3 (Raspberry Pi OS)', ext: '.py', engine: 'CPython 3.13 (Pyodide, WebAssembly)' },
  micropython: { label: 'MicroPython', ext: '.py', engine: 'MicroPython 1.29 (official WebAssembly port)' },
  arduino: { label: 'Arduino C++', ext: '.ino', engine: 'Clang/LLVM 22 compiled to WebAssembly (YoWASP) + simulator Arduino-ESP32 core' },
  wbrules: { label: 'wb-rules (JavaScript ES5)', ext: '.js', engine: 'QuickJS (WebAssembly sandbox) + simulator wb-rules engine' },
};

export type BoardFamily = 'sbc' | 'mcu' | 'plc';

export interface PinCaps {
  input?: boolean;
  output?: boolean;
  pullUp?: boolean;
  pullDown?: boolean;
  pwm?: boolean;
  /** ADC unit and channel */
  adc?: { unit: 1 | 2; ch: number };
  dac?: boolean;
  /** connected to the on-module SPI flash: never usable as GPIO */
  flash?: boolean;
  /** sampled at reset; the text explains the constraint */
  strapping?: string;
  /** default function on this board (UART0 TX, I2C SDA …) */
  defaultFn?: string;
}

export interface BoardPin {
  /** pin id on the part (wires attach here) */
  pin: string;
  /** silkscreen label */
  label: string;
  /** number used by the firmware API (GPIO number on an MCU, channel index on a PLC) */
  num?: number;
  kind: 'gpio' | 'power' | 'ground' | 'terminal' | 'control';
  caps: PinCaps;
}

export interface BoardDefinition {
  /** part type in the component library */
  type: string;
  family: BoardFamily;
  vendor: string;
  model: string;
  languages: LanguageId[];
  defaultLanguage: LanguageId;
  /** logic level of the I/O (V) */
  logicV: number;
  /** absolute maximum on an I/O pin (V) */
  absMaxV: number;
  /** recommended / absolute maximum current per pin (mA) */
  pinMa: { recommended: number; max: number };
  pins: BoardPin[];
  /** where the pin data comes from */
  sources: string[];
  /** what the simulation does NOT model for this board */
  limits: string;
}
