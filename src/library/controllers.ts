// ESP32 and Wiren Board 7.4 projects of the example library. Every project is complete
// (circuit, program per controller, bilingual teaching text) and has an automatic test that
// runs the real program — MicroPython, Arduino C++ compiled by Clang, wb-rules in QuickJS —
// against the simulated circuit and Smart Farm.
import { CircuitBuilder, WIRE_COLORS as W } from '../engine/project';
import type { ProjectDoc } from '../engine/types';
import type { Simulator } from '../engine/simulator';
import type { Bi, Level } from './dsl';
import { INTEGRATION_ESP, INTEGRATION_RULES, integrationCircuit } from '../examples/mcu/irrigationLoop';

export interface McuTestEvent {
  at: number;
  comp: string;
  props?: Record<string, any>;
  press?: boolean;
}

export interface McuSpec {
  id: string;
  level: Level;
  minutes: number;
  /** what runs: shown as a badge */
  board: 'esp32' | 'wb7' | 'both';
  title: Bi;
  goal: Bi;
  result: Bi;
  tryIt: Bi;
  modify: Bi;
  explain: Bi;
  build(): ProjectDoc;
  /** the program shown in the library card */
  code: string;
  test: {
    seconds: number;
    /** expected in the combined output of the controllers (serial monitor + wb-rules log) */
    expect: RegExp;
    events?: McuTestEvent[];
    /** checked near the end while the programs still run: null = OK */
    verify?: (sim: Simulator) => string | null;
  };
}

const vis = (s: Simulator, id: string) => s.vis.get(id) ?? {};
const running = (s: Simulator, id: string) => (vis(s, id).run ?? 0) > 0.5;

/** document with programs: files keyed by path, controllers by component id */
function project(b: CircuitBuilder, name: string, id: string, files: Record<string, string>, controllers: ProjectDoc['controllers'], farm = false): ProjectDoc {
  const d = b.doc({ name });
  d.exampleId = id;
  d.files = [{ name: 'main.py', content: '# This project runs on the ESP32 / Wiren Board: open their folders.\n' }, ...Object.entries(files).map(([n, content]) => ({ name: n, content }))];
  d.controllers = controllers;
  if (farm) d.farm = { ...d.farm, enabled: true };
  return d;
}

/** ESP32 at the left, USB powered */
const esp = (b = new CircuitBuilder()) => b.add('esp', 'esp32_devkitc', 40, 60, {}, 0, 'ESP32');
/** Wiren Board 7.4 on a 12 V DIN-rail supply */
const wb = (b = new CircuitBuilder(), x = 420, y = 60) =>
  b.add('wb', 'wb74', x, y, {}, 0, 'WB7').add('ps', 'power_supply', x + 260, y, { volts: 12, amps: 10 }, 0, '12 V').wire('ps.P', 'wb.VIN1', W.red).wire('ps.N', 'wb.GND1', W.black);

const MP = (id: string) => ({ [id]: { language: 'micropython' as const, main: `${id}/main.py` } });
const INO = (id: string) => ({ [id]: { language: 'arduino' as const, main: `${id}/main.ino` } });
const RULES = (id: string) => ({ [id]: { language: 'wbrules' as const, main: `${id}/rules.js` } });

// ====================================================================== ESP32
const ESP_BLINK = `# ESP32 + MicroPython: blink an LED on GPIO23
from machine import Pin
import time

led = Pin(23, Pin.OUT)        # GPIO23 -> 330 ohm -> LED -> GND

count = 0
while True:
    led.on()
    count += 1
    print("blink", count, "LED ON")
    time.sleep(0.5)
    led.off()
    print("LED OFF")
    time.sleep(0.5)
`;

const ESP_DHT_FAN = `# ESP32 + MicroPython: DHT22 controls a 12 V fan through a relay (with hysteresis)
from machine import Pin
import dht, time

sensor = dht.DHT22(Pin(4))
fan = Pin(26, Pin.OUT, value=0)    # relay IN1 (active HIGH module)

ON_ABOVE = 28.0     # degC - start the fan
OFF_BELOW = 26.0    # degC - stop it (2 degC hysteresis avoids chattering)

while True:
    try:
        sensor.measure()
        t = sensor.temperature()
        h = sensor.humidity()
    except OSError as e:
        print("DHT22 read failed:", e)
        time.sleep(2)
        continue
    if t > ON_ABOVE:
        fan.on()
    elif t < OFF_BELOW:
        fan.off()
    print("T=%.1f C  H=%.0f %%  fan %s" % (t, h, "ON" if fan.value() else "OFF"))
    time.sleep(2)
`;

const ESP_SOIL_PUMP = `// ESP32 + Arduino C++: capacitive soil sensor (ADC) -> relay -> irrigation pump
// The sensor and the pump are connected to the Smart Farm: watering raises the moisture.
const int SOIL_PIN = 34;     // ADC1_CH6, input-only pin
const int PUMP_PIN = 26;     // relay IN1
const float DRY = 35.0;      // % - start watering
const float WET = 45.0;      // % - stop watering

float readMoisture() {
  // capacitive probe: about 2.9 V in dry soil, 1.3 V in water
  float volts = analogReadMilliVolts(SOIL_PIN) / 1000.0;
  float pct = (2.9 - volts) / 1.6 * 100.0;
  return constrain(pct, 0.0f, 100.0f);
}

void setup() {
  Serial.begin(115200);
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);
  analogSetAttenuation(ADC_11db);   // 0...3.3 V range
  Serial.println("soil irrigation controller ready");
}

void loop() {
  float m = readMoisture();
  bool pump = digitalRead(PUMP_PIN);
  if (m < DRY && !pump) {
    digitalWrite(PUMP_PIN, HIGH);
    Serial.printf("moisture %.1f%% -> pump ON\\n", m);
  } else if (m > WET && pump) {
    digitalWrite(PUMP_PIN, LOW);
    Serial.printf("moisture %.1f%% -> pump OFF\\n", m);
  } else {
    Serial.printf("moisture %.1f%%\\n", m);
  }
  delay(1000);
}
`;

