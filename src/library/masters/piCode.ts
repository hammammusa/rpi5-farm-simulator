// COMPETITION MASTER 01 — Raspberry Pi 5: the study program (Python 3, gpiozero) and its web page.
// Markers "# >>> NAME" / "# <<< NAME" delimit the parts used by the code-recall practice.

export const PI_MAIN = String.raw`# COMPETITION MASTER 01 — Raspberry Pi 5 Complete Smart Farm
# مزرعة ذكية كاملة على Raspberry Pi 5 — نفس منطق مشروعي ESP32 و Wiren Board
import time                                         # الوقت والانتظار (sleep)
import threading                                    # فقط لتشغيل صفحة الويب في الخلفية
import serial                                       # منفذ UART لقراءة حساس CO2
import adafruit_dht                                 # مكتبة حساس الحرارة والرطوبة DHT22
import board                                        # أسماء أرجل اللوحة مثل board.D16
from gpiozero import OutputDevice, Button, MCP3008  # مخارج المرحّلات + الأزرار + محوّل ADC
from flask import Flask, jsonify, render_template   # صفحة الويب البسيطة

# ---------- 1) الإعدادات: قيم تدريبية يمكنك تغييرها ----------
MAX_TEMP = 30                 # فوق 30 درجة: تشغيل المروحة
FAN_OFF_TEMP = 27             # تحت 27 درجة: إيقاف المروحة
MIN_WATER = 20                # أقل مستوى ماء مسموح (%) لتشغيل المضخة
PUMP_SECONDS = 5              # مدة الري بالثواني
IRRIGATION_HOURS = [7, 12, 17]  # ساعات الري في اليوم
LIGHT_ON_HOUR = 6             # ساعة تشغيل الإضاءة
LIGHT_OFF_HOUR = 20           # ساعة إطفاء الإضاءة
DOSE_A_ML = 10                # جرعة السماد A بالمليلتر
DOSE_B_ML = 5                 # جرعة السماد B بالمليلتر
FLOW_ML_PER_SEC = 2           # تدفق مضخة الجرعات (يحتاج معايرة على الجهاز الحقيقي)
PH_MIN = 5.5                  # أقل pH مقبول
PH_MAX = 6.5                  # أعلى pH مقبول
EC_MIN = 1.0                  # أقل EC مقبول (mS/cm)
EC_MAX = 2.5                  # أعلى EC مقبول
CO2_MAX = 1500                # أعلى CO2 مقبول (ppm)
MIN_PUMP_AMPS = 0.2           # أقل تيار يثبت أن المضخة تعمل فعلاً (أمبير)
TEST_SECONDS = 2              # مدة تشغيل كل جهاز في وضع الاختبار

# >>> PINS
# ---------- 2) التوصيلات: كل جهاز على رجله ----------
dht = adafruit_dht.DHT22(board.D16)                 # DHT22: البيانات على GPIO16
co2_port = serial.Serial("/dev/serial0", 9600, timeout=1)  # MH-Z19B على UART0 (GPIO14 و GPIO15)
ph_adc = MCP3008(channel=0)                         # حساس pH على قناة ADC رقم 0
ec_adc = MCP3008(channel=1)                         # حساس EC على القناة 1
level_adc = MCP3008(channel=2)                      # حساس مستوى الماء على القناة 2
current_adc = MCP3008(channel=3)                    # حساس تيار المضخة ACS712 على القناة 3
pump = OutputDevice(17)                             # مرحّل مضخة الري على GPIO17
fan = OutputDevice(22)                              # مرحّل المروحة على GPIO22
light = OutputDevice(27)                            # مرحّل الإضاءة على GPIO27
alarm_lamp = OutputDevice(23)                       # مرحّل مصباح الإنذار على GPIO23
dose_a = OutputDevice(5)                            # مرحّل مضخة الجرعات A على GPIO5
dose_b = OutputDevice(6)                            # مرحّل مضخة الجرعات B على GPIO6
dosing_button = Button(26)                          # زر وضع الجرعات على GPIO26 (إلى GND)
test_button = Button(19)                            # زر وضع الاختبار على GPIO19 (إلى GND)
# <<< PINS

# ---------- 3) حالة النظام ----------
mode = "AUTO"                 # الوضع الحالي: AUTO أو DOSING أو TEST
alarm = "NONE"                # الإنذار الحالي
pump_failed = False           # يصبح True إذا شغّلنا المضخة ولم يمر تيار
temperature = None            # آخر قراءة حرارة
humidity = None               # آخر قراءة رطوبة
co2 = None                    # آخر قراءة CO2
ph = 0                        # آخر قراءة pH
ec = 0                        # آخر قراءة EC
water_level = 0               # مستوى الماء %
pump_amps = 0                 # تيار المضخة بالأمبير
last_irrigation_hour = -1     # آخر ساعة تم فيها الري (حتى لا نكرره)
start_time = time.time()      # وقت بدء التشغيل لحساب يوم النمو
last_dht_time = 0             # وقت آخر قراءة DHT22 (يحتاج ثانيتين بين القراءات)


def read_co2():                                     # قراءة CO2 من MH-Z19B عبر UART
    co2_port.write(bytes([0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79]))  # أمر طلب القراءة (9 بايت)
    reply = co2_port.read(9)                        # ننتظر رداً من 9 بايت
    if len(reply) != 9:                             # لا يوجد رد = الحساس مفصول
        return None                                 # None تعني: لا توجد قراءة
    return reply[2] * 256 + reply[3]                # البايت 2 و 3 = التركيز ppm


# >>> SENSORS
def read_sensors():                                 # قراءة كل الحساسات
    global temperature, humidity, co2, ph, ec, water_level, pump_amps, last_dht_time  # سنغيّر هذه المتغيرات العامة
    if time.time() - last_dht_time >= 2:            # DHT22: قراءة جديدة كل ثانيتين فقط
        last_dht_time = time.time()                 # نحفظ وقت هذه القراءة
        try:                                        # نحاول القراءة
            temperature = dht.temperature           # الحرارة °C
            humidity = dht.humidity                 # الرطوبة %
        except RuntimeError:                        # فشل القراءة (الحساس مفصول)
            temperature = None                      # لا توجد قراءة حرارة
            humidity = None                         # ولا رطوبة
    co2 = read_co2()                                # CO2 ppm (أو None)
    ph = round(ph_adc.voltage * 3.5, 2)             # pH = 3.5 × الجهد
    ec = round(ec_adc.voltage / 0.5, 2)             # EC = الجهد ÷ 0.5
    water_level = round(level_adc.voltage / 3.0 * 100)  # 3 فولت = 100%
    pump_amps = round((current_adc.voltage - 2.5) / 0.185, 2)  # ACS712: 2.5 فولت = صفر أمبير
# <<< SENSORS


def water_ok():                                     # هل يوجد ماء كافٍ؟
    return water_level >= MIN_WATER and water_level <= 100  # أكثر من 100% = قراءة غير صالحة


def growth_day():                                   # يوم النمو منذ بدء التشغيل
    return int((time.time() - start_time) / 86400) + 1  # 86400 ثانية = يوم واحد


# >>> IRRIGATION
def irrigate():                                     # ري لمدة PUMP_SECONDS مع الحماية
    global pump_failed                              # قد نغيّر هذا المتغير العام
    print("IRRIGATION start")                       # رسالة بداية الري
    for second in range(PUMP_SECONDS):              # ثانية بعد ثانية
        read_sensors()                              # قراءة جديدة قبل كل ثانية
        if not water_ok():                          # الماء نقص أثناء الري
            print("IRRIGATION stopped: LOW WATER")  # نخبر بالسبب
            break                                   # نخرج من الحلقة فوراً
        pump.on()                                   # تشغيل المضخة
        time.sleep(1)                               # انتظار ثانية
        read_sensors()                              # نقرأ تيار المضخة الآن
        if pump_amps < MIN_PUMP_AMPS:               # المضخة لا تسحب تياراً = لا تعمل
            pump_failed = True                      # نتذكر العطل (يظهر الإنذار)
            print("PUMP FAILURE: no current")       # رسالة العطل
            break                                   # نتوقف عن الري
    pump.off()                                      # إيقاف المضخة دائماً في النهاية
    print("IRRIGATION end")                         # رسالة نهاية الري
# <<< IRRIGATION


# >>> DOSING
def run_dosing():                                   # جرعة A ثم جرعة B (لا تعملان معاً أبداً)
    if not water_ok():                              # لا تسميد بدون ماء
        print("DOSING cancelled: LOW WATER")        # نخبر بالسبب
        return                                      # نخرج من الدالة
    dose_b.off()                                    # تأكد أن B متوقفة قبل تشغيل A
    dose_a.on()                                     # تشغيل A
    print("DOSING A", DOSE_A_ML, "ml")              # رسالة الجرعة A
    time.sleep(DOSE_A_ML / FLOW_ML_PER_SEC)         # الزمن = الكمية ÷ التدفق (10 ÷ 2 = 5 ثوانٍ)
    dose_a.off()                                    # إيقاف A
    dose_b.on()                                     # ثم تشغيل B
    print("DOSING B", DOSE_B_ML, "ml")              # رسالة الجرعة B
    time.sleep(DOSE_B_ML / FLOW_ML_PER_SEC)         # 5 ÷ 2 = 2.5 ثانية
    dose_b.off()                                    # إيقاف B
    print("DOSING DONE")                            # انتهت الجرعات
# <<< DOSING


def run_test():                                     # تجربة كل جهاز لثانيتين
    for name, device in [("FAN", fan), ("LIGHT", light), ("DOSE A", dose_a), ("DOSE B", dose_b)]:  # قائمة الأجهزة
        print("TEST", name)                         # اسم الجهاز الذي نختبره
        device.on()                                 # تشغيله
        time.sleep(TEST_SECONDS)                    # ننتظر ثانيتين
        device.off()                                # إيقافه
    if water_ok():                                  # المضخة فقط إذا يوجد ماء (الحماية لا تُلغى)
        print("TEST PUMP")                          # نختبر المضخة
        pump.on()                                   # تشغيلها
        time.sleep(TEST_SECONDS)                    # ننتظر ثانيتين
        pump.off()                                  # إيقافها
    else:                                           # لا يوجد ماء كافٍ
        print("TEST PUMP skipped: LOW WATER")       # لا نشغّل المضخة فارغة
    print("TEST DONE")                              # انتهى الاختبار


def auto_control():                                 # الوضع التلقائي
    global last_irrigation_hour                     # سنغيّر هذا المتغير العام
    hour = time.localtime().tm_hour                 # الساعة الحالية (0 إلى 23)
    # >>> FAN
    if temperature is None:                         # لا قراءة حرارة: نشغّل المروحة للأمان
        fan.on()                                    # تشغيل المروحة
    elif temperature > MAX_TEMP:                    # حار جداً
        fan.on()                                    # تشغيل المروحة
    elif temperature < FAN_OFF_TEMP:                # برد بما يكفي
        fan.off()                                   # إيقاف المروحة (بين 27 و 30 تبقى كما هي)
    # <<< FAN
    # >>> LIGHT
    if hour >= LIGHT_ON_HOUR and hour < LIGHT_OFF_HOUR:  # داخل ساعات الإضاءة
        light.on()                                  # تشغيل الإضاءة
    else:                                           # خارج ساعات الإضاءة
        light.off()                                 # إطفاء الإضاءة
    # <<< LIGHT
    if hour in IRRIGATION_HOURS and hour != last_irrigation_hour:  # حان وقت ري جديد
        last_irrigation_hour = hour                 # نتذكر الساعة حتى لا نكرر الري
        if water_ok():                              # يوجد ماء؟
            irrigate()                              # نروي
        else:                                       # لا يوجد ماء
            print("IRRIGATION skipped: LOW WATER")  # نتخطى الري


# >>> ALARMS
def check_alarms():                                 # اختيار أهم إنذار وتشغيل المصباح
    global alarm                                    # سنغيّر هذا المتغير العام
    old = alarm                                     # نحفظ الإنذار السابق
    if temperature is None or co2 is None or ph < 1 or ph > 14 or water_level > 100:  # قراءة غير صالحة
        alarm = "SENSOR ERROR"                      # خطأ حساس
    elif not water_ok():                            # الماء قليل
        alarm = "LOW WATER"                         # نقص الماء
    elif pump_failed:                               # المضخة لم تسحب تياراً
        alarm = "PUMP FAILURE"                      # عطل المضخة
    elif temperature > MAX_TEMP:                    # حرارة عالية
        alarm = "HIGH TEMPERATURE"                  # ارتفاع الحرارة
    elif ph < PH_MIN or ph > PH_MAX or ec < EC_MIN or ec > EC_MAX or co2 > CO2_MAX:  # خارج الحدود
        alarm = "OUT OF RANGE"                      # قيمة خارج المجال
    else:                                           # كل شيء طبيعي
        alarm = "NONE"                              # لا يوجد إنذار
    if alarm == "NONE":                             # لا إنذار
        alarm_lamp.off()                            # إطفاء مصباح الإنذار
    else:                                           # يوجد إنذار
        alarm_lamp.on()                             # تشغيل مصباح الإنذار
    if alarm != old:                                # نطبع الإنذار عند تغيّره فقط
        print("ALARM", alarm)                       # رسالة الإنذار
# <<< ALARMS


def on_off(device):                                 # "ON" أو "OFF" لعرض حالة جهاز
    if device.is_active:                            # الجهاز يعمل الآن؟
        return "ON"                                 # يعمل
    return "OFF"                                    # متوقف


def show_status():                                  # سطر الحالة في الطرفية
    print("STATUS mode=" + mode, "temp=" + str(temperature), "hum=" + str(humidity), "co2=" + str(co2),  # الوضع والهواء
          "ph=" + str(ph), "ec=" + str(ec), "level=" + str(water_level), "pump=" + on_off(pump),  # الماء والمضخة
          "fan=" + on_off(fan), "light=" + on_off(light), "alarm=" + alarm, "day=" + str(growth_day()))  # الباقي


# ---------- 4) صفحة الويب (Flask) ----------
app = Flask(__name__)                               # إنشاء تطبيق الويب


def home():                                         # الصفحة الرئيسية
    return render_template("index.html")            # الملف templates/index.html


def status():                                       # البيانات بصيغة JSON للصفحة
    return jsonify(temperature=temperature, humidity=humidity, co2=co2, ph=ph, ec=ec,  # القراءات
                   water_level=water_level, mode=mode, pump=on_off(pump), fan=on_off(fan),  # الحالة
                   light=on_off(light), alarm=alarm, day=growth_day())  # الإضاءة والإنذار واليوم


def set_mode(name):                                 # زر في الصفحة يطلب DOSING أو TEST
    global mode                                     # سنغيّر الوضع العام
    if name == "DOSING" or name == "TEST":          # نقبل هذين الاسمين فقط
        mode = name                                 # الحلقة الرئيسية تنفّذه
    return jsonify(mode=mode)                       # نرد بالوضع الحالي


app.add_url_rule("/", "home", home)                 # ربط العنوان / بالدالة home
app.add_url_rule("/status", "status", status)       # العنوان /status يعطي القراءات
app.add_url_rule("/mode/<name>", "set_mode", set_mode)  # العنوان /mode/DOSING أو /mode/TEST
threading.Thread(target=app.run, kwargs={"host": "0.0.0.0", "port": 5000}, daemon=True).start()  # الويب في الخلفية

# ---------- 5) الحلقة الرئيسية ----------
print("Smart farm started (Raspberry Pi 5)")        # رسالة البداية
loop = 0                                            # عدّاد الدورات
while True:                                         # تكرار إلى الأبد
    read_sensors()                                  # 1) قراءة الحساسات
    if dosing_button.is_pressed:                    # 2) زر الجرعات مضغوط؟
        mode = "DOSING"                             # نختار وضع الجرعات
    if test_button.is_pressed:                      # زر الاختبار مضغوط؟
        mode = "TEST"                               # نختار وضع الاختبار
    if mode == "DOSING":                            # 3) تنفيذ الوضع
        run_dosing()                                # الجرعات A ثم B
        mode = "AUTO"                               # ثم العودة إلى التلقائي
    elif mode == "TEST":                            # وضع الاختبار
        run_test()                                  # تجربة الأجهزة
        mode = "AUTO"                               # ثم العودة إلى التلقائي
    else:                                           # الوضع AUTO
        auto_control()                              # المروحة والإضاءة والري
    check_alarms()                                  # 4) الإنذارات
    if loop % 5 == 0:                               # 5) الحالة كل 5 ثوانٍ
        show_status()                               # سطر STATUS
    loop = loop + 1                                 # الدورة التالية
    time.sleep(1)                                   # 6) انتظار ثانية ثم التكرار
`;

