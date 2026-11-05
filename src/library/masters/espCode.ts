// COMPETITION MASTER 02 — ESP32: the study program (MicroPython). Same logic, same names and
// same order as the Raspberry Pi program; only the hardware access differs (machine instead of
// gpiozero, ADC instead of MCP3008, UART instead of serial, a Nextion screen instead of Flask).
// Markers "# >>> NAME" / "# <<< NAME" delimit the parts used by the code-recall practice.

export const ESP_MAIN = String.raw`# COMPETITION MASTER 02 — ESP32 Complete Smart Farm (MicroPython)
# نفس منطق مشروع Raspberry Pi تماماً — الاختلاف فقط في طريقة الوصول إلى الأرجل
import time                                         # الوقت والانتظار (sleep)
import dht                                          # حساس الحرارة والرطوبة DHT22
from machine import Pin, ADC, UART                  # الأرجل + محوّل ADC الداخلي + منافذ UART

# ---------- 1) الإعدادات: نفس قيم مشروع Raspberry Pi ----------
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
dht_sensor = dht.DHT22(Pin(4))                      # DHT22: البيانات على GPIO4
co2_port = UART(2, baudrate=9600, tx=17, rx=16, timeout=300)  # MH-Z19B على UART2 (TX=17، RX=16)
screen = UART(1, baudrate=9600, tx=18, rx=19)       # شاشة Nextion على UART1 (TX=18، RX=19)
ph_adc = ADC(Pin(36), atten=ADC.ATTN_11DB)          # pH على GPIO36 (ADC1 يعمل مع Wi-Fi، حتى 3.3 فولت تقريباً)
ec_adc = ADC(Pin(39), atten=ADC.ATTN_11DB)          # EC على GPIO39 (ADC1)
level_adc = ADC(Pin(34), atten=ADC.ATTN_11DB)       # مستوى الماء على GPIO34 (ADC1)
current_adc = ADC(Pin(35), atten=ADC.ATTN_11DB)     # تيار المضخة ACS712 على GPIO35 (ADC1)
pump = Pin(26, Pin.OUT, value=0)                    # مرحّل مضخة الري على GPIO26 (يبدأ مطفأً)
fan = Pin(27, Pin.OUT, value=0)                     # مرحّل المروحة على GPIO27
light = Pin(14, Pin.OUT, value=0)                   # مرحّل الإضاءة على GPIO14
alarm_lamp = Pin(13, Pin.OUT, value=0)              # مرحّل مصباح الإنذار على GPIO13
dose_a = Pin(25, Pin.OUT, value=0)                  # مرحّل مضخة الجرعات A على GPIO25
dose_b = Pin(33, Pin.OUT, value=0)                  # مرحّل مضخة الجرعات B على GPIO33
dosing_button = Pin(23, Pin.IN, Pin.PULL_UP)        # زر الجرعات على GPIO23 (إلى GND، مقاومة سحب داخلية)
test_button = Pin(32, Pin.IN, Pin.PULL_UP)          # زر الاختبار على GPIO32 (إلى GND)
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


def volts(adc):                                     # جهد مدخل ADC بالفولت
    return adc.read_uv() / 1000000                  # read_uv() تعطي ميكروفولت معايَراً


def read_co2():                                     # قراءة CO2 من MH-Z19B عبر UART
    co2_port.write(bytes([0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79]))  # أمر طلب القراءة (9 بايت)
    reply = co2_port.read(9)                        # ننتظر رداً من 9 بايت (أو None بعد المهلة)
    if reply is None or len(reply) != 9:            # لا رد = الحساس مفصول
        return None                                 # None تعني: لا توجد قراءة
    return reply[2] * 256 + reply[3]                # البايت 2 و 3 = التركيز ppm


# >>> SENSORS
def read_sensors():                                 # قراءة كل الحساسات
    global temperature, humidity, co2, ph, ec, water_level, pump_amps, last_dht_time  # سنغيّر هذه المتغيرات العامة
    if time.time() - last_dht_time >= 2:            # DHT22: قراءة جديدة كل ثانيتين فقط
        last_dht_time = time.time()                 # نحفظ وقت هذه القراءة
        try:                                        # نحاول القراءة
            dht_sensor.measure()                    # في MicroPython نطلب القياس أولاً
            temperature = dht_sensor.temperature()  # الحرارة °C
            humidity = dht_sensor.humidity()        # الرطوبة %
        except OSError:                             # فشل القراءة (الحساس مفصول)
            temperature = None                      # لا توجد قراءة حرارة
            humidity = None                         # ولا رطوبة
    co2 = read_co2()                                # CO2 ppm (أو None)
    ph = round(volts(ph_adc) * 3.5, 2)              # نفس معادلة Raspberry Pi: pH = 3.5 × الجهد
    ec = round(volts(ec_adc) / 0.5, 2)              # EC = الجهد ÷ 0.5
    water_level = round(volts(level_adc) / 3.0 * 100)  # 3 فولت = 100%
    pump_amps = round((volts(current_adc) - 2.5) / 0.185, 2)  # ACS712: 2.5 فولت = صفر أمبير
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
    hour = time.localtime()[3]                      # الساعة الحالية: في MicroPython هي العنصر رقم 3
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
    if device.value() == 1:                         # Pin.value() تعطي 1 (يعمل) أو 0
        return "ON"                                 # يعمل
    return "OFF"                                    # متوقف


def show(name, text):                               # كتابة نص في عنصر على شاشة Nextion
    screen.write(name + '.txt="' + str(text) + '"')  # مثال: tTemp.txt="24.5"
    screen.write(bytes([0xFF, 0xFF, 0xFF]))         # كل أمر Nextion ينتهي بثلاثة 0xFF


def show_status():                                  # الحالة على Serial وعلى الشاشة
    print("STATUS mode=" + mode, "temp=" + str(temperature), "hum=" + str(humidity), "co2=" + str(co2),  # الوضع والهواء
          "ph=" + str(ph), "ec=" + str(ec), "level=" + str(water_level), "pump=" + on_off(pump),  # الماء والمضخة
          "fan=" + on_off(fan), "light=" + on_off(light), "alarm=" + alarm, "day=" + str(growth_day()))  # الباقي
    show("tTemp", temperature)                      # الحرارة على الشاشة
    show("tHum", humidity)                          # الرطوبة
    show("tCO2", co2)                               # CO2
    show("tPH", ph)                                 # pH
    show("tEC", ec)                                 # EC
    show("tLevel", water_level)                     # مستوى الماء
    show("tMode", mode)                             # الوضع
    show("tAlarm", alarm)                           # الإنذار
    show("tDay", growth_day())                      # يوم النمو


# ---------- 4) الحلقة الرئيسية ----------
print("Smart farm started (ESP32)")                 # رسالة البداية على Serial Monitor
loop = 0                                            # عدّاد الدورات
while True:                                         # تكرار إلى الأبد
    read_sensors()                                  # 1) قراءة الحساسات
    if dosing_button.value() == 0:                  # 2) الزر المضغوط يقرأ 0 (موصول إلى GND)
        mode = "DOSING"                             # نختار وضع الجرعات
    if test_button.value() == 0:                    # زر الاختبار مضغوط؟
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
        show_status()                               # Serial + Nextion
    loop = loop + 1                                 # الدورة التالية
    time.sleep(1)                                   # 6) انتظار ثانية ثم التكرار
`;