const ESP_GROW_LIGHT = `// ESP32 + Arduino C++: BH1750 light sensor (I2C) dims a grow LED with LEDC PWM
#include <Wire.h>

const int LIGHT_PIN = 18;        // LED through 330 ohm (a MOSFET drives a real grow light)
const float TARGET_LUX = 800.0;  // wanted light level

uint16_t readLux() {
  Wire.beginTransmission(0x23);
  Wire.write(0x20);              // one-time high-resolution measurement
  Wire.endTransmission();
  delay(180);
  Wire.requestFrom(0x23, 2);
  uint16_t raw = (Wire.read() << 8) | Wire.read();
  return raw / 1.2;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);            // SDA, SCL
  ledcAttach(LIGHT_PIN, 1000, 8);  // 1 kHz, 8-bit duty (0...255)
}

void loop() {
  float lux = readLux();
  // missing light is made up by the LED: 0 lux -> full power, >= target -> off
  float missing = constrain((TARGET_LUX - lux) / TARGET_LUX, 0.0f, 1.0f);
  int duty = (int)(missing * 255);
  ledcWrite(LIGHT_PIN, duty);
  Serial.printf("light %.0f lux -> grow light %d%%\\n", lux, duty * 100 / 255);
  delay(1000);
}
`;

const ESP_GREENHOUSE = `# ESP32 + MicroPython: complete greenhouse controller on the Smart Farm
# DHT22 (air) + soil sensor + BH1750 (light) -> pump, fan, heater relays + status NeoPixel
from machine import Pin, ADC, SoftI2C
import dht, neopixel, time

air = dht.DHT22(Pin(4))
soil = ADC(Pin(34), atten=ADC.ATTN_11DB)
i2c = SoftI2C(scl=Pin(22), sda=Pin(21))
pump = Pin(26, Pin.OUT, value=0)
fan = Pin(27, Pin.OUT, value=0)
heater = Pin(25, Pin.OUT, value=0)
status = neopixel.NeoPixel(Pin(13), 1)

def lux():
    i2c.writeto(0x23, b"\\x20")
    time.sleep_ms(180)
    d = i2c.readfrom(0x23, 2)
    return ((d[0] << 8) | d[1]) / 1.2

def moisture():
    v = soil.read_uv() / 1e6
    return max(0, min(100, (2.9 - v) / 1.6 * 100))

while True:
    air.measure()
    t, h, m, l = air.temperature(), air.humidity(), moisture(), lux()
    # irrigation with hysteresis
    if m < 35:
        pump.on()
    elif m > 45:
        pump.off()
    # climate: heat below 18 C, ventilate above 27 C
    heater.value(1 if t < 18 else 0)
    fan.value(1 if t > 27 else 0)
    alarm = t > 35 or t < 10
    status[0] = (255, 0, 0) if alarm else (0, 0, 255) if pump.value() else (0, 255, 0)
    status.write()
    print("T=%.1f H=%.0f soil=%.0f%% light=%.0f lux | pump %d fan %d heater %d" % (t, h, m, l, pump.value(), fan.value(), heater.value()))
    time.sleep(2)
`;

function espRelays(b: CircuitBuilder, loads: [relayCh: number, gpio: string, id: string, type: string, props: Record<string, any>, label: string][], relayX = 260) {
  const n = loads.length;
  b.add('rl', 'relay_module', relayX, 330, { channels: n <= 1 ? 1 : n <= 2 ? 2 : 4, trigger: 'high', coil: 5 }, 0, `Relay ×${n}`);
  b.add('ps12', 'power_supply', relayX + 260, 330, { volts: 12, amps: 10 }, 0, '12 V');
  b.wire('esp.5V', 'rl.VCC', W.red).wire('rl.GND', 'esp.GND2', W.black).wire('ps12.N', 'esp.GND1', W.black);
  loads.forEach(([ch, gpio, id, type, props, label], i) => {
    b.add(id, type, relayX + 420, 260 + i * 90, props, 0, label);
    b.wire(`esp.${gpio}`, `rl.IN${ch}`, W.orange).wire('ps12.P', `rl.COM${ch}`, W.red).wire(`rl.NO${ch}`, `${id}.P`, W.red).wire(`${id}.N`, 'ps12.N', W.black);
  });
  return b;
}