export const PI_INDEX_HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Farm — Raspberry Pi 5</title>
<style>
body{font-family:system-ui;margin:14px;background:#f2f6f3}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.c{background:#fff;border-radius:10px;padding:8px;box-shadow:0 1px 3px #0002}.c b{display:block;font-size:22px}
button{font-size:16px;padding:8px 14px;margin:6px 4px}#alarm{font-weight:700;margin:10px 0}
</style></head>
<body>
<h2>🌱 المزرعة الذكية — Raspberry Pi 5</h2>
<div class="grid">
 <div class="c">الحرارة °C<b id="temperature">--</b></div><div class="c">الرطوبة %<b id="humidity">--</b></div>
 <div class="c">CO2 ppm<b id="co2">--</b></div><div class="c">pH<b id="ph">--</b></div>
 <div class="c">EC<b id="ec">--</b></div><div class="c">مستوى الماء %<b id="water_level">--</b></div>
 <div class="c">الوضع<b id="mode">--</b></div><div class="c">يوم النمو<b id="day">--</b></div>
 <div class="c">المضخة<b id="pump">--</b></div><div class="c">المروحة<b id="fan">--</b></div>
 <div class="c">الإضاءة<b id="light">--</b></div>
</div>
<div id="alarm">--</div>
<button onclick="fetch('/mode/DOSING')">تشغيل الجرعات</button>
<button onclick="fetch('/mode/TEST')">وضع الاختبار</button>
<script>
function update(){fetch('/status').then(function(r){return r.json()}).then(function(s){
 for (var k in s){var e=document.getElementById(k); if(e) e.textContent = s[k]===null ? '--' : s[k];}
 document.getElementById('alarm').textContent = 'الإنذار: ' + s.alarm;});}
update(); setInterval(update, 2000);
</script></body></html>
`;
