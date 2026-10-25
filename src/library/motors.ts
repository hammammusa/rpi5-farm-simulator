// Motors & actuators: PWM, servos, DC motors with drivers, steppers, relays and valves.
import { check, energised, ex, near, running, vis, type LibExample } from './dsl';

export const MOTOR_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'motors-fan-speed-steps',
      cat: 'motors',
      level: 'beginner',
      minutes: 15,
      title: ['Fan speed steps with a MOSFET', 'سرعات المروحة عبر ترانزستور MOSFET'],
      goal: ['Control a 12 V fan from a 3.3 V GPIO with a logic-level MOSFET and PWM.', 'التحكم بمروحة 12 فولت من طرف GPIO بجهد 3.3 فولت عبر MOSFET منطقي وإشارة PWM.'],
      result: ['The fan steps through 30 %, 60 %, 100 % and off, one second each, over and over until you press Stop.', 'تمر المروحة على 30% ثم 60% ثم 100% ثم الإيقاف، ثانية لكل خطوة، وتتكرر حتى تضغط إيقاف.'],
      tryIt: ['Watch the fan speed and the PWM duty in the GPIO monitor.', 'راقب سرعة المروحة ونسبة PWM في مراقب GPIO.'],
      modify: ['Add a 0 % step and make the fan stop at the end.', 'أضف خطوة 0% واجعل المروحة تتوقف في النهاية.'],
      explain: ['The GPIO only drives the MOSFET gate; the 12 V supply powers the fan. The diode absorbs the motor’s voltage spike when it switches off.', 'يقود طرف GPIO بوابة الـ MOSFET فقط، بينما يغذي مصدر 12 فولت المروحة. ويمتص الثنائي قفزة الجهد عند فصل المحرك.'],
      code: `from gpiozero import PWMOutputDevice
from time import sleep

fan = PWMOutputDevice(18, frequency=1000)
while True:                      # runs until you press Stop
    for duty in (0.3, 0.6, 1.0, 0.0):
        fan.value = duty
        print(f"fan at {duty:.0%}")
        sleep(1)
`,
      test: { expect: /fan at 30%[\s\S]*fan at 60%[\s\S]*fan at 100%/, seconds: 2.7, verify: (s) => check((vis(s, 'fan').run ?? 0) > 0.8, `fan run ${vis(s, 'fan').run}`) },
    },
    (c) => c.mosfetLoad('fan', 'fan', 18, {}, 'Fan'),
  ),
  ex(
    {
      id: 'motors-servo-angles',
      cat: 'motors',
      level: 'beginner',
      minutes: 10,
      title: ['Servo positions (AngularServo)', 'مواضع السيرفو (AngularServo)'],
      goal: ['Move a hobby servo to exact angles with gpiozero.AngularServo.', 'تحريك محرك سيرفو إلى زوايا محددة باستخدام AngularServo.'],
      result: ['The servo sweeps to -90°, 0°, +45° and +90° and starts again, until you press Stop.', 'يتحرك السيرفو إلى -90° ثم 0° ثم +45° ثم +90° ويعيد الكرّة حتى تضغط إيقاف.'],
      tryIt: ['Watch the servo horn in the workspace.', 'راقب ذراع السيرفو في مساحة العمل.'],
      modify: ['Sweep slowly from −90° to +90° in 10° steps.', 'حرّك الذراع ببطء من −90° إلى +90° بخطوات 10°.'],
      explain: ['A servo reads a 50 Hz pulse. The SG90 needs 0.5–2.5 ms for its full ±90°; with gpiozero\u2019s default 1–2 ms it would only move about ±45°, so the pulse widths are set explicitly.', 'يقرأ السيرفو نبضة بتردد 50 هرتز، ويحتاج SG90 نبضات بين 0.5 و2.5 ملي ثانية ليدور ±90° كاملة. القيم الافتراضية في gpiozero (1–2 ملي ثانية) تحركه نحو ±45° فقط، لذا نضبط عرض النبضة صراحة.'],
      code: `from gpiozero import AngularServo
from time import sleep

# SG90: 0.5 ms = -90°, 2.5 ms = +90° (gpiozero's default 1–2 ms only gives about ±45°)
servo = AngularServo(18, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
while True:                      # runs until you press Stop
    for angle in (-90, 0, 45, 90):
        servo.angle = angle
        print("angle", angle)
        sleep(0.7)
`,
      test: { expect: /angle -90[\s\S]*angle 90/, seconds: 2.6, verify: (s) => check(near(vis(s, 'sv').angle ?? 0, 90, 4), `angle ${vis(s, 'sv').angle}`) },
    },
    (c) => c.servo('sv', 18, 'sg90'),
  ),
  ex(
    {
      id: 'motors-dc-motor-direction',
      cat: 'motors',
      level: 'intermediate',
      minutes: 20,
      title: ['DC motor direction and speed (L298N)', 'اتجاه وسرعة محرك تيار مستمر (L298N)'],
      goal: ['Drive a 12 V motor through an H-bridge with gpiozero.Motor.', 'تشغيل محرك 12 فولت عبر جسر H باستخدام gpiozero.Motor.'],
      result: ['The motor runs forward at 50 % and 100 %, backward at 70 %, stops for a second and repeats, until you press Stop.', 'يدور المحرك للأمام بسرعة 50% ثم 100%، ثم للخلف بسرعة 70%، ثم يتوقف ثانية ويعيد، حتى تضغط إيقاف.'],
      tryIt: ['Watch the motor and the IN1/IN2 pins in the GPIO monitor.', 'راقب المحرك والطرفين IN1 وIN2 في مراقب GPIO.'],
      modify: ['Add a smooth ramp-up from 0 to full speed.', 'أضف تسارعاً تدريجياً من الصفر إلى السرعة الكاملة.'],
      explain: ['IN1 HIGH / IN2 LOW turns one way, the opposite turns the other way; PWM on the active input sets the speed.', 'IN1 مرتفع وIN2 منخفض يدوّر المحرك باتجاه، والعكس يدوّره بالاتجاه الآخر، وإشارة PWM على المدخل النشط تحدد السرعة.'],
      code: `from gpiozero import Motor
from time import sleep

motor = Motor(forward=23, backward=24)
while True:                      # runs until you press Stop
    motor.forward(0.5); print("forward 50 %"); sleep(1)
    motor.forward(1.0); print("forward 100 %"); sleep(1)
    motor.backward(0.7); print("backward 70 %"); sleep(1)
    motor.stop(); print("stopped"); sleep(1)
`,
      test: { expect: /forward 50 %[\s\S]*backward 70 %[\s\S]*stopped/, seconds: 3.6, verify: (s) => check(!running(s, 'motor'), 'motor stopped in the pause') },
    },
    (c) => c.l298n('drv', 23, 24).part('motor', 'dc_motor', { vrated: 12 }, 'Motor').w('drv.OUT1>motor.P', 'drv.OUT2>motor.N'),
  ),
  ex(
    {
      id: 'motors-stepper-clock-hand',
      cat: 'motors',
      level: 'intermediate',
      minutes: 20,
      title: ['Stepper clock hand (28BYJ-48)', 'عقرب ساعة بمحرك خطوي (28BYJ-48)'],
      goal: ['Move a geared stepper in exact angular steps.', 'تحريك محرك خطوي بمسنّنات بزوايا دقيقة.'],
      result: ['The motor moves like a clock hand: 30° per tick, round and round until you press Stop.', 'يتحرك المحرك كعقرب الساعة: 30° لكل تكة، ويدور باستمرار حتى تضغط إيقاف.'],
      tryIt: ['Watch the shaft angle shown on the motor.', 'راقب زاوية العمود المعروضة على المحرك.'],
      modify: ['Make it turn back to 0° at the end.', 'اجعله يعود إلى 0° في النهاية.'],
      explain: ['The ULN2003 board energises the four coils in sequence; 2048 steps make one turn of the output shaft.', 'تغذي لوحة ULN2003 الملفات الأربعة بالتتابع، و2048 خطوة تكمل دورة كاملة لعمود الخرج.'],
      code: `from smartfarm import Stepper28BYJ
from time import sleep

motor = Stepper28BYJ([17, 18, 27, 22], delay=0.002)
tick = 0
while True:                      # runs until you press Stop
    motor.rotate(30)
    tick += 1
    print(f"tick {tick}: {30 * tick % 360}°")
    sleep(0.3)
`,
      test: { expect: /tick 4: 120°/, seconds: 12 },
    },
    (c) => c.part('step', 'stepper_28byj48', {}, '28BYJ-48').w('step.IN1>pi.P11', 'step.IN2>pi.P12', 'step.IN3>pi.P13', 'step.IN4>pi.P15', `step.VCC>${c.v50()}`, `step.GND>${c.gnd()}`),
  ),
  ex(
    {
      id: 'motors-nema17-positioning',
      cat: 'motors',
      level: 'advanced',
      minutes: 25,
      title: ['Absolute positioning with a NEMA 17 (A4988)', 'تحديد موضع مطلق بمحرك NEMA 17 (A4988)'],
      goal: ['Keep track of the motor position and move to target angles with STEP/DIR.', 'تتبّع موضع المحرك والتحرك إلى زوايا مستهدفة عبر إشارتي STEP وDIR.'],
      result: ['The motor moves to 90°, 45°, 180° and back to 0°, pausing at each position, and repeats until you press Stop.', 'يتحرك المحرك إلى 90° ثم 45° ثم 180° ثم يعود إلى 0° مع توقف عند كل موضع، ويكرر حتى تضغط إيقاف.'],
      tryIt: ['Follow the angle on the motor and the STEP pulses in the GPIO monitor.', 'تابع الزاوية على المحرك ونبضات STEP في مراقب GPIO.'],
      modify: ['Add a home() function that returns to 0°.', 'أضف دالة home() تعيد المحرك إلى 0°.'],
      explain: ['Each STEP pulse moves 1.8° (200 steps per turn); DIR selects the direction. The program stores the position in a variable.', 'كل نبضة STEP تحرك المحرك 1.8° (200 خطوة للدورة)، ويحدد DIR الاتجاه، ويحتفظ البرنامج بالموضع في متغير.'],
      code: `from smartfarm import StepperDriver
from time import sleep

motor = StepperDriver(step=20, dir=21)
position = 0
while True:                      # runs until you press Stop
    for target in (90, 45, 180, 0):
        motor.rotate(target - position)
        position = target
        print("at", position, "degrees")
        sleep(0.5)
`,
      test: { expect: /at 90 degrees[\s\S]*at 45 degrees[\s\S]*at 180 degrees/, seconds: 8 },
    },
    (c) =>
      c
        .supply()
        .part('nema', 'a4988_nema17', {}, 'A4988 + NEMA 17')
        .w(`nema.VDD>${c.v33()}`, `nema.GND>${c.gnd()}`, 'nema.STEP>pi.P38', 'nema.DIR>pi.P40', 'nema.RST>nema.SLP', 'nema.VMOT>ps.P', 'nema.GNDM>ps.N'),
  ),
  ex(
    {
      id: 'motors-pump-run-timer',
      cat: 'motors',
      level: 'beginner',
      minutes: 15,
      title: ['Timed pump run through a relay', 'تشغيل مضخة لمدة محددة عبر مرحل'],
      goal: ['Run a pump through a relay on a timed cycle (3 s on, 3 s off).', 'تشغيل مضخة عبر مرحل بدورة زمنية (3 ثوانٍ تشغيل و3 ثوانٍ إيقاف).'],
      result: ['The relay clicks, the pump runs for 3 s and rests for 3 s; the cycle repeats until you press Stop.', 'ينقر المرحل وتعمل المضخة 3 ثوانٍ ثم ترتاح 3 ثوانٍ، وتتكرر الدورة حتى تضغط إيقاف.'],
      tryIt: ['Watch the relay LED and the pump while the program runs.', 'راقب مؤشر المرحل والمضخة أثناء التشغيل.'],
      modify: ['Run the pump for a number of seconds typed with input().', 'شغّل المضخة لعدد ثوانٍ يُدخله المستخدم عبر input().'],
      explain: ['Relay boards switch on when IN is LOW, so OutputDevice(…, active_high=False). The pump is powered by the 12 V supply through the relay contact.', 'تعمل لوحات المرحلات عندما يكون IN منخفضاً، لذا نستخدم active_high=False. وتُغذّى المضخة من مصدر 12 فولت عبر تلامس المرحل.'],
      code: `from gpiozero import OutputDevice
from time import sleep

pump = OutputDevice(17, active_high=False, initial_value=False)
cycle = 0
while True:                      # runs until you press Stop
    cycle += 1
    pump.on()
    print(f"cycle {cycle}: pump ON")
    sleep(3)
    pump.off()
    print(f"cycle {cycle}: pump OFF after 3 s")
    sleep(3)
`,
      test: { expect: /cycle 1: pump ON[\s\S]*cycle 1: pump OFF after 3 s/, seconds: 5, verify: (s) => check(!running(s, 'pump') && !energised(s, 'relay'), 'pump and relay off during the rest') },
    },
    (c) => c.supply().relay('relay', [17], {}, 'Relay').load('pump', 'water_pump', 'relay', 1, {}, 'Pump'),
  ),
  ex(
    {
      id: 'motors-valve-pulses',
      cat: 'motors',
      level: 'beginner',
      minutes: 10,
      title: ['Solenoid valve pulses', 'نبضات صمام كهرومغناطيسي'],
      goal: ['Open and close a valve a set number of times with a for loop.', 'فتح وإغلاق صمام عدداً محدداً من المرات بحلقة for.'],
      result: ['Every few seconds the valve opens three times for 0.5 s (a short watering burst), until you press Stop.', 'كل بضع ثوانٍ يفتح الصمام ثلاث مرات لمدة 0.5 ثانية (دفعة ري قصيرة)، حتى تضغط إيقاف.'],
      tryIt: ['Watch the valve state in the workspace.', 'راقب حالة الصمام في مساحة العمل.'],
      modify: ['Make the open time longer each time.', 'اجعل مدة الفتح أطول في كل مرة.'],
      explain: ['smartfarm.Valve wraps an active-LOW relay; open()/close() are easier to read than on()/off().', 'تغلّف smartfarm.Valve مرحلاً نشطاً على المستوى المنخفض، وopen() وclose() أوضح من on() وoff().'],
      code: `from smartfarm import Valve
from time import sleep

valve = Valve(17, active_high=False)
burst = 0
while True:                      # runs until you press Stop
    burst += 1
    for n in range(3):
        valve.on()
        print(f"burst {burst}: open {n + 1}")
        sleep(0.5)
        valve.off()
        sleep(0.5)
    print("valve closed - next burst in 2 s")
    sleep(2)
`,
      test: { expect: /burst 1: open 3[\s\S]*valve closed/, seconds: 4, verify: (s) => check(!running(s, 'valve'), 'valve closed between bursts') },
    },
    (c) => c.supply().relay('relay', [17], {}, 'Relay').load('valve', 'solenoid_valve', 'relay', 1, {}, 'Valve'),
  ),
  ex(
    {
      id: 'motors-pwm-fan-rpm',
      cat: 'motors',
      level: 'intermediate',
      minutes: 20,
      title: ['4-wire fan: speed control with feedback', 'مروحة رباعية الأسلاك: تحكم بالسرعة مع تغذية راجعة'],
      goal: ['Set fan speed with PWM and measure the real speed from the tachometer pulses.', 'ضبط سرعة المروحة بـ PWM وقياس السرعة الفعلية من نبضات مقياس الدوران.'],
      result: ['The fan alternates between 50 % and 100 % duty; each step prints the speed measured from the tach pulses. It repeats until you press Stop.', 'تتناوب المروحة بين نسبة تشغيل 50% و100%، وتطبع كل خطوة السرعة المقيسة من نبضات العداد، وتتكرر حتى تضغط إيقاف.'],
      tryIt: ['Compare the requested duty and the measured rpm.', 'قارن نسبة التشغيل المطلوبة مع الدوران المقاس.'],
      modify: ['Write a loop that adjusts the duty until the fan reaches 2000 rpm.', 'اكتب حلقة تعدّل النسبة حتى تصل المروحة إلى 2000 دورة/دقيقة.'],
      explain: ['The TACH output gives two pulses per revolution; it is open-collector, so it needs the 10 kΩ pull-up to 3.3 V.', 'يعطي مخرج TACH نبضتين لكل دورة، وهو مخرج مجمّع مفتوح لذا يحتاج مقاومة رفع 10 كيلو أوم إلى 3.3 فولت.'],
      code: `from smartfarm import PWMFan

fan = PWMFan(pwm=18, tach=24)
while True:                      # runs until you press Stop
    for duty in (0.5, 1.0):
        fan.speed = duty
        print(f"duty {duty:.0%}: {fan.rpm(window=2):.0f} rpm")
`,
      test: { expect: /duty 50%: 1[45]\d\d rpm[\s\S]*duty 100%: (29|30)\d\d rpm/, seconds: 8 },
    },
    (c) =>
      c
        .supply()
        .part('fan', 'pwm_fan', {}, '4-wire fan')
        .part('r_tach', 'resistor', { ohms: 10000 })
        .w('fan.V12>ps.P', 'fan.GND>ps.N', 'fan.PWM>pi.P12', 'fan.TACH>pi.P18', 'r_tach.1>pi.P18', `r_tach.2>${c.v33()}`),
  ),
  ex(
    {
      id: 'motors-tb6612-ramp',
      cat: 'motors',
      level: 'intermediate',
      minutes: 20,
      title: ['Smooth motor ramp (TB6612FNG)', 'تسارع سلس للمحرك (TB6612FNG)'],
      goal: ['Ramp a motor up and down with PWM through a modern MOSFET driver.', 'زيادة سرعة المحرك وإنقاصها تدريجياً بـ PWM عبر دائرة قيادة MOSFET حديثة.'],
      result: ['The motor ramps up to full speed and back down to 0 %, rests for a second and repeats, until you press Stop.', 'تتسارع سرعة المحرك حتى السرعة الكاملة ثم تتباطأ إلى 0%، ويرتاح ثانية ثم يكرر، حتى تضغط إيقاف.'],
      tryIt: ['Watch the motor speed and the PWMA duty while it ramps.', 'راقب سرعة المحرك ونسبة PWMA أثناء التسارع.'],
      modify: ['Change the step to 10 % and the delay to 0.1 s.', 'غيّر الخطوة إلى 10% والتأخير إلى 0.1 ثانية.'],
      explain: ['STBY must be HIGH for the driver to work; AIN1/AIN2 choose the direction and PWMA the speed.', 'يجب أن يكون STBY مرتفعاً لتعمل الدائرة، ويحدد AIN1 وAIN2 الاتجاه، وPWMA السرعة.'],
      code: `from gpiozero import OutputDevice
from smartfarm import DCMotor
from time import sleep

standby = OutputDevice(17, initial_value=True)
motor = DCMotor(forward=23, backward=24, enable=12)
while True:                      # runs until you press Stop
    for pct in list(range(20, 101, 20)) + list(range(80, -1, -20)):
        motor.forward(pct / 100)
        print("speed", pct, "%")
        sleep(0.3)
    sleep(1)
`,
      test: { expect: /speed 100 %[\s\S]*speed 0 %/, seconds: 3.5, verify: (s) => check(!running(s, 'motor'), 'motor stopped at 0 %') },
    },
    (c) =>
      c
        .supply()
        .part('drv', 'tb6612', {}, 'TB6612FNG')
        .part('motor', 'dc_motor', { vrated: 12 }, 'Motor')
        .w('drv.VM>ps.P', 'drv.GND>ps.N', `drv.VCC>${c.v33()}`, 'drv.STBY>pi.P11', 'drv.AIN1>pi.P16', 'drv.AIN2>pi.P18', 'drv.PWMA>pi.P32', 'drv.AO1>motor.P', 'drv.AO2>motor.N'),
  ),
  ex(
    {
      id: 'motors-servo-follows-knob',
      cat: 'motors',
      level: 'intermediate',
      minutes: 20,
      title: ['Servo follows a knob', 'سيرفو يتبع المقبض'],
      goal: ['Map an analog reading to a servo angle (linear scaling).', 'تحويل قراءة تناظرية إلى زاوية سيرفو (تحويل خطي).'],
      result: ['Turning the potentiometer moves the servo to the matching angle.', 'تدوير المقاومة المتغيرة يحرك السيرفو إلى الزاوية المقابلة.'],
      tryIt: ['Set the knob position to 100 % while it runs.', 'اضبط موضع المقبض على 100% أثناء التشغيل.'],
      modify: ['Limit the angle to −45°…+45° for a gentler movement.', 'حدّد الزاوية بين −45° و+45° لحركة ألطف.'],
      explain: ['angle = (v / 3.3) × 180 − 90 maps 0–3.3 V to −90…+90°.', 'المعادلة angle = (v / 3.3) × 180 − 90 تحوّل المدى 0–3.3 فولت إلى −90…+90°.'],
      code: `import time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn
from gpiozero import AngularServo

knob = AnalogIn(ADS.ADS1115(busio.I2C(board.SCL, board.SDA)), ADS.P0)
servo = AngularServo(18, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
while True:                      # runs until you press Stop
    angle = round(max(-90, min(90, knob.voltage / 3.3 * 180 - 90)))
    servo.angle = angle
    print(f"knob {knob.voltage:.2f} V -> angle {angle:+d}")
    time.sleep(0.5)
`,
      test: { expect: /angle \+0[\s\S]*angle \+(8[6-9]|90)/, seconds: 5, events: [{ at: 1.2, comp: 'knob', props: { position: 100 } }], verify: (s) => check((vis(s, 'sv').angle ?? 0) > 80, `angle ${vis(s, 'sv').angle}`) },
    },
    (c) => c.pot('knob', 0, { position: 50 }, 'Knob').servo('sv', 18, 'sg90'),
  ),
];
