// Data, time & logging: files, CSV, JSON settings, real-time clocks and statistics.
import { ex, type LibExample } from './dsl';

export const DATA_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'data-csv-logger',
      cat: 'data',
      level: 'intermediate',
      minutes: 20,
      title: ['Climate CSV logger', 'مسجل المناخ في ملف CSV'],
      goal: ['Write timestamped sensor readings to a CSV file and read it back for a summary.', 'كتابة قراءات الحساس مع الوقت في ملف CSV ثم قراءته لعمل ملخص.'],
      result: ['Every 2.2 s a timestamped row is added to log.csv and the number of rows and the average temperature are printed, until you press Stop.', 'كل 2.2 ثانية يُضاف صف مع الوقت إلى log.csv ويُطبع عدد الصفوف ومتوسط الحرارة، حتى تضغط إيقاف.'],
      tryIt: ['Stop the program after a few rows, then open log.csv in the file list.', 'أوقف البرنامج بعد بضعة صفوف، ثم افتح log.csv من قائمة الملفات.'],
      modify: ['Start a new file every day (name it with the date).', 'ابدأ ملفاً جديداً كل يوم (سمّه بالتاريخ).'],
      explain: ['The csv module handles quoting; files written by the program appear in the editor after the run.', 'تتولى الوحدة csv علامات الاقتباس، وتظهر الملفات التي يكتبها البرنامج في المحرر بعد التشغيل.'],
      code: `import csv, time, board, adafruit_dht
from datetime import datetime

dht = adafruit_dht.DHT22(board.D4)
with open("log.csv", "w", newline="") as f:
    csv.writer(f).writerow(["time", "temperature", "humidity"])
rows, total = 0, 0.0
while True:                      # runs until you press Stop
    try:
        t, h = dht.temperature, dht.humidity
    except RuntimeError:
        time.sleep(2.2)
        continue
    with open("log.csv", "a", newline="") as f:      # append one row at a time
        csv.writer(f).writerow([datetime.now().strftime("%H:%M:%S"), t, h])
    rows += 1
    total += t
    print(f"{rows} rows logged, average {total / rows:.1f} °C")
    time.sleep(2.2)
`,
      test: { expect: /3 rows logged, average 2[56]\.\d °C/, seconds: 7, events: [{ at: 2, comp: 'dht', props: { temperature: 27 } }] },
    },
    (c) => c.dht('dht', 4),
  ),
  ex(
    {
      id: 'data-rtc-event-stamps',
      cat: 'data',
      level: 'intermediate',
      minutes: 20,
      title: ['Event time stamps from a DS3231 clock', 'طوابع زمنية للأحداث من ساعة DS3231'],
      goal: ['Keep accurate time with a battery-backed real-time clock and stamp button events.', 'حفظ الوقت بدقة بساعة زمن حقيقي مزودة ببطارية وتسجيل وقت ضغطات الزر.'],
      result: ['The clock is set once; every press prints the RTC date and time, until you press Stop.', 'تُضبط الساعة مرة واحدة، وكل ضغطة تطبع تاريخ ووقت الساعة حتى تضغط إيقاف.'],
      tryIt: ['Press the button twice during the run.', 'اضغط الزر مرتين أثناء التشغيل.'],
      modify: ['Use the DS3231 alarm output to wake the program.', 'استخدم مخرج المنبّه في DS3231 لتنبيه البرنامج.'],
      explain: ['The Pi 5 has its own RTC, but an external DS3231 keeps very accurate time (±2 ppm) and is common in data loggers.', 'يحتوي Pi 5 على ساعة خاصة به، لكن DS3231 الخارجية دقيقة جداً (±2 جزء بالمليون) وشائعة في مسجلات البيانات.'],
      code: `import time
import board, busio, adafruit_ds3231
from gpiozero import Button

rtc = adafruit_ds3231.DS3231(busio.I2C(board.SCL, board.SDA))
rtc.datetime = time.struct_time((2026, 6, 1, 9, 0, 0, 0, -1, -1))
button = Button(17)
n = 0
while True:                      # runs until you press Stop
    button.wait_for_press()
    n += 1
    t = rtc.datetime
    print(f"event {n} at {t.tm_year}-{t.tm_mon:02d}-{t.tm_mday:02d} {t.tm_hour:02d}:{t.tm_min:02d}:{t.tm_sec:02d}")
    button.wait_for_release()
`,
      test: {
        expect: /event 1 at 2026-06-01 09:00:01[\s\S]*event 2 at 2026-06-01 09:00:0[34]/,
        seconds: 6,
        events: [
          { at: 1.1, comp: 'btn', press: true },
          { at: 1.4, comp: 'btn', press: false },
          { at: 3.1, comp: 'btn', press: true },
          { at: 3.4, comp: 'btn', press: false },
        ],
      },
    },
    (c) => c.i2c('rtc', 'ds3231', {}, 'DS3231').button('btn', 17, 'Event'),
  ),
  ex(
    {
      id: 'data-json-settings',
      cat: 'data',
      level: 'beginner',
      minutes: 15,
      title: ['Settings from a JSON file', 'الإعدادات من ملف JSON'],
      goal: ['Keep thresholds in settings.json so they can change without editing the code.', 'حفظ الحدود في ملف settings.json حتى يمكن تغييرها دون تعديل الكود.'],
      result: ['The limit and blink speed are loaded from settings.json; the temperature is checked every second and the alarm blinks while it is above the limit. It runs until you press Stop.', 'يُحمَّل الحد وسرعة الوميض من settings.json، وتُفحص الحرارة كل ثانية ويومض الإنذار ما دامت فوق الحد، ويستمر حتى تضغط إيقاف.'],
      tryIt: ['Open settings.json, change "limit_c" to 20 and run again.', 'افتح settings.json وغيّر "limit_c" إلى 20 ثم شغّل مجدداً.'],
      modify: ['Save the last reading back into the JSON file.', 'احفظ آخر قراءة في ملف JSON.'],
      explain: ['json.load turns the file into a dict; .get() gives a default when a key is missing.', 'تحوّل json.load الملف إلى قاموس، وتعطي .get() قيمة افتراضية إذا غاب المفتاح.'],
      code: `import json
from time import sleep
from w1thermsensor import W1ThermSensor
from gpiozero import LED

with open("settings.json") as f:
    settings = json.load(f)
limit = settings.get("limit_c", 25)
blink = settings.get("blink_s", 0.5)
alarm = LED(17)
probe = W1ThermSensor()
above = None
while True:                      # runs until you press Stop
    t = probe.get_temperature()
    if (t > limit) != above:
        above = t > limit
        print(f"limit from settings: {limit} °C, measured {t:.1f} °C")
        if above:
            alarm.blink(blink, blink)
            print("above limit -> alarm blinking")
        else:
            alarm.off()
            print("below limit")
    sleep(1)
`,
      files: { 'settings.json': '{\n  "limit_c": 30,\n  "blink_s": 0.2\n}\n' },
      test: { expect: /limit from settings: 30 °C, measured 21\.0 °C[\s\S]*below limit[\s\S]*measured 35\.0 °C[\s\S]*above limit -> alarm blinking/, seconds: 3, events: [{ at: 1.5, comp: 'probe', props: { temperature: 35 } }] },
    },
    (c) => c.ds18b20('probe').led('alarm', 17, 'red', 'Alarm'),
  ),
  ex(
    {
      id: 'data-moving-average',
      cat: 'data',
      level: 'intermediate',
      minutes: 20,
      title: ['Smoothing a noisy sensor (moving average)', 'تنعيم قراءات حساس مشوشة (متوسط متحرك)'],
      goal: ['Reduce noise with a fixed-size window of recent values.', 'تقليل الضجيج بنافذة ثابتة الحجم من القيم الأخيرة.'],
      result: ['Raw readings jump around while the moving average of the last five changes smoothly; it keeps measuring until you press Stop.', 'تتقافز القراءات الخام بينما يتغير متوسط آخر خمس قراءات بسلاسة، ويستمر القياس حتى تضغط إيقاف.'],
      tryIt: ['Compare the raw and average columns.', 'قارن عمودي القيم الخام والمتوسط.'],
      modify: ['Try a median filter (statistics.median) instead.', 'جرّب مرشح الوسيط (statistics.median) بدلاً منه.'],
      explain: ['collections.deque(maxlen=5) automatically drops the oldest value; the sensor’s "noise" fault adds random variation.', 'تحذف deque(maxlen=5) تلقائياً أقدم قيمة، ويضيف عطل "الضجيج" في الحساس تغيّرات عشوائية.'],
      code: `from collections import deque
from smartfarm import ADS1115, SoilMoisture
from time import sleep

soil = SoilMoisture(ADS1115(), 0)
window = deque(maxlen=5)
announced = False
while True:                      # runs until you press Stop
    raw = soil.read()
    window.append(raw)
    avg = sum(window) / len(window)
    print(f"raw {raw:5.1f} %   average {avg:5.1f} %")
    if len(window) == window.maxlen and not announced:
        print("window full: the average now covers the last 5 readings")
        announced = True
    sleep(0.3)
`,
      test: { expect: /window full[\s\S]*raw\s+\d+\.\d %\s+average/, seconds: 2.5 },
    },
    (c) => c.analog('soil', 'soil_moisture', 0, { fault: 'noise' }, 'Soil (noisy)'),
  ),
  ex(
    {
      id: 'data-statistics-report',
      cat: 'data',
      level: 'intermediate',
      minutes: 20,
      title: ['Statistics report of light readings', 'تقرير إحصائي لقراءات الضوء'],
      goal: ['Collect samples in a list and compute min, max, mean and standard deviation.', 'جمع العينات في قائمة وحساب الأدنى والأعلى والمتوسط والانحراف المعياري.'],
      result: ['Every 10 samples (2.5 s) a short report with min, max, mean and standard deviation is printed, until you press Stop.', 'كل 10 عينات (2.5 ثانية) يُطبع تقرير قصير بالأدنى والأعلى والمتوسط والانحراف المعياري، حتى تضغط إيقاف.'],
      tryIt: ['Change the BH1750 lux during sampling to widen the spread.', 'غيّر lux في BH1750 أثناء أخذ العينات لتوسيع التشتت.'],
      modify: ['Print a text histogram of the samples.', 'اطبع مدرّجاً تكرارياً نصياً للعينات.'],
      explain: ['The statistics module provides mean() and stdev(); f-strings align the report.', 'توفر الوحدة statistics الدالتين mean() وstdev()، وتصفّ صيغ f-string التقرير.'],
      code: `import statistics
from smartfarm import BH1750
from time import sleep

sensor = BH1750()
report = 0
while True:                      # runs until you press Stop
    samples = []
    for i in range(10):
        samples.append(sensor.read())
        sleep(0.25)
    report += 1
    print(f"report {report} - samples: {len(samples)}")
    print(f"min {min(samples):.0f}  max {max(samples):.0f}  mean {statistics.mean(samples):.0f}  stdev {statistics.stdev(samples):.0f} lux")
`,
      test: { expect: /samples: 10\s+min 300\s+max 900\s+mean \d+\s+stdev \d+ lux/, seconds: 3, events: [{ at: 1.2, comp: 'light', props: { lux: 900 } }] },
    },
    (c) => c.i2c('light', 'bh1750', {}, 'BH1750'),
  ),
  ex(
    {
      id: 'data-motion-log-file',
      cat: 'data',
      level: 'beginner',
      minutes: 15,
      title: ['Motion events log file', 'ملف سجل أحداث الحركة'],
      goal: ['Append one line per event to a text log file.', 'إضافة سطر لكل حدث إلى ملف سجل نصي.'],
      result: ['events.log gets a timestamped line for every motion start and the number of lines is printed, until you press Stop.', 'يُضاف إلى events.log سطر مع الوقت لكل بداية حركة ويُطبع عدد الأسطر، حتى تضغط إيقاف.'],
      tryIt: ['Trigger motion twice, then open events.log.', 'شغّل الحركة مرتين ثم افتح events.log.'],
      modify: ['Also log when the motion stops and how long it lasted.', 'سجّل أيضاً وقت توقف الحركة ومدتها.'],
      explain: ['Opening with mode "a" appends instead of overwriting; each write ends with a newline.', 'الفتح بالوضع "a" يضيف إلى نهاية الملف بدل استبداله، وكل كتابة تنتهي بسطر جديد.'],
      code: `from gpiozero import MotionSensor
from datetime import datetime

pir = MotionSensor(17)
n = 0
while True:                      # runs until you press Stop
    pir.wait_for_motion()
    n += 1
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} motion #{n}"
    with open("events.log", "a") as f:
        f.write(line + "\\n")
    print("logged:", line)
    with open("events.log") as f:
        print("lines in log:", len(f.readlines()))
    pir.wait_for_no_motion()
`,
      test: {
        expect: /logged: .* motion #2[\s\S]*lines in log: 2/,
        seconds: 7,
        events: [
          { at: 1, comp: 'pir', props: { motion: true } },
          { at: 1.6, comp: 'pir', props: { motion: false } },
          { at: 3.5, comp: 'pir', props: { motion: true } },
          { at: 4.1, comp: 'pir', props: { motion: false } },
        ],
      },
    },
    (c) => c.pir('pir', 17, { hold: 0.3 }),
  ),
];
