// Sensors: climate, light, distance, motion, gases, particles, water and analog inputs.
import { check, ex, lit, type LibExample } from './dsl';

export const SENSOR_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'sensors-dht22-heat-index',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Feels-like temperature (DHT22)', 'درجة الحرارة المحسوسة (DHT22)'],
      goal: ['Read temperature and humidity and compute the heat index with a formula.', 'قراءة الحرارة والرطوبة وحساب مؤشر الحرارة بمعادلة.'],
      result: ['Every 2.5 s the terminal prints temperature, humidity and the "feels like" value.', 'كل 2.5 ثانية تطبع الطرفية الحرارة والرطوبة والقيمة المحسوسة.'],
      tryIt: ['While it runs, raise the DHT22 temperature in the Inspector to 32 °C.', 'أثناء التشغيل ارفع حرارة DHT22 من نافذة الخصائص إلى 32 °م.'],
      modify: ['Print a warning when the heat index is above 32 °C.', 'اطبع تحذيراً عندما يتجاوز مؤشر الحرارة 32 °م.'],
      explain: ['The DHT22 needs at least 2 s between reads; reads can fail, so they are wrapped in try/except RuntimeError like on a real Pi.', 'يحتاج DHT22 ثانيتين على الأقل بين القراءات، وقد تفشل القراءة لذا نضعها داخل try/except RuntimeError كما على Pi حقيقي.'],
      code: `import time
import board
import adafruit_dht

dht = adafruit_dht.DHT22(board.D4)

def heat_index(t, rh):
    # simple Steadman/NOAA approximation (°C)
    return t + 0.33 * (rh / 100 * 6.105 * 2.718 ** (17.27 * t / (237.7 + t))) - 4.0

for i in range(3):
    try:
        t, rh = dht.temperature, dht.humidity
        print(f"T {t:.1f} °C  RH {rh:.0f} %  feels like {heat_index(t, rh):.1f} °C")
    except RuntimeError as e:
        print("retry:", e)
    time.sleep(2.5)
`,
      test: { expect: /T 25\.0 °C\s+RH 60 %\s+feels like 2\d\.\d °C[\s\S]*T 32\.0 °C/, seconds: 9, events: [{ at: 3, comp: 'dht', props: { temperature: 32 } }] },
    },
    (c) => c.dht('dht', 4),
  ),
  ex(
    {
      id: 'sensors-bme280-weather',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 20,
      title: ['Mini weather station (BME280)', 'محطة طقس مصغرة (BME280)'],
      goal: ['Read temperature, humidity and pressure over I2C and estimate the weather trend.', 'قراءة الحرارة والرطوبة والضغط عبر I2C وتقدير اتجاه الطقس.'],
      result: ['The station prints readings; when pressure falls by more than 1 hPa it forecasts rain.', 'تطبع المحطة القراءات، وعندما ينخفض الضغط أكثر من 1 هيكتوباسكال تتوقع مطراً.'],
      tryIt: ['While it runs, lower the BME280 pressure to 1009 hPa in the Inspector.', 'أثناء التشغيل خفّض ضغط BME280 إلى 1009 هيكتوباسكال من نافذة الخصائص.'],
      modify: ['Store the last 10 pressures in a list and use the average trend.', 'خزّن آخر 10 قيم ضغط في قائمة واستخدم متوسط الاتجاه.'],
      explain: ['adafruit_bme280 talks to the sensor at address 0x76 on I2C bus 1 (SDA GPIO2, SCL GPIO3).', 'تتواصل مكتبة adafruit_bme280 مع الحساس على العنوان 0x76 في ناقل I2C رقم 1 (SDA على GPIO2 وSCL على GPIO3).'],
      code: `import time
import board, busio
from adafruit_bme280 import basic as adafruit_bme280

i2c = busio.I2C(board.SCL, board.SDA)
bme = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)
first = bme.pressure
for i in range(4):
    p = bme.pressure
    trend = p - first
    forecast = "rain likely" if trend < -1 else "stable"
    print(f"T {bme.temperature:.1f} °C  RH {bme.relative_humidity:.0f} %  P {p:.1f} hPa  trend {trend:+.1f} -> {forecast}")
    time.sleep(1)
`,
      test: { expect: /P 1013\.\d hPa\s+trend \+0\.0 -> stable[\s\S]*P 1009\.\d hPa\s+trend -4\.\d -> rain likely/, seconds: 6, events: [{ at: 1.5, comp: 'bme', props: { pressure: 1009 } }] },
    },
    (c) => c.i2c('bme', 'bme280', {}, 'BME280'),
  ),
  ex(
    {
      id: 'sensors-light-levels',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Light-level classifier (BH1750)', 'تصنيف شدة الإضاءة (BH1750)'],
      goal: ['Read lux from a digital light sensor and classify it with if/elif.', 'قراءة شدة الإضاءة بالـ lux من حساس رقمي وتصنيفها بـ if/elif.'],
      result: ['The terminal prints the lux value and "dark", "indoor" or "daylight".', 'تطبع الطرفية قيمة lux والتصنيف: مظلم أو داخلي أو ضوء نهار.'],
      tryIt: ['While running, set the BH1750 lux to 5, then to 20000.', 'أثناء التشغيل اضبط lux في BH1750 على 5 ثم على 20000.'],
      modify: ['Add a "night" class below 1 lux.', 'أضف تصنيف "ليل" لما دون 1 lux.'],
      explain: ['smbus2 sends the one-time high-resolution command (0x20), waits for the conversion and reads two bytes with a plain I2C read (the BH1750 has no registers); lux = raw / 1.2.', 'ترسل smbus2 أمر القياس عالي الدقة لمرة واحدة (0x20) وتنتظر انتهاء التحويل ثم تقرأ بايتين بقراءة I2C مباشرة (لا يحتوي BH1750 على سجلات)؛ وlux = القيمة الخام ÷ 1.2.'],
      code: `import time
from smbus2 import SMBus, i2c_msg

bus = SMBus(1)
ADDR = 0x23

def read_lux():
    bus.write_byte(ADDR, 0x20)          # one-time high-resolution measurement
    time.sleep(0.18)                    # conversion time (max 180 ms)
    msg = i2c_msg.read(ADDR, 2)         # the BH1750 has no registers: read 2 bytes
    bus.i2c_rdwr(msg)
    hi, lo = list(msg)
    return ((hi << 8) | lo) / 1.2

for i in range(3):
    lux = read_lux()
    label = "dark" if lux < 10 else "indoor" if lux < 1000 else "daylight"
    print(f"{lux:8.0f} lux -> {label}")
    time.sleep(1.5)
`,
      test: {
        expect: /300 lux -> indoor[\s\S]*5 lux -> dark[\s\S]*20000 lux -> daylight/,
        seconds: 6,
        events: [
          { at: 1, comp: 'light', props: { lux: 5 } },
          { at: 2.8, comp: 'light', props: { lux: 20000 } },
        ],
      },
    },
    (c) => c.i2c('light', 'bh1750', {}, 'BH1750'),
  ),
  ex(
    {
      id: 'sensors-ultrasonic-ruler',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Ultrasonic ruler (HC-SR04)', 'مسطرة بالموجات فوق الصوتية (HC-SR04)'],
      goal: ['Measure distance with gpiozero.DistanceSensor and protect the 3.3 V input with a divider.', 'قياس المسافة باستخدام DistanceSensor وحماية مدخل 3.3 فولت بمقسّم جهد.'],
      result: ['The distance in centimetres is printed twice per second.', 'تُطبع المسافة بالسنتيمتر مرتين في الثانية.'],
      tryIt: ['Change the HC-SR04 distance in the Inspector to 60 cm while it runs.', 'غيّر مسافة HC-SR04 من نافذة الخصائص إلى 60 سم أثناء التشغيل.'],
      modify: ['Light an LED when something is closer than 10 cm.', 'أضئ LED عندما يقترب جسم لأقل من 10 سم.'],
      explain: ['The ECHO pin outputs 5 V, so a 1 kΩ / 2 kΩ divider brings it to 3.3 V. DistanceSensor times the echo pulse.', 'يُخرج طرف ECHO جهد 5 فولت، لذا يخفضه المقسّم 1 كيلو/2 كيلو أوم إلى 3.3 فولت، وتقيس DistanceSensor زمن نبضة الصدى.'],
      code: `from gpiozero import DistanceSensor
from time import sleep

sensor = DistanceSensor(echo=24, trigger=23, max_distance=2)
for i in range(6):
    print(f"distance: {sensor.distance * 100:.1f} cm")
    sleep(0.5)
`,
      test: { expect: /distance: 25\.\d cm[\s\S]*distance: 60\.\d cm/, seconds: 5, events: [{ at: 1.2, comp: 'us', props: { distance: 60 } }] },
    },
    (c) => c.ultrasonic('us', 23, 24),
  ),
  ex(
    {
      id: 'sensors-motion-counter',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Motion event counter (PIR)', 'عدّاد أحداث الحركة (PIR)'],
      goal: ['Count motion events with callbacks and keep a total.', 'عدّ أحداث الحركة بدوال الاستدعاء والاحتفاظ بالمجموع.'],
      result: ['Each time motion starts, the count increases and an LED lights while motion lasts.', 'كل مرة تبدأ فيها الحركة يزداد العدد، ويضيء LED طوال مدة الحركة.'],
      tryIt: ['Toggle "motion" of the PIR sensor in the Inspector while running.', 'بدّل خاصية الحركة في حساس PIR من نافذة الخصائص أثناء التشغيل.'],
      modify: ['Print the time of each event with time.strftime.', 'اطبع وقت كل حدث باستخدام time.strftime.'],
      explain: ['MotionSensor.when_motion and when_no_motion run functions on the rising and falling edges of the PIR output.', 'تنفذ when_motion وwhen_no_motion دوالاً عند الحافة الصاعدة والهابطة لمخرج حساس PIR.'],
      code: `from gpiozero import MotionSensor, LED
from signal import pause

pir = MotionSensor(17)
led = LED(27)
count = 0

def moved():
    global count
    count += 1
    led.on()
    print("motion #", count)

def still():
    led.off()
    print("no motion")

pir.when_motion = moved
pir.when_no_motion = still
pause()
`,
      test: {
        expect: /motion # 1[\s\S]*no motion[\s\S]*motion # 2/,
        seconds: 7,
        events: [
          { at: 1, comp: 'pir', props: { motion: true } },
          { at: 2, comp: 'pir', props: { motion: false } },
          { at: 5.5, comp: 'pir', props: { motion: true } },
        ],
        verify: (s) => check(lit(s, 'led'), 'LED on during motion'),
      },
    },
    (c) => c.pir('pir', 17, { hold: 1 }).led('led', 27, 'yellow'),
  ),
  ex(
    {
      id: 'sensors-co2-meter',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 20,
      title: ['Indoor CO₂ meter (SCD30)', 'مقياس CO₂ داخلي (SCD30)'],
      goal: ['Read a true NDIR CO₂ sensor and grade the room air quality.', 'قراءة حساس CO₂ بتقنية NDIR وتقييم جودة هواء الغرفة.'],
      result: ['The CO₂ value is printed with "good", "ventilate" or "poor".', 'تُطبع قيمة CO₂ مع التقييم: جيد أو يحتاج تهوية أو سيئ.'],
      tryIt: ['Raise the SCD30 CO₂ to 1500 ppm while running.', 'ارفع CO₂ في SCD30 إلى 1500 جزء بالمليون أثناء التشغيل.'],
      modify: ['Switch a ventilation relay on above 1000 ppm.', 'شغّل مرحل التهوية عند تجاوز 1000 جزء بالمليون.'],
      explain: ['The SCD30 measures every 2 s; data_available tells when a new value is ready.', 'يقيس SCD30 كل ثانيتين، وتخبرنا data_available بوجود قراءة جديدة.'],
      code: `import time
import board, busio
import adafruit_scd30

scd = adafruit_scd30.SCD30(busio.I2C(board.SCL, board.SDA))
for i in range(3):
    while not scd.data_available:
        time.sleep(0.5)
    co2 = scd.CO2
    grade = "good" if co2 < 800 else "ventilate" if co2 < 1200 else "poor"
    print(f"CO2 {co2:.0f} ppm -> {grade}")
`,
      test: { expect: /CO2 650 ppm -> good[\s\S]*CO2 1500 ppm -> poor/, seconds: 9, events: [{ at: 2.5, comp: 'scd', props: { co2: 1500 } }] },
    },
    (c) => c.i2c('scd', 'scd30', {}, 'SCD30'),
  ),
  ex(
    {
      id: 'sensors-gas-alarm',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 20,
      title: ['Gas leak alarm (MQ-2 + ADS1115)', 'إنذار تسرب الغاز (MQ-2 مع ADS1115)'],
      goal: ['Read a 5 V analog gas sensor safely through a divider and an external ADC.', 'قراءة حساس غاز تناظري يعمل على 5 فولت بأمان عبر مقسّم جهد ومحول ADC خارجي.'],
      result: ['Normal readings are printed; above 1000 ppm the buzzer sounds.', 'تُطبع القراءات العادية، وعند تجاوز 1000 جزء بالمليون يعمل الجرس.'],
      tryIt: ['Set the MQ-2 gas concentration to 3000 ppm while running.', 'اضبط تركيز الغاز في MQ-2 على 3000 جزء بالمليون أثناء التشغيل.'],
      modify: ['Add hysteresis: switch the alarm off only below 800 ppm.', 'أضف هامشاً (Hysteresis): لا تطفئ الإنذار إلا تحت 800 جزء بالمليون.'],
      explain: ['The Pi has no analog inputs; the ADS1115 converts the voltage. The divider keeps the 5 V module output below 3.3 V.', 'لا يحتوي Pi على مداخل تناظرية، فيحوّل ADS1115 الجهد إلى رقم، ويُبقي المقسّم مخرج الوحدة (5 فولت) دون 3.3 فولت.'],
      code: `from smartfarm import ADS1115, MQSensor
from gpiozero import Buzzer
from time import sleep

gas = MQSensor(ADS1115(), channel=0, model="mq2", divider=1.5)
buzzer = Buzzer(18)
for i in range(6):
    ppm = gas.read()
    alarm = ppm > 1000
    buzzer.value = alarm
    print(f"gas {ppm:5.0f} ppm {'ALARM' if alarm else 'ok'}")
    sleep(0.5)
`,
      test: { expect: /gas\s+\d+ ppm ok[\s\S]*gas\s+\d+ ppm ALARM/, seconds: 5, events: [{ at: 1.2, comp: 'mq', props: { ppm: 3000 } }], verify: (s) => check(!!s.vis.get('bz')?.on, 'buzzer on during the alarm') },
    },
    (c) => c.analog5('mq', 'mq2', 0, {}, 'MQ-2').buzzer('bz', 18),
  ),
  ex(
    {
      id: 'sensors-water-temp-minmax',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Water thermometer with min/max (DS18B20)', 'مقياس حرارة الماء مع أدنى/أعلى قيمة (DS18B20)'],
      goal: ['Use the 1-Wire bus and track the lowest and highest temperature.', 'استخدام ناقل 1-Wire وتتبع أدنى وأعلى درجة حرارة.'],
      result: ['Each reading is printed with the running minimum and maximum.', 'تُطبع كل قراءة مع أدنى وأعلى قيمة حتى الآن.'],
      tryIt: ['Change the probe temperature to 18 °C and then 27 °C while running.', 'غيّر حرارة المجس إلى 18 ثم 27 °م أثناء التشغيل.'],
      modify: ['Reset the min/max every 10 readings.', 'أعد ضبط الأدنى والأعلى كل 10 قراءات.'],
      explain: ['The 4.7 kΩ pull-up on DQ is required by 1-Wire; dtoverlay=w1-gpio (enabled on the Pi) exposes the sensor to w1thermsensor.', 'مقاومة الرفع 4.7 كيلو أوم على DQ ضرورية لناقل 1-Wire، وخيار dtoverlay=w1-gpio (مفعّل في Pi) يجعل الحساس متاحاً لمكتبة w1thermsensor.'],
      code: `from w1thermsensor import W1ThermSensor
from time import sleep

probe = W1ThermSensor()
low, high = None, None
for i in range(4):
    t = probe.get_temperature()
    low = t if low is None else min(low, t)
    high = t if high is None else max(high, t)
    print(f"{t:.2f} °C  (min {low:.2f}, max {high:.2f})")
    sleep(1)
`,
      test: {
        expect: /min 18\.00, max 27\.00/,
        seconds: 6,
        events: [
          { at: 1.2, comp: 'probe', props: { temperature: 18 } },
          { at: 2.2, comp: 'probe', props: { temperature: 27 } },
        ],
      },
    },
    (c) => c.ds18b20('probe'),
  ),
  ex(
    {
      id: 'sensors-thermistor-math',
      cat: 'sensors',
      level: 'advanced',
      minutes: 25,
      title: ['Thermistor maths from raw ADC values', 'حساب الحرارة من قراءة ADC خام لثرمستور'],
      goal: ['Convert an ADC voltage to resistance and then to °C with the Beta equation.', 'تحويل جهد ADC إلى مقاومة ثم إلى درجة حرارة بمعادلة Beta.'],
      result: ['The program prints voltage, resistance and temperature it calculated itself.', 'يطبع البرنامج الجهد والمقاومة والحرارة التي حسبها بنفسه.'],
      tryIt: ['Set the NTC temperature to 40 °C and compare the calculated value.', 'اضبط حرارة الـ NTC على 40 °م وقارن القيمة المحسوبة.'],
      modify: ['Average 10 readings to reduce noise.', 'خذ متوسط 10 قراءات لتقليل الضجيج.'],
      explain: ['Divider: V = 3.3·R/(R+10k) → R = 10k·V/(3.3−V). Beta: 1/T = 1/T25 + ln(R/R25)/β.', 'المقسّم: V = 3.3·R/(R+10k) ومنه R = 10k·V/(3.3−V). ومعادلة Beta: ‏1/T = 1/T25 + ln(R/R25)/β.'],
      code: `import math, time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

ads = ADS.ADS1115(busio.I2C(board.SCL, board.SDA))
ch = AnalogIn(ads, ADS.P0)
R_FIXED, R25, BETA = 10000, 10000, 3950
for i in range(3):
    v = ch.voltage
    r = R_FIXED * v / (3.3 - v)
    t = 1 / (1 / 298.15 + math.log(r / R25) / BETA) - 273.15
    print(f"V {v:.3f}  R {r:7.0f} ohm  T {t:.1f} °C")
    time.sleep(1)
`,
      test: { expect: /T 25\.\d °C[\s\S]*T (39\.\d|40\.\d) °C/, seconds: 5, events: [{ at: 1.3, comp: 'ntc', props: { temperature: 40 } }] },
    },
    (c) => {
      c.ads().part('r_fix', 'resistor', { ohms: 10000 }).part('ntc', 'ntc', {}, 'NTC 10k');
      c.w(`r_fix.1>${c.v33()}`, 'r_fix.2>ads.A0', 'ntc.1>ads.A0', `ntc.2>${c.gnd()}`);
    },
  ),
  ex(
    {
      id: 'sensors-dust-aqi',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 20,
      title: ['Dust monitor with AQI bands (PMS5003)', 'مراقب الغبار مع فئات جودة الهواء (PMS5003)'],
      goal: ['Read a laser particle sensor over UART and map PM2.5 to an air-quality band.', 'قراءة حساس الجسيمات الليزري عبر UART وتحويل PM2.5 إلى فئة لجودة الهواء.'],
      result: ['PM1.0 / PM2.5 / PM10 are printed with a band such as "good" or "unhealthy".', 'تُطبع قيم PM1.0 وPM2.5 وPM10 مع الفئة مثل جيد أو غير صحي.'],
      tryIt: ['Raise PM2.5 to 80 µg/m³ in the Inspector while running.', 'ارفع PM2.5 إلى 80 ميكروغرام/م³ من نافذة الخصائص أثناء التشغيل.'],
      modify: ['Average the last five PM2.5 values before choosing the band.', 'خذ متوسط آخر خمس قيم PM2.5 قبل اختيار الفئة.'],
      explain: ['The PMS5003 streams 32-byte frames at 9600 baud; adafruit_pm25 checks the frame checksum and decodes the values.', 'يرسل PMS5003 إطارات من 32 بايتاً بسرعة 9600، وتتحقق adafruit_pm25 من مجموع التحقق وتفك القيم.'],
      code: `import time
import serial
from adafruit_pm25.uart import PM25_UART

uart = serial.Serial("/dev/serial0", baudrate=9600, timeout=2)
pm = PM25_UART(uart)
BANDS = [(12, "good"), (35, "moderate"), (55, "unhealthy for sensitive groups"), (150, "unhealthy"), (10**9, "very unhealthy")]
for i in range(3):
    d = pm.read()
    pm25 = d["pm25 standard"]
    band = next(name for limit, name in BANDS if pm25 <= limit)
    print(f"PM1.0 {d['pm10 standard']}  PM2.5 {pm25}  PM10 {d['pm100 standard']} -> {band}")
    time.sleep(1.5)
`,
      test: { expect: /PM2\.5 12\s+PM10 18 -> good[\s\S]*PM2\.5 80\s+PM10 \d+ -> unhealthy/, seconds: 7, events: [{ at: 2, comp: 'pms', props: { pm25: 80 } }] },
    },
    (c) => c.uart('pms', 'pms5003', {}, 'PMS5003'),
  ),
  ex(
    {
      id: 'sensors-dew-point',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 15,
      title: ['Dew point & condensation risk (SHT31)', 'نقطة الندى وخطر التكاثف (SHT31)'],
      goal: ['Use a precise humidity sensor and the Magnus formula.', 'استخدام حساس رطوبة دقيق ومعادلة Magnus.'],
      result: ['Temperature, humidity and dew point are printed; a warning appears when they are within 2 °C.', 'تُطبع الحرارة والرطوبة ونقطة الندى، ويظهر تحذير عندما يقل الفرق عن 2 °م.'],
      tryIt: ['Set the SHT31 humidity to 92 % while running.', 'اضبط رطوبة SHT31 على 92% أثناء التشغيل.'],
      modify: ['Switch on a fan output while condensation is likely.', 'شغّل مخرج مروحة طالما التكاثف محتمل.'],
      explain: ['Magnus: γ = ln(RH/100) + 17.62·T/(243.12+T); dew point = 243.12·γ/(17.62−γ).', 'معادلة Magnus: ‏γ = ln(RH/100) + 17.62·T/(243.12+T)، ونقطة الندى = 243.12·γ/(17.62−γ).'],
      code: `import math, time
import board, busio
import adafruit_sht31d

sht = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
for i in range(3):
    t, rh = sht.temperature, sht.relative_humidity
    g = math.log(rh / 100) + 17.62 * t / (243.12 + t)
    dew = 243.12 * g / (17.62 - g)
    risk = "CONDENSATION RISK" if t - dew < 2 else "dry"
    print(f"T {t:.1f} °C  RH {rh:.0f} %  dew point {dew:.1f} °C -> {risk}")
    time.sleep(1)
`,
      test: { expect: /RH 55 %\s+dew point 14\.\d °C -> dry[\s\S]*RH 92 %[\s\S]*CONDENSATION RISK/, seconds: 5, events: [{ at: 1.3, comp: 'sht', props: { humidity: 92 } }] },
    },
    (c) => c.i2c('sht', 'sht31', {}, 'SHT31'),
  ),
  ex(
    {
      id: 'sensors-knob-voltmeter',
      cat: 'sensors',
      level: 'beginner',
      minutes: 15,
      title: ['Knob voltmeter (potentiometer + ADS1115)', 'مقياس جهد بالمقبض (مقاومة متغيرة مع ADS1115)'],
      goal: ['Read an analog voltage with the Adafruit ADS1x15 library and show a bar graph.', 'قراءة جهد تناظري بمكتبة Adafruit ADS1x15 وعرضه كمخطط شريطي نصي.'],
      result: ['The voltage and a text bar are printed; turning the knob changes them.', 'يُطبع الجهد وشريط نصي، ويتغيران عند تدوير المقبض.'],
      tryIt: ['Move the potentiometer position to 90 % while running.', 'حرّك موضع المقاومة المتغيرة إلى 90% أثناء التشغيل.'],
      modify: ['Map the voltage to 0–100 % and print it.', 'حوّل الجهد إلى نسبة من 0 إلى 100% واطبعها.'],
      explain: ['AnalogIn.voltage is the measured voltage; the bar length is proportional to it.', 'تعطي AnalogIn.voltage الجهد المقاس، وطول الشريط يتناسب معه.'],
      code: `import time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

ads = ADS.ADS1115(busio.I2C(board.SCL, board.SDA))
knob = AnalogIn(ads, ADS.P0)
for i in range(5):
    v = knob.voltage
    print(f"{v:.2f} V |{'#' * int(v / 3.3 * 20):<20}|")
    time.sleep(0.6)
`,
      test: { expect: /1\.6\d V \|#{9,10}\s*\|[\s\S]*2\.9\d V \|#{17,18}/, seconds: 4, events: [{ at: 1.5, comp: 'knob', props: { position: 90 } }] },
    },
    (c) => c.pot('knob', 0, { position: 50 }, 'Knob'),
  ),
  ex(
    {
      id: 'sensors-rain-gauge',
      cat: 'sensors',
      level: 'beginner',
      minutes: 10,
      title: ['Rain detector', 'كاشف المطر'],
      goal: ['Read the digital output of a rain module and report changes only.', 'قراءة المخرج الرقمي لوحدة المطر والإبلاغ عن التغييرات فقط.'],
      result: ['"dry" at the start, then "raining" when the plate gets wet.', 'تُطبع "جاف" في البداية ثم "مطر" عندما يبتل اللوح.'],
      tryIt: ['Set the rain sensor wetness to 80 % while running.', 'اضبط نسبة البلل في حساس المطر على 80% أثناء التشغيل.'],
      modify: ['Count how long it has been raining.', 'احسب مدة هطول المطر.'],
      explain: ['The module’s comparator pulls DO LOW when the plate is wetter than the threshold set by its trimmer.', 'يسحب المقارن في الوحدة الطرف DO إلى LOW عندما يتجاوز البلل العتبة المضبوطة بالمقاومة المتغيرة.'],
      code: `from gpiozero import DigitalInputDevice
from time import sleep

rain = DigitalInputDevice(17)            # DO is LOW when wet
last = None
for i in range(10):
    state = "raining" if rain.value == 0 else "dry"
    if state != last:
        print(state)
        last = state
    sleep(0.3)
`,
      test: { expect: /dry[\s\S]*raining/, seconds: 4, events: [{ at: 1.2, comp: 'rain', props: { wetness: 80 } }] },
    },
    (c) => c.digital('rain', 'rain_sensor', 17, {}, 'Rain'),
  ),
  ex(
    {
      id: 'sensors-barometric-altitude',
      cat: 'sensors',
      level: 'intermediate',
      minutes: 15,
      title: ['Altitude from air pressure (BMP280)', 'حساب الارتفاع من ضغط الهواء (BMP280)'],
      goal: ['Calibrate sea-level pressure and convert pressure changes to height.', 'معايرة ضغط مستوى سطح البحر وتحويل تغيّر الضغط إلى ارتفاع.'],
      result: ['The relative height is printed; a drop of 12 hPa reads roughly 100 m higher.', 'يُطبع الارتفاع النسبي، وانخفاض 12 هيكتوباسكال يعني ارتفاعاً بنحو 100 م.'],
      tryIt: ['Lower the BMP280 pressure to 1001 hPa (taking the sensor up a hill).', 'خفّض ضغط BMP280 إلى 1001 هيكتوباسكال (كأنك تصعد تلاً).'],
      modify: ['Print the altitude in feet as well.', 'اطبع الارتفاع بالقدم أيضاً.'],
      explain: ['Setting sea_level_pressure to the first reading makes altitude relative to the start point.', 'ضبط sea_level_pressure على أول قراءة يجعل الارتفاع نسبياً لنقطة البداية.'],
      code: `import time
import board, busio
import adafruit_bmp280

bmp = adafruit_bmp280.Adafruit_BMP280_I2C(busio.I2C(board.SCL, board.SDA), address=0x76)
bmp.sea_level_pressure = bmp.pressure          # start point = 0 m
for i in range(3):
    print(f"P {bmp.pressure:.1f} hPa  height {bmp.altitude:+.0f} m")
    time.sleep(1.2)
`,
      test: { expect: /height \+0 m[\s\S]*P 1001\.0 hPa\s+height \+(9\d|10\d) m/, seconds: 5, events: [{ at: 1.5, comp: 'bmp', props: { pressure: 1001 } }] },
    },
    (c) => c.i2c('bmp', 'bmp280', {}, 'BMP280'),
  ),
];
