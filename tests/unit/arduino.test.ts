// Arduino C++ on the simulated ESP32: sketches are compiled by the real Clang/LLD (LLVM 22,
// WebAssembly build) with the simulator's Arduino-ESP32 core, then run against the circuit.
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { inoToCpp, sketchPrototypes } from '../../src/runtime/arduino/arduinoHost';
import { McuHarness } from './mcuharness';

const esp = () => new CircuitBuilder().add('esp', 'esp32_devkitc', 0, 0);
const withSketch = (b: CircuitBuilder, code: string) => {
  const d = b.doc();
  d.files.push({ name: 'esp/main.ino', content: code });
  d.controllers = { esp: { language: 'arduino', main: 'esp/main.ino' } };
  return d;
};

describe('.ino preprocessing (Arduino IDE prototypes)', () => {
  it('adds prototypes before the first function so functions can be called before their definition', () => {
    const src = `#include <DHT.h>
// a comment with a fake void f() {
const int LED = 23;
struct Reading { float t; };
void setup() {
  blink(3);
}
void loop() {}
static int blink(int times) { for (int i = 0; i < times; i++) {} return times; }
float avg(const float *v, int n) const_dummy;
`;
    const { prototypes, firstLine } = sketchPrototypes(src);
    expect(prototypes).toEqual(['void setup();', 'void loop();', 'static int blink(int times);']);
    expect(firstLine).toBe(5);
    const cpp = inoToCpp(src, 'esp/main.ino');
    expect(cpp).toContain('#line 5 "esp/main.ino"');
  });
});

