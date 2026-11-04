// Multi-controller engine: an ESP32-DevKitC V4 placed next to (or instead of) the Pi has its
// own pin table, drives the real circuit and reads it back through the same solver.
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { Simulator } from '../../src/engine/simulator';
import { boardDef, controllersIn } from '../../src/engine/boards';
import { buildNetlist } from '../../src/engine/netlist';

const esp = () => new CircuitBuilder().add('esp', 'esp32_devkitc', 0, 0);

describe('ESP32 in the engine', () => {
  it('is a registered controller with the DevKitC V4 header (38 pins, flash and input-only pins marked)', () => {
    const def = boardDef('esp32_devkitc')!;
    expect(def.pins).toHaveLength(38);
    expect(def.pins.filter((p) => p.caps.flash).map((p) => p.num).sort((a, b) => a! - b!)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(def.pins.filter((p) => p.kind === 'gpio' && !p.caps.output && !p.caps.flash).map((p) => p.num).sort((a, b) => a! - b!)).toEqual([34, 35, 36, 39]);
    expect(def.pins.filter((p) => p.caps.strapping).map((p) => p.num).sort((a, b) => a! - b!)).toEqual([0, 2, 5, 12, 15]);
  });

  it('drives an LED from GPIO23 through a resistor', () => {
    const d = esp().add('r', 'resistor', 200, 0, { ohms: 330 }).add('led', 'led', 300, 0).wire('esp.IO23', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2').doc();
    const sim = new Simulator(d);
    expect(controllersIn(d).map((c) => c.id)).toEqual(['esp']);
    sim.controllerStart('esp');
    sim.mcuSetup('esp', 23, 'output', 'none', 'Pin(23)');
    expect(sim.vis.get('led')?.brightness ?? 0).toBeLessThan(0.1);
    sim.mcuWrite('esp', 23, 1);
    expect(sim.vis.get('led')?.brightness).toBeGreaterThan(0.2);
    expect(sim.vis.get('esp')?.gpio[23].v).toBeGreaterThan(2.5);
    sim.mcuWrite('esp', 23, 0);
    expect(sim.vis.get('led')?.brightness ?? 0).toBeLessThan(0.1);
  });

  it('reads a button with the internal pull-up and a potentiometer on ADC1', () => {
    const d = esp()
      .add('btn', 'button', 200, 0)
      .add('pot', 'potentiometer', 200, 100, { position: 25 })
      .wire('esp.IO4', 'btn.1a').wire('btn.2a', 'esp.GND1')
      .wire('pot.A', 'esp.GND2').wire('pot.B', 'esp.3V3').wire('pot.W', 'esp.IO34')
      .doc();
    const sim = new Simulator(d);
    sim.controllerStart('esp');
    sim.mcuSetup('esp', 4, 'input', 'up', 'Pin(4)');
    expect(sim.mcuRead('esp', 4).value).toBe(1);
    sim.pressButton('btn', true);
    expect(sim.mcuRead('esp', 4).value).toBe(0);
    const a = sim.mcuAdc('esp', 34);
    expect(a.volts).toBeCloseTo(0.825, 1);
    expect(a.raw).toBeGreaterThan(900);
    expect(a.raw).toBeLessThan(1150);
  });

  it('rejects flash pins and outputs on input-only pins; warns about pulls on GPIO34–39', () => {
    const sim = new Simulator(esp().doc());
    sim.controllerStart('esp');
    expect(() => sim.mcuSetup('esp', 6, 'output', 'none', 'Pin(6)')).toThrow(/SPI flash/);
    expect(() => sim.mcuSetup('esp', 35, 'output', 'none', 'Pin(35)')).toThrow(/input-only/);
    sim.mcuSetup('esp', 35, 'input', 'up', 'Pin(35)');
    expect(sim.getRuntimeIssues().map((i) => i.code)).toContain('W_NO_INTERNAL_PULL');
    expect(() => sim.mcuSetup('esp', 40, 'input', 'none', 'Pin(40)')).toThrow(/invalid pin/);
  });

  it('one owner per pin', () => {
    const sim = new Simulator(esp().doc());
    sim.controllerStart('esp');
    sim.mcuSetup('esp', 23, 'output', 'none', 'relay');
    expect(() => sim.mcuSetup('esp', 23, 'input', 'none', 'button')).toThrow(/in use by relay/);
  });

  it('reads a DHT22 on GPIO4 and a BH1750 on I2C (SDA 21, SCL 22)', () => {
    const d = esp()
      .add('dht', 'dht22', 200, 0, { temperature: 27.5, humidity: 55 })
      .wire('esp.3V3', 'dht.VCC').wire('dht.GND', 'esp.GND1').wire('dht.DATA', 'esp.IO4')
      .add('lux', 'bh1750', 200, 120, { lux: 420 })
      .wire('lux.VCC', 'esp.3V3').wire('lux.GND', 'esp.GND3').wire('lux.SDA', 'esp.IO21').wire('lux.SCL', 'esp.IO22')
      .doc();
    const sim = new Simulator(d);
    sim.controllerStart('esp');
    const r = sim.mcuDht('esp', 4, 'DHT22') as any;
    expect(r.temperature).toBe(27.5);
    expect(r.humidity).toBe(55);
    expect(sim.mcuI2cScan('esp', 21, 22)).toEqual([0x23]);
    sim.mcuI2c('esp', 21, 22, 0x23, [0x20], 0);
    const raw = sim.mcuI2c('esp', 21, 22, 0x23, null, 2);
    expect(((raw[0] << 8) | raw[1]) / 1.2).toBeCloseTo(420, -1);
  });

  it('flags 5 V on a GPIO and GPIO12 pulled HIGH at power-up', () => {
    const d = esp()
      .add('r5', 'resistor', 200, 100, { ohms: 1000 }).wire('esp.5V', 'r5.1').wire('r5.2', 'esp.IO13')
      .add('r', 'resistor', 200, 0, { ohms: 10000 }).wire('esp.3V3', 'r.1').wire('r.2', 'esp.IO12')
      .doc();
    const sim = new Simulator(d);
    const codes = sim.issues.map((i) => i.code);
    expect(codes).toContain('E_MCU_OVERVOLTAGE');
    expect(codes).toContain('W_STRAP_FLASH_V');
  });

  it('PWM on an ESP32 pin dims an LED (duty-weighted solve)', () => {
    const d = esp().add('r', 'resistor', 200, 0, { ohms: 330 }).add('led', 'led', 300, 0).wire('esp.IO18', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2').doc();
    const sim = new Simulator(d);
    sim.controllerStart('esp');
    sim.mcuPwm('esp', 18, 1000, 0.25);
    const quarter = sim.vis.get('led')!.brightness;
    sim.mcuPwm('esp', 18, 1000, 1);
    const full = sim.vis.get('led')!.brightness;
    expect(quarter).toBeGreaterThan(0.1);
    expect(quarter).toBeLessThan(full * 0.5);
  });

  it('a Pi and an ESP32 in one project keep separate pin tables and both grounds are references', () => {
    const d = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('esp', 'esp32_devkitc', 500, 0)
      .add('r1', 'resistor', 300, 300, { ohms: 330 }).add('l1', 'led', 400, 300)
      .add('r2', 'resistor', 700, 300, { ohms: 330 }).add('l2', 'led', 800, 300)
      .wire('pi.P11', 'r1.1').wire('r1.2', 'l1.A').wire('l1.K', 'pi.P6')
      .wire('esp.IO17', 'r2.1').wire('r2.2', 'l2.A').wire('l2.K', 'esp.GND2')
      .doc();
    const net = buildNetlist(d);
    expect(net.groundNets.size).toBe(2);
    expect(net.boardNet.get('esp')!.get(17)).toBeDefined();
    const sim = new Simulator(d);
    sim.controllerStart('esp');
    sim.programStart();
    sim.gpioSetup(17, 'output', 'none', 'LED(17)');
    sim.gpioWrite(17, 1);
    expect(sim.vis.get('l1')!.brightness).toBeGreaterThan(0.2);
    expect(sim.vis.get('l2')?.brightness ?? 0).toBeLessThan(0.1); // ESP32 GPIO17 untouched
    sim.mcuSetup('esp', 17, 'output', 'none', 'Pin(17)');
    sim.mcuWrite('esp', 17, 1);
    expect(sim.vis.get('l2')!.brightness).toBeGreaterThan(0.2);
    expect(sim.gpio[17].owner).toBe('LED(17)');
    expect(sim.controller('esp').claims.get(17)).toBe('Pin(17)');
  });
});

describe('ESP32 MicroPython (real MicroPython 1.29 interpreter)', () => {
  const relayDoc = (code: string) => {
    const d = esp()
      .add('rl', 'relay_module', 300, 0, { channels: 1, trigger: 'high' })
      .add('ps', 'power_supply', 500, 0, { volts: 12 })
      .add('pump', 'water_pump', 500, 200)
      .wire('esp.5V', 'rl.VCC').wire('rl.GND', 'esp.GND2').wire('esp.IO23', 'rl.IN1')
      .wire('ps.P', 'rl.COM1').wire('rl.NO1', 'pump.P').wire('pump.N', 'ps.N').wire('ps.N', 'esp.GND1')
      .doc();
    d.files.push({ name: 'esp/main.py', content: code });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    return d;
  };

  it("runs the user's relay program: GPIO23 switches the relay and the pump really runs", async () => {
    const { McuHarness } = await import('./mcuharness');
    const h = new McuHarness(
      relayDoc(`from machine import Pin
from time import sleep
import sys
print(sys.implementation.name)
relay = Pin(23, Pin.OUT)
while True:
    relay.value(1)
    sleep(2)
    relay.value(0)
    sleep(2)
`),
    );
    const seen: { t: number; on: boolean; run: number }[] = [];
    h.onWait = (hh, t) => {
      const on = !!hh.sim.vis.get('rl')?.ch?.[0]?.energised;
      if (!seen.length || seen[seen.length - 1].on !== on) seen.push({ t, on, run: hh.sim.vis.get('pump')?.run ?? 0 });
    };
    const r = await h.runMicroPython('esp', 9);
    expect(r.status).toBe('stopped');
    expect(r.stdout).toContain('micropython');
    expect(seen.map((s) => s.on)).toEqual([true, false, true, false, true]);
    expect(seen[1].t).toBeCloseTo(2, 0);
    expect(seen[2].t).toBeCloseTo(4, 0);
    expect(seen[0].run).toBeGreaterThan(0.9);
    expect(seen[1].run).toBe(0);
    // Stop leaves no output driven
    expect(h.sim.controller('esp').pins.get(23)!.mode).toBe('input');
  });

  it('reports a Python error with the file and line number', async () => {
    const { McuHarness } = await import('./mcuharness');
    const h = new McuHarness(relayDoc('from machine import Pin\nx = 1\nPin(6, Pin.OUT)\n'));
    const r = await h.runMicroPython('esp', 2);
    expect(r.status).toBe('error');
    expect(r.error?.type).toBe('ValueError');
    expect(r.error?.message).toMatch(/SPI flash/);
    expect(r.error?.file).toBe('esp/main.py');
    expect(r.error?.line).toBe(3);
  });

  it('dht, ADC, PWM, I2C, Pin.irq and machine.Timer work against the circuit', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp()
      .add('dht', 'dht22', 200, 0, { temperature: 31.2, humidity: 48 })
      .wire('esp.3V3', 'dht.VCC').wire('dht.GND', 'esp.GND1').wire('dht.DATA', 'esp.IO4')
      .add('soil', 'soil_moisture', 200, 100, { moisture: 30 })
      .wire('soil.VCC', 'esp.3V3').wire('soil.GND', 'esp.GND2').wire('soil.AO', 'esp.IO34')
      .add('lux', 'bh1750', 200, 200, { lux: 300 })
      .wire('lux.VCC', 'esp.3V3').wire('lux.GND', 'esp.GND3').wire('lux.SDA', 'esp.IO21').wire('lux.SCL', 'esp.IO22')
      .add('btn', 'button', 200, 300).wire('btn.1a', 'esp.IO27').wire('btn.2a', 'esp.GND1')
      .add('r', 'resistor', 300, 0, { ohms: 330 }).add('led', 'led', 400, 0).wire('esp.IO18', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2')
      .doc();
    d.files.push({
      name: 'esp/main.py',
      content: `import dht, time
from machine import Pin, ADC, PWM, SoftI2C, Timer
s = dht.DHT22(Pin(4))
s.measure()
print("T", s.temperature(), "H", s.humidity())
adc = ADC(Pin(34))
adc.atten(ADC.ATTN_11DB)
print("ADC", adc.read())
i2c = SoftI2C(scl=Pin(22), sda=Pin(21))
print("I2C", [hex(a) for a in i2c.scan()])
i2c.writeto(0x23, b"\\x20")
time.sleep_ms(180)
d = i2c.readfrom(0x23, 2)
print("LUX", round(((d[0] << 8) | d[1]) / 1.2))
led = PWM(Pin(18), freq=1000, duty_u16=16384)
presses = []
def pressed(p):
    presses.append(time.ticks_ms())
Pin(27, Pin.IN, Pin.PULL_UP).irq(handler=pressed, trigger=Pin.IRQ_FALLING)
ticks = []
tim = Timer(0)
tim.init(period=500, mode=Timer.PERIODIC, callback=lambda t: ticks.append(1))
time.sleep(3)
tim.deinit()
Pin(27).irq(handler=None)
print("PRESSES", len(presses), "TICKS", len(ticks))
`,
    });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const h = new McuHarness(d);
    let pwmBrightness = 0;
    h.onWait = (hh, t) => {
      if (t > 1 && t < 1.1) hh.sim.pressButton('btn', true);
      if (t > 1.3 && t < 1.4) hh.sim.pressButton('btn', false);
      if (t > 2) pwmBrightness = hh.sim.vis.get('led')?.brightness ?? 0;
    };
    const r = await h.runMicroPython('esp', 8);
    expect(r.status, r.stderr + r.error?.traceback).toBe('ok');
    expect(r.stdout).toMatch(/T 31\.2 H 48\.0/);
    const adc = Number(/ADC (\d+)/.exec(r.stdout)![1]);
    expect(adc).toBeGreaterThan(1500); // dry soil -> high capacitive-sensor voltage
    expect(r.stdout).toContain("I2C ['0x23']");
    expect(r.stdout).toMatch(/LUX (29\d|30\d)/);
    expect(r.stdout).toMatch(/PRESSES 1 TICKS [56]/);
    expect(pwmBrightness).toBeGreaterThan(0.05);
  });
});

describe('ESP32 MicroPython controls the Smart Farm', () => {
  it('soil sensor -> relay -> irrigation pump raises the tray moisture; DHT22 -> fan cools the room', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp()
      .add('rl', 'relay_module', 300, 0, { channels: 2, trigger: 'high' })
      .add('ps', 'power_supply', 500, 0, { volts: 12, amps: 10 })
      .add('pump', 'water_pump', 600, 0, { role: 'circulation', rate: 4 })
      .add('fan', 'fan', 600, 100, { role: 'fan' })
      .add('soil', 'soil_moisture', 200, 300, { source: 'farm' })
      .add('dht', 'dht22', 200, 400, { source: 'farm' })
      .wire('esp.5V', 'rl.VCC').wire('rl.GND', 'esp.GND2').wire('esp.IO26', 'rl.IN1').wire('esp.IO27', 'rl.IN2')
      .wire('ps.P', 'rl.COM1').wire('rl.NO1', 'pump.P').wire('pump.N', 'ps.N')
      .wire('ps.P', 'rl.COM2').wire('rl.NO2', 'fan.P').wire('fan.N', 'ps.N').wire('ps.N', 'esp.GND1')
      .wire('soil.VCC', 'esp.3V3').wire('soil.GND', 'esp.GND3').wire('soil.AO', 'esp.IO34')
      .wire('dht.VCC', 'esp.3V3').wire('dht.GND', 'esp.GND3').wire('dht.DATA', 'esp.IO4')
      .doc();
    d.farm = { ...d.farm, enabled: true };
    d.files.push({
      name: 'esp/main.py',
      content: `from machine import Pin, ADC
import dht, time
pump = Pin(26, Pin.OUT, value=0)
fan = Pin(27, Pin.OUT, value=0)
soil = ADC(Pin(34), atten=ADC.ATTN_11DB)
air = dht.DHT22(Pin(4))
while True:
    volts = soil.read_uv() / 1e6
    moisture = max(0, min(100, (2.9 - volts) / 1.6 * 100))
    pump.value(1 if moisture < 40 else 0)
    air.measure()
    fan.value(1 if air.temperature() > 22 else 0)
    print("moisture %.0f%% pump %d temp %.1f fan %d" % (moisture, pump.value(), air.temperature(), fan.value()))
    time.sleep(2)
`,
    });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const h = new McuHarness(d);
    const m0 = h.sim.farm.read('tray.moisture');
    let pumpRan = false;
    let fanRan = false;
    h.onWait = (hh) => {
      if ((hh.sim.vis.get('pump')?.run ?? 0) > 0.5) pumpRan = true;
      if ((hh.sim.vis.get('fan')?.run ?? 0) > 0.5) fanRan = true;
    };
    const r = await h.runMicroPython('esp', 30);
    expect(r.status, r.stderr + r.error?.traceback).toBe('stopped');
    expect(r.stdout).toMatch(/moisture \d+% pump 1/);
    expect(pumpRan).toBe(true);
    expect(h.sim.farm.read('tray.moisture')).toBeGreaterThan(m0 + 5);
    expect(fanRan).toBe(true);
    expect(r.stdout).toMatch(/fan 1/);
  });
});

describe('ESP32 machine.UART', () => {
  it('reads an MH-Z19B CO2 sensor on UART2 (GPIO17 TX / GPIO16 RX) with real checksums', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp()
      .add('co2', 'mhz19b', 200, 0, { co2: 812 })
      .wire('co2.VCC', 'esp.5V').wire('co2.GND', 'esp.GND1').wire('co2.TX', 'esp.IO16').wire('co2.RX', 'esp.IO17')
      .doc();
    d.files.push({
      name: 'esp/main.py',
      content: `from machine import UART
import time
u = UART(2, baudrate=9600, tx=17, rx=16, timeout=200)
u.write(bytes([0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79]))
r = u.read(9)
ok = r is not None and len(r) == 9 and ((0xFF - (sum(r[1:8]) & 0xFF) + 1) & 0xFF) == r[8]
print("CO2", r[2] * 256 + r[3], "checksum ok" if ok else "bad")
u.deinit()
`,
    });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const h = new McuHarness(d);
    const r = await h.runMicroPython('esp', 5);
    expect(r.status, r.stderr + r.error?.traceback).toBe('ok');
    const ppm = Number(/CO2 (\d+) checksum ok/.exec(r.stdout)?.[1]);
    expect(Math.abs(ppm - 812)).toBeLessThan(200);
  });

  it('ESP32 talks to the Raspberry Pi over UART (ESP32 TX -> Pi RX GPIO15)', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp()
      .add('pi', 'rpi5', 400, 0)
      .wire('esp.IO17', 'pi.P10').wire('esp.IO16', 'pi.P8').wire('esp.GND1', 'pi.P6')
      .doc();
    d.files.push({ name: 'esp/main.py', content: `from machine import UART\nu = UART(2, 115200)\nu.write("hello pi\\n")\nprint("sent")\n` });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const h = new McuHarness(d);
    h.sim.programStart();
    h.sim.uartOpen('/dev/serial0', 115200);
    const r = await h.runMicroPython('esp', 2);
    expect(r.status, r.stderr + r.error?.traceback).toBe('ok');
    h.advance(0.1);
    expect(String.fromCharCode(...h.sim.uartRead('/dev/serial0', 100))).toBe('hello pi\n');
  });

  it('UART on the SPI-flash pins (UART1 default) is refused with a clear error', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp().doc();
    d.files.push({ name: 'esp/main.py', content: `from machine import UART\nu = UART(1, 9600)\n` });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const r = await new McuHarness(d).runMicroPython('esp', 2);
    expect(r.status).toBe('error');
    expect(r.error?.message).toMatch(/flash/);
    expect(r.error?.line).toBe(2);
  });
});