const ESP32_SPECS: McuSpec[] = [
  {
    id: 'mcu-esp32-blink',
    level: 'beginner',
    minutes: 10,
    board: 'esp32',
    title: ['ESP32 · Blink an LED on GPIO23 (MicroPython)', 'ESP32 · وميض LED على GPIO23 ‏(MicroPython)'],
    goal: ['Drive a digital output of the ESP32 with machine.Pin and see the LED and the GPIO level change.', 'تشغيل مخرج رقمي في ESP32 باستخدام machine.Pin ومشاهدة تغيّر LED ومستوى الطرف.'],
    result: ['The LED blinks twice per second and the serial monitor prints "blink N LED ON" / "LED OFF".', 'يومض LED مرتين في الثانية وتطبع شاشة المنفذ التسلسلي "blink N LED ON" و"LED OFF".'],
    tryIt: ['Change the delays to 0.1 s, or move the LED to GPIO2 and change Pin(23) to Pin(2).', 'غيّر زمن الانتظار إلى 0.1 ثانية، أو انقل LED إلى GPIO2 وغيّر Pin(23) إلى Pin(2).'],
    modify: ['Try Pin(34, Pin.OUT): GPIO34 is input-only, so the simulator stops with a ValueError, as the real chip cannot drive it.', 'جرّب Pin(34, Pin.OUT): الطرف GPIO34 للإدخال فقط، فيتوقف المحاكي بخطأ ValueError لأن الشريحة الحقيقية لا تستطيع تشغيله كمخرج.'],
    explain: ['GPIO outputs of the ESP32 are 3.3 V with about 20 mA recommended: the 330 Ω resistor limits the LED current to ≈4 mA.', 'مخارج ESP32 بجهد 3.3 فولت ويُنصح بتيار نحو 20 مللي أمبير: المقاومة 330 أوم تحد تيار LED إلى نحو 4 مللي أمبير.'],
    code: ESP_BLINK,
    build: () =>
      project(
        esp().add('r1', 'resistor', 260, 120, { ohms: 330 }).add('led1', 'led', 360, 100, { color: 'green' }).wire('esp.IO23', 'r1.1', W.green).wire('r1.2', 'led1.A', W.green).wire('led1.K', 'esp.GND2', W.black),
        'ESP32 blink',
        'mcu-esp32-blink',
        { 'esp/main.py': ESP_BLINK },
        MP('esp'),
      ),
    test: {
      seconds: 3,
      expect: /blink 2 LED ON[\s\S]*LED OFF/,
    },
  },
  {
    id: 'mcu-esp32-dht-fan',
    level: 'intermediate',
    minutes: 20,
    board: 'esp32',
    title: ['ESP32 · DHT22 temperature controls a fan (MicroPython)', 'ESP32 · حساس DHT22 يتحكم بمروحة ‏(MicroPython)'],
    goal: ['Read a DHT22 with the dht module and switch a 12 V fan through a relay with hysteresis.', 'قراءة DHT22 بوحدة dht وتشغيل مروحة 12 فولت عبر مرحل مع هامش تخلّف (hysteresis).'],
    result: ['At 30 °C the fan runs; when the room cools to 24 °C it stops. The monitor prints temperature, humidity and the fan state.', 'عند 30 °م تعمل المروحة، وعندما تبرد الغرفة إلى 24 °م تتوقف. تطبع الشاشة الحرارة والرطوبة وحالة المروحة.'],
    tryIt: ['Select the DHT22 and drag its temperature between 25 and 29 °C: inside the hysteresis band the fan keeps its state.', 'اختر DHT22 وحرّك حرارته بين 25 و29 °م: داخل نطاق الهامش تحافظ المروحة على حالتها.'],
    modify: ['Use the relay module set to active-LOW and invert the logic, or add a second fan stage at 32 °C.', 'اضبط وحدة المرحل على التفعيل المنخفض واعكس المنطق، أو أضف مرحلة مروحة ثانية عند 32 °م.'],
    explain: ['The relay coil needs 5 V (the board 5V pin from USB); the ESP32 only drives the relay input. The fan has its own 12 V supply with a common GND.', 'يحتاج ملف المرحل 5 فولت (طرف 5V من USB)؛ يقود ESP32 مدخل المرحل فقط. للمروحة مزود 12 فولت خاص مع أرضي مشترك.'],
    code: ESP_DHT_FAN,
    build: () =>
      project(
        espRelays(
          esp().add('dht', 'dht22', 260, 80, { temperature: 30, humidity: 55 }, 0, 'DHT22').wire('esp.3V3', 'dht.VCC', W.red).wire('dht.GND', 'esp.GND1', W.black).wire('dht.DATA', 'esp.IO4', W.yellow),
          [[1, 'IO26', 'fan', 'fan', {}, 'Fan 12 V']],
        ),
        'ESP32 DHT22 fan',
        'mcu-esp32-dht-fan',
        { 'esp/main.py': ESP_DHT_FAN },
        MP('esp'),
      ),
    test: {
      seconds: 9,
      expect: /T=30\.0 C\s+H=55 %\s+fan ON[\s\S]*T=24\.0 C\s+H=55 %\s+fan OFF/,
      events: [{ at: 4, comp: 'dht', props: { temperature: 24 } }],
      verify: (s) => (!running(s, 'fan') ? null : 'the fan should be off after the room cooled to 24 °C'),
    },
  },
  {
    id: 'mcu-esp32-soil-pump',
    level: 'intermediate',
    minutes: 25,
    board: 'esp32',
    title: ['ESP32 · Soil moisture (ADC) waters the farm (Arduino C++)', 'ESP32 · رطوبة التربة (ADC) تسقي المزرعة ‏(Arduino C++)'],
    goal: ['Read a capacitive soil sensor with analogReadMilliVolts and run the irrigation pump of the Smart Farm through a relay.', 'قراءة حساس رطوبة سعوي بالدالة analogReadMilliVolts وتشغيل مضخة الري في المزرعة الذكية عبر مرحل.'],
    result: ['The sketch is compiled by Clang, starts the pump below 35 %, the farm tray gets wetter, and the pump stops above 45 %.', 'تُترجم الشيفرة بمترجم Clang، فتشغّل المضخة تحت 35٪، وتزداد رطوبة صينية المزرعة، ثم تتوقف المضخة فوق 45٪.'],
    tryIt: ['Open the Smart Farm tab while it runs and watch the tray moisture and the pump flow.', 'افتح تبويب المزرعة الذكية أثناء التشغيل وراقب رطوبة الصينية وتدفق المضخة.'],
    modify: ['Change DRY/WET, or move the sensor to GPIO25 (ADC2): it works until Wi-Fi is used, because ADC2 is shared with the radio.', 'غيّر DRY وWET، أو انقل الحساس إلى GPIO25 ‏(ADC2): يعمل إلى أن تُستخدم Wi-Fi لأن ADC2 مشترك مع الراديو.'],
    explain: ['GPIO34 is an input-only ADC1 pin, the right choice for analog sensors. With 11 dB attenuation the ADC reads 0…3.3 V.', 'الطرف GPIO34 للإدخال فقط وتابع لـ ADC1، وهو الخيار الصحيح للحساسات التناظرية. مع تخميد 11 dB يقرأ المحول من 0 إلى 3.3 فولت.'],
    code: ESP_SOIL_PUMP,
    build: () =>
      project(
        espRelays(
          esp().add('soil', 'soil_moisture', 260, 80, { source: 'farm' }, 0, 'Soil sensor').wire('soil.VCC', 'esp.3V3', W.red).wire('soil.GND', 'esp.GND1', W.black).wire('soil.AO', 'esp.IO34', W.yellow),
          [[1, 'IO26', 'pump', 'water_pump', { role: 'circulation', rate: 4 }, 'Irrigation pump']],
        ),
        'ESP32 soil pump',
        'mcu-esp32-soil-pump',
        { 'esp/main.ino': ESP_SOIL_PUMP },
        INO('esp'),
        true,
      ),
    test: {
      seconds: 40,
      expect: /pump ON[\s\S]*pump OFF/,
      verify: (s) => (s.farm.read('tray.moisture') > 30 ? null : 'the farm tray should be wetter after watering'),
    },
  },
  {
    id: 'mcu-esp32-grow-light',
    level: 'intermediate',
    minutes: 20,
    board: 'esp32',
    title: ['ESP32 · PWM grow light follows the light level (Arduino C++)', 'ESP32 · إضاءة نمو بتعديل PWM حسب شدة الضوء ‏(Arduino C++)'],
    goal: ['Read a BH1750 over I2C with Wire and dim an LED with the LEDC PWM peripheral (ledcAttach / ledcWrite).', 'قراءة BH1750 عبر I2C بمكتبة Wire وتعتيم LED بطرفية LEDC للتعديل PWM ‏(ledcAttach و ledcWrite).'],
    result: ['In the dark the LED is at full power; at 600 lux it dims to 25 %; above 800 lux it is off.', 'في الظلام يعمل LED بكامل قدرته؛ عند 600 لوكس ينخفض إلى 25٪؛ وفوق 800 لوكس ينطفئ.'],
    tryIt: ['Select the BH1750 and change the light level while the sketch runs.', 'اختر BH1750 وغيّر شدة الضوء أثناء تشغيل الشيفرة.'],
    modify: ['Use 10-bit resolution (ledcAttach(18, 1000, 10)) and scale the duty to 0…1023.', 'استخدم دقة 10 بت (ledcAttach(18, 1000, 10)) ووسّع قيمة التشغيل إلى 0…1023.'],
    explain: ['LEDC generates the PWM in hardware: the pin switches at 1 kHz and the LED brightness follows the duty cycle. A real 12 V grow light needs a logic-level MOSFET.', 'تولّد LEDC إشارة PWM عتادياً: يتبدل الطرف بتردد 1 كيلوهرتز ويتبع سطوع LED نسبة التشغيل. إضاءة النمو الحقيقية بجهد 12 فولت تحتاج ترانزستور MOSFET بمستوى منطقي.'],
    code: ESP_GROW_LIGHT,
    build: () =>
      project(
        esp()
          .add('lux', 'bh1750', 260, 80, { lux: 0 }, 0, 'BH1750')
          .wire('lux.VCC', 'esp.3V3', W.red).wire('lux.GND', 'esp.GND1', W.black).wire('lux.SDA', 'esp.IO21', W.blue).wire('lux.SCL', 'esp.IO22', W.yellow)
          .add('r1', 'resistor', 260, 230, { ohms: 330 }).add('led1', 'led', 360, 210, { color: 'white' }, 0, 'Grow LED')
          .wire('esp.IO18', 'r1.1', W.orange).wire('r1.2', 'led1.A', W.orange).wire('led1.K', 'esp.GND2', W.black),
        'ESP32 grow light',
        'mcu-esp32-grow-light',
        { 'esp/main.ino': ESP_GROW_LIGHT },
        INO('esp'),
      ),
    test: {
      seconds: 6,
      expect: /light 0 lux -> grow light 100%[\s\S]*light (59\d|60\d) lux -> grow light 2[45]%/,
      events: [{ at: 3, comp: 'lux', props: { lux: 600 } }],
      verify: (s) => {
        const b = vis(s, 'led1').brightness ?? 0;
        return b > 0.02 && b < 0.6 ? null : `the LED should be dimmed (brightness ${b.toFixed(2)})`;
      },
    },
  },
  {
    id: 'mcu-esp32-greenhouse',
    level: 'advanced',
    minutes: 45,
    board: 'esp32',
    title: ['ESP32 · Complete greenhouse on the Smart Farm (MicroPython)', 'ESP32 · بيت محمي متكامل على المزرعة الذكية ‏(MicroPython)'],
    goal: ['Combine DHT22, soil ADC and BH1750 (I2C) with three relays (pump, fan, heater) and a NeoPixel status LED, all connected to the Smart Farm.', 'دمج DHT22 وحساس التربة وBH1750 ‏(I2C) مع ثلاثة مرحلات (مضخة ومروحة وسخان) ومؤشر NeoPixel، وكلها مرتبطة بالمزرعة الذكية.'],
    result: ['The pump waters the dry tray (blue status), the climate relays follow the air temperature and the monitor prints every reading.', 'تسقي المضخة الصينية الجافة (المؤشر أزرق)، وتتبع مرحلات المناخ حرارة الهواء، وتطبع الشاشة كل القراءات.'],
    tryIt: ['In the Smart Farm tab change the outdoor temperature or speed up time and watch the heater and fan.', 'في تبويب المزرعة الذكية غيّر الحرارة الخارجية أو سرّع الزمن وراقب السخان والمروحة.'],
    modify: ['Publish the readings over MQTT to a Wiren Board (see the integration project), or add a light schedule.', 'انشر القراءات عبر MQTT إلى Wiren Board (انظر مشروع التكامل)، أو أضف جدولاً للإضاءة.'],
    explain: ['Each actuator has a farm role: the pump moves water to the tray, the heater and fan change the room air in the farm model, and the sensors read that model back.', 'لكل مشغل دور في المزرعة: المضخة تنقل الماء إلى الصينية، والسخان والمروحة يغيران هواء الغرفة في نموذج المزرعة، والحساسات تقرأ هذا النموذج.'],
    code: ESP_GREENHOUSE,
    build: () =>
      project(
        espRelays(
          esp()
            .add('dht', 'dht22', 260, 40, { source: 'farm' }, 0, 'DHT22')
            .wire('esp.3V3', 'dht.VCC', W.red).wire('dht.GND', 'esp.GND1', W.black).wire('dht.DATA', 'esp.IO4', W.yellow)
            .add('soil', 'soil_moisture', 360, 40, { source: 'farm' }, 0, 'Soil')
            .wire('soil.VCC', 'esp.3V3', W.red).wire('soil.GND', 'esp.GND1', W.black).wire('soil.AO', 'esp.IO34', W.yellow)
            .add('lux', 'bh1750', 460, 40, { source: 'farm' }, 0, 'BH1750')
            .wire('lux.VCC', 'esp.3V3', W.red).wire('lux.GND', 'esp.GND3', W.black).wire('lux.SDA', 'esp.IO21', W.blue).wire('lux.SCL', 'esp.IO22', W.yellow)
            .add('px', 'ws2812_strip', 260, 200, { count: 1 }, 0, 'Status')
            .wire('px.VCC', 'esp.5V', W.red).wire('px.GND', 'esp.GND3', W.black).wire('px.DIN', 'esp.IO13', W.green),
          [
            [1, 'IO26', 'pump', 'water_pump', { role: 'circulation', rate: 4 }, 'Pump'],
            [2, 'IO27', 'fan', 'fan', { role: 'fan' }, 'Fan'],
            [3, 'IO25', 'heater', 'heater', { role: 'heater', watts: 40 }, 'Heater'],
          ],
        ),
        'ESP32 greenhouse',
        'mcu-esp32-greenhouse',
        { 'esp/main.py': ESP_GREENHOUSE },
        MP('esp'),
        true,
      ),
    test: {
      seconds: 8,
      expect: /T=\d+\.\d H=\d+ soil=\d+% light=\d+ lux \| pump 1/,
      verify: (s) => {
        if (!running(s, 'pump')) return 'the pump should water the dry tray';
        const px = (s as any).rtOf('px').pixels?.[0];
        return px && px[2] === 255 ? null : 'the status pixel should be blue while watering';
      },
    },
  },
];

