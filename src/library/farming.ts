// Smart farming: irrigation, nutrients, climate, light, water and soil.
import { check, energised, ex, lit, running, type LibExample } from './dsl';

export const FARMING_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'farm-soil-irrigation',
      cat: 'farming',
      level: 'beginner',
      minutes: 20,
      title: ['Soil-moisture irrigation', 'الري حسب رطوبة التربة'],
      goal: ['Water a plant automatically from a capacitive soil-moisture reading.', 'ري نبتة تلقائياً اعتماداً على قراءة حساس رطوبة التربة السعوي.'],
      result: ['Below 35 % the pump starts; at 60 % it stops.', 'تحت 35% تبدأ المضخة، وعند 60% تتوقف.'],
      tryIt: ['Set the soil moisture to 25 %, then to 65 %.', 'اضبط رطوبة التربة على 25% ثم على 65%.'],
      modify: ['Limit watering to a maximum of 10 s per cycle.', 'حدّد الري بعشر ثوانٍ كحد أقصى لكل دورة.'],
      explain: ['Two thresholds (35 % on, 60 % off) avoid switching the pump on and off repeatedly.', 'حدّان (35% للتشغيل و60% للإيقاف) يمنعان تشغيل المضخة وإيقافها بشكل متكرر.'],
      code: `from smartfarm import ADS1115, SoilMoisture, Pump
from time import sleep

soil = SoilMoisture(ADS1115(), 0)
pump = Pump(17, active_high=False)
while True:                      # runs until you press Stop
    m = soil.read()
    if m < 35 and not pump.is_on:
        pump.on(); print(f"soil {m:.0f} % -> watering")
    elif m > 60 and pump.is_on:
        pump.off(); print(f"soil {m:.0f} % -> stop")
    sleep(0.5)
`,
      test: {
        expect: /soil 2\d % -> watering[\s\S]*soil 6\d % -> stop/,
        seconds: 6,
        events: [
          { at: 0.8, comp: 'soil', props: { moisture: 25 } },
          { at: 2.5, comp: 'soil', props: { moisture: 65 } },
        ],
        verify: (s) => check(!running(s, 'pump'), 'pump off'),
      },
    },
    (c) => c.analog('soil', 'soil_moisture', 0, {}, 'Soil moisture').supply().relay('relay', [17], {}, 'Relay').load('pump', 'water_pump', 'relay', 1, {}, 'Pump'),
  ),
  ex(
    {
      id: 'farm-ph-ec-check',
      cat: 'farming',
      level: 'intermediate',
      minutes: 20,
      title: ['Nutrient solution check (pH + EC)', 'فحص المحلول المغذي (pH وEC)'],
      goal: ['Read two analog probes on one ADC and compare them with crop targets.', 'قراءة مجسين تناظريين على محول ADC واحد ومقارنتهما بأهداف المحصول.'],
      result: ['pH and EC are printed with "OK", "too low" or "too high" for lettuce.', 'تُطبع قيمتا pH وEC مع الحالة: مناسب أو منخفض أو مرتفع لنبات الخس.'],
      tryIt: ['Set pH to 7.4 and EC to 0.6 while it runs.', 'اضبط pH على 7.4 وEC على 0.6 أثناء التشغيل.'],
      modify: ['Add targets for tomato (pH 5.8–6.3, EC 2.0–3.5) and select the crop.', 'أضف أهداف الطماطم (pH بين 5.8 و6.3 وEC بين 2.0 و3.5) واختر المحصول.'],
      explain: ['Channel 0 is pH and channel 1 is EC; a dict of (min, max) ranges keeps the targets in one place.', 'القناة 0 لـ pH والقناة 1 لـ EC، ويحفظ قاموس من نطاقات (أدنى، أعلى) الأهداف في مكان واحد.'],
      code: `from smartfarm import ADS1115, PHSensor, ECSensor
from time import sleep

adc = ADS1115()
ph, ec = PHSensor(adc, 0), ECSensor(adc, 1, temperature=25)
TARGET = {"pH": (5.5, 6.5), "EC": (0.8, 1.6)}      # lettuce

def grade(name, value):
    lo, hi = TARGET[name]
    return "too low" if value < lo else "too high" if value > hi else "OK"

while True:                      # runs until you press Stop
    p, e = ph.read(), ec.read()
    print(f"pH {p:.2f} {grade('pH', p):8s}  EC {e:.2f} mS/cm {grade('EC', e)}")
    sleep(1.2)
`,
      test: { expect: /pH 6\.2\d OK\s+EC 1\.2\d mS\/cm OK[\s\S]*pH 7\.\d\d too high\s+EC 0\.6\d mS\/cm too low/, seconds: 5, events: [{ at: 1.5, comp: 'ph', props: { ph: 7.4 } }, { at: 1.5, comp: 'ec', props: { ec: 0.6 } }] },
    },
    (c) => c.analog('ph', 'ph_sensor', 0, {}, 'pH probe').analog('ec', 'ec_sensor', 1, {}, 'EC probe'),
  ),
  ex(
    {
      id: 'farm-photoperiod-light',
      cat: 'farming',
      level: 'beginner',
      minutes: 15,
      title: ['Grow-light photoperiod (18/6)', 'دورة الإضاءة الزراعية (18/6)'],
      goal: ['Switch a grow light from the clock: on from 06:00 to 24:00.', 'تشغيل إضاءة النمو حسب الساعة: من 06:00 حتى 24:00.'],
      result: ['The schedule is checked for a few hours of the day; then the light follows the clock (checked every second) until you press Stop, and every switch is printed.', 'يُفحص الجدول لعدة ساعات من اليوم، ثم تتبع الإضاءة الساعة (تُفحص كل ثانية) حتى تضغط إيقاف، ويُطبع كل تبديل.'],
      tryIt: ['Use the ⏩ fast-forward button to jump past midnight and run again.', 'استخدم زر التقديم السريع ⏩ لتجاوز منتصف الليل ثم شغّل مجدداً.'],
      modify: ['Change to a 12/12 flowering schedule.', 'غيّر الجدول إلى 12/12 لمرحلة الإزهار.'],
      explain: ['One function decides from the hour; testing it on fixed hours first proves the schedule without waiting a whole day. A MOSFET dims the 12 V LED panel.', 'دالة واحدة تقرر حسب الساعة، واختبارها على ساعات ثابتة أولاً يثبت صحة الجدول دون انتظار يوم كامل. ويتحكم MOSFET بلوحة LED بجهد 12 فولت.'],
      code: `from datetime import datetime
from smartfarm import GrowLight
from time import sleep

ON_HOUR, OFF_HOUR = 6, 24

def light_on(hour):
    return ON_HOUR <= hour < OFF_HOUR

print("schedule:", ", ".join(f"{h:02d}:00 {'ON' if light_on(h) else 'off'}" for h in (0, 5, 6, 12, 23)))
light = GrowLight(18)
state = None
while True:                      # runs until you press Stop
    now = datetime.now()
    on = light_on(now.hour)
    if on != state:
        light.on(1.0) if on else light.off()
        print(f"now {now:%H:%M} -> grow light {'ON' if on else 'off'}")
        state = on
    sleep(1)
`,
      test: { expect: /schedule: 00:00 off, 05:00 off, 06:00 ON, 12:00 ON, 23:00 ON\s+now \d\d:\d\d -> grow light (ON|off)/, seconds: 3 },
    },
    (c) => c.mosfetLoad('light', 'grow_light', 18, {}, 'Grow light', false),
  ),
  ex(
    {
      id: 'farm-greenhouse-climate',
      cat: 'farming',
      level: 'intermediate',
      minutes: 25,
      title: ['Greenhouse climate: fan and humidifier', 'مناخ البيت المحمي: مروحة ومرطّب'],
      goal: ['Control two actuators from one climate sensor with separate rules.', 'التحكم بمشغلين من حساس مناخ واحد بقواعد منفصلة.'],
      result: ['Above 28 °C the fan runs; below 50 % RH the humidifier runs.', 'فوق 28 °م تعمل المروحة، وتحت 50% رطوبة يعمل المرطّب.'],
      tryIt: ['Set the SHT31 to 24 °C and 60 % RH, then to 31 °C and 40 %.', 'اضبط SHT31 على 24 °م و60% رطوبة ثم على 31 °م و40%.'],
      modify: ['Do not humidify while the fan is running (they work against each other).', 'لا تشغّل المرطّب أثناء عمل المروحة (فهما يعملان ضد بعضهما).'],
      explain: ['Each actuator has its own condition; relay channels 1 and 2 switch the 12 V and 5 V loads.', 'لكل مشغل شرطه الخاص، وتشغّل قناتا المرحل 1 و2 الحمولتين.'],
      code: `import time, board, busio, adafruit_sht31d
from smartfarm import Fan, Humidifier

sht = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
fan, mist = Fan(17, active_high=False), Humidifier(27, active_high=False)
while True:                      # runs until you press Stop
    t, rh = sht.temperature, sht.relative_humidity
    fan.value = t > 28
    mist.value = rh < 50
    print(f"{t:.1f} °C {rh:.0f} % -> fan {'ON' if t > 28 else 'off'}, humidifier {'ON' if rh < 50 else 'off'}")
    time.sleep(1)
`,
      test: {
        expect: /24\.0 °C 60 % -> fan off, humidifier off[\s\S]*31\.0 °C 40 % -> fan ON, humidifier ON/,
        seconds: 5,
        events: [
          { at: 0.5, comp: 'sht', props: { temperature: 24, humidity: 60 } },
          { at: 2.5, comp: 'sht', props: { temperature: 31, humidity: 40 } },
        ],
        verify: (s) => check(running(s, 'fan') && running(s, 'mist'), 'fan and humidifier must really run'),
      },
    },
    (c) => c.i2c('sht', 'sht31', {}, 'SHT31').supply().relay('relay', [17, 27], {}, 'Relay ×2').load('fan', 'fan', 'relay', 1, {}, 'Fan').load('mist', 'humidifier', 'relay', 2, { vrated: 12 }, 'Humidifier'),
  ),
  ex(
    {
      id: 'farm-ec-dosing',
      cat: 'farming',
      level: 'advanced',
      minutes: 30,
      title: ['EC-controlled nutrient dosing', 'جرعات المغذيات حسب EC'],
      goal: ['Dose nutrient in small, measured amounts until the EC target is reached.', 'إضافة المغذيات بجرعات صغيرة محسوبة حتى الوصول إلى هدف EC.'],
      result: ['Below the target the pump doses 2 ml and waits for mixing; once EC reaches 1.2 mS/cm dosing stops, and it doses again whenever EC falls. It keeps controlling until you press Stop.', 'تحت الهدف تضخ المضخة 2 مل وتنتظر الخلط، وعند وصول EC إلى 1.2 mS/cm يتوقف الحقن، ويُعاد الحقن كلما انخفضت الموصلية. ويستمر التحكم حتى تضغط إيقاف.'],
      tryIt: ['Start with EC 0.8; raise it to 1.3 after the first dose (as if the dose mixed in).', 'ابدأ بـ EC يساوي 0.8، وارفعه إلى 1.3 بعد الجرعة الأولى (كأن الجرعة اختلطت).'],
      modify: ['Stop after 5 doses even if the target is not reached (safety limit).', 'توقف بعد 5 جرعات حتى لو لم يُبلغ الهدف (حد أمان).'],
      explain: ['DosingPump turns millilitres into run time from its calibrated flow (100 ml/min → 1.2 s for 2 ml).', 'تحوّل DosingPump المليلترات إلى زمن تشغيل حسب تدفقها المعاير (100 مل/دقيقة تعني 1.2 ثانية لكل 2 مل).'],
      code: `from smartfarm import ADS1115, ECSensor, DosingPump
from time import sleep

ec = ECSensor(ADS1115(), 0, temperature=25)
pump_a = DosingPump(17, flow_ml_per_min=100)
TARGET = 1.2
doses = 0
while True:                      # runs until you press Stop
    value = ec.read()
    if value < TARGET:
        print(f"EC {value:.2f} mS/cm")
        pump_a.dose(2); doses += 1
        print("dosed 2 ml")
    elif doses:
        print(f"EC {value:.2f} mS/cm")
        print("target reached after", doses, "dose(s)")
        doses = 0
    sleep(1.5)                   # let it mix
`,
      test: { expect: /EC 0\.8\d[\s\S]*dosed 2 ml[\s\S]*EC 1\.3\d[\s\S]*target reached after 1 dose/, seconds: 8, events: [{ at: 2, comp: 'ec', props: { ec: 1.3 } }], verify: (s) => check(!energised(s, 'relay'), 'dosing pump off') },
    },
    (c) => c.analog('ec', 'ec_sensor', 0, { ec: 0.8 }, 'EC probe').supply().relay('relay', [17], {}, 'Relay').load('dose', 'dosing_pump', 'relay', 1, {}, 'Dosing pump A'),
  ),
  ex(
    {
      id: 'farm-tank-level-refill',
      cat: 'farming',
      level: 'intermediate',
      minutes: 25,
      title: ['Reservoir level by ultrasound with auto refill', 'مستوى الخزان بالموجات فوق الصوتية مع إعادة الملء'],
      goal: ['Convert an ultrasonic distance into a fill percentage and open a refill valve.', 'تحويل مسافة الموجات فوق الصوتية إلى نسبة امتلاء وفتح صمام إعادة الملء.'],
      result: ['The tank level is printed; below 30 % the refill valve opens, above 90 % it closes.', 'يُطبع مستوى الخزان، وتحت 30% يُفتح صمام الملء، وفوق 90% يُغلق.'],
      tryIt: ['Set the sensor distance to 80 cm (low), then 15 cm (almost full).', 'اضبط مسافة الحساس على 80 سم (منخفض) ثم 15 سم (شبه ممتلئ).'],
      modify: ['Print the volume in litres for a 100 L tank.', 'اطبع الحجم باللترات لخزان سعته 100 لتر.'],
      explain: ['The sensor sits on top: level % = (empty distance − measured) / (empty − full) × 100.', 'يوضع الحساس في الأعلى: النسبة = (مسافة الفراغ − المسافة المقاسة) ÷ (مسافة الفراغ − مسافة الامتلاء) × 100.'],
      code: `from gpiozero import DistanceSensor
from smartfarm import Valve
from time import sleep

sensor = DistanceSensor(echo=24, trigger=23, max_distance=2)
valve = Valve(17, active_high=False)
EMPTY, FULL = 100, 10          # cm from the sensor
while True:                      # runs until you press Stop
    d = sensor.distance * 100
    level = max(0, min(100, (EMPTY - d) / (EMPTY - FULL) * 100))
    if level < 30 and not valve.is_on:
        valve.on(); print(f"level {level:.0f} % -> refill ON")
    elif level > 90 and valve.is_on:
        valve.off(); print(f"level {level:.0f} % -> refill OFF")
    sleep(0.4)
`,
      test: {
        expect: /level 22 % -> refill ON[\s\S]*level 94 % -> refill OFF/,
        seconds: 5,
        events: [
          { at: 0.6, comp: 'us', props: { distance: 80 } },
          { at: 2.2, comp: 'us', props: { distance: 15 } },
        ],
        verify: (s) => check(!running(s, 'valve'), 'refill valve closed'),
      },
    },
    (c) => c.ultrasonic('us', 23, 24, { distance: 50 }).supply().relay('relay', [17], {}, 'Relay').load('valve', 'solenoid_valve', 'relay', 1, {}, 'Refill valve'),
  ),
  ex(
    {
      id: 'farm-solution-temperature',
      cat: 'farming',
      level: 'beginner',
      minutes: 15,
      title: ['Nutrient solution temperature bands', 'نطاقات حرارة المحلول المغذي'],
      goal: ['Classify the root-zone water temperature into three bands with LEDs.', 'تصنيف حرارة ماء منطقة الجذور إلى ثلاثة نطاقات باستخدام LEDs.'],
      result: ['Blue below 18 °C, green 18–24 °C, red above 24 °C (low oxygen risk).', 'أزرق تحت 18 °م، وأخضر بين 18 و24 °م، وأحمر فوق 24 °م (خطر نقص الأكسجين).'],
      tryIt: ['Change the probe temperature to 16 °C and then 27 °C.', 'غيّر حرارة المجس إلى 16 ثم 27 °م.'],
      modify: ['Switch a chiller relay in the red band.', 'شغّل مرحل المبرد في النطاق الأحمر.'],
      explain: ['Warm water holds less dissolved oxygen, so roots suffer above about 24 °C.', 'الماء الدافئ يحمل أكسجيناً مذاباً أقل، لذا تتضرر الجذور فوق نحو 24 °م.'],
      code: `from w1thermsensor import W1ThermSensor
from gpiozero import LEDBoard
from time import sleep

probe = W1ThermSensor()
bands = LEDBoard(cold=17, ok=27, warm=22)
while True:                      # runs until you press Stop
    t = probe.get_temperature()
    band = "cold" if t < 18 else "warm" if t > 24 else "ok"
    bands.value = (band == "cold", band == "ok", band == "warm")
    print(f"solution {t:.1f} °C -> {band}")
    sleep(1)
`,
      test: {
        expect: /16\.0 °C -> cold[\s\S]*27\.0 °C -> warm/,
        seconds: 5,
        events: [
          { at: 0.5, comp: 'probe', props: { temperature: 16 } },
          { at: 2.5, comp: 'probe', props: { temperature: 27 } },
        ],
        verify: (s) => check(lit(s, 'warm') && !lit(s, 'ok'), 'red band'),
      },
    },
    (c) => c.ds18b20('probe').led('cold', 17, 'blue', 'Cold').led('ok', 27, 'green', 'OK').led('warm', 22, 'red', 'Warm'),
  ),
  ex(
    {
      id: 'farm-volume-watering',
      cat: 'farming',
      level: 'advanced',
      minutes: 30,
      title: ['Water by volume with a flow meter', 'الري بالحجم باستخدام عدّاد التدفق'],
      goal: ['Count flow-meter pulses to deliver an exact volume of water.', 'عدّ نبضات عدّاد التدفق لإيصال حجم ماء محدد بدقة.'],
      result: ['The valve opens until the flow meter has counted 0.5 L, closes and waters again 10 s later; every watering is printed until you press Stop.', 'يُفتح الصمام حتى يعد مقياس التدفق 0.5 لتر ثم يُغلق، ويروي مجدداً بعد 10 ثوانٍ، وتُطبع كل رية حتى تضغط إيقاف.'],
      tryIt: ['Watch the delivered volume rise in steps.', 'راقب ارتفاع الحجم المُسلّم خطوة بخطوة.'],
      modify: ['Raise an alarm if no pulses arrive within 2 s (empty pipe).', 'أطلق إنذاراً إذا لم تصل نبضات خلال ثانيتين (أنبوب فارغ).'],
      explain: ['YF-S201: about 7.5 pulses per second per L/min (450 pulses per litre). when_activated counts each pulse.', 'العداد YF-S201 يعطي نحو 7.5 نبضة في الثانية لكل لتر/دقيقة (450 نبضة لكل لتر)، وتعدّ when_activated كل نبضة.'],
      code: `from gpiozero import DigitalInputDevice
from smartfarm import Valve
from time import sleep

flow = DigitalInputDevice(27)
valve = Valve(17, active_high=False)
PULSES_PER_LITRE = 450
pulses = 0

def tick():
    global pulses
    pulses += 1

flow.when_activated = tick
watering = 0
while True:                      # runs until you press Stop
    watering += 1
    pulses = 0
    valve.on()
    while pulses / PULSES_PER_LITRE < 0.5:
        print(f"watering {watering}: delivered {pulses / PULSES_PER_LITRE:.2f} L")
        sleep(1)
    valve.off()
    print(f"done: {pulses / PULSES_PER_LITRE:.2f} L - next watering in 10 s")
    sleep(10)
`,
      test: { expect: /done: 0\.5\d L/, seconds: 12, verify: (s) => check(!running(s, 'valve'), 'valve closed between waterings') },
    },
    (c) => c.part('flow', 'flow_sensor', { flow: 6 }, 'Flow meter').w(`flow.VCC>${c.v33()}`, `flow.GND>${c.gnd()}`, 'flow.SIG>pi.P13').supply().relay('relay', [17], {}, 'Relay').load('valve', 'solenoid_valve', 'relay', 1, {}, 'Valve'),
  ),
  ex(
    {
      id: 'farm-co2-enrichment',
      cat: 'farming',
      level: 'intermediate',
      minutes: 20,
      title: ['CO₂ enrichment valve', 'صمام إثراء CO₂'],
      goal: ['Keep greenhouse CO₂ between 800 and 1000 ppm with a gas valve.', 'الحفاظ على CO₂ في البيت المحمي بين 800 و1000 جزء بالمليون بصمام غاز.'],
      result: ['Below 800 ppm the CO₂ valve opens; above 1000 ppm it closes.', 'تحت 800 جزء بالمليون يُفتح صمام CO₂، وفوقها 1000 يُغلق.'],
      tryIt: ['Set the SCD30 to 600 ppm, then to 1100 ppm.', 'اضبط SCD30 على 600 ثم على 1100 جزء بالمليون.'],
      modify: ['Never enrich while the vent fan is running.', 'لا تُثرِ الهواء بالغاز أثناء عمل مروحة التهوية.'],
      explain: ['Plants use more CO₂ in light; a hysteresis band avoids rapid valve cycling.', 'تستهلك النباتات CO₂ أكثر في الضوء، ونطاق الهامش يمنع تبديل الصمام بسرعة.'],
      code: `import time, board, busio, adafruit_scd30
from smartfarm import Valve

scd = adafruit_scd30.SCD30(busio.I2C(board.SCL, board.SDA))
gas = Valve(17, active_high=False)
while True:                      # runs until you press Stop
    while not scd.data_available:
        time.sleep(0.5)
    co2 = scd.CO2
    if co2 < 800 and not gas.is_on:
        gas.on(); print(f"{co2:.0f} ppm -> CO2 valve OPEN")
    elif co2 > 1000 and gas.is_on:
        gas.off(); print(f"{co2:.0f} ppm -> CO2 valve closed")
    else:
        print(f"{co2:.0f} ppm")
`,
      test: {
        expect: /600 ppm -> CO2 valve OPEN[\s\S]*1100 ppm -> CO2 valve closed/,
        seconds: 10,
        events: [
          { at: 0.5, comp: 'scd', props: { co2: 600 } },
          { at: 4, comp: 'scd', props: { co2: 1100 } },
        ],
        verify: (s) => check(!running(s, 'gas'), 'valve closed'),
      },
    },
    (c) => c.i2c('scd', 'scd30', {}, 'SCD30').supply().relay('relay', [17], {}, 'Relay').load('gas', 'solenoid_valve', 'relay', 1, {}, 'CO₂ valve'),
  ),
  ex(
    {
      id: 'farm-npk-advisor',
      cat: 'farming',
      level: 'advanced',
      minutes: 25,
      title: ['Soil NPK fertiliser advisor', 'مستشار الأسمدة حسب NPK في التربة'],
      goal: ['Read N, P and K from an RS-485 soil probe and suggest which nutrient is missing.', 'قراءة النيتروجين والفوسفور والبوتاسيوم من مجس تربة RS-485 واقتراح العنصر الناقص.'],
      result: ['Every 3 s the probe is read: the N, P and K values and a fertiliser advice are printed, until you press Stop.', 'كل 3 ثوانٍ يُقرأ المجس وتُطبع قيم N وP وK مع نصيحة التسميد، حتى تضغط إيقاف.'],
      tryIt: ['While it runs, raise phosphorus (P) above 25 mg/kg on the probe and watch the advice change.', 'أثناء التشغيل ارفع الفوسفور (P) فوق 25 ملغم/كغ في المجس وراقب تغيّر النصيحة.'],
      modify: ['Average three readings before advising.', 'خذ متوسط ثلاث قراءات قبل تقديم النصيحة.'],
      explain: ['smartfarm.ModbusSoilSensor reads the registers over Modbus RTU; a minimum level per nutrient decides the advice.', 'تقرأ ModbusSoilSensor السجلات عبر Modbus RTU، ويحدد حد أدنى لكل عنصر النصيحة.'],
      code: `from time import sleep
from smartfarm import ModbusSoilSensor

probe = ModbusSoilSensor(baud=9600)
MINIMUM = {"n": 30, "p": 25, "k": 40}
NAMES = {"n": "nitrogen", "p": "phosphorus", "k": "potassium"}
while True:                      # runs until you press Stop
    r = probe.read()
    print(f"N {r['n']}  P {r['p']}  K {r['k']} mg/kg")
    missing = [NAMES[x] for x in "npk" if r[x] < MINIMUM[x]]
    print("advice:", "add " + " and ".join(missing) if missing else "no fertiliser needed")
    sleep(3)
`,
      test: { expect: /N 40\s+P 20\s+K 60 mg\/kg[\s\S]*advice: add phosphorus[\s\S]*P 30[\s\S]*advice: no fertiliser needed/, seconds: 4, events: [{ at: 1, comp: 'soil', props: { p: 30 } }] },
    },
    (c) =>
      c
        .supply()
        .part('xcvr', 'max485', { auto: true }, 'MAX485')
        .part('soil', 'rs485_soil', {}, 'NPK probe')
        .w(`xcvr.VCC>${c.v33()}`, `xcvr.GND>${c.gnd()}`, 'xcvr.TX>pi.P10', 'xcvr.RX>pi.P8', 'xcvr.A>soil.A', 'xcvr.B>soil.B', 'soil.VCC>ps.P', 'soil.GND>ps.N'),
  ),
  ex(
    {
      id: 'farm-frost-protection',
      cat: 'farming',
      level: 'beginner',
      minutes: 15,
      title: ['Frost protection for seedlings', 'حماية الشتلات من الصقيع'],
      goal: ['Switch on a heater and a warning light when the temperature approaches freezing.', 'تشغيل مدفأة وضوء تحذير عندما تقترب الحرارة من التجمد.'],
      result: ['At 2 °C or below the heater and the frost light switch on.', 'عند 2 °م أو أقل تعمل المدفأة ويضيء ضوء الصقيع.'],
      tryIt: ['Lower the DHT22 temperature to 1 °C while it runs.', 'خفّض حرارة DHT22 إلى 1 °م أثناء التشغيل.'],
      modify: ['Keep the heater on until 5 °C (hysteresis).', 'أبقِ المدفأة تعمل حتى 5 °م (هامش تبديل).'],
      explain: ['The DHT22 measures down to −40 °C; a single threshold drives both outputs.', 'يقيس DHT22 حتى −40 °م، وحد واحد يتحكم بالمخرجين معاً.'],
      code: `import time, board, adafruit_dht
from smartfarm import Heater
from gpiozero import LED

dht = adafruit_dht.DHT22(board.D4)
heater, frost = Heater(17, active_high=False), LED(27)
while True:                      # runs until you press Stop
    try:
        t = dht.temperature
    except RuntimeError:
        continue
    danger = t <= 2
    heater.value = frost.value = danger
    print(f"{t:.1f} °C -> {'FROST: heater on' if danger else 'ok'}")
    time.sleep(2.5)
`,
      test: { expect: /6\.0 °C -> ok[\s\S]*1\.0 °C -> FROST: heater on/, seconds: 8, events: [{ at: 2, comp: 'dht', props: { temperature: 1 } }], verify: (s) => check(running(s, 'heater') && lit(s, 'frost'), 'heater and frost light on') },
    },
    (c) => c.dht('dht', 4, 'dht22', { temperature: 6 }).supply('ps', 12, 10).relay('relay', [17], {}, 'Relay').load('heater', 'heater', 'relay', 1, {}, 'Seedling heater').led('frost', 27, 'blue', 'Frost'),
  ),
];
