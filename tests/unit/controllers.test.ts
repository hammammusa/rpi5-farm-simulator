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
