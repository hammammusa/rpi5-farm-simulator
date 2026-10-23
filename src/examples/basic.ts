// Examples 1–11: GPIO basics, sensors, ADC and UART.
import { WIRE_COLORS as W } from '../engine/project';
import { DEFAULT_CODE } from '../engine/project';
import { defaultFarmConfig } from '../engine/farm';
import type { Example } from './types';
import { base, finish, onBoard } from './types';
import { sim } from '../state/engine';

const BB = { x: 420, y: 300 };

// ------------------------------------------------------------------ 1
export const ex01: Example = {
  id: 'ex01-blink',
  n: 1,
  level: 'beginner',
  title: { en: 'Blink an LED', ar: 'وميض LED' },
  objective: {
    en: 'Control a GPIO output from Python with gpiozero and understand the LED circuit: GPIO17 → 330 Ω → LED → GND.',
    ar: 'التحكم بمخرج GPIO من Python باستخدام gpiozero وفهم دائرة الـ LED: GPIO17 ← 330 أوم ← LED ← GND.',
  },
  parts: ['Raspberry Pi 5', 'Breadboard', 'Red LED', '330 Ω resistor', '2 jumper wires'],
  expected: { en: 'The LED is on for 1 s and off for 1 s, forever. The GPIO monitor shows GPIO17 switching HIGH/LOW.', ar: 'يضيء الـ LED ثانية وينطفئ ثانية باستمرار، ويُظهر مراقب GPIO تبدل GPIO17 بين HIGH وLOW.' },
  instructions: {
    en: 'Press Run. Watch the LED and the GPIO monitor. Then change sleep(1) to sleep(0.2) and run again.',
    ar: 'اضغط تشغيل وراقب الـ LED ومراقب GPIO. ثم غيّر sleep(1) إلى sleep(0.2) وشغّل مرة أخرى.',
  },
  breakIt: [
    { en: 'Move the yellow wire from pin 11 (GPIO17) to pin 12 (GPIO18): the LED stays dark and the Problems tab explains why.', ar: 'انقل السلك الأصفر من الطرف 11 (GPIO17) إلى الطرف 12 (GPIO18): لن يضيء الـ LED وسيشرح تبويب المشكلات السبب.' },
    { en: 'Delete the black GND wire: the circuit is open.', ar: 'احذف سلك GND الأسود: تصبح الدائرة مفتوحة.' },
    { en: 'Rotate the LED twice (reverse it): it is reverse-biased.', ar: 'أدر الـ LED مرتين (اعكسه): يصبح منحازاً عكسياً.' },
    { en: 'Replace 330 Ω with 10 Ω: the GPIO current warning appears.', ar: 'استبدل 330 أوم بـ 10 أوم: يظهر تحذير تيار GPIO.' },
  ],
  build() {
    const b = base('Blink');
    b.add('bb', 'breadboard', BB.x, BB.y);
    onBoard(b, BB, 'led1', 'led', [0, 40], 'e10', { color: 'red' });
    onBoard(b, BB, 'r1', 'resistor', [0, 0], 'c11', { ohms: 330 });
    b.wire('pi.P11', 'bb.a15', W.yellow, 'GPIO17');
    b.wire('bb.a10', 'bb.tn10', W.black);
    b.wire('pi.P6', 'bb.tn2', W.black, 'GND');
    return finish(b, 'Ex 1 · Blink an LED', this.id, { 'main.py': DEFAULT_CODE });
  },
  checks: [
    {
      id: 'ex01',
      name: 'LED blinks with 1 s period',
      expected: 'LED toggles about every 1 s',
      async run(h) {
        await h.load(ex01.build());
        await h.run();
        const tr: number[] = [];
        let last: boolean | null = null;
        await h.waitSim(5.2, (t) => {
          const lit = (h.vis('led1').brightness ?? 0) > 0.2;
          if (last !== null && lit !== last) tr.push(t);
          last = lit;
        });
        const gaps = tr.slice(1).map((x, i) => x - tr[i]);
        const ok = tr.length >= 3 && gaps.every((g) => Math.abs(g - 1) < 0.25);
        return { pass: ok, actual: `${tr.length} transitions, gaps ${gaps.map((g) => g.toFixed(2)).join(', ')} s` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 2
const BUTTON_CODE = `from gpiozero import LED, Button
from signal import pause

led = LED(17)
button = Button(27)          # internal pull-up: pressed = LOW

def pressed():
    print("Button pressed -> LED on")
    led.on()

def released():
    print("Button released -> LED off")
    led.off()

button.when_pressed = pressed
button.when_released = released

print("Press the button (click it in the workspace while running)")
pause()                      # wait forever, serving callbacks
`;

export const ex02: Example = {
  id: 'ex02-button',
  n: 2,
  level: 'beginner',
  title: { en: 'Button controls an LED', ar: 'زر يتحكم بـ LED' },
  objective: { en: 'Read a digital input with the internal pull-up and react to events with callbacks.', ar: 'قراءة مدخل رقمي بمقاومة الرفع الداخلية والاستجابة للأحداث بدوال الاستدعاء.' },
  parts: ['Push button (across the centre gap)', 'LED + 330 Ω', 'Wires'],
  expected: { en: 'While you hold the button the LED is lit and the terminal prints a message.', ar: 'أثناء الضغط على الزر يضيء الـ LED وتُطبع رسالة في الطرفية.' },
  instructions: { en: 'Run, then click and hold the red button in the workspace.', ar: 'شغّل البرنامج ثم اضغط مطولاً على الزر الأحمر في مساحة العمل.' },
  breakIt: [
    { en: 'Change Button(27) to Button(27, pull_up=False): the input floats/reads pressed incorrectly.', ar: 'غيّر Button(27) إلى Button(27, pull_up=False): يصبح المدخل عائماً أو يقرأ خطأ.' },
    { en: 'Create LED(17) twice: GPIOPinInUse error.', ar: 'أنشئ LED(17) مرتين: خطأ GPIOPinInUse.' },
  ],
  build() {
    const b = base('Button');
    b.add('bb', 'breadboard', BB.x, BB.y);
    onBoard(b, BB, 'led1', 'led', [0, 40], 'e10', { color: 'green' });
    onBoard(b, BB, 'r1', 'resistor', [0, 0], 'c11', { ohms: 330 });
    onBoard(b, BB, 'btn', 'button', [0, 0], 'e20');
    b.wire('pi.P11', 'bb.a15', W.yellow, 'GPIO17');
    b.wire('bb.a10', 'bb.tn10', W.black);
    b.wire('pi.P13', 'bb.a20', W.blue, 'GPIO27');
    b.wire('bb.a22', 'bb.tn22', W.black);
    b.wire('pi.P6', 'bb.tn2', W.black, 'GND');
    return finish(b, 'Ex 2 · Button and LED', this.id, { 'main.py': BUTTON_CODE });
  },
  checks: [
    {
      id: 'ex02',
      name: 'Button press lights the LED',
      expected: 'LED off → press → LED on → release → off',
      async run(h) {
        await h.load(ex02.build());
        await h.run();
        await h.waitSim(0.5);
        const before = h.vis('led1').brightness ?? 0;
        sim.pressButton('btn', true);
        await h.waitSim(0.4);
        const during = h.vis('led1').brightness ?? 0;
        sim.pressButton('btn', false);
        await h.waitSim(0.4);
        const after = h.vis('led1').brightness ?? 0;
        const ok = before === 0 && during > 0.2 && after === 0 && h.term().includes('Button pressed');
        return { pass: ok, actual: `brightness before ${before.toFixed(2)}, pressed ${during.toFixed(2)}, after ${after.toFixed(2)}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 3
const TRAFFIC = `from gpiozero import LED
from time import sleep

red = LED(17)
yellow = LED(27)
green = LED(22)

def show(r, y, g, seconds, name):
    red.value, yellow.value, green.value = r, y, g
    print(name)
    sleep(seconds)

while True:
    show(1, 0, 0, 3, "RED - stop")
    show(1, 1, 0, 1, "RED+YELLOW - get ready")
    show(0, 0, 1, 3, "GREEN - go")
    show(0, 1, 0, 1, "YELLOW - prepare to stop")
`;

export const ex03: Example = {
  id: 'ex03-traffic',
  n: 3,
  level: 'beginner',
  title: { en: 'Traffic light', ar: 'إشارة مرور' },
  objective: { en: 'Drive several outputs in a timed sequence; practise functions and tuple assignment.', ar: 'تشغيل عدة مخارج بتسلسل زمني والتدرب على الدوال وإسناد الصفوف.' },
  parts: ['3 LEDs (red, yellow, green)', '3 × 330 Ω', 'Breadboard'],
  expected: { en: 'Red 3 s → red+yellow 1 s → green 3 s → yellow 1 s, repeating.', ar: 'أحمر 3 ث ← أحمر+أصفر 1 ث ← أخضر 3 ث ← أصفر 1 ث بالتكرار.' },
  instructions: { en: 'Run and compare the sequence with the printed phase names. Try 5× speed.', ar: 'شغّل وقارن التسلسل بأسماء المراحل المطبوعة. جرّب السرعة 5×.' },
  breakIt: [{ en: 'Swap the yellow and green wires on the Pi header — the colours no longer match the code.', ar: 'بدّل سلكي الأصفر والأخضر على Pi — لن تطابق الألوان الكود.' }],
  build() {
    const b = base('Traffic');
    b.add('bb', 'breadboard', BB.x, BB.y);
    const leds: [string, string, string, string][] = [
      ['red', 'e10', 'c11', 'a15'],
      ['yellow', 'e16', 'c17', 'a21'],
      ['green', 'e22', 'c23', 'a27'],
    ];
    leds.forEach(([color, k, r], i) => {
      onBoard(b, BB, `led_${color}`, 'led', [0, 40], k, { color });
      onBoard(b, BB, `r_${color}`, 'resistor', [0, 0], r, { ohms: 330 });
      b.wire(`bb.a${k.slice(1)}`, `bb.tn${k.slice(1)}`, W.black);
      void i;
    });
    b.wire('pi.P11', 'bb.a15', W.red, 'GPIO17');
    b.wire('pi.P13', 'bb.a21', W.yellow, 'GPIO27');
    b.wire('pi.P15', 'bb.a27', W.green, 'GPIO22');
    b.wire('pi.P6', 'bb.tn2', W.black, 'GND');
    return finish(b, 'Ex 3 · Traffic light', this.id, { 'main.py': TRAFFIC });
  },
  checks: [
    {
      id: 'ex03',
      name: 'Traffic light sequence',
      expected: 'red, red+yellow, green, yellow phases in order',
      async run(h) {
        await h.load(ex03.build());
        await h.run();
        const seen: string[] = [];
        await h.waitSim(8.5, () => {
          const s = ['red', 'yellow', 'green'].map((c) => ((h.vis(`led_${c}`).brightness ?? 0) > 0.2 ? c[0].toUpperCase() : '-')).join('');
          if (seen[seen.length - 1] !== s) seen.push(s);
        });
        const want = ['R--', 'RY-', '--G', '-Y-'];
        const ok = want.every((w) => seen.includes(w)) && seen.indexOf('R--') < seen.indexOf('--G');
        return { pass: ok, actual: seen.join(' → ') };
      },
    },
  ],
};

// ------------------------------------------------------------------ 4
const DHT_CODE = `import time
import board
import adafruit_dht

# On a real Pi 5: pip install adafruit-circuitpython-dht
dht = adafruit_dht.DHT22(board.D4)

while True:
    try:
        t = dht.temperature
        h = dht.humidity
        print(f"Temperature: {t:.1f} °C   Humidity: {h:.1f} %")
    except RuntimeError as err:
        # DHT sensors fail now and then - just try again
        print("Read error:", err)
    time.sleep(2.0)
`;

export const ex04: Example = {
  id: 'ex04-dht22',
  n: 4,
  level: 'beginner',
  title: { en: 'Read the DHT22', ar: 'قراءة حساس DHT22' },
  objective: { en: 'Read air temperature and humidity and handle the occasional read error.', ar: 'قراءة حرارة الهواء والرطوبة ومعالجة أخطاء القراءة العرضية.' },
  parts: ['DHT22 module (+, out, −)', 'Wires: 3.3 V, GPIO4, GND'],
  expected: { en: 'A new reading every 2 s. Move the temperature slider in the Inspector while running — the printed value follows.', ar: 'قراءة جديدة كل ثانيتين. حرّك منزلق الحرارة في لوحة الخصائص أثناء التشغيل وستتغير القيمة المطبوعة.' },
  instructions: { en: 'Run, select the DHT22 and change Temperature/Humidity live. Try the "Read timeout" fault.', ar: 'شغّل، اختر DHT22 وغيّر الحرارة/الرطوبة مباشرة. جرّب عطل "Read timeout".' },
  breakIt: [
    { en: 'Power the module from 5 V (pin 2): its pull-up drives 5 V into GPIO4 → over-voltage error.', ar: 'غذِّ الوحدة من 5V (الطرف 2): مقاومة الرفع تدفع 5V إلى GPIO4 ← خطأ جهد زائد.' },
    { en: 'Set fault "Sensor disconnected": RuntimeError "DHT sensor not found".', ar: 'اختر عطل "Sensor disconnected": يظهر RuntimeError "DHT sensor not found".' },
  ],
  build() {
    const b = base('DHT22');
    b.add('dht', 'dht22', 520, 360, { temperature: 25, humidity: 60 }, 0, 'DHT22');
    b.wire('pi.P1', 'dht.VCC', W.red, '3V3').wire('pi.P7', 'dht.DATA', W.yellow, 'GPIO4').wire('pi.P9', 'dht.GND', W.black, 'GND');
    return finish(b, 'Ex 4 · DHT22', this.id, { 'main.py': DHT_CODE });
  },
  checks: [
    {
      id: 'ex04',
      name: 'DHT22 reading follows the slider',
      expected: 'prints 25.0 °C, then 31.5 °C after the change',
      async run(h) {
        await h.load(ex04.build());
        await h.run();
        await h.waitSim(2.5);
        h.setProp('dht', 'temperature', 31.5);
        await h.waitSim(4.5);
        const t = h.term();
        return { pass: t.includes('25.0 °C') && t.includes('31.5 °C'), actual: t.split('\n').filter((l) => l.includes('Temperature')).slice(-3).join(' | ') };
      },
    },
  ],
};

// ------------------------------------------------------------------ 5
const FAN_CODE = `import time
import board
import adafruit_dht
from gpiozero import OutputDevice

ON_ABOVE = 30.0    # °C: switch the fan on above this
OFF_BELOW = 28.0   # °C: hysteresis, avoids rapid on/off

dht = adafruit_dht.DHT22(board.D4)
fan = OutputDevice(17, active_high=False, initial_value=False)   # active-LOW relay board

while True:
    try:
        t = dht.temperature
    except RuntimeError as e:
        print("sensor error:", e)
        time.sleep(2)
        continue
    if t > ON_ABOVE and not fan.value:
        fan.on()
        print(f"{t:.1f} °C > {ON_ABOVE} -> FAN ON")
    elif t < OFF_BELOW and fan.value:
        fan.off()
        print(f"{t:.1f} °C < {OFF_BELOW} -> FAN OFF")
    else:
        print(f"{t:.1f} °C, fan {'ON' if fan.value else 'OFF'}")
    time.sleep(2)
`;

function fanCircuit() {
  const b = base('Fan');
  b.add('dht', 'dht22', 470, 380, { temperature: 25, humidity: 55 }, 0, 'DHT22');
  b.add('rl', 'relay_module', 600, 80, { channels: 1, trigger: 'low', coil: 5 }, 0, 'Relay');
  b.add('ps', 'power_supply', 600, 440, { volts: 12 }, 0, '12 V supply');
  b.add('fan', 'fan', 840, 230, { vrated: 12, role: 'fan' }, 0, 'Fan');
  b.wire('pi.P1', 'dht.VCC', W.red).wire('pi.P7', 'dht.DATA', W.yellow, 'GPIO4').wire('pi.P9', 'dht.GND', W.black);
  b.wire('pi.P2', 'rl.VCC', W.red, '5V').wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
  b.wire('ps.P', 'rl.COM1', W.red, '+12V').wire('rl.NO1', 'fan.P', W.red).wire('fan.N', 'ps.N', W.black);
  return b;
}

export const ex05: Example = {
  id: 'ex05-fan',
  n: 5,
  level: 'intermediate',
  title: { en: 'Automatic fan', ar: 'مروحة تلقائية' },
  objective: { en: 'Close the control loop: sensor → decision with hysteresis → relay → 12 V fan.', ar: 'إغلاق حلقة التحكم: حساس ← قرار مع تخلف (Hysteresis) ← مرحل ← مروحة 12V.' },
  parts: ['DHT22', 'Relay module (active-LOW, 5 V)', '12 V supply', '12 V fan'],
  expected: { en: 'Raise the DHT22 temperature above 30 °C: the relay clicks and the fan spins; below 28 °C it stops.', ar: 'ارفع حرارة DHT22 فوق 30°م: يعمل المرحل وتدور المروحة، وتحت 28°م تتوقف.' },
  instructions: { en: 'Run, select the DHT22 and drag Temperature to 35 °C, then back to 25 °C.', ar: 'شغّل، اختر DHT22 واسحب الحرارة إلى 35°م ثم أعدها إلى 25°م.' },
  breakIt: [
    { en: 'Use OutputDevice(17) (active-high) with this active-LOW board: the logic is inverted.', ar: 'استخدم OutputDevice(17) (نشط بالعالي) مع وحدة نشطة بالمنخفض: ينعكس المنطق.' },
    { en: 'Power the relay board from 3.3 V: the coil cannot pull in.', ar: 'غذِّ المرحل من 3.3V: لا يستطيع الملف الجذب.' },
    { en: 'Wire the fan to NC instead of NO.', ar: 'صل المروحة على NC بدل NO.' },
  ],
  build() {
    return finish(fanCircuit(), 'Ex 5 · Automatic fan', this.id, { 'main.py': FAN_CODE });
  },
  checks: [
    {
      id: 'ex05',
      name: 'Fan follows temperature',
      expected: 'fan off at 25 °C, on at 35 °C',
      async run(h) {
        await h.load(ex05.build());
        await h.run();
        await h.waitSim(2.5);
        const off = h.vis('fan').run ?? 0;
        h.setProp('dht', 'temperature', 35);
        await h.waitSim(4.5);
        const on = h.vis('fan').run ?? 0;
        return { pass: off === 0 && on > 0.9, actual: `fan run at 25 °C: ${off}, at 35 °C: ${on.toFixed(2)}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 6
export const WATER_CODE = `from gpiozero import Button, OutputDevice
from time import sleep

# Float switch between GPIO23 and GND, mounted at 20 % of the tank height.
# Contact is CLOSED (reads as "pressed") while the water is ABOVE the switch.
water_ok = Button(23, pull_up=True, bounce_time=0.05)
pump = OutputDevice(17, active_high=False, initial_value=False)   # active-LOW relay

print("Water-level protection running")
while True:
    if water_ok.is_pressed:
        if not pump.value:
            print("Water level OK -> pump ON")
        pump.on()
    else:
        if pump.value:
            print("WARNING: water level LOW -> pump OFF (dry-run protection)")
        pump.off()
    sleep(0.5)
`;

export function waterCircuit() {
  const b = base('Water');
  b.add('fs', 'float_switch', 480, 400, { source: 'farm', trigger: 20, mode: 'closed_high' }, 0, 'Float switch');
  b.add('rl', 'relay_module', 600, 80, { channels: 1, trigger: 'low' }, 0, 'Relay');
  b.add('ps', 'power_supply', 600, 440, { volts: 12 }, 0, '12 V supply');
  b.add('pump', 'water_pump', 840, 230, { role: 'circulation', rate: 4 }, 0, 'Circulation pump');
  b.wire('pi.P16', 'fs.1', W.blue, 'GPIO23').wire('fs.2', 'pi.P20', W.black);
  b.wire('pi.P2', 'rl.VCC', W.red, '5V').wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
  b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
  return b;
}

export const ex06: Example = {
  id: 'ex06-water',
  n: 6,
  level: 'intermediate',
  title: { en: 'Water level protection', ar: 'حماية مستوى الماء' },
  objective: { en: 'Protect a pump from running dry using a float switch — a mandatory safety function in hydroponics.', ar: 'حماية المضخة من العمل على الجاف باستخدام عوامة — وظيفة أمان أساسية في الزراعة المائية.' },
  parts: ['Float switch (linked to the farm reservoir)', 'Relay', '12 V circulation pump', 'Farm model'],
  expected: { en: 'With water above 20 % the pump runs; drag the reservoir level below 20 % in the Smart Farm tab and the pump stops with a warning.', ar: 'عند وجود ماء فوق 20٪ تعمل المضخة؛ اسحب مستوى الخزان تحت 20٪ في تبويب المزرعة فتتوقف المضخة مع تحذير.' },
  instructions: { en: 'Run, open Smart Farm, lower "Reservoir level". Then delete the protection code and see the physical dry-run alarm.', ar: 'شغّل، افتح تبويب المزرعة واخفض "مستوى الخزان". ثم احذف كود الحماية لترى إنذار التشغيل على الجاف.' },
  breakIt: [{ en: 'Replace the loop with pump.on() only: the farm model raises "Pump running dry" because nothing protects it.', ar: 'استبدل الحلقة بـ pump.on() فقط: يظهر إنذار "المضخة تعمل على الجاف" لعدم وجود حماية.' }],
  build() {
    return finish(waterCircuit(), 'Ex 6 · Water level protection', this.id, { 'main.py': WATER_CODE }, { farm: { ...defaultFarmConfig(), enabled: true } });
  },
  checks: [
    {
      id: 'ex06',
      name: 'Pump stops on low water',
      expected: 'pump runs at 75 %, stops and warns at 10 %',
      async run(h) {
        await h.load(ex06.build());
        await h.run();
        await h.waitSim(1.5);
        const before = h.vis('pump').run ?? 0;
        sim.farm.state.reservoir.volumeL = 0.1 * sim.doc.farm.reservoir.capacityL;
        sim.evaluate();
        await h.waitSim(1.5);
        const after = h.vis('pump').run ?? 0;
        const ok = before > 0.9 && after === 0 && h.term().includes('WARNING');
        return { pass: ok, actual: `pump run before ${before.toFixed(2)}, after ${after}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 7
const RELAY_CODE = `from gpiozero import OutputDevice
from time import sleep

# Most relay boards are active-LOW: IN=0 energises the coil.
pump = OutputDevice(17, active_high=False, initial_value=False)

for cycle in range(1, 4):
    print(f"cycle {cycle}: pump ON")
    pump.on()
    sleep(3)
    print(f"cycle {cycle}: pump OFF")
    pump.off()
    sleep(3)
print("done")
`;

export const ex07: Example = {
  id: 'ex07-relay',
  n: 7,
  level: 'beginner',
  title: { en: 'Relay and DC pump', ar: 'مرحل ومضخة تيار مستمر' },
  objective: { en: 'Switch a 12 V load safely: the Pi only drives the relay input; the pump has its own supply.', ar: 'تشغيل حمل 12V بأمان: يتحكم Pi بمدخل المرحل فقط والمضخة لها مصدرها.' },
  parts: ['Relay module', '12 V supply', 'Water pump'],
  expected: { en: 'Pump runs 3 s, stops 3 s, three times. The relay LED and contact state follow.', ar: 'تعمل المضخة 3 ث وتتوقف 3 ث ثلاث مرات، ويتبعها ضوء المرحل وحالة التلامس.' },
  instructions: { en: 'Run and watch COM–NO close. Try the "Contacts stuck open" fault on the relay.', ar: 'شغّل وراقب إغلاق COM–NO. جرّب عطل "Contacts stuck open" على المرحل.' },
  breakIt: [{ en: 'Wire the pump directly to GPIO17: error — a GPIO cannot drive a pump.', ar: 'صل المضخة مباشرة بـ GPIO17: خطأ — لا يستطيع GPIO تشغيل مضخة.' }],
  build() {
    const b = base('Relay');
    b.add('rl', 'relay_module', 600, 80, { channels: 1, trigger: 'low' }, 0, 'Relay');
    b.add('ps', 'power_supply', 600, 440, { volts: 12 }, 0, '12 V supply');
    b.add('pump', 'water_pump', 840, 230, { role: 'none' }, 0, 'Pump');
    b.wire('pi.P2', 'rl.VCC', W.red, '5V').wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
    b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
    return finish(b, 'Ex 7 · Relay and pump', this.id, { 'main.py': RELAY_CODE });
  },
  checks: [
    {
      id: 'ex07',
      name: 'Relay switches the pump',
      expected: 'pump on during ON phase, off during OFF phase; contacts follow',
      async run(h) {
        await h.load(ex07.build());
        await h.run();
        await h.waitSim(1.5);
        const on = h.vis('pump').run ?? 0;
        const contactOn = h.vis('rl').ch?.[0]?.energised;
        await h.waitSim(3);
        const off = h.vis('pump').run ?? 0;
        const contactOff = h.vis('rl').ch?.[0]?.energised;
        return { pass: on > 0.9 && off === 0 && contactOn === true && contactOff === false, actual: `ON phase run=${on.toFixed(2)} energised=${contactOn}; OFF phase run=${off} energised=${contactOff}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 8/9 ADC circuits
function adcBase(name: string) {
  const b = base(name);
  b.add('adc', 'mcp3008', 520, 330, {}, 0, 'MCP3008');
  b.wire('pi.P1', 'adc.VDD', W.red, '3V3').wire('pi.P17', 'adc.VREF', W.red);
  b.wire('pi.P25', 'adc.AGND', W.black).wire('pi.P25', 'adc.DGND', W.black);
  b.wire('pi.P23', 'adc.CLK', W.purple, 'SCLK').wire('pi.P21', 'adc.DOUT', W.green, 'MISO').wire('pi.P19', 'adc.DIN', W.blue, 'MOSI').wire('pi.P24', 'adc.CS', W.orange, 'CE0');
  return b;
}

const PH_CODE = `from gpiozero import MCP3008
from time import sleep

ph_channel = MCP3008(channel=0)        # SPI0, CE0 (GPIO8)

def read_ph(samples=10):
    total = 0.0
    for _ in range(samples):
        total += ph_channel.voltage    # 0..3.3 V
        sleep(0.01)
    volts = total / samples
    return 3.5 * volts, volts          # calibration of this pH board: pH = 3.5 × V

while True:
    ph, v = read_ph()
    print(f"pH = {ph:.2f}   (sensor {v:.3f} V)")
    sleep(1)
`;

export const ex08: Example = {
  id: 'ex08-ph',
  n: 8,
  level: 'intermediate',
  title: { en: 'Read pH through an MCP3008', ar: 'قراءة pH عبر MCP3008' },
  objective: { en: 'Understand why the Pi 5 needs an external ADC, wire SPI correctly and convert volts to pH.', ar: 'فهم حاجة Pi 5 إلى محول ADC خارجي، وتوصيل SPI بشكل صحيح وتحويل الجهد إلى pH.' },
  parts: ['MCP3008 (SPI0, CE0)', 'Analog pH board', 'Wires'],
  expected: { en: 'Prints pH ≈ 6.20 every second; changing the pH slider changes the reading.', ar: 'يطبع pH ≈ 6.20 كل ثانية وتغيير منزلق pH يغيّر القراءة.' },
  instructions: { en: 'Run, select the pH sensor, change pH. Then try the "Noisy signal" fault and see why averaging helps.', ar: 'شغّل، اختر حساس pH وغيّر القيمة. ثم جرّب عطل "Noisy signal" ولاحظ فائدة المتوسط.' },
  breakIt: [
    { en: 'Wire the pH AO straight to GPIO22: error — no ADC on the Pi 5.', ar: 'صل AO للحساس مباشرة بـ GPIO22: خطأ — لا يوجد ADC في Pi 5.' },
    { en: 'Swap DIN and DOUT on the MCP3008.', ar: 'بدّل DIN وDOUT في MCP3008.' },
    { en: 'Power VDD from 5 V: DOUT would push 5 V into GPIO9.', ar: 'غذِّ VDD من 5V: سيدفع DOUT جهد 5V إلى GPIO9.' },
  ],
  build() {
    const b = adcBase('pH');
    b.add('ph', 'ph_sensor', 760, 420, { ph: 6.2 }, 0, 'pH sensor');
    b.wire('pi.P4', 'ph.VCC', W.red, '5V').wire('pi.P30', 'ph.GND', W.black).wire('ph.AO', 'adc.CH0', W.yellow, 'pH → CH0');
    return finish(b, 'Ex 8 · pH via MCP3008', this.id, { 'main.py': PH_CODE });
  },
  checks: [
    {
      id: 'ex08',
      name: 'pH reading through the ADC',
      expected: 'pH ≈ 6.2 (±0.1)',
      async run(h) {
        await h.load(ex08.build());
        await h.run();
        await h.waitSim(1.6);
        const m = /pH = ([\d.]+)/.exec(h.term());
        const v = m ? Number(m[1]) : NaN;
        return { pass: Math.abs(v - 6.2) < 0.1, actual: `pH = ${v}` };
      },
    },
  ],
};

const EC_CODE = `import spidev
from time import sleep

spi = spidev.SpiDev()
spi.open(0, 0)                    # bus 0, CE0
spi.max_speed_hz = 1_350_000

def read_adc(channel):
    # MCP3008 frame: start bit, single-ended + channel, then clock out 10 bits
    r = spi.xfer2([1, (8 + channel) << 4, 0])
    return ((r[1] & 3) << 8) | r[2]

WATER_TEMP = 25.0                 # °C (use a DS18B20 for real compensation)

while True:
    raw = read_adc(1)
    volts = raw * 3.3 / 1023
    ec = volts / 0.5 / (1 + 0.02 * (WATER_TEMP - 25))   # board calibration: 0.5 V per mS/cm
    print(f"raw={raw:4d}  V={volts:.3f}  EC={ec:.2f} mS/cm")
    sleep(1)
`;

export const ex09: Example = {
  id: 'ex09-ec',
  n: 9,
  level: 'intermediate',
  title: { en: 'Read EC through an MCP3008 (raw SPI)', ar: 'قراءة EC عبر MCP3008 (SPI مباشر)' },
  objective: { en: 'Talk SPI byte-by-byte with spidev and apply temperature compensation.', ar: 'التخاطب عبر SPI بايتاً بايتاً باستخدام spidev وتطبيق تعويض الحرارة.' },
  parts: ['MCP3008', 'Analog EC board on CH1'],
  expected: { en: 'Prints EC ≈ 1.20 mS/cm and the raw 10-bit value.', ar: 'يطبع EC ≈ 1.20 mS/cm والقيمة الخام 10 بت.' },
  instructions: { en: 'Run. Change EC on the sensor. Read the MCP3008 datasheet bit layout in the code comments.', ar: 'شغّل وغيّر قيمة EC. اقرأ ترتيب البتات في تعليقات الكود.' },
  breakIt: [{ en: 'Read channel 0 instead of 1 — nothing is connected there (floating input gives random values).', ar: 'اقرأ القناة 0 بدل 1 — لا شيء موصول (مدخل عائم يعطي قيماً عشوائية).' }],
  build() {
    const b = adcBase('EC');
    b.add('ec', 'ec_sensor', 760, 420, { ec: 1.2, waterTemp: 25 }, 0, 'EC sensor');
    b.wire('pi.P4', 'ec.VCC', W.red, '5V').wire('pi.P30', 'ec.GND', W.black).wire('ec.AO', 'adc.CH1', W.yellow, 'EC → CH1');
    return finish(b, 'Ex 9 · EC via MCP3008', this.id, { 'main.py': EC_CODE });
  },
  checks: [
    {
      id: 'ex09',
      name: 'EC reading',
      expected: 'EC ≈ 1.20 (±0.05)',
      async run(h) {
        await h.load(ex09.build());
        await h.run();
        await h.waitSim(1.5);
        const m = /EC=([\d.]+)/.exec(h.term());
        const v = m ? Number(m[1]) : NaN;
        return { pass: Math.abs(v - 1.2) < 0.05, actual: `EC = ${v}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 10
const CO2_CODE = `import serial
import time

READ_CMD = bytes([0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79])

def checksum(frame):
    return (0xFF - (sum(frame[1:8]) & 0xFF) + 1) & 0xFF

ser = serial.Serial("/dev/serial0", 9600, timeout=1)

while True:
    ser.reset_input_buffer()
    ser.write(READ_CMD)
    resp = ser.read(9)
    if len(resp) == 9 and resp[0] == 0xFF and resp[1] == 0x86 and checksum(resp) == resp[8]:
        ppm = resp[2] * 256 + resp[3]
        print(f"CO2: {ppm} ppm")
    else:
        print("No/invalid response:", resp.hex(" "))
    time.sleep(2)
`;

export const ex10: Example = {
  id: 'ex10-co2',
  n: 10,
  level: 'intermediate',
  title: { en: 'Read CO₂ with the MH-Z19B', ar: 'قراءة CO₂ بحساس MH-Z19B' },
  objective: { en: 'Send a binary UART command, read a 9-byte answer and validate its checksum.', ar: 'إرسال أمر UART ثنائي وقراءة رد من 9 بايت والتحقق من مجموع التحقق.' },
  parts: ['MH-Z19B (5 V power, 3.3 V UART)', 'UART0: GPIO14 TX, GPIO15 RX'],
  expected: { en: 'Prints CO2: 650 ppm every 2 s; watch the bytes in the UART monitor.', ar: 'يطبع CO2: 650 ppm كل ثانيتين؛ راقب البايتات في مراقب UART.' },
  instructions: { en: 'Run, open the UART monitor tab. Try the "UART communication loss" fault.', ar: 'شغّل وافتح مراقب UART. جرّب عطل "UART communication loss".' },
  breakIt: [
    { en: 'Connect sensor TX to Pi TX (pin 8): TX↔TX error, no data.', ar: 'صل TX الحساس بـ TX في Pi (الطرف 8): خطأ TX↔TX ولا بيانات.' },
    { en: 'Open the port at 115200 baud: bytes are garbled.', ar: 'افتح المنفذ بسرعة 115200: تصبح البايتات مشوهة.' },
  ],
  build() {
    const b = base('CO2');
    b.add('co2', 'mhz19b', 560, 360, { co2: 650 }, 0, 'MH-Z19B');
    b.wire('pi.P4', 'co2.VCC', W.red, '5V').wire('pi.P6', 'co2.GND', W.black).wire('pi.P8', 'co2.RX', W.green, 'TX→RX').wire('pi.P10', 'co2.TX', W.blue, 'RX←TX');
    return finish(b, 'Ex 10 · CO2 MH-Z19B', this.id, { 'main.py': CO2_CODE });
  },
  checks: [
    {
      id: 'ex10',
      name: 'MH-Z19B CO₂ over UART',
      expected: 'CO2: 650 ppm',
      async run(h) {
        await h.load(ex10.build());
        await h.run();
        await h.waitSim(1.5);
        return { pass: h.term().includes('CO2: 650 ppm'), actual: h.term().split('\n').filter((l) => l.includes('CO2') || l.includes('response')).slice(-1)[0] ?? '' };
      },
    },
  ],
};

// ------------------------------------------------------------------ 11
const UART_CODE = `import serial

# A PC is connected through a 3.3 V USB-UART adapter.
ser = serial.Serial("/dev/serial0", 9600, timeout=0.5)
ser.write(b"Pi 5 ready. Type something:\\r\\n")

while True:
    line = ser.readline()                  # waits up to 0.5 s for a line
    if not line:
        continue
    text = line.decode(errors="replace").strip()
    print("received:", text)
    ser.write(("ECHO: " + text.upper() + "\\r\\n").encode())
`;

export const ex11: Example = {
  id: 'ex11-uart',
  n: 11,
  level: 'intermediate',
  title: { en: 'UART communication', ar: 'الاتصال التسلسلي UART' },
  objective: { en: 'Exchange text lines over UART: bytes vs str, encode/decode, timeouts and line endings.', ar: 'تبادل أسطر نصية عبر UART: الفرق بين bytes وstr، والترميز، والمهل الزمنية ونهايات الأسطر.' },
  parts: ['USB-serial adapter connected to a PC terminal'],
  expected: { en: 'Type "hello" in the UART monitor terminal: the Pi answers "ECHO: HELLO".', ar: 'اكتب "hello" في طرفية مراقب UART: يرد Pi بـ "ECHO: HELLO".' },
  instructions: { en: 'Run, open UART monitor, type in the PC terminal box and press Enter.', ar: 'شغّل وافتح مراقب UART واكتب في مربع طرفية الحاسوب ثم Enter.' },
  breakIt: [{ en: 'Write ser.write("text") without .encode(): TypeError — serial needs bytes.', ar: 'اكتب ser.write("text") بدون .encode(): خطأ TypeError — المنفذ يحتاج bytes.' }],
  build() {
    const b = base('UART');
    b.add('pc', 'usb_serial', 560, 360, { baud: 9600 }, 0, 'USB-UART → PC');
    b.wire('pi.P6', 'pc.GND', W.black).wire('pi.P8', 'pc.RX', W.green, 'TX→RXD').wire('pi.P10', 'pc.TX', W.blue, 'RX←TXD');
    return finish(b, 'Ex 11 · UART echo', this.id, { 'main.py': UART_CODE });
  },
  checks: [
    {
      id: 'ex11',
      name: 'UART echo',
      expected: 'PC receives "ECHO: HELLO"',
      async run(h) {
        await h.load(ex11.build());
        await h.run();
        await h.waitSim(0.5);
        sim.serialType('pc', 'hello\n');
        await h.waitSim(1);
        const got = (sim.device('pc') as any)?.view().text ?? '';
        return { pass: got.includes('ECHO: HELLO'), actual: JSON.stringify(got.slice(-60)) };
      },
    },
  ],
};
