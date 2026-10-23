// Python modules installed into the worker's filesystem at /lib/sim.
const files = import.meta.glob('./python/**/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const SHIMS: Record<string, string> = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace('./python/', ''), v]));

/** Modules a user can import (shown in docs and used by error explanations). */
export const SUPPORTED_MODULES = [
  'gpiozero',
  'RPi.GPIO',
  'serial',
  'smbus2',
  'smbus',
  'spidev',
  'board',
  'adafruit_dht',
  'Adafruit_DHT',
  'w1thermsensor',
  'bme280',
  'RPLCD.i2c',
  'ssd1306',
  'framebuf',
  'flask',
  'schedule',
  'signal (pause)',
  'time',
  'datetime',
  'threading (cooperative)',
  'json',
  'math',
  'random',
  'statistics',
  'collections',
  'csv',
  're',
];