// ====================================================================== Wiren Board 7.4
const WB_INPUT_RELAY = `// Wiren Board 7.4 · wb-rules: a push button on A2 (dry contact to GND) toggles the load on A1.
// A1 is an open-collector output: it connects the load's minus to GND, the plus goes to V+.
defineVirtualDevice("lighting", {
  title: "Lighting",
  cells: {
    lamp: { type: "switch", value: false },
    toggles: { type: "value", value: 0, readonly: true }
  }
});

// a closed contact pulls A2 to GND: A2_IN goes from 1 (open) to 0 (pressed)
defineRule("button_toggles_lamp", {
  whenChanged: "wb-gpio/A2_IN",
  then: function (value) {
    if (value) return;                           // only the press, not the release
    dev["lighting/lamp"] = !dev["lighting/lamp"];
    dev["lighting/toggles"] = dev["lighting/toggles"] + 1;
  }
});

// the virtual switch (also clickable in the MQTT tab) drives the output
defineRule("lamp_to_output", {
  whenChanged: "lighting/lamp",
  then: function (on) {
    dev["wb-gpio/A1_OUT"] = on;
    log("lamp {} (toggle #{})", on ? "ON" : "OFF", dev["lighting/toggles"]);
  }
});
`;

const WB_LEVEL_IRRIGATION = `// Wiren Board 7.4 · water-level protected irrigation
// Float switch on A3 (closed = water above the sensor) and the pump on relay K1 of a WB-MR6C (Modbus RTU).
defineVirtualDevice("irrigation", {
  title: "Irrigation",
  cells: {
    auto: { type: "switch", value: true },
    water_ok: { type: "switch", value: false, readonly: true },
    cycles: { type: "value", value: 0, readonly: true }
  }
});

var PUMP = "wb-mr6c_32/K1";

// water level: a closed float pulls A3 to GND (A3_IN = 0)
defineRule("level", {
  whenChanged: "wb-gpio/A3_IN",
  then: function (v) {
    dev["irrigation/water_ok"] = !v;
    if (v && dev[PUMP]) {
      dev[PUMP] = false;
      log.warning("reservoir LOW - pump stopped to protect it from running dry");
    }
  }
});

// watering cycle every 10 s, 4 s long, only with enough water
defineRule("schedule", {
  cron: "@every 10s",
  then: function () {
    if (!dev["irrigation/auto"]) return;
    if (!dev["irrigation/water_ok"]) {
      log.warning("skipped watering: reservoir low");
      return;
    }
    dev[PUMP] = true;
    dev["irrigation/cycles"] = dev["irrigation/cycles"] + 1;
    log("watering cycle {} started", dev["irrigation/cycles"]);
    setTimeout(function () {
      dev[PUMP] = false;
      log("watering cycle finished");
    }, 4000);
  }
});
`;