describe('Arduino C++ on ESP32 (real Clang → WebAssembly)', () => {
  it('Blink: digitalWrite on GPIO23 lights the LED; Serial prints to the monitor', async () => {
    const d = withSketch(
      esp().add('r', 'resistor', 200, 0, { ohms: 330 }).add('led', 'led', 300, 0).wire('esp.IO23', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2'),
      `const int LED_PIN = 23;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("ready");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.printf("on at %lu ms\\n", millis());
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("off");
  delay(500);
}
`,
    );
    const h = new McuHarness(d);
    const levels: number[] = [];
    h.onWait = (hh) => {
      const on = (hh.sim.vis.get('led')?.brightness ?? 0) > 0.2 ? 1 : 0;
      if (levels[levels.length - 1] !== on) levels.push(on);
    };
    const r = await h.runArduino('esp', 2.2);
    expect(r.compile.ok, r.compile.log).toBe(true);
    expect(r.status).toBe('stopped');
    expect(r.stdout).toContain('ready');
    expect(r.stdout).toMatch(/on at \d+ ms/);
    expect(r.stdout).toContain('off');
    expect(levels.slice(0, 4)).toEqual([1, 0, 1, 0]);
  }, 120_000);

  it('compile errors report file and line of the sketch', async () => {
    const d = withSketch(esp(), `void setup() {\n  pinMode(23, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(23, HIGH)\n  delay(100);\n}\n`);
    const r = await new McuHarness(d).runArduino('esp', 1);
    expect(r.status).toBe('error');
    expect(r.error?.type).toBe('CompileError');
    expect(r.error?.file).toBe('esp/main.ino');
    expect(r.error?.line).toBe(6);
    expect(r.error?.message).toMatch(/expected ';'/);
  }, 120_000);

  it('undefined functions are link errors, unknown libraries are missing headers', async () => {
    const a = await new McuHarness(withSketch(esp(), `void setup() { fooBar(); }\nvoid loop() {}\n`)).runArduino('esp', 1);
    expect(a.error?.message).toMatch(/fooBar/);
    const b = await new McuHarness(withSketch(esp(), `#include <LiquidCrystal_I2C.h>\nvoid setup() {}\nvoid loop() {}\n`)).runArduino('esp', 1);
    expect(b.error?.message).toMatch(/LiquidCrystal_I2C\.h' file not found/);
    expect(b.error?.line).toBe(1);
  }, 120_000);

  it('DHT22 + soil ADC + relay/pump + LEDC PWM + Wire (BH1750) + attachInterrupt', async () => {
    const d = withSketch(
      esp()
        .add('dht', 'dht22', 200, 0, { temperature: 29.5, humidity: 41 })
        .wire('esp.3V3', 'dht.VCC').wire('dht.GND', 'esp.GND1').wire('dht.DATA', 'esp.IO4')
        .add('soil', 'soil_moisture', 200, 100, { moisture: 20 })
        .wire('soil.VCC', 'esp.3V3').wire('soil.GND', 'esp.GND2').wire('soil.AO', 'esp.IO34')
        .add('lux', 'bh1750', 200, 200, { lux: 500 })
        .wire('lux.VCC', 'esp.3V3').wire('lux.GND', 'esp.GND3').wire('lux.SDA', 'esp.IO21').wire('lux.SCL', 'esp.IO22')
        .add('rl', 'relay_module', 300, 0, { channels: 1, trigger: 'high' })
        .add('ps', 'power_supply', 500, 0, { volts: 12 })
        .add('pump', 'water_pump', 500, 200)
        .wire('esp.5V', 'rl.VCC').wire('rl.GND', 'esp.GND2').wire('esp.IO26', 'rl.IN1')
        .wire('ps.P', 'rl.COM1').wire('rl.NO1', 'pump.P').wire('pump.N', 'ps.N').wire('ps.N', 'esp.GND1')
        .add('r', 'resistor', 300, 300, { ohms: 330 }).add('led', 'led', 400, 300).wire('esp.IO18', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2')
        .add('btn', 'button', 200, 300).wire('btn.1a', 'esp.IO27').wire('btn.2a', 'esp.GND1'),
      `#include <DHT.h>
#include <Wire.h>

DHT dht(4, DHT22);
volatile int presses = 0;
void IRAM_ATTR onPress() { presses++; }

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(26, OUTPUT);
  pinMode(27, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(27), onPress, FALLING);
  ledcAttach(18, 5000, 8);
  ledcWrite(18, 64);
  Wire.begin(21, 22);
  Wire.beginTransmission(0x23);
  Wire.write(0x20);
  Serial.printf("bh1750 ack %d\\n", Wire.endTransmission());
  Wire.beginTransmission(0x40);
  Serial.printf("nobody at 0x40 -> %d\\n", Wire.endTransmission());
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int raw = analogRead(34);
  uint32_t mv = analogReadMilliVolts(34);
  bool dry = mv > 2200;
  digitalWrite(26, dry ? HIGH : LOW);
  delay(180);
  Wire.requestFrom(0x23, 2);
  uint16_t v = (Wire.read() << 8) | Wire.read();
  Serial.print("T=");
  Serial.print(t, 1);
  Serial.printf(" H=%.1f raw=%d mv=%u pump=%d lux=%.0f presses=%d\\n", h, raw, mv, digitalRead(26), v / 1.2, presses);
  delay(1000);
}
`,
    );
    const h = new McuHarness(d);
    let pumpRan = false;
    let bright = 0;
    h.onWait = (hh, t) => {
      if (t > 0.5 && t < 0.6) hh.sim.pressButton('btn', true);
      if (t > 0.8 && t < 0.9) hh.sim.pressButton('btn', false);
      if ((hh.sim.vis.get('pump')?.run ?? 0) > 0.5) pumpRan = true;
      bright = Math.max(bright, hh.sim.vis.get('led')?.brightness ?? 0);
    };
    const r = await h.runArduino('esp', 3);
    expect(r.compile.ok, r.compile.log).toBe(true);
    expect(r.status, r.error?.message).toBe('stopped');
    expect(r.stdout).toContain('bh1750 ack 0');
    expect(r.stdout).toContain('nobody at 0x40 -> 2');
    expect(r.stdout).toMatch(/T=29\.5 H=41\.0 raw=\d+ mv=\d+ pump=1 lux=(49\d|50\d) presses=\d/);
    expect(r.stdout).toMatch(/presses=1/);
    expect(pumpRan).toBe(true);
    expect(bright).toBeGreaterThan(0.02);
  }, 120_000);

  it('using a flash pin stops the sketch with a clear error; ESP.restart() resets the board', async () => {
    const a = await new McuHarness(withSketch(esp(), `void setup() { pinMode(6, OUTPUT); }\nvoid loop() {}\n`)).runArduino('esp', 1);
    expect(a.status).toBe('error');
    expect(a.error?.message).toMatch(/flash/);
    const b = await new McuHarness(withSketch(esp(), `void setup() { Serial.begin(115200); Serial.println("boot"); delay(200); ESP.restart(); }\nvoid loop() {}\n`)).runArduino('esp', 2);
    expect(b.status).toBe('reset');
    expect(b.stdout).toContain('boot');
  }, 120_000);
});
