import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { describe as describeName, piCompletions } from '../../src/ui/pyComplete';

function complete(code: string) {
  const st = EditorState.create({ doc: code });
  const r = piCompletions(new CompletionContext(st, code.length, true));
  return r?.options.map((o) => o.label) ?? [];
}

describe('registry-driven Python completion', () => {
  it('suggests built-in modules after import/from', () => {
    expect(complete('from gpi')).toContain('gpiozero');
    expect(complete('import ')).toEqual(expect.arrayContaining(['smartfarm', 'adafruit_dht', 'lgpio', 'busio']));
  });
  it('suggests classes after from X import', () => {
    expect(complete('from gpiozero import ')).toEqual(expect.arrayContaining(['LED', 'Button', 'DistanceSensor']));
    expect(complete('from smartfarm import P')).toEqual(expect.arrayContaining(['PHSensor', 'Pump']));
  });
  it('suggests methods of a variable created from a known class', () => {
    expect(complete('from gpiozero import LED\nled = LED(17)\nled.')).toEqual(expect.arrayContaining(['on', 'off', 'blink', 'toggle']));
    expect(complete('import adafruit_dht\n')).toBeTruthy();
    expect(complete('import smbus2\nbus = smbus2.SMBus(1)\nbus.')).toEqual(expect.arrayContaining(['read_byte_data', 'write_byte_data']));
  });
  it('hover docs describe signatures', () => {
    const d = describeName('from gpiozero import LED\nled = LED(17)\n', 'blink', 'led');
    expect(d?.sig).toMatch(/blink\(on_time=1/);
    expect(describeName('import adafruit_dht\n', 'adafruit_dht')?.doc).toMatch(/pip install adafruit-circuitpython-dht/);
  });
});
