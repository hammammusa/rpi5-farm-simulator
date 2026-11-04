// ESP32-DevKitC V4 with the ESP32-WROOM-32 module (Espressif).
// Header pin-out from the ESP32-DevKitC V4 user guide (headers J2 and J3, 19 pins each) and the
// ESP32 datasheet (ADC channels, input-only pins, strapping pins, SPI-flash pins).
import type { BoardDefinition, BoardPin, PinCaps } from './types';

const IO: PinCaps = { input: true, output: true, pullUp: true, pullDown: true, pwm: true };
const INPUT_ONLY: PinCaps = { input: true };
const FLASH: PinCaps = { flash: true };

const g = (pin: string, label: string, num: number, caps: PinCaps): BoardPin => ({ pin, label, num, kind: 'gpio', caps });
const pw = (pin: string, label: string, kind: 'power' | 'ground' | 'control' = 'power'): BoardPin => ({ pin, label, kind, caps: {} });

/** J2: left header, pin 1 at the top (antenna end) */
export const ESP32_J2: BoardPin[] = [
  pw('3V3', '3V3'),
  pw('EN', 'EN', 'control'),
  g('VP', 'VP', 36, { ...INPUT_ONLY, adc: { unit: 1, ch: 0 } }),
  g('VN', 'VN', 39, { ...INPUT_ONLY, adc: { unit: 1, ch: 3 } }),
  g('IO34', 'IO34', 34, { ...INPUT_ONLY, adc: { unit: 1, ch: 6 } }),
  g('IO35', 'IO35', 35, { ...INPUT_ONLY, adc: { unit: 1, ch: 7 } }),
  g('IO32', 'IO32', 32, { ...IO, adc: { unit: 1, ch: 4 } }),
  g('IO33', 'IO33', 33, { ...IO, adc: { unit: 1, ch: 5 } }),
  g('IO25', 'IO25', 25, { ...IO, adc: { unit: 2, ch: 8 }, dac: true }),
  g('IO26', 'IO26', 26, { ...IO, adc: { unit: 2, ch: 9 }, dac: true }),
  g('IO27', 'IO27', 27, { ...IO, adc: { unit: 2, ch: 7 } }),
  g('IO14', 'IO14', 14, { ...IO, adc: { unit: 2, ch: 6 } }),
  g('IO12', 'IO12', 12, { ...IO, adc: { unit: 2, ch: 5 }, strapping: 'MTDI selects the flash voltage at reset: HIGH selects 1.8 V and the WROOM-32 (3.3 V flash) fails to boot. Keep it LOW/floating at power-up.' }),
  pw('GND1', 'GND', 'ground'),
  g('IO13', 'IO13', 13, { ...IO, adc: { unit: 2, ch: 4 } }),
  g('D2', 'D2', 9, FLASH),
  g('D3', 'D3', 10, FLASH),
  g('CMD', 'CMD', 11, FLASH),
  pw('5V', '5V'),
];

/** J3: right header, pin 1 at the top */
export const ESP32_J3: BoardPin[] = [
  pw('GND2', 'GND', 'ground'),
  g('IO23', 'IO23', 23, { ...IO, defaultFn: 'VSPI MOSI' }),
  g('IO22', 'IO22', 22, { ...IO, defaultFn: 'I2C SCL (Arduino default)' }),
  g('TX', 'TX', 1, { ...IO, defaultFn: 'UART0 TX (USB serial console)' }),
  g('RX', 'RX', 3, { ...IO, defaultFn: 'UART0 RX (USB serial console)' }),
  g('IO21', 'IO21', 21, { ...IO, defaultFn: 'I2C SDA (Arduino default)' }),
  pw('GND3', 'GND', 'ground'),
  g('IO19', 'IO19', 19, { ...IO, defaultFn: 'VSPI MISO' }),
  g('IO18', 'IO18', 18, { ...IO, defaultFn: 'VSPI SCK' }),
  g('IO5', 'IO5', 5, { ...IO, defaultFn: 'VSPI CS', strapping: 'Strapping pin (SDIO timing); has a pull-up at reset — avoid pulling it LOW at power-up.' }),
  g('IO17', 'IO17', 17, { ...IO, defaultFn: 'UART2 TX' }),
  g('IO16', 'IO16', 16, { ...IO, defaultFn: 'UART2 RX' }),
  g('IO4', 'IO4', 4, { ...IO, adc: { unit: 2, ch: 0 } }),
  g('IO0', 'IO0', 0, { ...IO, adc: { unit: 2, ch: 1 }, strapping: 'Boot-mode strapping pin (BOOT button): LOW at reset enters the serial bootloader instead of running your program.' }),
  g('IO2', 'IO2', 2, { ...IO, adc: { unit: 2, ch: 2 }, strapping: 'Strapping pin: must be LOW or floating at reset to enter the bootloader; avoid a pull-up on it.' }),
  g('IO15', 'IO15', 15, { ...IO, adc: { unit: 2, ch: 3 }, strapping: 'MTDO strapping pin: LOW at reset silences the boot log; it has a pull-up.' }),
  g('D1', 'D1', 8, FLASH),
  g('D0', 'D0', 7, FLASH),
  g('CLK', 'CLK', 6, FLASH),
];

export const ESP32_DEVKITC: BoardDefinition = {
  type: 'esp32_devkitc',
  family: 'mcu',
  vendor: 'Espressif',
  model: 'ESP32-DevKitC V4 (ESP32-WROOM-32)',
  languages: ['micropython', 'arduino'],
  defaultLanguage: 'micropython',
  logicV: 3.3,
  absMaxV: 3.6,
  pinMa: { recommended: 20, max: 40 },
  pins: [...ESP32_J2, ...ESP32_J3],
  sources: [
    'Espressif, ESP32-DevKitC V4 User Guide — header blocks J2/J3',
    'Espressif, ESP32 Series Datasheet — ADC channels, strapping pins, input-only GPIO34–39, SPI flash GPIO6–11',
  ],
  limits:
    'Functional model of the GPIO/ADC/PWM/I2C/UART peripherals as seen by your program. The Xtensa CPU, ESP-IDF, FreeRTOS, Wi-Fi radio and the boot ROM are not emulated. Wi-Fi is a virtual network that reaches the MQTT broker of a Wiren Board in the same project.',
};

/** ESP32 pins by GPIO number */
export const ESP32_BY_GPIO = new Map(ESP32_DEVKITC.pins.filter((p) => p.num !== undefined).map((p) => [p.num!, p]));
