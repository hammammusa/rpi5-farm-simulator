// Security systems: alarms, sensors, locks and alerts.
import { check, energised, ex, lit, near, vis, type LibExample } from './dsl';

export const SECURITY_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'sec-intruder-alarm',
      cat: 'security',
      level: 'intermediate',
      minutes: 25,
      title: ['Armed intruder alarm', 'إنذار تسلل قابل للتفعيل'],
      goal: ['Build an alarm with armed/disarmed states, a PIR trigger and a siren.', 'بناء إنذار بحالتي تفعيل وتعطيل مع مُشغّل PIR وصفارة.'],
      result: ['After arming, motion starts the siren; pressing the button disarms it.', 'بعد التفعيل تُطلق الحركة الصفارة، والضغط على الزر يعطّلها.'],
      tryIt: ['Press ARM, trigger motion on the PIR, then press ARM again to disarm.', 'اضغط زر التفعيل، ثم شغّل الحركة في PIR، ثم اضغط الزر مجدداً للتعطيل.'],
      modify: ['Add an exit delay of 5 s after arming.', 'أضف مهلة خروج 5 ثوانٍ بعد التفعيل.'],
      explain: ['Two variables hold the state (armed, alarm). Callbacks change them; the LED shows armed, the buzzer the alarm.', 'يحتفظ متغيران بالحالة (مفعّل، إنذار)، وتغيّرهما دوال الاستدعاء، ويُظهر الـ LED حالة التفعيل والجرس حالة الإنذار.'],
      code: `from gpiozero import MotionSensor, Button, Buzzer, LED
from signal import pause

pir, arm = MotionSensor(17), Button(27)
siren, armed_led = Buzzer(18), LED(22)
state = {"armed": False}

def toggle_arm():
    state["armed"] = not state["armed"]
    armed_led.value = state["armed"]
    siren.off()
    print("ARMED" if state["armed"] else "disarmed")

def intruder():
    if state["armed"]:
        siren.on()
        print("INTRUDER! siren on")

arm.when_pressed = toggle_arm
pir.when_motion = intruder
print("system ready (disarmed)")
pause()
`,
      test: {
        expect: /ARMED[\s\S]*INTRUDER! siren on[\s\S]*disarmed/,
        seconds: 7,
        events: [
          { at: 1, comp: 'arm', press: true },
          { at: 1.3, comp: 'arm', press: false },
          { at: 2.5, comp: 'pir', props: { motion: true } },
          { at: 4.5, comp: 'arm', press: true },
          { at: 4.8, comp: 'arm', press: false },
        ],
        verify: (s) => check(!vis(s, 'siren').on && !lit(s, 'armed'), 'siren off and system disarmed'),
      },
    },
    (c) => c.pir('pir', 17).button('arm', 27, 'ARM').buzzer('siren', 18).led('armed', 22, 'red', 'Armed'),
  ),
  ex(
    {
      id: 'sec-light-beam-tripwire',
      cat: 'security',
      level: 'beginner',
      minutes: 15,
      title: ['Light-beam tripwire', 'سلك إنذار بشعاع ضوئي'],
      goal: ['Detect when a light beam aimed at a light sensor is interrupted, and count interruptions.', 'اكتشاف انقطاع شعاع ضوئي موجّه إلى حساس ضوء وعدّ مرات الانقطاع.'],
      result: ['Each time the beam is broken the count increases and the buzzer beeps.', 'كلما انقطع الشعاع يزداد العدد ويُصدر الجرس صفيراً.'],
      tryIt: ['Lower the light module lux to 50 (beam blocked) and back to 2000.', 'خفّض lux في وحدة الضوء إلى 50 (انقطاع الشعاع) ثم أعده إلى 2000.'],
      modify: ['Ignore interruptions shorter than 0.2 s.', 'تجاهل الانقطاعات الأقصر من 0.2 ثانية.'],
      explain: ['The module’s DO is LOW while the light is above the threshold; when_deactivated fires as the beam breaks.', 'يكون المخرج DO منخفضاً طالما الضوء فوق العتبة، وتُطلق when_deactivated عند انقطاع الشعاع.'],
      code: `from gpiozero import DigitalInputDevice, Buzzer
from signal import pause
from time import sleep

beam = DigitalInputDevice(17, pull_up=False)   # DO: LOW = beam present (bright)
buzzer = Buzzer(18)
count = 0

def broken():
    global count
    count += 1
    print("beam broken, count =", count)
    buzzer.on(); sleep(0.2); buzzer.off()

beam.when_activated = broken            # DO goes HIGH when it gets dark
pause()
`,
      test: {
        expect: /beam broken, count = 1[\s\S]*beam broken, count = 2/,
        seconds: 6,
        events: [
          { at: 1, comp: 'ldr', props: { lux: 50 } },
          { at: 2, comp: 'ldr', props: { lux: 2000 } },
          { at: 3, comp: 'ldr', props: { lux: 50 } },
        ],
      },
    },
    (c) => c.part('ldr', 'ldr_module', { lux: 2000, threshold: 500 }, 'Light sensor').w(`ldr.VCC>${c.v33()}`, `ldr.GND>${c.gnd()}`, 'ldr.DO>pi.P11').buzzer('bz', 18),
  ),
  ex(
    {
      id: 'sec-code-lock',
      cat: 'security',
      level: 'advanced',
      minutes: 30,
      title: ['Two-button code lock with servo bolt', 'قفل برمز من زرين مع مزلاج سيرفو'],
      goal: ['Enter a secret sequence with two buttons; the correct code moves a servo bolt.', 'إدخال تسلسل سري بزرين، والرمز الصحيح يحرك مزلاج سيرفو.'],
      result: ['Entering A, B, B, A unlocks (servo turns, green LED). A wrong code flashes red.', 'إدخال A ثم B ثم B ثم A يفتح القفل (يدور السيرفو ويضيء الأخضر)، والرمز الخاطئ يومض الأحمر.'],
      tryIt: ['Press A, B, B, A on the two buttons.', 'اضغط على الزرين بالترتيب A ثم B ثم B ثم A.'],
      modify: ['Lock out for 10 s after three wrong codes.', 'اقفل النظام 10 ثوانٍ بعد ثلاثة رموز خاطئة.'],
      explain: ['The presses are collected in a list; once it has 4 entries it is compared with the secret and cleared.', 'تُجمع الضغطات في قائمة، وعندما تصل إلى 4 عناصر تُقارن بالرمز السري ثم تُفرغ.'],
      code: `from gpiozero import Button, LED, AngularServo
from signal import pause

a, b = Button(17), Button(27)
green, red = LED(22), LED(23)
bolt = AngularServo(18, min_angle=0, max_angle=180, min_pulse_width=0.0005, max_pulse_width=0.0025)
bolt.angle = 0
SECRET = ["A", "B", "B", "A"]
entered = []

def press(key):
    entered.append(key)
    print("entered", "".join(entered))
    if len(entered) == len(SECRET):
        if entered == SECRET:
            bolt.angle = 90; green.on(); print("UNLOCKED")
        else:
            red.blink(0.1, 0.1, 3); print("wrong code")
        entered.clear()

a.when_pressed = lambda: press("A")
b.when_pressed = lambda: press("B")
pause()
`,
      test: {
        expect: /entered ABBA[\s\S]*UNLOCKED/,
        seconds: 6,
        events: [
          { at: 0.8, comp: 'btnA', press: true },
          { at: 1.0, comp: 'btnA', press: false },
          { at: 1.4, comp: 'btnB', press: true },
          { at: 1.6, comp: 'btnB', press: false },
          { at: 2.0, comp: 'btnB', press: true },
          { at: 2.2, comp: 'btnB', press: false },
          { at: 2.6, comp: 'btnA', press: true },
          { at: 2.8, comp: 'btnA', press: false },
        ],
        verify: (s) => check(near(vis(s, 'bolt').angle ?? 0, 0, 3) && lit(s, 'green'), `bolt ${vis(s, 'bolt').angle}°, green ${lit(s, 'green')}`),
      },
    },
    (c) => c.button('btnA', 17, 'A').button('btnB', 27, 'B').led('green', 22, 'green', 'Open').led('red', 23, 'red', 'Wrong').servo('bolt', 18, 'sg90'),
  ),
  ex(
    {
      id: 'sec-door-left-open',
      cat: 'security',
      level: 'beginner',
      minutes: 15,
      title: ['Door-left-open warning', 'تحذير ترك الباب مفتوحاً'],
      goal: ['Measure how long a door has been open and warn after a limit.', 'قياس مدة بقاء الباب مفتوحاً والتحذير بعد حد معيّن.'],
      result: ['If the door stays open longer than 3 s, the warning LED flashes until it closes.', 'إذا بقي الباب مفتوحاً أكثر من 3 ثوانٍ يومض LED التحذير حتى يُغلق.'],
      tryIt: ['Set the door contact to B (open), wait 4 s, then back to A.', 'اضبط تلامس الباب على B (مفتوح) وانتظر 4 ثوانٍ ثم أعده إلى A.'],
      modify: ['Also sound the buzzer after 10 s.', 'شغّل الجرس أيضاً بعد 10 ثوانٍ.'],
      explain: ['The time when the door opened is stored; the loop compares it with the current time.', 'يُخزن وقت فتح الباب، وتقارنه الحلقة بالوقت الحالي.'],
      code: `from gpiozero import DigitalInputDevice, LED
from time import monotonic, sleep

door = DigitalInputDevice(27, pull_up=True)    # active (1) = closed
warn = LED(17)
opened_at = None
while True:                      # runs until you press Stop
    if not door.value:
        if opened_at is None:
            opened_at = monotonic(); print("door opened")
        if monotonic() - opened_at > 3 and not warn.is_lit:
            warn.blink(0.2, 0.2); print("WARNING: door open > 3 s")
    elif opened_at is not None:
        opened_at = None; warn.off(); print("door closed, warning cleared")
    sleep(0.1)
`,
      test: {
        expect: /door opened[\s\S]*WARNING: door open > 3 s[\s\S]*warning cleared/,
        seconds: 8,
        events: [
          { at: 1, comp: 'door', props: { position: 'B' } },
          { at: 5, comp: 'door', props: { position: 'A' } },
        ],
        verify: (s) => check(!lit(s, 'warn'), 'warning off after closing'),
      },
    },
    (c) => c.part('door', 'switch', { position: 'A' }, 'Door contact').w('door.COM>pi.P13', `door.A>${c.gnd()}`).led('warn', 17, 'yellow', 'Warning'),
  ),
  ex(
    {
      id: 'sec-water-leak-shutoff',
      cat: 'security',
      level: 'intermediate',
      minutes: 20,
      title: ['Water-leak shut-off', 'إيقاف المياه عند التسرب'],
      goal: ['Detect a leak and close the main water valve automatically.', 'اكتشاف التسرب وإغلاق صمام المياه الرئيسي تلقائياً.'],
      result: ['The main valve is open until the leak sensor gets wet; then it closes and the buzzer sounds. After the floor has been dry for 5 s the valve reopens. It keeps guarding until you press Stop.', 'يبقى الصمام الرئيسي مفتوحاً حتى يبتل حساس التسرب، فيُغلق ويرن الجرس. وبعد بقاء الأرض جافة 5 ثوانٍ يُعاد فتح الصمام، ويستمر في الحراسة حتى تضغط إيقاف.'],
      tryIt: ['Set the leak sensor to wet while it runs.', 'اضبط حساس التسرب على مبتل أثناء التشغيل.'],
      modify: ['Require a button press to reopen the valve after a leak.', 'اشترط الضغط على زر لإعادة فتح الصمام بعد التسرب.'],
      explain: ['The leak module output is read with smartfarm.LeakSensor; the valve relay is switched off as soon as it reports water.', 'يُقرأ مخرج وحدة التسرب عبر smartfarm.LeakSensor، ويُفصل مرحل الصمام فور الإبلاغ عن وجود ماء.'],
      code: `from smartfarm import LeakSensor, Valve
from gpiozero import Buzzer
from time import sleep

leak = LeakSensor(27)
main_valve = Valve(17, active_high=False)
buzzer = Buzzer(18)
while True:                      # runs until you press Stop
    main_valve.on()
    buzzer.off()
    print("main valve open")
    while not leak.wet:
        sleep(0.2)
    main_valve.off()
    buzzer.on()
    print("LEAK! main valve closed")
    dry_for = 0.0
    while dry_for < 5:           # reopen only after 5 s without water
        sleep(0.2)
        dry_for = dry_for + 0.2 if not leak.wet else 0.0
    print("dry for 5 s -> reopening")
`,
      test: { expect: /main valve open[\s\S]*LEAK! main valve closed/, seconds: 5, events: [{ at: 1.5, comp: 'leak', props: { wet: 1 } }], verify: (s) => check(!energised(s, 'relay') && !!vis(s, 'bz').on, 'valve closed, buzzer on') },
    },
    (c) => c.digital('leak', 'leak_sensor', 27, {}, 'Leak sensor').supply().relay('relay', [17], {}, 'Relay').load('valve', 'solenoid_valve', 'relay', 1, {}, 'Main valve').buzzer('bz', 18),
  ),
  ex(
    {
      id: 'sec-proximity-zone',
      cat: 'security',
      level: 'intermediate',
      minutes: 20,
      title: ['Proximity guard zones (HC-SR04)', 'مناطق حماية بالقرب (HC-SR04)'],
      goal: ['Classify distance into safe, caution and alarm zones with LEDs.', 'تصنيف المسافة إلى مناطق آمنة وتحذير وإنذار باستخدام LEDs.'],
      result: ['Green beyond 1 m, yellow 0.4–1 m, red closer than 0.4 m.', 'أخضر لأبعد من متر، وأصفر بين 0.4 ومتر، وأحمر لأقرب من 0.4 متر.'],
      tryIt: ['Change the HC-SR04 distance to 70 cm and then to 20 cm.', 'غيّر مسافة HC-SR04 إلى 70 سم ثم إلى 20 سم.'],
      modify: ['Make the red zone also beep faster the closer the object is.', 'اجعل المنطقة الحمراء تصفّر أسرع كلما اقترب الجسم.'],
      explain: ['DistanceSensor.distance is in metres; LEDBoard sets three LEDs at once.', 'تعطي DistanceSensor.distance المسافة بالأمتار، وتضبط LEDBoard الـ LEDs الثلاثة دفعة واحدة.'],
      code: `from gpiozero import DistanceSensor, LEDBoard
from time import sleep

sensor = DistanceSensor(echo=24, trigger=23, max_distance=3)
zones = LEDBoard(green=17, yellow=27, red=22)
while True:                      # runs until you press Stop
    d = sensor.distance
    zone = "safe" if d > 1 else "caution" if d > 0.4 else "ALARM"
    zones.value = (zone == "safe", zone == "caution", zone == "ALARM")
    print(f"{d * 100:5.0f} cm -> {zone}")
    sleep(0.4)
`,
      test: {
        expect: /150 cm -> safe[\s\S]*70 cm -> caution[\s\S]*20 cm -> ALARM/,
        seconds: 5,
        events: [
          { at: 1, comp: 'us', props: { distance: 70 } },
          { at: 2, comp: 'us', props: { distance: 20 } },
        ],
        verify: (s) => check(lit(s, 'red') && !lit(s, 'green'), 'red zone'),
      },
    },
    (c) => c.ultrasonic('us', 23, 24, { distance: 150 }).led('green', 17, 'green', 'Safe').led('yellow', 27, 'yellow', 'Caution').led('red', 22, 'red', 'Alarm'),
  ),
  ex(
    {
      id: 'sec-dial-safe',
      cat: 'security',
      level: 'intermediate',
      minutes: 20,
      title: ['Dial safe (knob combination)', 'خزنة بقرص (رمز بالمقبض)'],
      goal: ['Read a dial value, quantise it to numbers 0–9 and check a combination.', 'قراءة قيمة القرص وتحويلها إلى أرقام من 0 إلى 9 ثم التحقق من الرمز.'],
      result: ['Entering 7 then 3 with the dial and ENTER opens the safe (green LED) for 5 s; a wrong combination is reported. It keeps accepting attempts until you press Stop.', 'إدخال 7 ثم 3 بالقرص وزر ENTER يفتح الخزنة (LED أخضر) لمدة 5 ثوانٍ، ويُبلَّغ عن الرمز الخاطئ، ويستمر في قبول المحاولات حتى تضغط إيقاف.'],
      tryIt: ['Move the knob to about 75 %, press ENTER; then to 35 %, press ENTER.', 'حرّك المقبض إلى نحو 75% واضغط إدخال، ثم إلى 35% واضغط إدخال.'],
      modify: ['Use three numbers and show progress with LEDs.', 'استخدم ثلاثة أرقام وأظهر التقدم بالـ LEDs.'],
      explain: ['digit = int(voltage / 3.3 × 10) turns the knob into 10 positions; the entered digits are compared with the combination.', 'المعادلة digit = int(voltage / 3.3 × 10) تحوّل المقبض إلى 10 مواضع، وتُقارن الأرقام المدخلة بالرمز.'],
      code: `import time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn
from gpiozero import Button, LED

dial = AnalogIn(ADS.ADS1115(busio.I2C(board.SCL, board.SDA)), ADS.P0)
enter = Button(17)
opened = LED(27)
COMBO = [7, 3]
while True:                                  # runs until you press Stop
    entered = []
    print("enter the combination")
    while len(entered) < len(COMBO):
        enter.wait_for_press()
        digit = min(9, int(dial.voltage / 3.3 * 10))
        entered.append(digit)
        print("digit", digit)
        enter.wait_for_release()
    if entered == COMBO:
        opened.on(); print("SAFE OPEN")
        time.sleep(5)
        opened.off(); print("safe locked again")
    else:
        print("wrong combination", entered)
`,
      test: {
        expect: /digit 7[\s\S]*digit 3[\s\S]*SAFE OPEN/,
        seconds: 6,
        events: [
          { at: 0.5, comp: 'dial', props: { position: 75 } },
          { at: 1, comp: 'enter', press: true },
          { at: 1.3, comp: 'enter', press: false },
          { at: 1.8, comp: 'dial', props: { position: 35 } },
          { at: 2.3, comp: 'enter', press: true },
          { at: 2.6, comp: 'enter', press: false },
        ],
        verify: (s) => check(lit(s, 'open'), 'safe LED on'),
      },
    },
    (c) => c.pot('dial', 0, { position: 0 }, 'Dial').button('enter', 17, 'ENTER').led('open', 27, 'green', 'Open'),
  ),
  ex(
    {
      id: 'sec-panic-button',
      cat: 'security',
      level: 'beginner',
      minutes: 10,
      title: ['Panic button with latching alarm', 'زر طوارئ مع إنذار مستمر'],
      goal: ['Latch an alarm on with one press so it stays on until a reset.', 'تثبيت الإنذار بضغطة واحدة ليبقى يعمل حتى إعادة الضبط.'],
      result: ['Pressing PANIC starts flashing and beeping; only RESET stops it.', 'الضغط على زر الطوارئ يبدأ الوميض والصفير، ولا يوقفه إلا زر إعادة الضبط.'],
      tryIt: ['Press PANIC, then RESET.', 'اضغط زر الطوارئ ثم زر إعادة الضبط.'],
      modify: ['Record the time of each panic event in a list and print it on reset.', 'سجّل وقت كل حالة طوارئ في قائمة واطبعها عند إعادة الضبط.'],
      explain: ['blink() and beep() run in the background, so the program keeps reacting to the RESET button.', 'تعمل blink() وbeep() في الخلفية، فيبقى البرنامج قادراً على الاستجابة لزر إعادة الضبط.'],
      code: `from gpiozero import Button, LED, Buzzer
from signal import pause

panic, reset = Button(17), Button(27)
light, siren = LED(22), Buzzer(18)

def alarm():
    light.blink(0.2, 0.2); siren.beep(0.2, 0.2)
    print("PANIC alarm latched")

def clear():
    light.off(); siren.off()
    print("alarm reset")

panic.when_pressed = alarm
reset.when_pressed = clear
pause()
`,
      test: {
        expect: /PANIC alarm latched[\s\S]*alarm reset/,
        seconds: 5,
        events: [
          { at: 1, comp: 'panic', press: true },
          { at: 1.2, comp: 'panic', press: false },
          { at: 3, comp: 'reset', press: true },
          { at: 3.2, comp: 'reset', press: false },
        ],
        verify: (s) => check(!lit(s, 'light') && !vis(s, 'siren').on, 'alarm off after reset'),
      },
    },
    (c) => c.button('panic', 17, 'PANIC').button('reset', 27, 'RESET').led('light', 22, 'red', 'Strobe').buzzer('siren', 18),
  ),
];
