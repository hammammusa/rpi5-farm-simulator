// Python challenges: games and programs that practise classes, state machines,
// generators, dataclasses, dictionaries and exception handling on real hardware.
import { check, ex, lit, running, vis, type LibExample, type TestEvent } from './dsl';

/** button presses spelling Morse code: dot = 0.15 s, dash = 0.5 s, 0.2 s between symbols, 1.2 s between letters */
function morseEvents(code: string, start: number, comp: string): TestEvent[] {
  const out: TestEvent[] = [];
  let t = start;
  for (const letter of code.split(' ')) {
    for (const s of letter) {
      out.push({ at: t, comp, press: true });
      t += s === '.' ? 0.15 : 0.5;
      out.push({ at: t, comp, press: false });
      t += 0.2;
    }
    t += 1.0;
  }
  return out;
}

/** press and release `comp` at `at` */
const tap = (comp: string, at: number, hold = 0.2): TestEvent[] => [
  { at, comp, press: true },
  { at: at + hold, comp, press: false },
];

export const CHALLENGE_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'ch-simon-says',
      cat: 'challenges',
      level: 'intermediate',
      minutes: 30,
      title: ['Simon says memory game', 'لعبة "سايمون يقول" للذاكرة'],
      goal: ['Show a colour sequence on three LEDs and check that the player repeats it on three buttons.', 'عرض تسلسل ألوان على ثلاثة LEDs والتحقق من أن اللاعب يكرره على ثلاثة أزرار.'],
      result: ['The sequence red, blue, green flashes; repeating it prints "correct! score 3".', 'يومض التسلسل أحمر ثم أزرق ثم أخضر، وعند تكراره يُطبع "correct! score 3".'],
      tryIt: ['After "your turn", press the buttons in the order the LEDs flashed.', 'بعد ظهور "your turn" اضغط الأزرار بترتيب وميض الـ LEDs.'],
      modify: ['Add one random colour per round with random.choice and keep playing until a mistake.', 'أضف لوناً عشوائياً في كل جولة باستخدام random.choice واستمر حتى يحدث خطأ.'],
      explain: ['Lists pair each LED with its button (same index). The program polls the buttons, then waits for the release so one press counts once.', 'تربط القوائم كل LED بزره (نفس الفهرس). يفحص البرنامج الأزرار، ثم ينتظر التحرير حتى تُحسب الضغطة مرة واحدة.'],
      code: `from gpiozero import LED, Button
from time import sleep

leds = [LED(17), LED(27), LED(22)]
buttons = [Button(5), Button(6), Button(13)]
names = ["red", "green", "blue"]
sequence = [0, 2, 1]

for i in sequence:
    leds[i].on(); sleep(0.3); leds[i].off(); sleep(0.1)
print("sequence:", ", ".join(names[i] for i in sequence))
print("your turn")

def read_press():
    while True:
        for i, b in enumerate(buttons):
            if b.is_pressed:
                leds[i].on()
                b.wait_for_release()
                leds[i].off()
                return i
        sleep(0.01)

score = 0
for expected in sequence:
    got = read_press()
    if got != expected:
        print(f"wrong: {names[got]} instead of {names[expected]}")
        break
    score += 1
else:
    print(f"correct! score {score}")
`,
      test: { expect: /sequence: red, blue, green[\s\S]*your turn[\s\S]*correct! score 3/, seconds: 5, events: [...tap('b0', 2), ...tap('b2', 2.6), ...tap('b1', 3.2)] },
    },
    (c) =>
      c
        .led('red', 17, 'red', 'Red')
        .led('green', 27, 'green', 'Green')
        .led('blue', 22, 'blue', 'Blue')
        .button('b0', 5, 'Red button')
        .button('b1', 6, 'Green button')
        .button('b2', 13, 'Blue button'),
  ),
  ex(
    {
      id: 'ch-morse-decoder',
      cat: 'challenges',
      level: 'advanced',
      minutes: 30,
      title: ['Morse code decoder', 'مفكك شفرة مورس'],
      goal: ['Measure how long a button is held, classify dots and dashes and decode letters with a dictionary.', 'قياس مدة الضغط على الزر وتصنيف النقاط والشرطات وفك الحروف بقاموس.'],
      result: ['Tapping ... --- ... prints S, O, S and "decoded: SOS".', 'النقر ... --- ... يطبع S ثم O ثم S ثم "decoded: SOS".'],
      tryIt: ['Short presses are dots, long presses (> 0.3 s) are dashes; pause to finish a letter.', 'الضغطات القصيرة نقاط، والطويلة (أكثر من 0.3 ثانية) شرطات، وتوقف قليلاً لإنهاء الحرف.'],
      modify: ['Add the digits 0–9 to the dictionary and finish a word after a 2 s pause.', 'أضف الأرقام 0–9 إلى القاموس وأنهِ الكلمة بعد توقف ثانيتين.'],
      explain: ['wait_for_press(timeout=…) returns False when nobody presses in time, which marks the end of a letter. time.monotonic() measures the hold time.', 'تعيد wait_for_press(timeout=…) القيمة False إذا لم يضغط أحد في الوقت المحدد، وهذا يعني نهاية الحرف. وتقيس time.monotonic() مدة الضغط.'],
      code: `import time
from gpiozero import Button, Buzzer

MORSE = {".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F", "--.": "G",
         "....": "H", "..": "I", ".---": "J", "-.-": "K", ".-..": "L", "--": "M", "-.": "N",
         "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T", "..-": "U",
         "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y", "--..": "Z"}
key = Button(17)
beep = Buzzer(18)
symbols, text = "", ""
print("tap a message")
while len(text) < 3:
    if key.wait_for_press(timeout=0.8):
        start = time.monotonic()
        beep.on()
        key.wait_for_release()
        beep.off()
        symbols += "." if time.monotonic() - start < 0.3 else "-"
    elif symbols:
        letter = MORSE.get(symbols, "?")
        print(f"{symbols:5} -> {letter}")
        text += letter
        symbols = ""
print("decoded:", text)
`,
      test: { expect: /\.\.\.\s+-> S[\s\S]*---\s+-> O[\s\S]*decoded: SOS/, seconds: 9, events: morseEvents('... --- ...', 0.8, 'key') },
    },
    (c) => c.button('key', 17, 'Morse key').buzzer('beep', 18),
  ),
  ex(
    {
      id: 'ch-class-thermostat',
      cat: 'challenges',
      level: 'advanced',
      minutes: 35,
      title: ['Thermostat class with fault handling', 'صنف منظم حرارة مع معالجة الأعطال'],
      goal: ['Wrap sensor, heater and status LED in a class with hysteresis, a failure counter and a safe state when the sensor fails.', 'تغليف الحساس والسخان ومؤشر الحالة في صنف مع فرق تشغيل وعدّاد أعطال وحالة آمنة عند تعطل الحساس.'],
      result: ['The heater follows the temperature; when the DHT22 is unplugged the heater turns off and the fault LED lights; it recovers when the sensor returns.', 'يتبع السخان درجة الحرارة، وعند فصل DHT22 ينطفئ السخان ويضيء مؤشر العطل، ثم يتعافى عند عودة الحساس.'],
      tryIt: ['Set the DHT22 fault to "Sensor disconnected", then back to "No fault".', 'اضبط عطل DHT22 على "Sensor disconnected" ثم أعده إلى "No fault".'],
      modify: ['Count faults and stop the program after 3 in a row.', 'احسب الأعطال وأوقف البرنامج بعد 3 أعطال متتالية.'],
      explain: ['A single failed DHT read is normal, so step() keeps its last decision; two failures in a row mean the sensor is gone and it chooses the safe state (heater off). Retrying at once would not help: within 2 s adafruit_dht returns its cached value. The class keeps its own state, so several thermostats could run side by side.', 'فشل قراءة واحدة من DHT أمر طبيعي، لذا تحتفظ step() بقرارها الأخير، أما فشل قراءتين متتاليتين فيعني غياب الحساس فتختار الحالة الآمنة (السخان مطفأ). إعادة المحاولة فوراً لا تفيد لأن adafruit_dht تعيد القيمة المخزنة خلال ثانيتين. يحتفظ الصنف بحالته، لذلك يمكن تشغيل عدة منظمات جنباً إلى جنب.'],
      code: `import time, board, adafruit_dht
from gpiozero import LED
from smartfarm import Heater

class Thermostat:
    def __init__(self, sensor, heater, fault_led, target=22.0, band=1.0):
        self.sensor, self.heater, self.fault_led = sensor, heater, fault_led
        self.target, self.band = target, band
        self.state = "idle"
        self.failures = 0

    def read(self):
        try:
            t = self.sensor.temperature
            self.failures = 0
            return t
        except RuntimeError:
            self.failures += 1
            return None

    def step(self):
        t = self.read()
        if t is None and self.failures < 2:
            return  # one failed read is normal for a DHT: keep the last decision
        if t is None:
            new = "FAULT"
        elif t < self.target - self.band:
            new = "heating"
        elif t > self.target + self.band:
            new = "idle"
        else:
            new = self.state if self.state != "FAULT" else "idle"
        self.heater.value = new == "heating"
        self.fault_led.value = new == "FAULT"
        if new != self.state:
            print(f"{'---' if t is None else f'{t:.1f} °C'} -> {new}")
            self.state = new

stat = Thermostat(adafruit_dht.DHT22(board.D4), Heater(17, active_high=False), LED(27))
for i in range(12):
    stat.step()
    time.sleep(2.1)
`,
      test: {
        expect: /18\.0 °C -> heating[\s\S]*--- -> FAULT[\s\S]*18\.0 °C -> heating/,
        seconds: 27,
        events: [
          { at: 0, comp: 'dht', props: { temperature: 18 } },
          { at: 5, comp: 'dht', props: { fault: 'disconnected' } },
          { at: 10, comp: 'dht', props: { fault: 'none' } },
        ],
        verify: (s) => check(running(s, 'heater') && !lit(s, 'fault'), 'heater on again, fault LED off'),
      },
    },
    (c) => c.dht('dht', 4).led('fault', 27, 'red', 'Fault').supply().relay('relay', [17], {}, 'Relay').load('heater', 'heater', 'relay', 1, {}, 'Heater'),
  ),
  ex(
    {
      id: 'ch-vending-state-machine',
      cat: 'challenges',
      level: 'intermediate',
      minutes: 30,
      title: ['Vending machine state machine', 'آلة بيع بآلة الحالات'],
      goal: ['Model a machine as states and a transition table (a dict of dicts) instead of nested ifs.', 'نمذجة آلة كحالات وجدول انتقالات (قاموس من القواميس) بدلاً من الشروط المتداخلة.'],
      result: ['Two coins move IDLE → ONE_COIN → READY; the select button vends (servo turns, buzzer beeps) and returns to IDLE.', 'عملتان تنقلان الآلة من IDLE إلى ONE_COIN ثم READY، وزر الاختيار يصرف المنتج (يدور السيرفو ويصدر الجرس صوتاً) ثم تعود إلى IDLE.'],
      tryIt: ['Press COIN, COIN, then SELECT. Pressing SELECT first does nothing.', 'اضغط COIN مرتين ثم SELECT. الضغط على SELECT أولاً لا يفعل شيئاً.'],
      modify: ['Add a REFUND button that returns to IDLE from any paying state.', 'أضف زر استرداد يعيد الآلة إلى IDLE من أي حالة دفع.'],
      explain: ['TRANSITIONS[state][event] gives the next state; a missing key means the event is ignored. Actions run on entering a state.', 'يعطي TRANSITIONS[state][event] الحالة التالية، وغياب المفتاح يعني تجاهل الحدث. وتُنفَّذ الأفعال عند دخول الحالة.'],
      code: `from gpiozero import Button, LED, Buzzer, AngularServo
from time import sleep

coin, select = Button(17), Button(27)
ready_led, beep = LED(22), Buzzer(18)
flap = AngularServo(12, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
flap.angle = -90

TRANSITIONS = {
    "IDLE": {"coin": "ONE_COIN"},
    "ONE_COIN": {"coin": "READY"},
    "READY": {"select": "VEND"},
}
state = "IDLE"

def enter(new):
    global state
    print(f"{state} -> {new}")
    state = new
    ready_led.value = state == "READY"
    if state == "VEND":
        flap.angle = 90; beep.on(); sleep(0.5)
        flap.angle = -90; beep.off()
        print("item delivered")
        enter("IDLE")

def handle(event):
    nxt = TRANSITIONS[state].get(event)
    if nxt:
        enter(nxt)
    else:
        print(f"'{event}' ignored in {state}")

coin.when_pressed = lambda: handle("coin")
select.when_pressed = lambda: handle("select")
sleep(6)
print("final state:", state)
`,
      test: {
        expect: /'select' ignored in IDLE[\s\S]*IDLE -> ONE_COIN[\s\S]*ONE_COIN -> READY[\s\S]*READY -> VEND[\s\S]*item delivered[\s\S]*VEND -> IDLE[\s\S]*final state: IDLE/,
        seconds: 8,
        events: [...tap('select', 0.8), ...tap('coin', 1.6), ...tap('coin', 2.4), ...tap('select', 3.2)],
        verify: (s) => check(!lit(s, 'ready') && !vis(s, 'beep').on, 'idle again: ready LED and buzzer off'),
      },
    },
    (c) => c.button('coin', 17, 'COIN').button('select', 27, 'SELECT').led('ready', 22, 'green', 'Ready').buzzer('beep', 18).servo('flap', 12, 'sg90'),
  ),
  ex(
    {
      id: 'ch-generator-pipeline',
      cat: 'challenges',
      level: 'advanced',
      minutes: 25,
      title: ['Sensor pipeline with generators', 'خط معالجة الحساس بالمولّدات'],
      goal: ['Chain generator functions (read → smooth → detect changes) and time a function with a decorator.', 'ربط دوال مولّدة (قراءة ← تنعيم ← كشف التغيّر) وقياس زمن دالة بمُزخرف.'],
      result: ['Only significant changes of the knob are reported; a summary of the work time is printed at the end.', 'لا يُبلَّغ إلا عن التغيرات المهمة في المقبض، ويُطبع ملخص زمن العمل في النهاية.'],
      tryIt: ['Turn the potentiometer from 20 % to 80 % during the run.', 'أدر مقياس الجهد من 20% إلى 80% أثناء التشغيل.'],
      modify: ['Add a stage that drops readings outside 0–100 %.', 'أضف مرحلة تحذف القراءات خارج 0–100%.'],
      explain: ['Each stage is a generator that pulls from the previous one, so data flows one value at a time. functools.wraps keeps the decorated function’s name.', 'كل مرحلة مولّد يسحب القيم من المرحلة السابقة، فتتدفق البيانات قيمة بعد قيمة. وتحافظ functools.wraps على اسم الدالة المزخرفة.'],
      code: `import functools, time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

def timed(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kw):
        t0 = time.monotonic()
        result = fn(*args, **kw)
        print(f"{fn.__name__} took {time.monotonic() - t0:.1f} s")
        return result
    return wrapper

knob = AnalogIn(ADS.ADS1115(busio.I2C(board.SCL, board.SDA)), 0)

def readings(n, every=0.2):
    for _ in range(n):
        yield knob.voltage / 3.3 * 100
        time.sleep(every)

def smooth(values, k=3):
    window = []
    for v in values:
        window = (window + [v])[-k:]
        yield sum(window) / len(window)

def changes(values, step=10):
    last = None
    for v in values:
        if last is None or abs(v - last) >= step:
            last = v
            yield v

@timed
def monitor():
    reports = [round(v) for v in changes(smooth(readings(20)))]
    for r in reports:
        print(f"knob at {r} %")
    return reports

result = monitor()
print("reports:", len(result))
`,
      test: { expect: /knob at 2\d %[\s\S]*knob at [78]\d %[\s\S]*monitor took 4\.\d s[\s\S]*reports: \d/, seconds: 6, events: [{ at: 0, comp: 'knob', props: { position: 20 } }, { at: 1.5, comp: 'knob', props: { position: 80 } }] },
    },
    (c) => c.pot('knob', 0, { position: 20 }, 'Knob'),
  ),
  ex(
    {
      id: 'ch-dataclass-plant-scheduler',
      cat: 'challenges',
      level: 'advanced',
      minutes: 30,
      title: ['Plant scheduler with dataclasses', 'جدولة النباتات باستخدام dataclasses'],
      goal: ['Describe each plant as a dataclass, sort the plants by how thirsty they are and water only the neediest one.', 'وصف كل نبتة كـ dataclass، وترتيب النباتات حسب حاجتها للماء، وري الأكثر حاجة فقط.'],
      result: ['The basil (driest relative to its target) is watered first; its valve opens while the mint’s stays closed.', 'تُروى نبتة الريحان أولاً (الأكثر جفافاً مقارنة بهدفها)، فيُفتح صمامها ويبقى صمام النعناع مغلقاً.'],
      tryIt: ['Swap the soil values of the two sensors and run again.', 'بدّل قيمتي التربة في الحساسين وشغّل مجدداً.'],
      modify: ['Add a field "last_watered" and skip plants watered less than 1 h ago.', 'أضف حقلاً باسم "last_watered" وتخطَّ النباتات التي رُويت قبل أقل من ساعة.'],
      explain: ['@dataclass writes __init__ and __repr__ for you; the "deficit" property is computed; sorted(key=…) orders by it.', 'تكتب @dataclass الدالتين __init__ و__repr__ نيابة عنك، وتُحسب الخاصية "deficit"، وترتب sorted(key=…) حسبها.'],
      code: `from dataclasses import dataclass
from smartfarm import ADS1115, SoilMoisture, Valve
from time import sleep

@dataclass
class Plant:
    name: str
    target: float
    sensor: SoilMoisture
    valve: Valve

    @property
    def deficit(self):
        return self.target - self.sensor.read()

adc = ADS1115()
plants = [
    Plant("mint", 45, SoilMoisture(adc, 0), Valve(17, active_high=False)),
    Plant("basil", 55, SoilMoisture(adc, 1), Valve(27, active_high=False)),
]
ranked = sorted(plants, key=lambda p: p.deficit, reverse=True)
for p in ranked:
    print(f"{p.name:6} deficit {p.deficit:5.1f} %")
first = ranked[0]
if first.deficit > 0:
    first.valve.on()
    print(f"watering {first.name}")
    sleep(1.5)
`,
      test: {
        expect: /basil\s+deficit\s+2\d\.\d %[\s\S]*mint\s+deficit[\s\S]*watering basil/,
        seconds: 3,
        verify: (s) => check(running(s, 'v_basil') && !running(s, 'v_mint'), 'only the basil valve is open'),
      },
    },
    (c) =>
      c
        .analog('soil_mint', 'soil_moisture', 0, { moisture: 40 }, 'Soil: mint')
        .analog('soil_basil', 'soil_moisture', 1, { moisture: 30 }, 'Soil: basil')
        .supply()
        .relay('relay', [17, 27], {}, 'Relay ×2')
        .load('v_mint', 'solenoid_valve', 'relay', 1, {}, 'Valve: mint')
        .load('v_basil', 'solenoid_valve', 'relay', 2, {}, 'Valve: basil'),
  ),
  ex(
    {
      id: 'ch-i2c-watchdog',
      cat: 'challenges',
      level: 'intermediate',
      minutes: 25,
      title: ['Sensor watchdog with exceptions', 'مراقب الحساس باستخدام الاستثناءات'],
      goal: ['Keep a light logger running when the I2C sensor disappears: catch the error, report it and retry.', 'إبقاء مسجل الضوء يعمل عندما يختفي حساس I2C: التقاط الخطأ والإبلاغ عنه وإعادة المحاولة.'],
      result: ['Readings stop with "sensor lost" while the BH1750 is disconnected and resume afterwards; the program never crashes.', 'تتوقف القراءات مع رسالة "sensor lost" أثناء فصل BH1750 ثم تُستأنف بعد ذلك، ولا يتعطل البرنامج أبداً.'],
      tryIt: ['Set the BH1750 fault to "Sensor disconnected" for a few seconds.', 'اضبط عطل BH1750 على "Sensor disconnected" لبضع ثوانٍ.'],
      modify: ['Blink the LED faster the longer the sensor is missing.', 'اجعل الـ LED يومض أسرع كلما طال غياب الحساس.'],
      explain: ['A missing I2C device does not acknowledge its address, which Linux reports as OSError errno 121 (Remote I/O); smartfarm wraps it in SensorError with that message. try/except/else separates the error path from the normal one.', 'جهاز I2C المفقود لا يرد على عنوانه، ويبلّغ لينكس عن ذلك بالخطأ OSError رقم 121 (Remote I/O)، وتغلّفه smartfarm في SensorError مع الرسالة نفسها. وتفصل try/except/else مسار الخطأ عن المسار العادي.'],
      code: `from smartfarm import BH1750, SensorError
from gpiozero import LED
from time import sleep

sensor, warn = BH1750(), LED(17)
lost = False
for i in range(12):
    try:
        lux = sensor.read()
    except SensorError as e:
        warn.on()
        if not lost:
            print(f"sensor lost: {e}")
        lost = True
    else:
        warn.off()
        if lost:
            print("sensor back")
        lost = False
        print(f"{lux:.0f} lux")
    sleep(0.5)
print("logger still running")
`,
      test: {
        expect: /300 lux[\s\S]*sensor lost: BH1750: \[Errno 121\] Remote I\/O error[\s\S]*sensor back[\s\S]*logger still running/,
        seconds: 8,
        events: [
          { at: 1.6, comp: 'light', props: { fault: 'disconnected' } },
          { at: 3.8, comp: 'light', props: { fault: 'none' } },
        ],
        verify: (s) => check(!lit(s, 'warn'), 'warning LED off after recovery'),
      },
    },
    (c) => c.i2c('light', 'bh1750', {}, 'BH1750').led('warn', 17, 'yellow', 'Sensor fault'),
  ),
  ex(
    {
      id: 'ch-binary-quiz',
      cat: 'challenges',
      level: 'beginner',
      minutes: 20,
      title: ['Binary quiz with LEDs', 'اختبار الأعداد الثنائية بالـ LEDs'],
      goal: ['Show numbers in binary on four LEDs and check the answers given with YES/NO buttons.', 'عرض أعداد بالنظام الثنائي على أربعة LEDs والتحقق من الإجابات بزري نعم ولا.'],
      result: ['For each question the LEDs show a number; the player answers whether it is the asked value; the score is printed.', 'في كل سؤال تعرض الـ LEDs عدداً، ويجيب اللاعب هل هو القيمة المطلوبة، ثم تُطبع النتيجة.'],
      tryIt: ['Read the LEDs (left = 8, right = 1) and press YES or NO.', 'اقرأ الـ LEDs (اليسار = 8 واليمين = 1) واضغط نعم أو لا.'],
      modify: ['Use a random number per question and keep a high score.', 'استخدم عدداً عشوائياً لكل سؤال واحتفظ بأعلى نتيجة.'],
      explain: ['(n >> bit) & 1 extracts one bit; LEDBoard.value takes a tuple of 0/1 values.', 'يستخرج التعبير (n >> bit) & 1 بتاً واحداً، وتأخذ LEDBoard.value مجموعة من القيم 0/1.'],
      code: `from gpiozero import LEDBoard, Button
from time import sleep

leds = LEDBoard(5, 6, 13, 19)
yes, no = Button(17), Button(27)
questions = [(9, 9), (5, 6), (12, 12)]
score = 0

def answer():
    while True:
        if yes.is_pressed:
            yes.wait_for_release(); return True
        if no.is_pressed:
            no.wait_for_release(); return False
        sleep(0.01)

for shown, asked in questions:
    leds.value = tuple((shown >> bit) & 1 for bit in (3, 2, 1, 0))
    print(f"is this {asked}?")
    said_yes = answer()
    correct = said_yes == (shown == asked)
    score += correct
    print(f"  shown {shown:04b} -> {'right' if correct else 'wrong'}")
leds.off()
print(f"score {score}/{len(questions)}")
`,
      test: { expect: /shown 1001 -> right[\s\S]*shown 0101 -> right[\s\S]*shown 1100 -> right[\s\S]*score 3\/3/, seconds: 5, events: [...tap('yes', 0.6), ...tap('no', 1.4), ...tap('yes', 2.2)] },
    },
    (c) =>
      c
        .led('b3', 5, 'red', '8')
        .led('b2', 6, 'red', '4')
        .led('b1', 13, 'red', '2')
        .led('b0', 19, 'red', '1')
        .button('yes', 17, 'YES')
        .button('no', 27, 'NO'),
  ),
];
