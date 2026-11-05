// COMPETITION MASTER 03 — Wiren Board 7.4: the study program (wb-rules, JavaScript ES5 style).
// Same constants, names and order as the Python programs. The Wiren Board has no sleep():
// a timer runs control() every second; irrigation is checked by that function every second
// (water and pump current), and dosing / test are chains of named steps started by setTimeout.
// Markers "// >>> NAME" / "// <<< NAME" delimit the parts used by the code-recall practice.

export const WB_RULES = String.raw`// COMPETITION MASTER 03 — Wiren Board 7.4 Complete Smart Farm (wb-rules)
// نفس منطق مشروعي Raspberry Pi و ESP32 — هنا نقرأ ونكتب "Controls" عبر MQTT بدلاً من الأرجل

// ---------- 1) الإعدادات: نفس القيم في المشاريع الثلاثة ----------
var MAX_TEMP = 30;            // فوق 30 درجة: تشغيل المروحة
var FAN_OFF_TEMP = 27;        // تحت 27 درجة: إيقاف المروحة
var MIN_WATER = 20;           // أقل مستوى ماء مسموح (%) لتشغيل المضخة
var PUMP_SECONDS = 5;         // مدة الري بالثواني
var IRRIGATION_HOURS = [7, 12, 17]; // ساعات الري في اليوم
var LIGHT_ON_HOUR = 6;        // ساعة تشغيل الإضاءة
var LIGHT_OFF_HOUR = 20;      // ساعة إطفاء الإضاءة
var DOSE_A_ML = 10;           // جرعة السماد A بالمليلتر
var DOSE_B_ML = 5;            // جرعة السماد B بالمليلتر
var FLOW_ML_PER_SEC = 2;      // تدفق مضخة الجرعات (يحتاج معايرة على الجهاز الحقيقي)
var PH_MIN = 5.5;             // أقل pH مقبول
var PH_MAX = 6.5;             // أعلى pH مقبول
var EC_MIN = 1.0;             // أقل EC مقبول (mS/cm)
var EC_MAX = 2.5;             // أعلى EC مقبول
var CO2_MAX = 1500;           // أعلى CO2 مقبول (ppm)
var MIN_PUMP_AMPS = 0.2;      // أقل تيار يثبت أن المضخة تعمل فعلاً (أمبير)
var TEST_SECONDS = 2;         // مدة تشغيل كل جهاز في وضع الاختبار

// >>> PINS
// ---------- 2) التوصيلات = أسماء الـControls بصيغة "جهاز/عنصر" ----------
var TEMP = "air-sensor_2/Temperature";   // حساس الهواء RS-485 (عنوان Modbus 2): الحرارة
var HUM = "air-sensor_2/Humidity";       // نفس الحساس: الرطوبة
var CO2 = "air-sensor_2/CO2";            // نفس الحساس: CO2
var PH_VOLTS = "wb-adc/A1";              // جهد حساس pH على المدخل A1
var EC_VOLTS = "wb-adc/A2";              // جهد حساس EC على A2
var LEVEL_VOLTS = "wb-adc/A3";           // جهد حساس المستوى على A3
var CURRENT_VOLTS = "wb-adc/A4";         // جهد حساس التيار ACS712 على A4
var PUMP = "wb-mr6c_32/K1";              // وحدة المرحّلات WB-MR6C (عنوان 32): K1 مضخة الري
var DOSE_A = "wb-mr6c_32/K2";            // K2 مضخة الجرعات A
var DOSE_B = "wb-mr6c_32/K3";            // K3 مضخة الجرعات B
var FAN = "wb-mr6c_32/K4";               // K4 المروحة
var LIGHT = "wb-mr6c_32/K5";             // K5 الإضاءة
var ALARM_LAMP = "wb-mr6c_32/K6";        // K6 مصباح الإنذار
// <<< PINS

// لوحة الحالة: جهاز افتراضي يظهر في تبويب MQTT (وفي واجهة Wiren Board على الجهاز الحقيقي)
defineVirtualDevice("farm", {                      // اسم الجهاز: farm
  title: "Smart Farm",                             // العنوان الظاهر
  cells: {                                         // عناصر الجهاز (Controls)
    mode: { type: "text", value: "AUTO", readonly: true },        // الوضع الحالي
    start_dosing: { type: "pushbutton" },          // زر: تشغيل الجرعات
    start_test: { type: "pushbutton" },            // زر: وضع الاختبار
    temperature: { type: "value", value: 0, readonly: true },     // الحرارة (-1 = لا قراءة)
    humidity: { type: "value", value: 0, readonly: true },        // الرطوبة
    co2: { type: "value", value: 0, readonly: true },             // CO2
    ph: { type: "value", value: 0, readonly: true },              // pH
    ec: { type: "value", value: 0, readonly: true },              // EC
    water_level: { type: "value", value: 0, readonly: true },     // مستوى الماء %
    alarm: { type: "text", value: "NONE", readonly: true },       // الإنذار
    day: { type: "value", value: 1, readonly: true }              // يوم النمو
  }                                                // نهاية العناصر
});                                                // نهاية تعريف الجهاز

// ---------- 3) حالة النظام ----------
var mode = "AUTO";            // الوضع الحالي: AUTO أو DOSING أو TEST
var alarm = "NONE";           // الإنذار الحالي
var pumpFailed = false;       // يصبح true إذا شغّلنا المضخة ولم يمر تيار
var temperature = null;       // آخر قراءة حرارة (null = لا قراءة)
var humidity = null;          // آخر قراءة رطوبة
var co2 = null;               // آخر قراءة CO2
var ph = 0;                   // آخر قراءة pH
var ec = 0;                   // آخر قراءة EC
var waterLevel = 0;           // مستوى الماء %
var pumpAmps = 0;             // تيار المضخة بالأمبير
var lastIrrigationHour = -1;  // آخر ساعة تم فيها الري (حتى لا نكرره)
var startTime = Date.now();   // وقت بدء التشغيل لحساب يوم النمو (ميلي ثانية)
var irrigating = false;       // هل الري جارٍ الآن؟
var irrigationLeft = 0;       // ثوانٍ متبقية من الري
var testStep = 0;             // رقم الجهاز التالي في الاختبار
var loop = 0;                 // عدّاد الدورات

function round2(x) {                       // تقريب إلى رقمين بعد الفاصلة
  return Math.round(x * 100) / 100;        // مثال: 6.1987 → 6.2
}

function sensorValue(name) {               // قيمة حساس Modbus، أو null إذا لم يرد
  if (getControl(name).getError() !== "") return null;   // wb-mqtt-serial يضع خطأ عند انقطاع الحساس
  return dev[name];                        // القيمة الأخيرة المنشورة عبر MQTT
}

function setRelay(name, on) {              // تشغيل أو إيقاف مرحّل
  if (dev[name] !== on) dev[name] = on;    // نكتب فقط عند تغيّر الحالة (أمر Modbus واحد)
}

// >>> SENSORS
function readSensors() {                   // قراءة كل الحساسات
  temperature = sensorValue(TEMP);         // الحرارة °C (أو null)
  humidity = sensorValue(HUM);             // الرطوبة % (أو null)
  co2 = sensorValue(CO2);                  // CO2 ppm (أو null)
  ph = round2(dev[PH_VOLTS] * 3.5);         // نفس معادلات Python: pH = 3.5 × الجهد
  ec = round2(dev[EC_VOLTS] / 0.5);         // EC = الجهد ÷ 0.5
  waterLevel = Math.round(dev[LEVEL_VOLTS] / 3.0 * 100);   // 3 فولت = 100%
  pumpAmps = round2((dev[CURRENT_VOLTS] - 2.5) / 0.185);   // ACS712: 2.5 فولت = صفر أمبير
}
// <<< SENSORS

function waterOk() {                        // هل يوجد ماء كافٍ؟
  return waterLevel >= MIN_WATER && waterLevel <= 100;   // أكثر من 100% = قراءة غير صالحة
}

function growthDay() {                      // يوم النمو منذ بدء التشغيل
  return Math.floor((Date.now() - startTime) / 86400000) + 1;   // 86400000 ميلي ثانية = يوم
}

// >>> IRRIGATION
function irrigationSecond() {              // تُنفَّذ كل ثانية أثناء الري
  if (!waterOk()) {                        // الماء نقص أثناء الري
    log("IRRIGATION stopped: LOW WATER");  // نخبر بالسبب
  } else if (dev[PUMP] && pumpAmps < MIN_PUMP_AMPS) {   // المضخة تعمل ولا يمر تيار
    pumpFailed = true;                     // نتذكر العطل (يظهر الإنذار)
    log("PUMP FAILURE: no current");       // رسالة العطل
  } else if (irrigationLeft > 0) {         // ما زال هناك وقت
    setRelay(PUMP, true);                  // نُبقي المضخة تعمل
    irrigationLeft = irrigationLeft - 1;   // ثانية أقل
    return;                                // نكمل في الثانية القادمة
  }
  setRelay(PUMP, false);                   // نهاية الري (عادية أو بسبب الحماية)
  irrigating = false;                      // لم يعد هناك ري
  log("IRRIGATION end");                   // رسالة نهاية الري
}
// <<< IRRIGATION

// >>> DOSING
function doseAStart() {                     // الخطوة 1: المضخة A وحدها
  setRelay(DOSE_B, false);                  // تأكد أن B متوقفة قبل تشغيل A
  setRelay(DOSE_A, true);                   // تشغيل A
  log("DOSING A {} ml", DOSE_A_ML);         // رسالة الجرعة A
  setTimeout(doseBStart, DOSE_A_ML / FLOW_ML_PER_SEC * 1000);   // بعد (10 ÷ 2) = 5 ثوانٍ
}

function doseBStart() {                     // الخطوة 2: نطفئ A ثم نشغّل B
  setRelay(DOSE_A, false);                  // إيقاف A
  setRelay(DOSE_B, true);                   // ثم تشغيل B
  log("DOSING B {} ml", DOSE_B_ML);         // رسالة الجرعة B
  setTimeout(dosingDone, DOSE_B_ML / FLOW_ML_PER_SEC * 1000);   // بعد (5 ÷ 2) = 2.5 ثانية
}

function dosingDone() {                     // الخطوة 3: النهاية
  setRelay(DOSE_B, false);                  // إيقاف B
  mode = "AUTO";                            // العودة إلى التلقائي
  log("DOSING DONE");                       // انتهت الجرعات
}
// <<< DOSING

var TEST_DEVICES = [["FAN", FAN], ["LIGHT", LIGHT], ["DOSE A", DOSE_A], ["DOSE B", DOSE_B], ["PUMP", PUMP]];   // ترتيب الاختبار

function testNext() {                       // جهاز واحد كل TEST_SECONDS بالترتيب
  if (testStep > 0) setRelay(TEST_DEVICES[testStep - 1][1], false);   // نطفئ الجهاز السابق
  if (testStep >= TEST_DEVICES.length) {    // انتهت القائمة
    mode = "AUTO";                          // العودة إلى التلقائي
    log("TEST DONE");                       // انتهى الاختبار
    return;                                 // لا خطوة أخرى
  }
  var name = TEST_DEVICES[testStep][0];     // اسم الجهاز
  var relay = TEST_DEVICES[testStep][1];    // مرحّل الجهاز
  testStep = testStep + 1;                  // الخطوة التالية
  if (relay === PUMP && !waterOk()) {       // الحماية لا تُلغى في الاختبار
    log("TEST PUMP skipped: LOW WATER");    // لا نشغّل المضخة فارغة
    testNext();                             // ننتقل مباشرة إلى النهاية
    return;                                 // لا نشغّل شيئاً هنا
  }
  log("TEST {}", name);                     // اسم الجهاز الذي نختبره
  setRelay(relay, true);                    // تشغيله
  setTimeout(testNext, TEST_SECONDS * 1000); // بعد ثانيتين: الجهاز التالي
}

function autoControl() {                    // الوضع التلقائي
  var hour = new Date().getHours();         // الساعة الحالية (0 إلى 23)
  // >>> FAN
  if (temperature === null) {               // لا قراءة حرارة: نشغّل المروحة للأمان
    setRelay(FAN, true);                    // تشغيل المروحة
  } else if (temperature > MAX_TEMP) {      // حار جداً
    setRelay(FAN, true);                    // تشغيل المروحة
  } else if (temperature < FAN_OFF_TEMP) {  // برد بما يكفي
    setRelay(FAN, false);                   // إيقاف المروحة (بين 27 و 30 تبقى كما هي)
  }
  // <<< FAN
  // >>> LIGHT
  if (hour >= LIGHT_ON_HOUR && hour < LIGHT_OFF_HOUR) {   // داخل ساعات الإضاءة
    setRelay(LIGHT, true);                  // تشغيل الإضاءة
  } else {                                  // خارج ساعات الإضاءة
    setRelay(LIGHT, false);                 // إطفاء الإضاءة
  }
  // <<< LIGHT
  if (IRRIGATION_HOURS.indexOf(hour) >= 0 && hour !== lastIrrigationHour) {   // حان وقت ري جديد
    lastIrrigationHour = hour;              // نتذكر الساعة حتى لا نكرر الري
    if (waterOk()) {                        // يوجد ماء؟
      log("IRRIGATION start");              // رسالة بداية الري
      irrigating = true;                    // control() ستستدعي irrigationSecond كل ثانية
      irrigationLeft = PUMP_SECONDS;        // 5 ثوانٍ
    } else {                                // لا يوجد ماء
      log("IRRIGATION skipped: LOW WATER"); // نتخطى الري
    }
  }
}

// >>> ALARMS
function checkAlarms() {                    // اختيار أهم إنذار وتشغيل المصباح
  var old = alarm;                          // نحفظ الإنذار السابق
  if (temperature === null || co2 === null || ph < 1 || ph > 14 || waterLevel > 100) {   // قراءة غير صالحة
    alarm = "SENSOR ERROR";                 // خطأ حساس
  } else if (!waterOk()) {                  // الماء قليل
    alarm = "LOW WATER";                    // نقص الماء
  } else if (pumpFailed) {                  // المضخة لم تسحب تياراً
    alarm = "PUMP FAILURE";                 // عطل المضخة
  } else if (temperature > MAX_TEMP) {      // حرارة عالية
    alarm = "HIGH TEMPERATURE";             // ارتفاع الحرارة
  } else if (ph < PH_MIN || ph > PH_MAX || ec < EC_MIN || ec > EC_MAX || co2 > CO2_MAX) {   // خارج الحدود
    alarm = "OUT OF RANGE";                 // قيمة خارج المجال
  } else {                                  // كل شيء طبيعي
    alarm = "NONE";                         // لا يوجد إنذار
  }
  setRelay(ALARM_LAMP, alarm !== "NONE");   // المصباح يعمل عند وجود أي إنذار
  if (alarm !== old) log("ALARM {}", alarm);   // نسجّل الإنذار عند تغيّره فقط
}
// <<< ALARMS

function onOff(name) {                      // "ON" أو "OFF" لعرض حالة مرحّل
  if (dev[name]) return "ON";               // المرحّل مغلق = الجهاز يعمل
  return "OFF";                             // متوقف
}

function showStatus() {                     // الحالة في السجل وفي الجهاز الافتراضي farm
  log("STATUS mode={} temp={} hum={} co2={} ph={} ec={} level={} pump={} fan={} light={} alarm={} day={}",   // نفس سطر Python
    mode, temperature, humidity, co2, ph, ec, waterLevel, onOff(PUMP), onOff(FAN), onOff(LIGHT), alarm, growthDay());   // القيم
  dev["farm/mode"] = mode;                  // تحديث لوحة الحالة في MQTT
  dev["farm/temperature"] = temperature === null ? -1 : temperature;   // -1 = لا قراءة
  dev["farm/humidity"] = humidity === null ? -1 : humidity;   // -1 = لا قراءة
  dev["farm/co2"] = co2 === null ? -1 : co2;   // -1 = لا قراءة
  dev["farm/ph"] = ph;                      // pH
  dev["farm/ec"] = ec;                      // EC
  dev["farm/water_level"] = waterLevel;     // مستوى الماء
  dev["farm/alarm"] = alarm;                // الإنذار
  dev["farm/day"] = growthDay();            // يوم النمو
}

// ---------- 4) الأزرار: قواعد تبدأ الأوضاع ----------
defineRule("dosing_button", {               // قاعدة زر الجرعات
  whenChanged: "farm/start_dosing",         // عند الضغط على زر الجرعات (MQTT)
  then: function () {                       // ماذا نفعل عند الضغط
    if (mode !== "AUTO" || irrigating) return;   // وضع آخر أو ري يعمل الآن
    if (!waterOk()) {                       // لا تسميد بدون ماء
      log("DOSING cancelled: LOW WATER");   // نخبر بالسبب
      return;                               // لا نبدأ
    }
    mode = "DOSING";                        // وضع الجرعات
    doseAStart();                           // الخطوة 1
  }
});

defineRule("test_button", {                 // قاعدة زر الاختبار
  whenChanged: "farm/start_test",           // عند الضغط على زر الاختبار (MQTT)
  then: function () {                       // ماذا نفعل عند الضغط
    if (mode !== "AUTO" || irrigating) return;   // وضع آخر أو ري يعمل الآن
    mode = "TEST";                          // وضع الاختبار
    testStep = 0;                           // من أول جهاز
    testNext();                             // الجهاز الأول
  }
});

// ---------- 5) "الحلقة الرئيسية": مؤقّت يستدعي control() كل ثانية ----------
function control() {                        // تُنفَّذ كل ثانية
  readSensors();                            // 1) قراءة الحساسات
  if (irrigating) {                         // 2) الري الجاري له الأولوية
    irrigationSecond();                     // ثانية واحدة من الري
  } else if (mode === "AUTO") {             // 3) في DOSING و TEST تعمل الخطوات بمؤقّتاتها
    autoControl();                          // المروحة والإضاءة والري
  }
  checkAlarms();                            // 4) الإنذارات
  if (loop % 5 === 0) showStatus();         // 5) الحالة كل 5 ثوانٍ
  loop = loop + 1;                          // الدورة التالية
}

log("Smart farm started (Wiren Board 7.4)");   // رسالة البداية في سجل wb-rules
setInterval(control, 1000);                 // تكرار control كل 1000 ميلي ثانية
`;
