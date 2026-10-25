import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { makeComponent } from '../../src/engine/devices/nextion';
import { Harness } from './pyharness';

const BLINK = `from gpiozero import LED
from time import sleep

led = LED(17)

while True:
    led.on()
    sleep(1)
    led.off()
    sleep(1)
`;

function ledDoc(phys = 11) {
  return new CircuitBuilder()
    .add('pi', 'rpi5', 0, 0)
    .add('r1', 'resistor', 400, 300, { ohms: 330 })
    .add('led1', 'led', 500, 300)
    .wire(`pi.P${phys}`, 'r1.1')
    .wire('r1.2', 'led1.A')
    .wire('led1.K', 'pi.P6')
    .doc();
}

/** sample LED brightness every 50 ms of sim time and return [t, lit] transitions */
function recorder(h: Harness, id: string) {
  const tr: { t: number; lit: boolean }[] = [];
  h.onWait = (hh) => {
    const lit = (hh.sim.vis.get(id)?.brightness ?? 0) > 0.2;
    if (!tr.length || tr[tr.length - 1].lit !== lit) tr.push({ t: hh.now() - hh.t0, lit });
  };
  return tr;
}

describe('Python runtime (Pyodide + shims)', () => {
  it('Test 1: mandatory blink example blinks the LED on GPIO17 at 1 s on / 1 s off', async () => {
    const h = new Harness(ledDoc(11));
    const tr = recorder(h, 'led1');
    const r = await h.run(BLINK, { seconds: 6.2 });
    expect(r.status).toBe('stopped');
    const ons = tr.filter((x) => x.lit);
    expect(ons.length).toBeGreaterThanOrEqual(3);
    // on→off and off→on spacing ≈ 1 s
    for (let i = 1; i < tr.length; i++) expect(tr[i].t - tr[i - 1].t).toBeCloseTo(1, 1);
  }, 60000);

  it('Test 2: LED on GPIO18 stays dark while code drives GPIO17', async () => {
    const h = new Harness(ledDoc(12));
    const tr = recorder(h, 'led1');
    await h.run(BLINK, { seconds: 4 });
    expect(tr.some((x) => x.lit)).toBe(false);
  }, 60000);

  it('Test 7: ZeroDivisionError with line number', async () => {
    const h = new Harness(ledDoc());
    const r = await h.run('x = 1\nprint(1 / 0)\n');
    expect(r.status).toBe('error');
    expect(r.error.type).toBe('ZeroDivisionError');
    expect(r.error.message).toBe('division by zero');
    expect(r.error.line).toBe(2);
    expect(r.error.traceback).toContain('ZeroDivisionError: division by zero');
  }, 60000);

  it('Test 8: infinite loop is stopped', async () => {
    const h = new Harness(ledDoc());
    const r = await h.run('import time\nwhile True:\n    time.sleep(0.1)\n', { seconds: 2 });
    expect(r.status).toBe('stopped');
  }, 60000);

  it('Test 4: DHT22 reading follows a live temperature change and drives a fan relay', async () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('dht', 'dht22', 400, 300, { temperature: 25, humidity: 60 })
      .add('rl', 'relay_module', 450, 50, { trigger: 'high' })
      .add('ps', 'power_supply', 450, 300, { volts: 12 })
      .add('fan', 'fan', 700, 250)
      .wire('pi.P1', 'dht.VCC')
      .wire('pi.P9', 'dht.GND')
      .wire('pi.P7', 'dht.DATA')
      .wire('pi.P2', 'rl.VCC')
      .wire('pi.P6', 'rl.GND')
      .wire('pi.P11', 'rl.IN1')
      .wire('ps.P', 'rl.COM1')
      .wire('rl.NO1', 'fan.P')
      .wire('fan.N', 'ps.N')
      .doc();
    const h = new Harness(doc);
    let changed = false;
    h.onWait = (hh) => {
      if (!changed && hh.now() - hh.t0 > 5) {
        changed = true;
        const c = hh.sim.doc.components.find((x) => x.id === 'dht')!;
        hh.sim.setDoc({ ...hh.sim.doc, components: hh.sim.doc.components.map((x) => (x === c ? { ...c, props: { ...c.props, temperature: 35 } } : x)) });
      }
    };
    const fanStates: number[] = [];
    const prev = h.onWait;
    h.onWait = (hh) => {
      prev!(hh);
      fanStates.push(hh.sim.vis.get('fan')!.run);
    };
    const r = await h.run(
      `import adafruit_dht, board, time
from gpiozero import OutputDevice
fan = OutputDevice(17)
dht = adafruit_dht.DHT22(board.D4)
while True:
    t = dht.temperature
    print("T=%.1f" % t)
    if t > 30:
        fan.on()
    else:
        fan.off()
    time.sleep(2)
`,
      { seconds: 11 },
    );
    expect(r.stdout).toContain("T=25.0");
    expect(r.stdout).toContain('T=35.0');
    expect(fanStates[2]).toBe(0);
    expect(fanStates[fanStates.length - 1]).toBeGreaterThan(0.9);
  }, 60000);

  it('Button callback runs during sleep', async () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('b1', 'button', 500, 300).wire('pi.P11', 'b1.1a').wire('b1.2a', 'pi.P6').doc();
    const h = new Harness(doc);
    let pressed = false;
    h.onWait = (hh) => {
      if (!pressed && hh.now() - hh.t0 > 1) {
        pressed = true;
        hh.sim.pressButton('b1', true);
      }
    };
    const r = await h.run(
      `from gpiozero import Button
from time import sleep
b = Button(17)
b.when_pressed = lambda: print("pressed!")
sleep(3)
print("done", b.is_pressed)
`,
    );
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('pressed!');
    expect(r.stdout).toContain('done True');
  }, 60000);

  it('RPi.GPIO API works and GPIO pin-in-use is reported', async () => {
    const h = new Harness(ledDoc());
    const r = await h.run(`import RPi.GPIO as GPIO
from gpiozero import LED
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)
GPIO.output(17, GPIO.HIGH)
print("in:", GPIO.input(17))
try:
    LED(17)
except Exception as e:
    print(type(e).__name__, e)
`);
    expect(r.stdout).toContain('in: 1');
    expect(r.stdout).toContain('GPIOPinInUse');
    expect(h.sim.vis.get('led1')).toBeDefined();
  }, 60000);

  it('Test 6: Nextion — Python updates text, touch event reaches Python', async () => {
    const b = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('nx', 'nextion', 500, 0)
      .wire('pi.P2', 'nx.VCC')
      .wire('pi.P6', 'nx.GND')
      .wire('pi.P8', 'nx.RX')
      .wire('pi.P10', 'nx.TX');
    const doc = b.doc();
    const p0 = doc.nextion.pages[0];
    p0.components.push(makeComponent(p0, 'text'));
    p0.components.push(makeComponent(p0, 'button'));
    const h = new Harness(doc);
    let touched = false;
    h.onWait = (hh) => {
      if (!touched && hh.now() - hh.t0 > 2) {
        touched = true;
        hh.sim.nextionTouch('nx', 'b0', true);
        hh.sim.nextionTouch('nx', 'b0', false);
      }
    };
    const r = await h.run(
      `import serial, time
ser = serial.Serial("/dev/serial0", 9600, timeout=0.2)
time.sleep(0.5)
ser.reset_input_buffer()
def cmd(s):
    ser.write(s.encode() + b"\\xff\\xff\\xff")
cmd('t0.txt="Hello Farm"')
end = time.time() + 5
while time.time() < end:
    data = ser.read(7)
    if len(data) == 7 and data[0] == 0x65:
        print("touch page=%d id=%d event=%d" % (data[1], data[2], data[3]))
        cmd('t0.txt="Pump ON"')
        break
`,
    );
    expect(r.status).toBe('ok');
    expect(r.stdout).toContain('touch page=0 id=2 event=1');
    expect((h.sim.device('nx') as any).liveOf(0, 't0').attrs.txt).toBe('Pump ON');
  }, 60000);

  it('MCP3008 via gpiozero reads the pH sensor voltage', async () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('adc', 'mcp3008', 500, 100)
      .add('ph', 'ph_sensor', 500, 300, { ph: 7.0 })
      .wire('pi.P1', 'adc.VDD')
      .wire('pi.P1', 'adc.VREF')
      .wire('pi.P6', 'adc.AGND')
      .wire('pi.P6', 'adc.DGND')
      .wire('pi.P23', 'adc.CLK')
      .wire('pi.P21', 'adc.DOUT')
      .wire('pi.P19', 'adc.DIN')
      .wire('pi.P24', 'adc.CS')
      .wire('pi.P2', 'ph.VCC')
      .wire('pi.P6', 'ph.GND')
      .wire('ph.AO', 'adc.CH0')
      .doc();
    const h = new Harness(doc);
    const r = await h.run(`from gpiozero import MCP3008
ch = MCP3008(channel=0)
print("pH=%.2f" % (3.5 * ch.voltage))
`);
    expect(r.stdout).toMatch(/pH=(6\.9\d|7\.0\d)/);
  }, 60000);

  it('BME280 over I2C via the bme280 module', async () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('bme', 'bme280', 500, 100, { temperature: 22.5, humidity: 48, pressure: 1001 })
      .wire('pi.P1', 'bme.VCC')
      .wire('pi.P6', 'bme.GND')
      .wire('pi.P3', 'bme.SDA')
      .wire('pi.P5', 'bme.SCL')
      .doc();
    const h = new Harness(doc);
    const r = await h.run(`import smbus2, bme280
bus = smbus2.SMBus(1)
print("id", hex(bus.read_byte_data(0x76, 0xD0)))
cal = bme280.load_calibration_params(bus, 0x76)
d = bme280.sample(bus, 0x76, cal)
print("T=%.1f H=%.0f P=%.0f" % (d.temperature, d.humidity, d.pressure))
try:
    bus.read_byte_data(0x77, 0xD0)
except OSError as e:
    print("errno", e.errno)
`);
    expect(r.stdout).toContain('id 0x60');
    expect(r.stdout).toContain('T=22.5 H=48 P=1001');
    expect(r.stdout).toContain('errno 121');
  }, 60000);

  it('DS18B20 through /sys/bus/w1 and w1thermsensor', async () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0, { onewire: true })
      .add('ds', 'ds18b20', 500, 100, { temperature: 19.5 })
      .add('r', 'resistor', 500, 300, { ohms: 4700 })
      .wire('pi.P1', 'ds.VCC')
      .wire('pi.P6', 'ds.GND')
      .wire('pi.P7', 'ds.DQ')
      .wire('pi.P7', 'r.1')
      .wire('pi.P1', 'r.2')
      .doc();
    const h = new Harness(doc);
    const r = await h.run(`import glob
from w1thermsensor import W1ThermSensor
dev = glob.glob('/sys/bus/w1/devices/28*')[0]
lines = open(dev + '/w1_slave').read().splitlines()
print("raw", lines[0].endswith("YES"), int(lines[1].split("t=")[1]) / 1000)
print("w1", W1ThermSensor().get_temperature())
`);
    expect(r.stdout).toContain('raw True 19.5');
    expect(r.stdout).toContain('w1 19.5');
  }, 60000);

  it('LCD1602 shows text written by RPLCD', async () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('lcd', 'lcd1602_i2c', 500, 100, { pullups: 'removed' })
      .wire('pi.P2', 'lcd.VCC')
      .wire('pi.P6', 'lcd.GND')
      .wire('pi.P3', 'lcd.SDA')
      .wire('pi.P5', 'lcd.SCL')
      .doc();
    const h = new Harness(doc);
    await h.run(`from RPLCD.i2c import CharLCD
lcd = CharLCD('PCF8574', 0x27)
lcd.write_string("Temp: 24.5")
lcd.cursor_pos = (1, 0)
lcd.write_string("pH 6.2  EC 1.4")
`);
    const v = (h.sim.device('lcd') as any).view();
    expect(v.lines[0].trimEnd()).toBe('Temp: 24.5');
    expect(v.lines[1].trimEnd()).toBe('pH 6.2  EC 1.4');
  }, 60000);

  it('Flask route answers a virtual HTTP request', async () => {
    const h = new Harness(ledDoc());
    let sent = false;
    h.onWait = (hh) => {
      if (!sent && hh.serving) {
        sent = true;
        hh.sim.pushEvent({ k: 'http', id: 7, method: 'GET', path: '/api/state', query: '', body: '', headers: {} });
      }
      if (hh.responses.has(7)) hh.stop = true;
    };
    await h.run(`from flask import Flask, jsonify
from gpiozero import LED
import threading, time
app = Flask(__name__)
led = LED(17)
@app.route('/api/state')
def state():
    return jsonify(led=led.is_lit, temp=21.5)
threading.Thread(target=app.run, kwargs={'host': '0.0.0.0', 'port': 5000}, daemon=True).start()
while True:
    led.toggle()
    time.sleep(1)
`, { seconds: 10 });
    const resp = h.responses.get(7);
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body).temp).toBe(21.5);
  }, 60000);

  it('schedule + simulated datetime', async () => {
    const h = new Harness(ledDoc());
    const r = await h.run(`import schedule, time, datetime
runs = []
schedule.every(10).seconds.do(lambda: runs.append(datetime.datetime.now()))
t0 = time.time()
while time.time() - t0 < 35:
    schedule.run_pending()
    time.sleep(1)
print("runs", len(runs))
print("year", datetime.datetime.now().year)
`, { seconds: 60 });
    expect(r.stdout).toContain('runs 3');
    expect(r.stdout).toContain('year 2026');
  }, 60000);

  it('a runtime warning disappears once the circuit is fixed while the program runs', async () => {
    // DHT22 DATA is not wired yet; the program already reads GPIO14 (pin 8)
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('dht', 'dht22', 400, 100).wire('pi.P1', 'dht.VCC').wire('dht.GND', 'pi.P9').doc();
    const h = new Harness(doc);
    let warnedBefore = false;
    let warnedAfterRead = false;
    let wired = false;
    h.onWait = (hh) => {
      const t = hh.now() - hh.t0;
      const warned = hh.sim.getRuntimeIssues().some((i) => i.code === 'W_CODE_PIN_MISMATCH');
      if (!wired) warnedBefore ||= warned;
      if (!wired && t > 1) {
        wired = true;
        const d = hh.sim.doc;
        hh.sim.setDoc({ ...d, wires: [...d.wires, { id: 'wdata', from: { comp: 'dht', pin: 'DATA' }, to: { comp: 'pi', pin: 'P8' }, color: '#e6b800' }] });
      }
      if (wired && /T 25/.test(hh.stdout)) warnedAfterRead ||= warned;
    };
    const r = await h.run(
      `import time, board, adafruit_dht
dht = adafruit_dht.DHT22(board.D14)
while True:
    try:
        print("T", dht.temperature)
    except RuntimeError as e:
        print("error:", e)
    time.sleep(2.2)
`,
      { seconds: 7 },
    );
    expect(r.stdout).toMatch(/error: DHT sensor not found[\s\S]*T 25/);
    expect(warnedBefore).toBe(true);
    expect(warnedAfterRead).toBe(false);
    expect(h.sim.issues.some((i) => i.code === 'W_CODE_PIN_MISMATCH')).toBe(false);
  }, 60000);
});
