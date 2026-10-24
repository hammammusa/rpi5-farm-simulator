// Built-in Hardware Driver Registry: every documented module/API really exists in the
// simulator's Python environment (no name-only libraries), and the acceptance tests A1–A7.
import { describe, expect, it } from 'vitest';
import { DRIVERS } from '../../src/catalog/drivers';
import { SHIMS } from '../../src/runtime/shims';
import { buildPartExample } from '../../src/catalog/examples';
import { CircuitBuilder } from '../../src/engine/project';
import { Harness } from './pyharness';

const emptyDoc = () => new CircuitBuilder().add('pi', 'rpi5', 0, 0).doc();

describe('driver registry', () => {
  it('every documented module ships as a built-in shim', () => {
    const tops = new Set(Object.keys(SHIMS).map((p) => p.split('/')[0].replace(/\.py$/, '')));
    const missing = DRIVERS.map((d) => d.module).filter((m) => !tops.has(m));
    expect(missing).toEqual([]);
  });

  it('every documented class / function / attribute exists in the module', async () => {
    const h = new Harness(emptyDoc());
    const checks = DRIVERS.flatMap((d) => d.apis.map((a) => [d.module, a.name]));
    const code = `import importlib\nmissing = []\nfor mod, name in ${JSON.stringify(checks)}:\n    parts = name.split('.')\n    try:\n        obj = importlib.import_module(mod)\n    except Exception as e:\n        missing.append(f"{mod}: import failed {e}")\n        continue\n    for i, p in enumerate(parts):\n        if hasattr(obj, p):\n            obj = getattr(obj, p)\n            continue\n        try:\n            obj = importlib.import_module(mod + '.' + '.'.join(parts[: i + 1]))\n        except Exception:\n            missing.append(f"{mod}.{name}")\n            break\nprint("MISSING", missing)\n`;
    const r = await h.run(code, { seconds: 5 });
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('MISSING []');
  }, 120000);
});

describe('A · built-in libraries (acceptance)', () => {
  it('A1 gpiozero imports without installation', async () => {
    const r = await new Harness(emptyDoc()).run('from gpiozero import LED\nprint("ok", LED)\n');
    expect(r.status).not.toBe('error');
    expect(r.stdout).toContain('ok');
  }, 60000);

  it('A2 the DHT22 driver imports without installation (adafruit_dht and smartfarm)', async () => {
    const r = await new Harness(emptyDoc()).run('import adafruit_dht\nfrom smartfarm import DHT22\nprint("drivers ok")\n');
    expect(r.stdout).toContain('drivers ok');
  }, 60000);

  it('A3/A4 a correctly wired DHT22 is read, and a change of its value while running reaches Python', async () => {
    const doc = buildPartExample('dht22');
    const h = new Harness(doc);
    let changed = false;
    h.onWait = (hh) => {
      if (!changed && hh.now() - hh.t0 > 3) {
        changed = true;
        const d = hh.sim.doc;
        hh.sim.setDoc({ ...d, components: d.components.map((c) => (c.id === 'dut' ? { ...c, props: { ...c.props, temperature: 18.4, humidity: 71 } } : c)) });
      }
    };
    const r = await h.run('from smartfarm import DHT22\nimport time\ns = DHT22(4)\nfor i in range(3):\n    print("%.1f %.1f" % s.read())\n    time.sleep(2.2)\n', { seconds: 9 });
    expect(r.stdout).toContain('25.0 60.0');
    expect(r.stdout).toContain('18.4 71.0');
  }, 60000);

  it('A5 reading a GPIO that is not wired to the sensor gives a precise error', async () => {
    const doc = buildPartExample('dht22'); // DHT22 DATA is on GPIO4
    const r = await new Harness(doc).run('import board, adafruit_dht\ns = adafruit_dht.DHT22(board.D17)\nprint(s.temperature)\n');
    expect(r.status).toBe('error');
    expect(r.error.message).toMatch(/DHT sensor not found, check wiring \(simulator: .*wired to GPIO4 \(pin 7\), but the code reads GPIO17\)/);
  }, 60000);

  it('A6 importing an unsupported library gives a clear message', async () => {
    const r = await new Harness(emptyDoc()).run('import pigpio\n');
    expect(r.status).toBe('error');
    expect(r.error.type).toBe('ModuleNotFoundError');
    expect(r.error.message).toMatch(/pigpio does not support the Raspberry Pi 5/);
    expect(r.error.message).toMatch(/Built-in hardware libraries: .*gpiozero/);
    const r2 = await new Harness(emptyDoc()).run('import some_random_package\n');
    expect(r2.error.message).toMatch(/cannot install packages/);
  }, 60000);

  it('A6b a disconnected sensor raises the real library error', async () => {
    const doc = buildPartExample('sht31');
    doc.wires = doc.wires.filter((w) => w.from.pin !== 'SDA');
    const r = await new Harness(doc).run('import board, busio, adafruit_sht31d\nadafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))\n');
    expect(r.status).toBe('error');
    expect(r.error.message).toMatch(/No I2C device at address: 0x44/);
  }, 60000);
});