const WB_1WIRE_HEATING = `// Wiren Board 7.4 · 1-Wire temperature control of a heater
// DS18B20 on W1, heater on relay K2 of the WB-MR6C, adjustable set point with hysteresis.
defineVirtualDevice("heating", {
  title: "Heating",
  cells: {
    setpoint: { type: "range", value: 21, min: 10, max: 30 },
    heater: { type: "switch", value: false, readonly: true }
  }
});

var HEATER = "wb-mr6c_32/K2";
var HYST = 0.5;   // degC

function sensor() {
  // the first DS18B20 found by wb-mqtt-w1 (its name is the ROM code, e.g. 28-00000a1b2c3d)
  return Object.keys(probe).length ? probe.name : null;
}
var probe = {};

trackMqtt("/devices/wb-w1/controls/+", function (msg) {
  var name = msg.topic.split("/")[4];
  if (!probe.name) {
    probe.name = name;
    log("found 1-Wire sensor {}", name);
  }
});

defineRule("thermostat", {
  when: function () { return probe.name && dev["wb-w1/" + probe.name] !== null; },
  then: function () {
    var t = dev["wb-w1/" + probe.name];
    var sp = dev["heating/setpoint"];
    var on = dev[HEATER];
    if (t < sp - HYST && !on) {
      dev[HEATER] = true;
      log("{} C < {} C -> heater ON", t, sp);
    } else if (t > sp + HYST && on) {
      dev[HEATER] = false;
      log("{} C > {} C -> heater OFF", t, sp);
    }
    dev["heating/heater"] = dev[HEATER];
  }
});
`;

const WB_MODBUS_OUTPUT = `// Wiren Board 7.4 · Modbus RTU sensor -> Modbus RTU output
// RS-485 soil probe (address 1) and WB-MR6C relays (address 32) on the same RS-485-1 bus.
var SOIL = "soil-probe_1/Moisture";
var PUMP = "wb-mr6c_32/K1";

defineRule("soil_irrigation", {
  whenChanged: SOIL,
  then: function (m) {
    if (m < 30 && !dev[PUMP]) {
      dev[PUMP] = true;
      log("soil {}% -> pump ON (Modbus write coil 0)", m);
    } else if (m > 45 && dev[PUMP]) {
      dev[PUMP] = false;
      log("soil {}% -> pump OFF", m);
    }
  }
});

// wb-mqtt-serial marks a control with /meta/error when the device stops answering
trackMqtt("/devices/soil-probe_1/controls/Moisture/meta/error", function (msg) {
  if (msg.value) log.error("soil probe not answering ({}): pump forced OFF", msg.value);
  if (msg.value && dev[PUMP]) dev[PUMP] = false;
});
`;

const WB_MQTT_ALARMS = `// Wiren Board 7.4 · monitoring and alarms over MQTT
// Watches the soil probe (Modbus), the DS18B20 (1-Wire) and the supply voltage, keeps an
// alarm device, publishes JSON events on farm/alarms and lights the alarm lamp on A4.
defineVirtualDevice("alarms", {
  title: "Farm alarms",
  cells: {
    too_hot: { type: "alarm", value: false, readonly: true },
    too_dry: { type: "alarm", value: false, readonly: true },
    power: { type: "alarm", value: false, readonly: true },
    active: { type: "value", value: 0, readonly: true }
  }
});

function setAlarm(name, on, text) {
  if (dev["alarms/" + name] === on) return;
  dev["alarms/" + name] = on;
  publish("farm/alarms", JSON.stringify({ alarm: name, active: on, text: text }), 0, false);
  if (on) log.error("ALARM {}: {}", name, text);
  else log("alarm {} cleared", name);
  var n = 0;
  ["too_hot", "too_dry", "power"].forEach(function (a) { if (dev["alarms/" + a]) n++; });
  dev["alarms/active"] = n;
  dev["wb-gpio/A4_OUT"] = n > 0;
}

trackMqtt("/devices/wb-w1/controls/+", function (msg) {
  var t = parseFloat(msg.value);
  setAlarm("too_hot", t > 35, "water temperature " + t + " C");
});

defineRule("dry", { whenChanged: "soil-probe_1/Moisture", then: function (m) { setAlarm("too_dry", m < 20, "soil moisture " + m + " %"); } });
defineRule("supply", { whenChanged: "wb-adc/Vin", then: function (v) { setAlarm("power", v < 11, "supply " + v + " V"); } });
`;