describe('ESP32 1-Wire and NeoPixel', () => {
  it('DS18B20 on GPIO15 via onewire/ds18x20 and a WS2812 strip on GPIO13 via neopixel', async () => {
    const { McuHarness } = await import('./mcuharness');
    const d = esp()
      .add('t', 'ds18b20', 200, 0, { temperature: 21.5, module: true })
      .wire('t.VCC', 'esp.3V3').wire('t.GND', 'esp.GND1').wire('t.DQ', 'esp.IO15')
      .add('px', 'ws2812_strip', 200, 100, { count: 8 })
      .wire('px.VCC', 'esp.5V').wire('px.GND', 'esp.GND2').wire('px.DIN', 'esp.IO13')
      .doc();
    d.files.push({
      name: 'esp/main.py',
      content: `import onewire, ds18x20, neopixel, time
from machine import Pin
ds = ds18x20.DS18X20(onewire.OneWire(Pin(15)))
roms = ds.scan()
print("found", len(roms))
ds.convert_temp()
time.sleep_ms(750)
print("water %.1f" % ds.read_temp(roms[0]))
np = neopixel.NeoPixel(Pin(13), 8)
np.fill((0, 0, 0))
np[0] = (255, 0, 0)
np[7] = (0, 0, 255)
np.write()
`,
    });
    d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
    const h = new McuHarness(d);
    const r = await h.runMicroPython('esp', 5);
    expect(r.status, r.stderr + r.error?.traceback).toBe('ok');
    expect(r.stdout).toContain('found 1');
    expect(r.stdout).toMatch(/water 21\.\d/);
    const px = (h.sim as any).rtOf('px').pixels;
    expect(px[0]).toEqual([255, 0, 0]);
    expect(px[7]).toEqual([0, 0, 255]);
  });
});
