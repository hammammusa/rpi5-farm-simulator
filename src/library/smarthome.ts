// Smart home: automatic lighting, climate, ventilation, fire and comfort.
import { check, energised, ex, lit, running, vis, type LibExample } from './dsl';

export const SMARTHOME_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'home-auto-night-light',
      cat: 'smarthome',
      level: 'beginner',
      minutes: 15,
      title: ['Automatic night light', 'ضوء ليلي تلقائي'],
      goal: ['Dim a lamp automatically from the measured room light.', 'تخفيت مصباح تلقائياً حسب إضاءة الغرفة المقاسة.'],
      result: ['In daylight the lamp is off; as it gets darker it glows brighter.', 'في ضوء النهار يكون المصباح مطفأ، وكلما ازداد الظلام ازداد سطوعه.'],
      tryIt: ['Lower the BH1750 lux from 300 to 2 while it runs.', 'خفّض lux في BH1750 من 300 إلى 2 أثناء التشغيل.'],
      modify: ['Switch the lamp fully off between midnight and 6:00.', 'أطفئ المصباح تماماً بين منتصف الليل والسادسة صباحاً.'],
      explain: ['The brightness is a simple linear map: 0 lux → 100 %, 50 lux or more → 0 %, limited with min()/max().', 'السطوع تحويل خطي بسيط: 0 lux يعني 100%، و50 lux أو أكثر يعني 0%، ويُقيَّد بـ min() وmax().'],
      code: `from smartfarm import BH1750
from gpiozero import PWMLED
from time import sleep

sensor = BH1750()
lamp = PWMLED(18)
for i in range(6):
    lux = sensor.read()
    level = max(0.0, min(1.0, 1 - lux / 50))
    lamp.value = level
    print(f"{lux:6.0f} lux -> lamp {level:.0%}")
    sleep(0.5)
`,
      test: { expect: /300 lux -> lamp 0%[\s\S]*\b2 lux -> lamp 9\d%/, seconds: 5, events: [{ at: 1.2, comp: 'light', props: { lux: 2 } }], verify: (s) => check(lit(s, 'lamp'), 'lamp should glow in the dark') },
    },
    (c) => c.i2c('light', 'bh1750', {}, 'BH1750').led('lamp', 18, 'white', 'Lamp'),
  ),
  ex(
    {
      id: 'home-hallway-motion-light',
      cat: 'smarthome',
      level: 'beginner',
      minutes: 15,
      title: ['Hallway light with motion timer', 'إضاءة الممر بمؤقت الحركة'],
      goal: ['Keep a light on for a while after the last motion, restarting the timer on new motion.', 'إبقاء الضوء مضاءً لفترة بعد آخر حركة، مع إعادة تشغيل المؤقت عند أي حركة جديدة.'],
      result: ['Motion switches the light on; it goes off 3 s after motion stops.', 'تشغّل الحركة الضوء، وينطفئ بعد 3 ثوانٍ من توقفها.'],
      tryIt: ['Set PIR motion on, wait, then off; watch the light timer.', 'فعّل حركة PIR ثم أوقفها وراقب مؤقت الضوء.'],
      modify: ['Use a longer timeout at night only.', 'استخدم مهلة أطول في الليل فقط.'],
      explain: ['The loop remembers the time of the last motion and compares it with time.monotonic().', 'تتذكر الحلقة وقت آخر حركة وتقارنه بالوقت الحالي من time.monotonic().'],
      code: `from gpiozero import MotionSensor, LED
from time import monotonic, sleep

pir = MotionSensor(17)
light = LED(27)
TIMEOUT = 3
last_motion = None
while True:
    if pir.motion_detected:
        if not light.is_lit:
            print("motion -> light on")
        last_motion = monotonic()
        light.on()
    elif light.is_lit and monotonic() - last_motion > TIMEOUT:
        light.off()
        print("no motion for 3 s -> light off")
    sleep(0.1)
`,
      test: {
        expect: /motion -> light on[\s\S]*light off/,
        seconds: 7,
        events: [
          { at: 1, comp: 'pir', props: { motion: true } },
          { at: 2, comp: 'pir', props: { motion: false } },
        ],
        verify: (s) => check(!lit(s, 'light'), 'light off after the timeout'),
      },
    },
    (c) => c.pir('pir', 17, { hold: 0.5 }).led('light', 27, 'yellow', 'Hall light'),
  ),
  ex(
    {
      id: 'home-fire-alarm',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 25,
      title: ['Smoke and heat fire alarm', 'إنذار حريق بالدخان والحرارة'],
      goal: ['Combine two different sensors with "or" logic to raise an alarm.', 'دمج حساسين مختلفين بمنطق "أو" لإطلاق إنذار.'],
      result: ['Smoke above 1500 ppm or temperature above 55 °C starts the siren and the red light.', 'دخان فوق 1500 جزء بالمليون أو حرارة فوق 55 °م يطلق الصفارة والضوء الأحمر.'],
      tryIt: ['Raise the MQ-2 smoke level to 4000 ppm while it runs.', 'ارفع مستوى الدخان في MQ-2 إلى 4000 جزء بالمليون أثناء التشغيل.'],
      modify: ['Require two alarm readings in a row before sounding (fewer false alarms).', 'اشترط قراءتين متتاليتين قبل إطلاق الإنذار (إنذارات كاذبة أقل).'],
      explain: ['The analog smoke value comes through the ADC, the temperature from the DHT22; any(...) of the two conditions triggers.', 'تأتي قيمة الدخان التناظرية عبر محول ADC والحرارة من DHT22، وتحقق أي من الشرطين يطلق الإنذار.'],
      code: `import time, board, adafruit_dht
from smartfarm import ADS1115, MQSensor
from gpiozero import Buzzer, LED

smoke = MQSensor(ADS1115(), channel=0, model="mq2", divider=1.5)
dht = adafruit_dht.DHT22(board.D4)
siren, red = Buzzer(18), LED(27)
for i in range(4):
    ppm = smoke.read()
    try:
        t = dht.temperature
    except RuntimeError:
        t = None
    fire = ppm > 1500 or (t is not None and t > 55)
    siren.value = red.value = fire
    print(f"smoke {ppm:5.0f} ppm  temp {t} C -> {'FIRE ALARM' if fire else 'normal'}")
    time.sleep(2.2)
`,
      test: { expect: /normal[\s\S]*FIRE ALARM/, seconds: 10, events: [{ at: 3, comp: 'mq', props: { ppm: 4000 } }], verify: (s) => check(lit(s, 'red') && !!vis(s, 'siren').on, 'siren and red light on') },
    },
    (c) => c.analog5('mq', 'mq2', 0, {}, 'MQ-2 smoke').dht('dht', 4).buzzer('siren', 18).led('red', 27, 'red', 'Alarm'),
  ),
  ex(
    {
      id: 'home-thermostat',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 25,
      title: ['Room thermostat with hysteresis', 'منظم حرارة الغرفة مع هامش تبديل'],
      goal: ['Switch a heater with two thresholds so the relay does not chatter.', 'تشغيل مدفأة بحدّين حتى لا يتذبذب المرحل.'],
      result: ['Below 19 °C the heater turns on, above 21 °C it turns off; in between it keeps its state.', 'تحت 19 °م تعمل المدفأة وفوق 21 °م تتوقف، وبينهما تحافظ على حالتها.'],
      tryIt: ['Change the probe temperature to 22 °C, then 20 °C, then 18 °C.', 'غيّر حرارة المجس إلى 22 ثم 20 ثم 18 °م.'],
      modify: ['Read the set-point from a potentiometer.', 'اقرأ درجة الضبط من مقاومة متغيرة.'],
      explain: ['Hysteresis: one threshold to switch on and a higher one to switch off. Between them nothing changes.', 'الهامش (Hysteresis): حد للتشغيل وحد أعلى للإطفاء، وبينهما لا يتغير شيء.'],
      code: `from w1thermsensor import W1ThermSensor
from smartfarm import Heater
from time import sleep

probe = W1ThermSensor()
heater = Heater(17, active_high=False)
ON_BELOW, OFF_ABOVE = 19.0, 21.0
heating = False
for i in range(8):
    t = probe.get_temperature()
    if t < ON_BELOW:
        heating = True
    elif t > OFF_ABOVE:
        heating = False
    heater.value = heating
    print(f"{t:.1f} °C -> heater {'ON' if heating else 'off'}")
    sleep(0.8)
`,
      test: {
        expect: /22\.0 °C -> heater off[\s\S]*20\.0 °C -> heater off[\s\S]*18\.0 °C -> heater ON/,
        seconds: 8,
        events: [
          { at: 0.5, comp: 'probe', props: { temperature: 22 } },
          { at: 2.1, comp: 'probe', props: { temperature: 20 } },
          { at: 3.7, comp: 'probe', props: { temperature: 18 } },
        ],
        verify: (s) => check(running(s, 'heater') && energised(s, 'relay'), 'heater must really run below 19 °C'),
      },
    },
    (c) => c.ds18b20('probe', { temperature: 20 }).supply('ps', 12, 10).relay('relay', [17], {}, 'Relay').load('heater', 'heater', 'relay', 1, {}, 'Heater'),
  ),
  ex(
    {
      id: 'home-bathroom-fan',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 20,
      title: ['Bathroom fan with run-on timer', 'مروحة الحمام مع مؤقت تشغيل إضافي'],
      goal: ['Start a fan on high humidity and keep it running a little after the humidity drops.', 'تشغيل مروحة عند ارتفاع الرطوبة وإبقاؤها تعمل قليلاً بعد انخفاضها.'],
      result: ['Humidity above 70 % starts the fan; it stops 2 s after humidity is back below 60 %.', 'الرطوبة فوق 70% تشغّل المروحة، وتتوقف بعد ثانيتين من عودتها تحت 60%.'],
      tryIt: ['Set SHT31 humidity to 85 %, then back to 50 %.', 'اضبط رطوبة SHT31 على 85% ثم أعدها إلى 50%.'],
      modify: ['Make the run-on time proportional to how humid it was.', 'اجعل مدة التشغيل الإضافي متناسبة مع مقدار الرطوبة.'],
      explain: ['A start condition, a stop condition and a timestamp make a small state machine.', 'شرط بدء وشرط توقف وطابع زمني تكوّن آلة حالات صغيرة.'],
      code: `import time
import board, busio, adafruit_sht31d
from smartfarm import Fan

sht = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
fan = Fan(17, active_high=False)
dry_since = None
for i in range(14):
    rh = sht.relative_humidity
    if rh > 70 and not fan.is_on:
        fan.on(); print(f"RH {rh:.0f} % -> fan ON")
    if fan.is_on:
        if rh < 60:
            dry_since = dry_since or time.monotonic()
            if time.monotonic() - dry_since > 2:
                fan.off(); dry_since = None; print(f"RH {rh:.0f} % -> fan OFF after run-on")
        else:
            dry_since = None
    time.sleep(0.5)
`,
      test: {
        expect: /RH 85 % -> fan ON[\s\S]*RH 50 % -> fan OFF after run-on/,
        seconds: 8,
        events: [
          { at: 1, comp: 'sht', props: { humidity: 85 } },
          { at: 3, comp: 'sht', props: { humidity: 50 } },
        ],
        verify: (s) => check(!running(s, 'fan'), 'fan off'),
      },
    },
    (c) => c.i2c('sht', 'sht31', {}, 'SHT31').supply().relay('relay', [17], {}, 'Relay').load('fan', 'exhaust_fan', 'relay', 1, {}, 'Exhaust fan'),
  ),
  ex(
    {
      id: 'home-door-chime',
      cat: 'smarthome',
      level: 'beginner',
      minutes: 10,
      title: ['Door chime', 'جرس الباب'],
      goal: ['React only to the moment a door opens (edge detection).', 'الاستجابة فقط للحظة فتح الباب (اكتشاف الحافة).'],
      result: ['Every time the door contact opens, the buzzer plays two short tones.', 'كلما انفتح تلامس الباب يُصدر الجرس نغمتين قصيرتين.'],
      tryIt: ['Switch the door contact to position B (open) and back while it runs.', 'بدّل تلامس الباب إلى الوضع B (مفتوح) ثم أعده أثناء التشغيل.'],
      modify: ['Count the openings per hour.', 'عدّ مرات فتح الباب في الساعة.'],
      explain: ['when_deactivated fires once when the contact opens (the input goes from active to inactive), not repeatedly while the door stays open.', 'تُطلق when_deactivated مرة واحدة عند انفتاح التلامس (انتقال المدخل من نشط إلى غير نشط)، لا بشكل متكرر طالما الباب مفتوح.'],
      code: `from gpiozero import DigitalInputDevice, Buzzer
from signal import pause
from time import sleep

door = DigitalInputDevice(27, pull_up=True)    # closed contact = pin LOW = active
buzzer = Buzzer(18)
opened = 0

def ding_dong():
    global opened
    opened += 1
    print("door opened", opened)
    for _ in range(2):
        buzzer.on(); sleep(0.15); buzzer.off(); sleep(0.1)

door.when_deactivated = ding_dong
door.when_activated = lambda: print("door closed")
pause()
`,
      test: {
        expect: /door opened 1[\s\S]*door closed[\s\S]*door opened 2/,
        seconds: 6,
        events: [
          { at: 1, comp: 'door', props: { position: 'B' } },
          { at: 2, comp: 'door', props: { position: 'A' } },
          { at: 3.5, comp: 'door', props: { position: 'B' } },
        ],
      },
    },
    (c) => c.part('door', 'switch', { position: 'A' }, 'Door contact').w('door.COM>pi.P13', `door.A>${c.gnd()}`).buzzer('chime', 18),
  ),
  ex(
    {
      id: 'home-smart-blinds',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 20,
      title: ['Smart window blinds', 'ستائر نوافذ ذكية'],
      goal: ['Turn a light reading into a servo angle that tilts window blinds.', 'تحويل قراءة الضوء إلى زاوية سيرفو تميل بها شرائح الستارة.'],
      result: ['Strong sun closes the blinds (−90°), dim light opens them (+90°).', 'الشمس القوية تغلق الستارة (−90°) والإضاءة الخافتة تفتحها (+90°).'],
      tryIt: ['Set the TSL2561 lux to 40000, then to 200.', 'اضبط lux في TSL2561 على 40000 ثم على 200.'],
      modify: ['Move the servo slowly in 5° steps instead of jumping.', 'حرّك السيرفو ببطء بخطوات 5° بدل القفز.'],
      explain: ['The lux range is mapped to an angle with a clamp. In bright sun the TSL2561 saturates and the Adafruit driver returns None, so the code uses low gain and treats None as full sun.', 'يُحوّل مدى lux إلى زاوية مع تقييدها. في الشمس القوية يتشبع TSL2561 فتعيد مكتبة Adafruit القيمة None، لذا يستخدم الكود كسباً منخفضاً ويعامل None كشمس كاملة.'],
      code: `import time
import board, busio, adafruit_tsl2561
from gpiozero import AngularServo

tsl = adafruit_tsl2561.TSL2561(busio.I2C(board.SCL, board.SDA))
tsl.gain = 0                 # 1x gain and the shortest integration time for direct sun
tsl.integration_time = 0
blinds = AngularServo(18, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
for i in range(6):
    lux = tsl.lux
    if lux is None:          # the sensor is saturated: treat as full sun
        lux = 40000
    angle = round(max(-90, min(90, 90 - lux / 20000 * 180)))
    blinds.angle = angle
    print(f"{lux:7.0f} lux -> blinds {angle:+d}°")
    time.sleep(0.6)
`,
      test: {
        expect: /\d{5} lux -> blinds -90°[\s\S]*\b(1[89]\d|2[01]\d) lux -> blinds \+8\d°/,
        seconds: 5,
        events: [
          { at: 0.9, comp: 'tsl', props: { lux: 40000 } },
          { at: 2.4, comp: 'tsl', props: { lux: 200 } },
        ],
        verify: (s) => check((vis(s, 'blinds').angle ?? 0) > 80, `angle ${vis(s, 'blinds').angle}`),
      },
    },
    (c) => c.i2c('tsl', 'tsl2561', {}, 'TSL2561').servo('blinds', 18, 'sg90'),
  ),
  ex(
    {
      id: 'home-co2-ventilation',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 25,
      title: ['Demand-controlled ventilation (SCD40)', 'تهوية حسب الحاجة (SCD40)'],
      goal: ['Set fan speed proportional to CO₂ (a proportional controller).', 'ضبط سرعة المروحة بالتناسب مع CO₂ (متحكم تناسبي).'],
      result: ['At 650 ppm the fan idles at 20 %; at 1400 ppm it runs near full speed.', 'عند 650 جزء بالمليون تعمل المروحة بنسبة 20%، وعند 1400 قرب السرعة الكاملة.'],
      tryIt: ['Raise the SCD40 CO₂ to 1400 ppm while it runs.', 'ارفع CO₂ في SCD40 إلى 1400 جزء بالمليون أثناء التشغيل.'],
      modify: ['Add a night mode that limits the fan to 50 %.', 'أضف وضعاً ليلياً يحدّ المروحة عند 50%.'],
      explain: ['speed = (CO₂ − 600) / 800, clamped to 20 %…100 %; a MOSFET switches the 12 V fan with PWM.', 'السرعة = (CO₂ − 600) ÷ 800 مقيدة بين 20% و100%، ويشغّل الـ MOSFET مروحة 12 فولت بـ PWM.'],
      code: `import time
import board, busio, adafruit_scd4x
from gpiozero import PWMOutputDevice

scd = adafruit_scd4x.SCD4X(busio.I2C(board.SCL, board.SDA))
scd.start_periodic_measurement()
fan = PWMOutputDevice(18, frequency=1000)
for i in range(3):
    while not scd.data_ready:
        time.sleep(1)
    speed = max(0.2, min(1.0, (scd.CO2 - 600) / 800))
    fan.value = speed
    print(f"CO2 {scd.CO2} ppm -> fan {speed:.0%}")
`,
      test: { expect: /CO2 650 ppm -> fan 20%[\s\S]*CO2 1400 ppm -> fan 100%/, seconds: 18, events: [{ at: 6, comp: 'scd', props: { co2: 1400 } }], verify: (s) => check((vis(s, 'fan').run ?? 0) > 0.8, `fan ${vis(s, 'fan').run}`) },
    },
    (c) => c.i2c('scd', 'scd40', {}, 'SCD40').mosfetLoad('fan', 'fan', 18, {}, 'Fan'),
  ),
  ex(
    {
      id: 'home-mood-lamp',
      cat: 'smarthome',
      level: 'beginner',
      minutes: 15,
      title: ['Temperature mood lamp', 'مصباح يتغير لونه بالحرارة'],
      goal: ['Blend between two colours according to a temperature.', 'المزج بين لونين حسب درجة الحرارة.'],
      result: ['Cold (≤18 °C) glows blue, warm (≥30 °C) glows red, in between a mix.', 'البارد (≤18 °م) أزرق والدافئ (≥30 °م) أحمر، وما بينهما مزيج.'],
      tryIt: ['Change the DHT22 temperature to 16 °C and then to 32 °C.', 'غيّر حرارة DHT22 إلى 16 ثم 32 °م.'],
      modify: ['Add green for the comfortable range 21–24 °C.', 'أضف الأخضر للمدى المريح 21–24 °م.'],
      explain: ['The temperature is scaled to 0…1 (f); red = f and blue = 1 − f.', 'تُحوّل الحرارة إلى قيمة بين 0 و1 (f)، فيكون الأحمر = f والأزرق = 1 − f.'],
      code: `import time, board, adafruit_dht
from gpiozero import RGBLED

dht = adafruit_dht.DHT22(board.D4)
lamp = RGBLED(red=17, green=27, blue=22)
for i in range(3):
    try:
        t = dht.temperature
    except RuntimeError:
        continue
    f = max(0.0, min(1.0, (t - 18) / 12))
    lamp.color = (f, 0, 1 - f)
    print(f"{t:.1f} °C -> red {f:.2f} blue {1 - f:.2f}")
    time.sleep(2.5)
`,
      test: {
        expect: /16\.0 °C -> red 0\.00 blue 1\.00[\s\S]*32\.0 °C -> red 1\.00 blue 0\.00/,
        seconds: 9,
        events: [
          { at: 0.5, comp: 'dht', props: { temperature: 16 } },
          { at: 3.5, comp: 'dht', props: { temperature: 32 } },
        ],
        verify: (s) => check((vis(s, 'lamp').R ?? 0) > 0.2 && !((vis(s, 'lamp').B ?? 0) > 0.1), `rgb ${JSON.stringify(vis(s, 'lamp'))}`),
      },
    },
    (c) => c.dht('dht', 4, 'dht22', { temperature: 16 }).rgb('lamp', 17, 27, 22),
  ),
  ex(
    {
      id: 'home-irrigation-relay-schedule',
      cat: 'smarthome',
      level: 'intermediate',
      minutes: 20,
      title: ['Garden sprinkler with rain skip', 'رشاش الحديقة مع التخطي عند المطر'],
      goal: ['Run a sprinkler cycle but skip it when the rain sensor is wet.', 'تشغيل دورة الرشاش مع تخطيها عندما يكون حساس المطر مبتلاً.'],
      result: ['Dry: the valve opens for 2 s. Wet: the cycle is skipped with a message.', 'عند الجفاف يُفتح الصمام ثانيتين، وعند البلل تُتخطى الدورة مع رسالة.'],
      tryIt: ['Set the rain sensor wetness to 90 % before the second cycle.', 'اضبط بلل حساس المطر على 90% قبل الدورة الثانية.'],
      modify: ['Skip for 24 h after rain instead of only while wet.', 'تخطَّ لمدة 24 ساعة بعد المطر بدل التخطي أثناء البلل فقط.'],
      explain: ['The digital rain output is checked before each cycle; the valve is a 24 V irrigation valve on a relay.', 'يُفحص مخرج المطر الرقمي قبل كل دورة، والصمام صمام ري 24 فولت على مرحل.'],
      code: `from gpiozero import DigitalInputDevice
from smartfarm import Valve
from time import sleep

rain = DigitalInputDevice(27)                # LOW = wet
valve = Valve(17, active_high=False)
for cycle in (1, 2):
    if rain.value == 0:
        print(f"cycle {cycle}: raining, skipped")
    else:
        valve.on(); print(f"cycle {cycle}: watering"); sleep(2); valve.off()
    sleep(1)
`,
      test: { expect: /cycle 1: watering[\s\S]*cycle 2: raining, skipped/, seconds: 6, events: [{ at: 2.5, comp: 'rain', props: { wetness: 90 } }], verify: (s) => check(!energised(s, 'relay'), 'valve relay off') },
    },
    (c) => c.digital('rain', 'rain_sensor', 27, {}, 'Rain').supply('ps', 24).relay('relay', [17], {}, 'Relay').load('valve', 'irrigation_valve', 'relay', 1, { vrated: 24 }, 'Zone valve'),
  ),
];