/** WB-MR6C on RS-485-1 at Modbus address 32, powered from the 12 V supply */
const mr6c = (b: CircuitBuilder, x = 420, y = 330) =>
  b.add('mr', 'wb_mr6c', x, y, { slave: 32 }, 0, 'WB-MR6C').wire('mr.VIN', 'ps.P', W.red).wire('mr.GND', 'ps.N', W.black).wire('mr.A', 'wb.RS1_A', W.yellow).wire('mr.B', 'wb.RS1_B', W.blue);

const WB_SPECS: McuSpec[] = [
  {
    id: 'mcu-wb7-input-relay',
    level: 'beginner',
    minutes: 15,
    board: 'wb7',
    title: ['WB7 · Push button on A2 toggles the lamp on A1 (wb-rules)', 'WB7 · زر على A2 يبدّل المصباح على A1 ‏(wb-rules)'],
    goal: ['Use A2 as a dry-contact input and A1 as an open-collector output from wb-rules, with a virtual device that also works from MQTT.', 'استخدام A2 كمدخل تلامس جاف وA1 كمخرج مجمّع مفتوح من wb-rules، مع جهاز افتراضي يعمل أيضاً من MQTT.'],
    result: ['Each press of the button toggles the 12 V lamp (an LED with a resistor here) and counts the toggles.', 'كل ضغطة على الزر تبدّل مصباح 12 فولت (LED مع مقاومة هنا) وتعدّ مرات التبديل.'],
    tryIt: ['Open the MQTT tab and click lighting/lamp, or wb-gpio/A1_OUT directly.', 'افتح تبويب MQTT واضغط lighting/lamp أو wb-gpio/A1_OUT مباشرة.'],
    modify: ['Add a long-press rule with startTimer to switch the lamp off after 10 s.', 'أضف قاعدة للضغط الطويل باستخدام startTimer لإطفاء المصباح بعد 10 ثوانٍ.'],
    explain: ['A1–A4 switch to GND (open collector, up to 30 V / 1 A): the lamp is wired between V+ and A1. A closed contact on an input reads 0.', 'تتصل المخارج A1–A4 بالأرضي (مجمّع مفتوح حتى 30 فولت و1 أمبير): يوصَل المصباح بين V+ وA1. التلامس المغلق على المدخل يُقرأ 0.'],
    code: WB_INPUT_RELAY,
    build: () =>
      project(
        wb()
          .add('btn', 'button', 470, 300, {}, 0, 'Button')
          .wire('btn.1a', 'wb.A2', W.green).wire('btn.2a', 'wb.GND2', W.black)
          .add('rl', 'resistor', 700, 300, { ohms: 2200 }).add('lamp', 'led', 800, 280, { color: 'yellow' }, 0, 'Lamp')
          .wire('ps.P', 'rl.1', W.red).wire('rl.2', 'lamp.A', W.red).wire('lamp.K', 'wb.A1', W.orange),
        'WB7 input → output',
        'mcu-wb7-input-relay',
        { 'wb/rules.js': WB_INPUT_RELAY },
        RULES('wb'),
      ),
    test: {
      seconds: 4,
      expect: /lamp ON \(toggle #1\)[\s\S]*lamp OFF \(toggle #2\)[\s\S]*lamp ON \(toggle #3\)/,
      events: [
        { at: 0.5, comp: 'btn', press: true },
        { at: 0.8, comp: 'btn', press: false },
        { at: 1.5, comp: 'btn', press: true },
        { at: 1.8, comp: 'btn', press: false },
        { at: 2.5, comp: 'btn', press: true },
        { at: 2.8, comp: 'btn', press: false },
      ],
      verify: (s) => ((vis(s, 'lamp').brightness ?? 0) > 0.1 ? null : 'the lamp should be on after the third press'),
    },
  },
  {
    id: 'mcu-wb7-level-irrigation',
    level: 'intermediate',
    minutes: 25,
    board: 'wb7',
    title: ['WB7 · Scheduled irrigation with low-water protection', 'WB7 · ري مجدول مع حماية من انخفاض الماء'],
    goal: ['Combine a cron rule, a float switch on A3 and a Modbus relay (WB-MR6C K1) that runs the farm pump.', 'دمج قاعدة cron وعوامة على A3 ومرحل Modbus ‏(WB-MR6C K1) يشغّل مضخة المزرعة.'],
    result: ['Every 10 s the pump waters for 4 s; when the reservoir level falls below the float, the pump stops and cycles are skipped.', 'كل 10 ثوانٍ تسقي المضخة لمدة 4 ثوانٍ؛ وعندما ينخفض مستوى الخزان عن العوامة تتوقف المضخة وتُتخطى الدورات.'],
    tryIt: ['Select the float switch and lower its water level below the trigger while the pump runs.', 'اختر العوامة واخفض مستوى الماء تحت نقطة التفعيل أثناء عمل المضخة.'],
    modify: ['Replace "@every 10s" with "0 0 6 * * *" (every day at 06:00) and use fast-forward.', 'استبدل "@every 10s" بالتعبير "0 0 6 * * *" (كل يوم الساعة 06:00) واستخدم التسريع.'],
    explain: ['The relay is not on the controller: wb-mqtt-serial writes Modbus coil 0 of address 32, and the K1 value changes when the module confirms.', 'المرحل ليس على المتحكم: يكتب wb-mqtt-serial ملف Modbus رقم 0 في العنوان 32، وتتغير قيمة K1 عندما تؤكد الوحدة.'],
    code: WB_LEVEL_IRRIGATION,
    build: () =>
      project(
        mr6c(wb())
          .add('float', 'float_switch', 470, 300, { level: 70, trigger: 30, mode: 'closed_high' }, 0, 'Float switch')
          .wire('float.1', 'wb.A3', W.blue).wire('float.2', 'wb.GND2', W.black)
          .add('pump', 'water_pump', 700, 330, { role: 'circulation', rate: 4 }, 0, 'Pump')
          .wire('ps.P', 'mr.COM1', W.red).wire('mr.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black),
        'WB7 level-protected irrigation',
        'mcu-wb7-level-irrigation',
        { 'wb/rules.js': WB_LEVEL_IRRIGATION },
        RULES('wb'),
        true,
      ),
    test: {
      seconds: 32,
      expect: /watering cycle 1 started[\s\S]*watering cycle finished[\s\S]*watering cycle 2 started[\s\S]*reservoir LOW - pump stopped[\s\S]*skipped watering: reservoir low/,
      events: [{ at: 22, comp: 'float', props: { level: 10 } }],
      verify: (s) => (!running(s, 'pump') ? null : 'the pump must stay off while the reservoir is low'),
    },
  },
  {
    id: 'mcu-wb7-1wire-heating',
    level: 'intermediate',
    minutes: 25,
    board: 'wb7',
    title: ['WB7 · 1-Wire thermostat drives a heater relay', 'WB7 · منظم حرارة 1-Wire يشغّل مرحل السخان'],
    goal: ['Find a DS18B20 on W1 with trackMqtt, then control a heater on WB-MR6C K2 with a set point and hysteresis.', 'العثور على DS18B20 على W1 باستخدام trackMqtt، ثم التحكم بسخان على WB-MR6C K2 بنقطة ضبط وهامش تخلّف.'],
    result: ['At 18 °C the heater turns on; when the sensor reaches 23 °C it turns off.', 'عند 18 °م يعمل السخان؛ وعندما يصل الحساس إلى 23 °م يتوقف.'],
    tryIt: ['Change heating/setpoint in the MQTT tab (publish to /devices/heating/controls/setpoint/on).', 'غيّر heating/setpoint من تبويب MQTT (انشر إلى /devices/heating/controls/setpoint/on).'],
    modify: ['Add a second DS18B20 on W2 and use the average of both sensors.', 'أضف حساس DS18B20 ثانياً على W2 واستخدم متوسط القراءتين.'],
    explain: ['W1/W2 have an internal 5 V pull-up, so the probe needs no external resistor. wb-mqtt-w1 publishes each sensor under its ROM code.', 'للطرفين W1 وW2 مقاومة سحب داخلية إلى 5 فولت، فلا يحتاج الحساس مقاومة خارجية. ينشر wb-mqtt-w1 كل حساس باسم رمز ROM الخاص به.'],
    code: WB_1WIRE_HEATING,
    build: () =>
      project(
        mr6c(wb())
          .add('temp', 'ds18b20', 470, 300, { temperature: 18, module: false }, 0, 'DS18B20')
          .add('ps5', 'power_supply', 560, 420, { volts: 5, amps: 1 }, 0, '5 V')
          .wire('temp.DQ', 'wb.W1', W.yellow).wire('temp.GND', 'wb.GND3', W.black).wire('temp.VCC', 'ps5.P', W.red).wire('ps5.N', 'wb.GND3', W.black)
          .add('heater', 'heater', 700, 330, { role: 'heater', watts: 40 }, 0, 'Heater')
          .wire('ps.P', 'mr.COM2', W.red).wire('mr.NO2', 'heater.P', W.red).wire('heater.N', 'ps.N', W.black),
        'WB7 1-Wire heating',
        'mcu-wb7-1wire-heating',
        { 'wb/rules.js': WB_1WIRE_HEATING },
        RULES('wb'),
      ),
    test: {
      seconds: 6,
      expect: /found 1-Wire sensor 28-[0-9a-f]{12}[\s\S]*18 C < 21 C -> heater ON[\s\S]*23 C > 21 C -> heater OFF/,
      events: [{ at: 3, comp: 'temp', props: { temperature: 23 } }],
      verify: (s) => (!running(s, 'heater') && !(vis(s, 'mr').ch ?? [])[1] ? null : 'the heater relay K2 should be off at 23 °C'),
    },
  },
  {
    id: 'mcu-wb7-modbus-output',
    level: 'intermediate',
    minutes: 25,
    board: 'wb7',
    title: ['WB7 · Modbus RS-485 soil probe switches a Modbus relay', 'WB7 · حساس تربة Modbus ‏RS-485 يبدّل مرحل Modbus'],
    goal: ['Read a Modbus RTU sensor and drive a Modbus RTU relay on the same RS-485 bus, and react to communication errors.', 'قراءة حساس Modbus RTU وتشغيل مرحل Modbus RTU على ناقل RS-485 نفسه، والتفاعل مع أخطاء الاتصال.'],
    result: ['Below 30 % the pump starts, above 45 % it stops; when the probe stops answering the pump is forced off.', 'تحت 30٪ تبدأ المضخة، وفوق 45٪ تتوقف؛ وعندما يتوقف الحساس عن الرد تُطفأ المضخة قسراً.'],
    tryIt: ['Set the probe fault to "Sensor disconnected" or change its baud rate: watch the timeouts in the terminal.', 'اضبط عطل الحساس على "Sensor disconnected" أو غيّر سرعة نقله: راقب انتهاء المهلة في الطرفية.'],
    modify: ['Swap A and B of the probe: wb-mqtt-serial reports the swap and the probe disappears.', 'بدّل A وB في الحساس: يبلّغ wb-mqtt-serial عن التبديل ويختفي الحساس.'],
    explain: ['Both devices share RS-485-1 (A↔A, B↔B) and answer only to their own address: 1 for the probe, 32 for the relay module.', 'يتشارك الجهازان المنفذ RS-485-1 ‏(A↔A وB↔B) ولا يرد كل منهما إلا على عنوانه: 1 للحساس و32 لوحدة المرحلات.'],
    code: WB_MODBUS_OUTPUT,
    build: () =>
      project(
        mr6c(wb())
          .add('soil', 'rs485_soil', 470, 300, { slave: 1, moisture: 22 }, 0, 'Soil probe RS-485')
          .wire('soil.VCC', 'ps.P', W.red).wire('soil.GND', 'ps.N', W.black).wire('soil.A', 'wb.RS1_A', W.yellow).wire('soil.B', 'wb.RS1_B', W.blue)
          .add('pump', 'water_pump', 700, 330, {}, 0, 'Pump')
          .wire('ps.P', 'mr.COM1', W.red).wire('mr.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black),
        'WB7 Modbus in → out',
        'mcu-wb7-modbus-output',
        { 'wb/rules.js': WB_MODBUS_OUTPUT },
        RULES('wb'),
      ),
    test: {
      seconds: 8,
      expect: /soil 22% -> pump ON[\s\S]*soil 50% -> pump OFF/,
      events: [{ at: 4, comp: 'soil', props: { moisture: 50 } }],
      verify: (s) => (!running(s, 'pump') ? null : 'the pump should be off at 50 %'),
    },
  },
  {
    id: 'mcu-wb7-mqtt-alarms',
    level: 'advanced',
    minutes: 40,
    board: 'wb7',
    title: ['WB7 · MQTT monitoring and alarms with wb-rules', 'WB7 · مراقبة وإنذارات عبر MQTT باستخدام wb-rules'],
    goal: ['Collect readings from Modbus, 1-Wire and the ADC, keep an alarm device, publish JSON events on MQTT and light an alarm lamp.', 'جمع القراءات من Modbus و1-Wire والمحول التناظري، والاحتفاظ بجهاز إنذارات، ونشر أحداث JSON عبر MQTT، وإضاءة مصباح إنذار.'],
    result: ['When the water gets too hot and the soil too dry the alarms appear on farm/alarms and the lamp on A4 lights; they clear when values return.', 'عندما يسخن الماء كثيراً وتجف التربة تظهر الإنذارات على farm/alarms ويضيء المصباح على A4؛ وتزول عندما تعود القيم.'],
    tryIt: ['Watch the MQTT tab: the alarms device and the farm/alarms messages.', 'راقب تبويب MQTT: جهاز الإنذارات ورسائل farm/alarms.'],
    modify: ['Send the alarms to an ESP32 that subscribes to farm/alarms and beeps a buzzer.', 'أرسل الإنذارات إلى ESP32 يشترك في farm/alarms ويُصدر صوتاً من صفارة.'],
    explain: ['trackMqtt reacts to any topic, defineRule to controls; publish sends free-form messages that other controllers can subscribe to.', 'تتفاعل trackMqtt مع أي موضوع، وdefineRule مع عناصر التحكم؛ وتنشر publish رسائل حرة يمكن للمتحكمات الأخرى الاشتراك فيها.'],
    code: WB_MQTT_ALARMS,
    build: () =>
      project(
        wb()
          .add('soil', 'rs485_soil', 470, 300, { slave: 1, moisture: 40 }, 0, 'Soil probe RS-485')
          .wire('soil.VCC', 'ps.P', W.red).wire('soil.GND', 'ps.N', W.black).wire('soil.A', 'wb.RS1_A', W.yellow).wire('soil.B', 'wb.RS1_B', W.blue)
          .add('temp', 'ds18b20', 620, 300, { temperature: 24, module: false }, 0, 'DS18B20 water')
          .add('ps5', 'power_supply', 620, 420, { volts: 5, amps: 1 }, 0, '5 V')
          .wire('temp.DQ', 'wb.W1', W.yellow).wire('temp.GND', 'wb.GND3', W.black).wire('temp.VCC', 'ps5.P', W.red).wire('ps5.N', 'wb.GND3', W.black)
          .add('rl', 'resistor', 760, 300, { ohms: 2200 }).add('lamp', 'led', 860, 280, { color: 'red' }, 0, 'Alarm lamp')
          .wire('ps.P', 'rl.1', W.red).wire('rl.2', 'lamp.A', W.red).wire('lamp.K', 'wb.A4', W.orange),
        'WB7 MQTT alarms',
        'mcu-wb7-mqtt-alarms',
        { 'wb/rules.js': WB_MQTT_ALARMS },
        RULES('wb'),
      ),
    test: {
      seconds: 9,
      expect: /ALARM too_hot: water temperature 38[\s\S]*ALARM too_dry: soil moisture 15[\s\S]*alarm too_hot cleared/,
      events: [
        { at: 2, comp: 'temp', props: { temperature: 38 } },
        { at: 4, comp: 'soil', props: { moisture: 15 } },
        { at: 6.5, comp: 'temp', props: { temperature: 25 } },
      ],
      verify: (s) => ((vis(s, 'lamp').brightness ?? 0) > 0.1 ? null : 'the alarm lamp should stay on while the soil is dry'),
    },
  },
];

// ====================================================================== integration
const INTEGRATION: McuSpec = {
  id: 'mcu-esp32-wb7-integration',
  level: 'advanced',
  minutes: 45,
  board: 'both',
  title: ['ESP32 + WB7 · Wireless soil sensor → MQTT → Wiren Board rule → Modbus pump → Smart Farm', 'ESP32 + WB7 · حساس تربة لاسلكي ← MQTT ← قاعدة Wiren Board ← مضخة Modbus ← المزرعة الذكية'],
  goal: ['Build a two-controller system: an ESP32 sensor node publishes over Wi-Fi/MQTT, the Wiren Board decides and switches a Modbus relay that waters the farm.', 'بناء نظام بمتحكمين: عقدة حساس ESP32 تنشر عبر Wi-Fi وMQTT، وWiren Board يقرر ويبدّل مرحل Modbus يسقي المزرعة.'],
  result: ['The ESP32 joins the WB Wi-Fi, publishes the moisture as a WB device, the rule starts the pump below 35 %, the tray gets wetter and the pump stops above 45 %.', 'ينضم ESP32 إلى شبكة WB، وينشر الرطوبة كجهاز WB، فتشغّل القاعدة المضخة تحت 35٪، وتزداد رطوبة الصينية، وتتوقف المضخة فوق 45٪.'],
  tryIt: ['Open the MQTT tab: esp32_soil/moisture changes, wb-mr6c_32/K1 follows. Then stop only the ESP32 and see the rule wait for new data.', 'افتح تبويب MQTT: تتغير esp32_soil/moisture ويتبعها wb-mr6c_32/K1. ثم أوقف ESP32 وحده ولاحظ أن القاعدة تنتظر بيانات جديدة.'],
  modify: ['Rewrite the ESP32 node in Arduino C++ with WiFi.h and PubSubClient.h, or add a DHT22 and a fan rule on the WB.', 'أعد كتابة عقدة ESP32 بلغة Arduino C++ باستخدام WiFi.h وPubSubClient.h، أو أضف DHT22 وقاعدة مروحة على WB.'],
  explain: ['The Wi-Fi link and TCP are virtual, but the MQTT topics, retained values and the Modbus frames are the real ones of a Wiren Board installation.', 'رابط Wi-Fi وTCP افتراضيان، لكن مواضيع MQTT والقيم المحفوظة وإطارات Modbus هي نفسها في تركيبة Wiren Board الحقيقية.'],
  code: INTEGRATION_ESP + '\n# ---- wb/rules.js on the Wiren Board ----\n' + INTEGRATION_RULES.split('\n').map((l) => '# ' + l).join('\n'),
  build: () => {
    const d = integrationCircuit();
    d.name = 'ESP32 + WB7 irrigation loop';
    d.exampleId = 'mcu-esp32-wb7-integration';
    d.files = [{ name: 'main.py', content: '# This project runs on the ESP32 and the Wiren Board: open their folders.\n' }, ...d.files.filter((f) => f.name !== 'main.py')];
    return d;
  },
  test: {
    seconds: 50,
    // the serial monitor of the ESP32 and the wb-rules log, in any interleaving
    expect: /^(?=[\s\S]*Wi-Fi 192\.168\.42\.\d+)(?=[\s\S]*pump ON[\s\S]*pump OFF)/,
    verify: (s) => (s.farm.read('tray.moisture') > 30 ? null : 'the tray should have been watered'),
  },
};

export const MCU_SPECS: McuSpec[] = [...ESP32_SPECS, ...WB_SPECS, INTEGRATION];
