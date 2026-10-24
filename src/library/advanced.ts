// Advanced integrated projects: several subsystems (sensing, control, display,
// logging, safety) working together in one program.
import type { Simulator } from '../engine/simulator';
import { check, ex, lit, running, vis, type Circuit, type LibExample } from './dsl';

const lcdLines = (s: Simulator, id: string): string[] => (s.device(id) as any)?.view?.().lines ?? [];

/** two DC motors on one L298N (left on OUT1/2, right on OUT3/4) */
const drive = (c: Circuit) =>
  c
    .l298n('drv', 23, 24, 5, 6)
    .part('left', 'dc_motor', { vrated: 12 }, 'Left wheel')
    .part('right', 'dc_motor', { vrated: 12 }, 'Right wheel')
    .w('drv.OUT1>left.P', 'drv.OUT2>left.N', 'drv.OUT3>right.P', 'drv.OUT4>right.N');

export const ADVANCED_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'adv-weather-station',
      cat: 'advanced',
      level: 'advanced',
      minutes: 45,
      title: ['Weather station with display and CSV log', 'محطة طقس مع شاشة وسجل CSV'],
      goal: ['Combine three sensors on two buses, a 20×4 display, a status LED and a data log into one station.', 'دمج ثلاثة حساسات على ناقلين مع شاشة 20×4 ومؤشر حالة وسجل بيانات في محطة واحدة.'],
      result: ['Every cycle the LCD shows temperature, humidity, pressure, light and rain; weather.csv gets one row per cycle.', 'في كل دورة تعرض الشاشة الحرارة والرطوبة والضغط والإضاءة والمطر، ويُضاف صف إلى weather.csv لكل دورة.'],
      tryIt: ['Wet the rain sensor (wetness 80 %) and watch line 4 of the LCD change to RAIN.', 'بلّل حساس المطر (نسبة البلل 80%) وراقب تغيّر السطر الرابع في الشاشة إلى RAIN.'],
      modify: ['Add the dew point (see the dew-point example) and a daily max/min.', 'أضف نقطة الندى (انظر مثال نقطة الندى) والقيم العظمى والصغرى اليومية.'],
      explain: ['The BME280 (0x76), BH1750 (0x23) and LCD backpack (0x27) share the I2C bus; the rain module is a plain GPIO input. One function builds the four LCD lines, another writes the CSV row.', 'يتشارك BME280 (0x76) وBH1750 (0x23) ولوحة الشاشة (0x27) ناقل I2C، أما وحدة المطر فمدخل GPIO عادي. تبني دالة الأسطر الأربعة للشاشة، وتكتب دالة أخرى صف CSV.'],
      code: `import csv, time, board, busio
from adafruit_bme280 import basic as adafruit_bme280
from RPLCD.i2c import CharLCD
from gpiozero import DigitalInputDevice, LED
from smartfarm import BH1750

bme = adafruit_bme280.Adafruit_BME280_I2C(busio.I2C(board.SCL, board.SDA), address=0x76)
light = BH1750()
rain = DigitalInputDevice(17)            # DO is LOW when wet
status = LED(27)
lcd = CharLCD("PCF8574", 0x27, cols=20, rows=4)

def measure():
    return {"temp": bme.temperature, "hum": bme.relative_humidity, "press": bme.pressure,
            "lux": light.read(), "rain": rain.value == 0}

def show(m):
    lines = [f"Temp {m['temp']:5.1f} C", f"Hum  {m['hum']:5.0f} %  {m['press']:6.1f}",
             f"Light {m['lux']:6.0f} lux", "RAIN" if m["rain"] else "dry"]
    for row, text in enumerate(lines):
        lcd.cursor_pos = (row, 0)
        lcd.write_string(f"{text:<20}"[:20])

with open("weather.csv", "w", newline="") as f:
    log = csv.writer(f)
    log.writerow(["cycle", "temp_c", "humidity", "pressure_hpa", "lux", "rain"])
    for n in range(1, 4):
        status.on()
        m = measure()
        show(m)
        log.writerow([n, round(m["temp"], 1), round(m["hum"]), round(m["press"], 1), round(m["lux"]), int(m["rain"])])
        print(f"cycle {n}: {m['temp']:.1f} C {m['hum']:.0f} % {m['press']:.0f} hPa {m['lux']:.0f} lux {'RAIN' if m['rain'] else 'dry'}")
        status.off()
        time.sleep(1.5)
with open("weather.csv") as f:
    print("rows logged:", len(f.readlines()) - 1)
`,
      test: {
        expect: /cycle 1: .* dry[\s\S]*cycle 3: .* RAIN[\s\S]*rows logged: 3/,
        seconds: 6,
        events: [{ at: 2, comp: 'rain', props: { wetness: 80 } }],
        verify: (s) => check(lcdLines(s, 'lcd')[3]?.startsWith('RAIN') ?? false, `LCD ${JSON.stringify(lcdLines(s, 'lcd'))}`),
      },
    },
    (c) =>
      c
        .i2c('bme', 'bme280', {}, 'BME280')
        .i2c('light', 'bh1750', {}, 'BH1750')
        .i2c5('lcd', 'lcd2004_i2c', { pullups: 'removed' }, 'LCD 20×4')
        .digital('rain', 'rain_sensor', 17, {}, 'Rain')
        .led('status', 27, 'green', 'Status'),
  ),
  ex(
    {
      id: 'adv-greenhouse-controller',
      cat: 'advanced',
      level: 'advanced',
      minutes: 60,
      title: ['Complete greenhouse controller', 'وحدة تحكم متكاملة للبيت المحمي'],
      goal: ['Run fan, heater, irrigation pump and grow light from climate and soil sensors, with a dry-tank safety interlock, an alarm and an LCD status line.', 'تشغيل المروحة والسخان ومضخة الري والإضاءة الزراعية حسب حساسات المناخ والتربة، مع قفل أمان لخزان فارغ وإنذار وسطر حالة على الشاشة.'],
      result: ['Hot and dry: the fan and pump run. When the tank float drops, the pump is blocked, the buzzer sounds and the LCD shows TANK EMPTY!.', 'عند الحر والجفاف تعمل المروحة والمضخة. وعندما تنخفض عوامة الخزان تُمنع المضخة ويرن الجرس وتعرض الشاشة TANK EMPTY!.'],
      tryIt: ['Set the SHT31 to 31 °C and the soil to 25 %, then drop the tank float level to 10 %.', 'اضبط SHT31 على 31 °م والتربة على 25%، ثم اخفض مستوى عوامة الخزان إلى 10%.'],
      modify: ['Log every change of an actuator to a CSV file with a time stamp.', 'سجّل كل تغيّر في أي مشغّل في ملف CSV مع الوقت.'],
      explain: ['All limits are in one dictionary. control() reads every sensor once, decides each output, and the interlock ("no water → no pump") overrides the soil rule. Four relay channels switch the 12 V loads.', 'جميع الحدود في قاموس واحد. تقرأ control() كل حساس مرة واحدة وتقرر كل مخرج، ويتغلب قفل الأمان ("لا ماء ← لا مضخة") على قاعدة التربة. وتشغّل أربع قنوات مرحل الأحمال بجهد 12 فولت.'],
      code: `import time, board, busio, adafruit_sht31d
from RPLCD.i2c import CharLCD
from gpiozero import Buzzer
from smartfarm import ADS1115, SoilMoisture, FloatSwitch, Fan, Pump, Heater, Relay

sht = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
soil = SoilMoisture(ADS1115(), 0)
tank = FloatSwitch(5)
fan, pump = Fan(17, active_high=False), Pump(27, active_high=False)
heater, light = Heater(22, active_high=False), Relay(23, active_high=False)
alarm = Buzzer(18)
lcd = CharLCD("PCF8574", 0x27, cols=16, rows=2)
LIMITS = {"fan_on": 28, "heat_on": 15, "dry": 35, "wet": 60}

def control():
    t, m, water = sht.temperature, soil.read(), tank.is_closed
    fan.value = t > LIMITS["fan_on"]
    heater.value = t < LIMITS["heat_on"]
    if not water or m > LIMITS["wet"]:
        pump.off()
    elif m < LIMITS["dry"]:
        pump.on()
    light.on()
    alarm.value = not water
    lcd.cursor_pos = (0, 0)
    lcd.write_string(f"{t:4.1f}C soil {m:3.0f}%".ljust(16)[:16])
    lcd.cursor_pos = (1, 0)
    lcd.write_string(("TANK EMPTY!" if not water else f"fan {'ON ' if fan.value else 'off'} pump {'ON ' if pump.value else 'off'}").ljust(16)[:16])
    return f"{t:.1f} C soil {m:.0f} % tank {'ok' if water else 'EMPTY'} -> fan {fan.value} pump {pump.value} heater {heater.value}"

last = None
for i in range(8):
    summary = control()
    if summary != last:
        print(summary)
        last = summary
    time.sleep(0.8)
`,
      test: {
        expect: /24\.0 C soil 5\d % tank ok -> fan 0 pump 0 heater 0[\s\S]*31\.0 C soil 2\d % tank ok -> fan 1 pump 1 heater 0[\s\S]*tank EMPTY -> fan 1 pump 0/,
        seconds: 8,
        events: [
          { at: 0, comp: 'sht', props: { temperature: 24, humidity: 60 } },
          { at: 0, comp: 'soil', props: { moisture: 50 } },
          { at: 1.5, comp: 'sht', props: { temperature: 31 } },
          { at: 1.5, comp: 'soil', props: { moisture: 25 } },
          { at: 3.5, comp: 'tank', props: { level: 10 } },
        ],
        verify: (s) => check(running(s, 'fan') && !running(s, 'pump') && !!vis(s, 'alarm').on && /TANK EMPTY!/.test(lcdLines(s, 'lcd')[1] ?? ''), `fan on, pump blocked, alarm on; LCD ${JSON.stringify(lcdLines(s, 'lcd'))}`),
      },
    },
    (c) =>
      c
        .i2c('sht', 'sht31', {}, 'SHT31')
        .i2c5('lcd', 'lcd1602_i2c', { pullups: 'removed' }, 'LCD 16×2')
        .analog('soil', 'soil_moisture', 0, { moisture: 50 }, 'Soil moisture')
        .contact('tank', 'float_switch', 5, { level: 90, trigger: 20 }, 'Tank float')
        .buzzer('alarm', 18)
        .supply('ps', 12, 20)
        .relay('relay', [17, 27, 22, 23], {}, 'Relay ×4')
        .load('fan', 'fan', 'relay', 1, {}, 'Fan')
        .load('pump', 'water_pump', 'relay', 2, {}, 'Pump')
        .load('heater', 'heater', 'relay', 3, {}, 'Heater')
        .load('light', 'grow_light', 'relay', 4, { watts: 12 }, 'Grow light'),
  ),
  ex(
    {
      id: 'adv-smart-door',
      cat: 'advanced',
      level: 'advanced',
      minutes: 45,
      title: ['Smart door: secret knock, lock and porch light', 'باب ذكي: طرقة سرية وقفل وإضاءة مدخل'],
      goal: ['Unlock a servo lock with a secret knock (three presses within 2 s), relock automatically once the door is closed, switch a porch light on motion and warn when the door is left open.', 'فتح قفل سيرفو بطرقة سرية (ثلاث ضغطات خلال ثانيتين)، وإعادة القفل تلقائياً بعد إغلاق الباب، وتشغيل إضاءة المدخل عند الحركة، والتحذير عند ترك الباب مفتوحاً.'],
      result: ['Motion lights the porch; the knock unlocks (green LED, servo at +90°); after the door opens and closes again it locks (red LED, servo at −90°).', 'تُضيء الحركة المدخل، وتفتح الطرقة القفل (LED أخضر وسيرفو عند +90°)، وبعد فتح الباب وإغلاقه يُقفل مجدداً (LED أحمر وسيرفو عند −90°).'],
      tryIt: ['Trigger the PIR, press the bell button three times quickly, then open (B) and close (A) the door contact.', 'شغّل PIR، واضغط زر الجرس ثلاث مرات بسرعة، ثم افتح الباب (B) وأغلقه (A).'],
      modify: ['Use a different rhythm (short-short-long) as the secret knock.', 'استخدم إيقاعاً مختلفاً (قصير-قصير-طويل) كطرقة سرية.'],
      explain: ['Each press is time-stamped; only the last three are kept and compared. A small state variable (locked / unlocked / open) decides what the door contact means.', 'تُسجّل كل ضغطة مع وقتها، ولا يُحتفظ إلا بآخر ثلاث للمقارنة. ومتغير حالة صغير (مقفل / مفتوح القفل / الباب مفتوح) يحدد معنى مفتاح الباب.'],
      code: `from gpiozero import Button, MotionSensor, LED, Buzzer, AngularServo, DigitalInputDevice
from time import monotonic, sleep

bell, pir = Button(17), MotionSensor(27)
door = DigitalInputDevice(13, pull_up=True)        # 1 = closed
lock = AngularServo(12, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
green, red, porch = LED(22), LED(23), LED(24)
beep = Buzzer(18)
knocks = []
state = "locked"

def set_lock(locked):
    lock.angle = -90 if locked else 90
    red.value, green.value = locked, not locked

def knock():
    global state
    knocks.append(monotonic())
    del knocks[:-3]
    beep.beep(0.05, 0.05, n=1)
    if state == "locked" and len(knocks) == 3 and knocks[-1] - knocks[0] < 2:
        state = "unlocked"
        set_lock(False)
        print("secret knock -> unlocked")

bell.when_pressed = knock
pir.when_motion = lambda: (porch.on(), print("motion -> porch light on"))
pir.when_no_motion = porch.off
set_lock(True)
print("door locked")
opened_at = None
for i in range(90):
    if state == "unlocked" and not door.value:
        state, opened_at = "open", monotonic()
        print("door opened")
    elif state == "open":
        if door.value:
            state = "locked"
            set_lock(True)
            print("door closed -> locked")
        elif monotonic() - opened_at > 3:
            beep.on()
    sleep(0.1)
beep.off()
`,
      test: {
        expect: /door locked[\s\S]*motion -> porch light on[\s\S]*secret knock -> unlocked[\s\S]*door opened[\s\S]*door closed -> locked/,
        seconds: 10,
        events: [
          { at: 0.5, comp: 'pir', props: { motion: true } },
          { at: 1.5, comp: 'bell', press: true },
          { at: 1.6, comp: 'bell', press: false },
          { at: 1.9, comp: 'bell', press: true },
          { at: 2.0, comp: 'bell', press: false },
          { at: 2.3, comp: 'bell', press: true },
          { at: 2.4, comp: 'bell', press: false },
          { at: 3.5, comp: 'door', props: { position: 'B' } },
          { at: 5, comp: 'door', props: { position: 'A' } },
        ],
        verify: (s) => check(lit(s, 'red') && !lit(s, 'green') && (vis(s, 'lock').angle ?? 0) < -60, `locked again: red ${lit(s, 'red')}, angle ${vis(s, 'lock').angle}`),
      },
    },
    (c) =>
      c
        .button('bell', 17, 'Bell / knock')
        .pir('pir', 27, { hold: 2 })
        .part('door', 'switch', { position: 'A' }, 'Door contact')
        .w('door.COM>pi.P33', `door.A>${c.gnd()}`)
        .servo('lock', 12, 'sg90')
        .led('green', 22, 'green', 'Unlocked')
        .led('red', 23, 'red', 'Locked')
        .led('porch', 24, 'white', 'Porch light')
        .buzzer('beep', 18),
  ),
  ex(
    {
      id: 'adv-aquarium',
      cat: 'advanced',
      level: 'advanced',
      minutes: 50,
      title: ['Aquarium life-support controller', 'وحدة تحكم لدعم الحياة في حوض السمك'],
      goal: ['Keep the water temperature with a heater, run the filter pump only when the water level is safe, watch dissolved solids, feed the fish with a servo and set the light colour.', 'المحافظة على حرارة الماء بسخان، وتشغيل مضخة الفلتر فقط عندما يكون مستوى الماء آمناً، ومراقبة الأملاح الذائبة، وإطعام السمك بسيرفو، وضبط لون الإضاءة.'],
      result: ['Cold water switches the heater on and the light turns blue; at 26 °C the heater stops. A low water level stops the filter pump and turns the light red.', 'الماء البارد يشغّل السخان ويحوّل الإضاءة إلى الأزرق، وعند 26 °م يتوقف السخان. وانخفاض مستوى الماء يوقف مضخة الفلتر ويحوّل الإضاءة إلى الأحمر.'],
      tryIt: ['Change the DS18B20 temperature to 26 °C, then drop the float level to 10 %.', 'غيّر حرارة DS18B20 إلى 26 °م، ثم اخفض مستوى العوامة إلى 10%.'],
      modify: ['Warn (yellow light) when TDS rises above 400 ppm and log it.', 'نبّه (إضاءة صفراء) عندما يتجاوز TDS قيمة 400 ppm وسجّل ذلك.'],
      explain: ['The TDS reading is corrected with the probe temperature (the conductivity of water rises about 2 % per °C). The 8 NeoPixels show the system state at a glance: blue heating, green normal, red fault.', 'تُصحّح قراءة TDS بحرارة المجس (تزداد موصلية الماء بنحو 2% لكل درجة). وتعرض وحدات NeoPixel الثماني حالة النظام بنظرة: أزرق للتسخين وأخضر للوضع الطبيعي وأحمر للعطل.'],
      code: `import time, board, neopixel
from gpiozero import AngularServo
from w1thermsensor import W1ThermSensor
from smartfarm import ADS1115, TDSSensor, FloatSwitch, Heater, Pump

probe = W1ThermSensor()
tds = TDSSensor(ADS1115(), 0)
level = FloatSwitch(5)
heater, filt = Heater(17, active_high=False), Pump(27, active_high=False)
feeder = AngularServo(13, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
pixels = neopixel.NeoPixel(board.D18, 8, brightness=0.5)
TARGET, BAND = 25.0, 0.5

feeder.angle = 90; time.sleep(0.4); feeder.angle = -90
print("fed the fish")
last = None
for i in range(10):
    t = probe.get_temperature()
    tds.temperature = t
    ppm = tds.read()
    if t < TARGET - BAND:
        heater.on()
    elif t > TARGET + BAND:
        heater.off()
    water_ok = level.is_closed
    filt.value = water_ok
    colour, state = ((255, 0, 0), "LOW WATER") if not water_ok else ((0, 0, 255), "heating") if heater.value else ((0, 255, 0), "normal")
    pixels.fill(colour)
    line = f"{t:.1f} C, TDS {ppm:.0f} ppm -> {state}, filter {'on' if water_ok else 'OFF'}"
    if line != last:
        print(line)
        last = line
    time.sleep(0.5)
`,
      test: {
        expect: /fed the fish[\s\S]*22\.0 C, TDS \d+ ppm -> heating, filter on[\s\S]*26\.0 C, TDS \d+ ppm -> normal, filter on[\s\S]*-> LOW WATER, filter OFF/,
        seconds: 7,
        events: [
          { at: 0, comp: 'probe', props: { temperature: 22 } },
          { at: 1.8, comp: 'probe', props: { temperature: 26 } },
          { at: 3.5, comp: 'level', props: { level: 10 } },
        ],
        verify: (s) => check(!running(s, 'filter') && !running(s, 'heater') && (vis(s, 'strip').pixels?.[0]?.[0] ?? 0) > 50, `filter off, heater off, red light: ${JSON.stringify(vis(s, 'strip').pixels?.[0])}`),
      },
    },
    (c) =>
      c
        .ds18b20('probe', { temperature: 22 })
        .analog('tds', 'tds_sensor', 0, { tds: 250 }, 'TDS probe')
        .contact('level', 'float_switch', 5, { level: 90, trigger: 30 }, 'Water level')
        .servo('feeder', 13, 'sg90')
        .part('strip', 'ws2812_strip', { count: 8 }, 'Tank light ×8')
        .w('strip.DIN>pi.P12', `strip.VCC>${c.v50()}`, `strip.GND>${c.gnd()}`)
        .supply('ps', 12, 10)
        .relay('relay', [17, 27], {}, 'Relay ×2')
        .load('heater', 'heater', 'relay', 1, {}, 'Heater')
        .load('filter', 'water_pump', 'relay', 2, {}, 'Filter pump'),
  ),
  ex(
    {
      id: 'adv-robot-patrol',
      cat: 'advanced',
      level: 'advanced',
      minutes: 50,
      title: ['Security patrol robot', 'روبوت دورية أمنية'],
      goal: ['Drive a patrol, stop at obstacles, look left and right with a servo-mounted sonar to choose the clearer side, and raise an alarm when the PIR sees an intruder.', 'قيادة دورية والتوقف عند العوائق والنظر يميناً ويساراً بسونار مثبت على سيرفو لاختيار الجهة الأوسع، وإطلاق إنذار عندما يرى PIR متسللاً.'],
      result: ['The robot patrols, scans when blocked, turns toward the clearer side and continues; motion stops it with the siren and the warning LED on.', 'يقوم الروبوت بالدورية، ويمسح عند وجود عائق، وينعطف نحو الجهة الأوسع ويتابع، والحركة توقفه مع تشغيل الصفارة والـ LED التحذيري.'],
      tryIt: ['Set the sonar distance to 15 cm, then back to 120 cm; finally trigger the PIR.', 'اضبط مسافة السونار على 15 سم ثم أعدها إلى 120 سم، ثم شغّل PIR في النهاية.'],
      modify: ['Return to patrolling 5 s after the intruder has gone.', 'عُد إلى الدورية بعد 5 ثوانٍ من مغادرة المتسلل.'],
      explain: ['The program is a loop of behaviours with priorities: intruder > obstacle > patrol. scan() points the servo, waits for it to settle and measures each side.', 'البرنامج حلقة سلوكيات بأولويات: المتسلل أولاً ثم العائق ثم الدورية. توجّه scan() السيرفو وتنتظر استقراره ثم تقيس كل جهة.'],
      code: `from gpiozero import Motor, DistanceSensor, AngularServo, MotionSensor, Buzzer, LED
from time import sleep

left, right = Motor(23, 24), Motor(5, 6)
sonar = DistanceSensor(echo=27, trigger=17, max_distance=2)
neck = AngularServo(12, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
pir, siren, warn = MotionSensor(22), Buzzer(18), LED(25)

def stop():
    left.stop(); right.stop()

def scan():
    found = {}
    for side, angle in (("left", 60), ("right", -60)):
        neck.angle = angle
        sleep(0.3)
        found[side] = sonar.distance
    neck.angle = 0
    return found

neck.angle = 0
print("patrol started")
for i in range(40):
    if pir.motion_detected:
        stop(); siren.on(); warn.on()
        print("INTRUDER detected -> stopped, alarm on")
        break
    if sonar.distance < 0.3:
        stop()
        sides = scan()
        best = max(sides, key=sides.get)
        print(f"obstacle at {sonar.distance * 100:.0f} cm -> scan {sides['left'] * 100:.0f}/{sides['right'] * 100:.0f} cm -> turn {best}")
        (left.backward if best == "left" else left.forward)(0.6)
        (right.forward if best == "left" else right.backward)(0.6)
        sleep(0.4)
    left.forward(0.7); right.forward(0.7)
    sleep(0.15)
sleep(0.5)
`,
      test: {
        expect: /patrol started[\s\S]*obstacle at 15 cm -> scan 15\/15 cm -> turn left[\s\S]*INTRUDER detected -> stopped, alarm on/,
        seconds: 8,
        events: [
          { at: 1.2, comp: 'us', props: { distance: 15 } },
          { at: 2.4, comp: 'us', props: { distance: 120 } },
          { at: 4.5, comp: 'pir', props: { motion: true } },
        ],
        verify: (s) => check(!running(s, 'left') && !running(s, 'right') && !!vis(s, 'siren').on && lit(s, 'warn'), 'motors stopped, siren and warning LED on'),
      },
    },
    (c) => drive(c).ultrasonic('us', 17, 27, { distance: 120 }).servo('neck', 12, 'sg90').pir('pir', 22).buzzer('siren', 18).led('warn', 25, 'red', 'Warning'),
  ),
];
