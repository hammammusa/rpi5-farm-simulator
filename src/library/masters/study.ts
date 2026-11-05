// Study material of the three COMPETITION MASTER projects: the 9 study sections, the line-by-line
// glossary, the wiring notes (from / to / why / kind / what if it is cut), the code-recall parts
// (each checked by behaviour with the real scenarios), the "Change One Thing" exercises, the
// real-hardware guide and the comparison between the controllers. Code excerpts are always taken
// from the real programs, so the study text cannot drift from what runs.
import type { ProjectDoc, Wire } from '../../engine/types';
import { masterLayout } from './layout';
import { getPart, hasPart } from '../../engine/parts';
import { pinsOf } from '../../engine/parts/base';
import type { Bi } from '../dsl';
import { espMasterCircuit, piMasterCircuit, wbMasterCircuit } from './circuits';
import { PI_MAIN } from './piCode';
import { ESP_MAIN } from './espCode';
import { WB_RULES } from './wbCode';
import type { MasterBoard } from './scenarios';

export interface StudySection {
  id: string;
  title: Bi;
  /** [first line, last line] patterns; the first line matching `from`, then the first line after it matching `to` */
  ranges: [RegExp, RegExp][];
  text: Bi;
  points: Bi[];
}

export interface RecallPart {
  /** the "# >>> NAME" marker in the program */
  marker: string;
  title: Bi;
  hint: Bi;
  /** scenarios (ids from masterScenarios) that judge the rewritten part by behaviour */
  scenarios: string[];
}

export interface Exercise {
  title: Bi;
  steps: Bi;
  observe: Bi;
  /** the line(s) to change, shown on request */
  answer: string;
}

export interface MasterProject {
  id: 'master-pi5' | 'master-esp32' | 'master-wb7';
  board: MasterBoard;
  num: string;
  title: Bi;
  controller: string;
  language: string;
  /** program file inside the project */
  file: string;
  code: string;
  goal: Bi;
  summary: Bi;
  /** where the status is shown on this controller */
  dashboard: Bi;
  build(): ProjectDoc;
  sections: StudySection[];
  recall: RecallPart[];
  exercises: Exercise[];
  hardware: Bi[];
  libraries: { name: string; install: string }[];
  differences: Bi[];
}

const comment = (b: MasterBoard) => (b === 'wb' ? '//' : '#');

// ====================================================================== code helpers
/** the lines of a section: every range, in order, as [line number (1-based), text] */
export function sectionLines(code: string, s: StudySection): [number, string][] {
  const lines = code.split('\n');
  const out: [number, string][] = [];
  for (const [from, to] of s.ranges) {
    const a = lines.findIndex((l) => from.test(l));
    if (a < 0) continue;
    let b = lines.findIndex((l, i) => i >= a && to.test(l));
    if (b < 0) b = lines.length - 1;
    for (let i = a; i <= b; i++) out.push([i + 1, lines[i]]);
  }
  return out;
}

/** the text between "# >>> NAME" and "# <<< NAME" (markers excluded) */
export function markerRange(code: string, marker: string, b: MasterBoard): { start: number; end: number; body: string } | null {
  const c = comment(b);
  const lines = code.split('\n');
  const a = lines.findIndex((l) => l.trim() === `${c} >>> ${marker}`);
  const z = lines.findIndex((l, i) => i > a && l.trim() === `${c} <<< ${marker}`);
  if (a < 0 || z < 0) return null;
  return { start: a + 1, end: z, body: lines.slice(a + 1, z).join('\n') };
}

/** replace the body of a marked part (code recall) — keeps the markers and the indentation of the first line */
export function replaceMarked(code: string, marker: string, b: MasterBoard, body: string): string {
  const r = markerRange(code, marker, b);
  if (!r) return code;
  const lines = code.split('\n');
  return [...lines.slice(0, r.start), ...body.split('\n'), ...lines.slice(r.end)].join('\n');
}

/** placeholder written in place of a hidden part: still a valid program, but the part does nothing */
export function recallPlaceholder(code: string, marker: string, b: MasterBoard): string {
  const r = markerRange(code, marker, b);
  if (!r) return '';
  const first = r.body.split('\n').find((l) => l.trim()) ?? '';
  const indent = /^\s*/.exec(first)![0];
  const c = comment(b);
  const isDef = /^\s*(def |function )/.test(first);
  if (b === 'wb') {
    const sig = isDef ? first.replace(/\{.*$/, '{').trimEnd() : '';
    return isDef ? `${sig}\n${indent}  ${c} اكتب هنا من ذاكرتك\n${indent}}` : `${indent}${c} اكتب هنا من ذاكرتك`;
  }
  const sig = isDef ? first.replace(/#.*$/, '').trimEnd() : '';
  return isDef ? `${sig}\n${indent}    ${c} اكتب هنا من ذاكرتك\n${indent}    pass` : `${indent}${c} اكتب هنا من ذاكرتك\n${indent}pass`;
}

/** split a code line into code and its comment */
export function splitComment(line: string, b: MasterBoard): { code: string; note: string } {
  const c = comment(b);
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (line.startsWith(c, i)) return { code: line.slice(0, i).trimEnd(), note: line.slice(i + c.length).trim() };
  }
  return { code: line, note: '' };
}

// ====================================================================== Explain Every Line
// [pattern, explanation]: every term found in a line is explained under it.
const TERMS: [RegExp, Bi][] = [
  [/^\s*import |^\s*from \S+ import /, ['import: load a library so its functions can be used.', 'import: تحميل مكتبة لاستخدام دوالها.']],
  [/^\s*def /, ['def: define a function — a named block of code you can call.', 'def: تعريف دالة — مجموعة أوامر لها اسم نستدعيها.']],
  [/^\s*function /, ['function: define a function (JavaScript).', 'function: تعريف دالة (JavaScript).']],
  [/^\s*var /, ['var: create a variable (JavaScript).', 'var: إنشاء متغير (JavaScript).']],
  [/^\s*global /, ['global: this function changes a variable defined outside it.', 'global: الدالة ستغيّر متغيراً معرّفاً خارجها.']],
  [/^\s*if\b|\bif \(/, ['if: a condition — the indented lines run only when it is true.', 'if: شرط — الأسطر التالية تُنفَّذ فقط إذا كان صحيحاً.']],
  [/^\s*elif\b|else if/, ['elif / else if: another condition, checked only if the previous ones were false.', 'elif / else if: شرط آخر يُفحص فقط إذا كانت الشروط السابقة خاطئة.']],
  [/^\s*else\b|\} else \{/, ['else: what to do when no condition above was true.', 'else: ما يُنفَّذ إذا لم يتحقق أي شرط سابق.']],
  [/^\s*while True/, ['while True: repeat forever (the main loop).', 'while True: تكرار إلى الأبد (الحلقة الرئيسية).']],
  [/^\s*for /, ['for: repeat once for every item (or every number of range()).', 'for: تكرار مرة لكل عنصر (أو لكل رقم في range()).']],
  [/\brange\(/, ['range(n): the numbers 0 … n−1.', 'range(n): الأرقام من 0 إلى n−1.']],
  [/\bbreak\b/, ['break: leave the loop now.', 'break: الخروج من الحلقة فوراً.']],
  [/\breturn\b/, ['return: end the function and give back a value.', 'return: إنهاء الدالة وإرجاع قيمة.']],
  [/^\s*try:|^\s*except /, ['try / except: if the reading fails, run the except part instead of stopping the program.', 'try / except: إذا فشلت القراءة يُنفَّذ جزء except بدل توقف البرنامج.']],
  [/\bNone\b|\bnull\b/, ['None / null: "no value" — used here for a missing sensor reading.', 'None / null: "لا توجد قيمة" — نستخدمها لقراءة حساس مفقودة.']],
  [/ and | or | && | \|\| /, ['and / or (&& / ||): combine conditions: and = both, or = at least one.', 'and / or ‏(&& / ||): ربط الشروط: and = كلاهما، or = واحد على الأقل.']],
  [/\bnot \b|!water|!==|!=/, ['not / != : "not" reverses a condition; != means "different from".', 'not / != : ‏not تعكس الشرط، و != تعني "لا يساوي".']],
  [/ == | === /, ['== / ===: compare (is equal?). One = stores a value.', '== / ===: مقارنة (هل يساوي؟). علامة = واحدة تعني تخزين قيمة.']],
  [/ >= | <= | > | < /, ['> < >= <=: greater / less than (or equal).', '> < >= <=: أكبر / أصغر من (أو يساوي).']],
  [/ % /, ['%: remainder of a division — loop % 5 == 0 is true every 5th loop.', '%: باقي القسمة — loop % 5 == 0 تكون صحيحة كل 5 دورات.']],
  [/\bprint\(/, ['print(): write a line to the terminal / serial monitor.', 'print(): كتابة سطر في الطرفية أو شاشة المنفذ التسلسلي.']],
  [/\blog\(/, ['log(): write a line to the wb-rules log; {} is replaced by the next value.', 'log(): كتابة سطر في سجل wb-rules؛ تُستبدل {} بالقيمة التالية.']],
  [/time\.sleep\(/, ['time.sleep(s): wait s seconds (nothing else runs in this program meanwhile).', 'time.sleep(s): انتظار s ثانية (لا يُنفَّذ شيء آخر في البرنامج خلالها).']],
  [/time\.time\(\)|Date\.now\(\)/, ['time.time() / Date.now(): the current time (seconds / milliseconds).', 'time.time() / Date.now(): الوقت الحالي (ثوانٍ / ميلي ثانية).']],
  [/localtime|getHours/, ['current clock hour (0–23), used for the light and irrigation schedule.', 'ساعة الوقت الحالية (0–23) لجدول الإضاءة والري.']],
  [/round\(|round2\(|Math\.round/, ['round: round the number (fewer decimals).', 'round: تقريب الرقم (أرقام عشرية أقل).']],
  [/\bstr\(/, ['str(x): turn a value into text so it can be joined with +.', 'str(x): تحويل القيمة إلى نص لدمجها مع +.']],
  [/OutputDevice\(/, ['gpiozero OutputDevice(n): a digital output on GPIO n (drives the relay input).', 'gpiozero OutputDevice(n): مخرج رقمي على GPIO n (يشغّل مدخل المرحّل).']],
  [/Button\(/, ['gpiozero Button(n): an input with the internal pull-up; is_pressed is True when the button connects it to GND.', 'gpiozero Button(n): مدخل بمقاومة سحب داخلية؛ is_pressed تصبح True عندما يوصله الزر بالأرضي.']],
  [/MCP3008\(/, ['MCP3008(channel=n): the SPI ADC; .voltage = volts on that channel (0–3.3 V).', 'MCP3008(channel=n): محوّل ADC عبر SPI؛ ‎.voltage = الجهد على القناة (0–3.3 فولت).']],
  [/adafruit_dht|dht\.DHT22|DHT22\(/, ['DHT22: digital temperature and humidity sensor on one data pin.', 'DHT22: حساس رقمي للحرارة والرطوبة على طرف بيانات واحد.']],
  [/\.measure\(\)/, ['measure(): MicroPython asks the DHT22 for a new reading first.', 'measure(): في MicroPython نطلب من DHT22 قراءة جديدة أولاً.']],
  [/serial\.Serial\(|UART\(/, ['UART / serial port: two wires TX→RX and RX←TX, same baud rate on both sides (9600).', 'UART / المنفذ التسلسلي: سلكان TX→RX وRX←TX وسرعة واحدة على الطرفين (9600).']],
  [/\.write\(/, ['write(): send bytes on the UART.', 'write(): إرسال بايتات عبر UART.']],
  [/\.read\(/, ['read(n): wait for n bytes (or the timeout).', 'read(n): انتظار n بايت (أو انتهاء المهلة).']],
  [/0xFF/, ['0xFF…: bytes in hexadecimal (0xFF = 255).', '0xFF…: بايتات بالنظام الست عشري (0xFF = 255).']],
  [/Pin\(\d+, Pin\.OUT/, ['machine.Pin(n, Pin.OUT): ESP32 digital output; value=0 starts it LOW.', 'machine.Pin(n, Pin.OUT): مخرج رقمي في ESP32؛ value=0 يبدأ منخفضاً.']],
  [/Pin\.IN, Pin\.PULL_UP/, ['Pin.IN with PULL_UP: input held HIGH inside the chip; the button pulls it to 0.', 'Pin.IN مع PULL_UP: مدخل مرفوع داخلياً إلى HIGH؛ الزر يجعله 0.']],
  [/ADC\(Pin/, ['machine.ADC: the ESP32 internal ADC; ATTN_11DB allows about 0–3.1 V. ADC1 pins (32–39) keep working with Wi-Fi.', 'machine.ADC: محوّل ESP32 الداخلي؛ ATTN_11DB يسمح بنحو 0–3.1 فولت. أرجل ADC1 ‏(32–39) تعمل مع Wi-Fi.']],
  [/read_uv\(\)/, ['read_uv(): the ADC reading in microvolts (calibrated).', 'read_uv(): قراءة ADC بالميكروفولت (معايَرة).']],
  [/\.value\(\)/, ['value(): read a pin (1 / 0).', 'value(): قراءة الطرف (1 / 0).']],
  [/\.on\(\)/, ['on(): switch the output ON (relay closes, the load runs).', 'on(): تشغيل المخرج (المرحّل يغلق والحمل يعمل).']],
  [/\.off\(\)/, ['off(): switch the output OFF.', 'off(): إيقاف المخرج.']],
  [/is_active|is_pressed/, ['is_active / is_pressed: True or False state of a gpiozero device.', 'is_active / is_pressed: حالة True أو False لجهاز gpiozero.']],
  [/Flask\(|add_url_rule|render_template|jsonify/, ['Flask: a small web server on the Pi; add_url_rule links an address to a function, jsonify answers with JSON.', 'Flask: خادم ويب صغير على Pi؛ add_url_rule يربط عنواناً بدالة، وjsonify يرد ببيانات JSON.']],
  [/threading\.Thread/, ['threading.Thread: run the web server in the background so the main loop keeps running (the only thread in the project).', 'threading.Thread: تشغيل خادم الويب في الخلفية لتستمر الحلقة الرئيسية (الخيط الوحيد في المشروع).']],
  [/defineVirtualDevice/, ['defineVirtualDevice: create a device of your own with controls, visible over MQTT.', 'defineVirtualDevice: إنشاء جهاز خاص بك بعناصر تحكم، يظهر عبر MQTT.']],
  [/defineRule/, ['defineRule: a rule — whenChanged: a control; then: what to do when it changes.', 'defineRule: قاعدة — whenChanged: العنصر المراقَب؛ then: ما يُنفَّذ عند تغيّره.']],
  [/dev\[/, ['dev["device/control"]: read or write a control over MQTT (writing a relay sends a Modbus command).', 'dev["جهاز/عنصر"]: قراءة عنصر تحكم أو كتابته عبر MQTT (كتابة المرحّل ترسل أمر Modbus).']],
  [/getControl\(.*getError/, ['getError(): wb-mqtt-serial marks a control with an error when the Modbus device does not answer.', 'getError(): يضع wb-mqtt-serial خطأ على العنصر عندما لا يرد جهاز Modbus.']],
  [/setTimeout\(/, ['setTimeout(f, ms): run function f once, ms milliseconds later.', 'setTimeout(f, ms): تنفيذ الدالة f مرة واحدة بعد ms ميلي ثانية.']],
  [/setInterval\(/, ['setInterval(f, ms): run function f every ms milliseconds (replaces while True + sleep).', 'setInterval(f, ms): تنفيذ الدالة f كل ms ميلي ثانية (بديل while True وsleep).']],
  [/indexOf\(/, ['indexOf(x) >= 0: x is in the list (Python: x in list).', 'indexOf(x) >= 0: العنصر موجود في القائمة (في Python: x in list).']],
  [/ in IRRIGATION_HOURS/, ['x in list: True when x is one of the list items.', 'x in list: صحيحة إذا كانت x أحد عناصر القائمة.']],
  [/^\s*[A-Z_]+ = |^var [A-Z_]+ = /, ['CONSTANT in capitals: a setting you may change; the rest of the code uses its name.', 'ثابت بأحرف كبيرة: إعداد يمكنك تغييره؛ بقية الكود تستخدم اسمه.']],
];

export function explainLine(line: string): Bi[] {
  const out: Bi[] = [];
  for (const [re, b] of TERMS) if (re.test(line)) out.push(b);
  return out;
}

// ====================================================================== the 9 sections
function sections(b: MasterBoard): StudySection[] {
  const py = b !== 'wb';
  const R = (from: string, to: string): [RegExp, RegExp] => [new RegExp(from), new RegExp(to)];
  const pi = b === 'pi';
  return [
    {
      id: 'setup',
      title: ['1 · Setup and wiring', '1 · التهيئة والتوصيلات'],
      ranges: [R(py ? '^# ---------- 1\\)' : '^// ---------- 1\\)', py ? '^# <<< PINS' : '^// <<< PINS')],
      text: pi
        ? ['The settings first, then one line per device: every sensor and every relay gets a name and its GPIO / ADC channel. The names are what the rest of the program uses.', 'الإعدادات أولاً، ثم سطر لكل جهاز: لكل حساس ومرحّل اسم ورقم GPIO أو قناة ADC. بقية البرنامج تستخدم هذه الأسماء فقط.']
        : b === 'esp'
          ? ['Same settings as the Pi. machine.Pin, ADC and UART take the ESP32 GPIO numbers; the analog sensors use ADC1 pins (36, 39, 34, 35) which keep working with Wi-Fi.', 'نفس إعدادات Pi. ‏machine.Pin وADC وUART تأخذ أرقام GPIO في ESP32؛ الحساسات التناظرية على أرجل ADC1 ‏(36 و39 و34 و35) التي تعمل مع Wi-Fi.']
          : ['On the Wiren Board a "pin" is a control name "device/control": the Modbus air sensor (address 2), the four ADC inputs A1–A4 and the six relays of the WB-MR6C (address 32).', 'في Wiren Board "الرجل" هي اسم عنصر "جهاز/عنصر": حساس الهواء Modbus ‏(العنوان 2)، ومداخل ADC الأربعة A1–A4، ومرحّلات WB-MR6C الستة (العنوان 32).'],
      points: [
        ['Change a threshold here and the whole program follows it.', 'غيّر الحد هنا وسيتبعه البرنامج كله.'],
        pi ? ['GPIO numbers are BCM numbers (GPIO17 = physical pin 11).', 'أرقام GPIO هي أرقام BCM ‏(GPIO17 = الرجل الفعلية 11).'] : b === 'esp' ? ['GPIO34–39 are input-only; never use them as outputs.', 'GPIO34–39 للإدخال فقط؛ لا تستخدمها كمخارج.'] : ['The address in the name (air-sensor_2, wb-mr6c_32) must match the address set in the device.', 'العنوان في الاسم (air-sensor_2 و wb-mr6c_32) يجب أن يطابق عنوان الجهاز نفسه.'],
      ],
    },
    {
      id: 'sensors',
      title: ['2 · Reading the sensors', '2 · قراءة الحساسات'],
      ranges: py ? [R('^def read_co2', '^    return reply'), R('^# >>> SENSORS', '^# <<< SENSORS')] : [R('^function sensorValue', '^}'), R('^// >>> SENSORS', '^// <<< SENSORS')],
      text: [
        'One function reads everything and stores it in variables. A missing reading becomes None/null, so the alarms can see it. Analog sensors give volts; one formula per sensor turns volts into pH, EC, % and amperes.',
        'دالة واحدة تقرأ كل شيء وتحفظه في متغيرات. القراءة المفقودة تصبح None/null حتى تراها الإنذارات. الحساسات التناظرية تعطي جهداً؛ ومعادلة لكل حساس تحوّل الجهد إلى pH وEC ونسبة مئوية وأمبير.',
      ],
      points: [
        ['pH = 3.5 × V · EC = V ÷ 0.5 · level = V ÷ 3 × 100 · amps = (V − 2.5) ÷ 0.185 (the simulator modules; calibrate real probes).', 'pH = ‏3.5 × V · ‏EC = V ÷ 0.5 · المستوى = V ÷ 3 × 100 · التيار = (V − 2.5) ÷ 0.185 (وحدات المحاكي؛ عايِر الحساسات الحقيقية).'],
        b === 'wb' ? ['A Modbus sensor that stops answering gets an error flag: getError() is not empty.', 'حساس Modbus الذي يتوقف عن الرد يحصل على علامة خطأ: ‏getError() ليست فارغة.'] : ['DHT22 needs 2 s between readings: the program reads it at most every 2 s.', 'يحتاج DHT22 ثانيتين بين القراءات: البرنامج يقرؤه مرة كل ثانيتين على الأكثر.'],
      ],
    },
    {
      id: 'outputs',
      title: ['3 · Driving the outputs', '3 · تشغيل المخرجات'],
      ranges: pi ? [R('^pump = OutputDevice', '^dose_b = OutputDevice'), R('^def on_off', '^    return "OFF"')] : b === 'esp' ? [R('^pump = Pin', '^dose_b = Pin'), R('^def on_off', '^    return "OFF"')] : [R('^var PUMP = ', '^var ALARM_LAMP'), R('^function setRelay', '^}')],
      text: pi
        ? ['A GPIO cannot power a pump: it switches the input of a relay module, and the relay contact switches the 12 V load. on() closes the relay, off() opens it.', 'لا يستطيع GPIO تشغيل مضخة: هو يشغّل مدخل وحدة المرحّل، وتلامس المرحّل يوصل حمل 12 فولت. ‏on() يغلق المرحّل وoff() يفتحه.']
        : b === 'esp'
          ? ['Same idea as the Pi: Pin.on()/off() drive the relay inputs (3.3 V logic, active-HIGH module); the relays switch the 12 V loads.', 'نفس فكرة Pi: ‏Pin.on()/off() تشغّل مداخل المرحّلات (منطق 3.3 فولت، وحدة تعمل بـHIGH)؛ والمرحّلات توصل أحمال 12 فولت.']
          : ['Writing true to "wb-mr6c_32/K1" makes wb-mqtt-serial send a Modbus command to relay K1. setRelay writes only when the state changes, so the bus is not flooded.', 'كتابة true في "wb-mr6c_32/K1" تجعل wb-mqtt-serial يرسل أمر Modbus إلى المرحّل K1. ‏setRelay تكتب فقط عند تغيّر الحالة حتى لا يزدحم الناقل.'],
      points: [
        ['Loads: pump, fan, light and dosing pumps on the 12 V supply, never on the controller pins.', 'الأحمال: المضخة والمروحة والإضاءة ومضخات الجرعات على مصدر 12 فولت، وليس على أرجل المتحكم أبداً.'],
        ['The alarm lamp is a 12 V lamp on its own relay channel.', 'مصباح الإنذار مصباح 12 فولت على قناة مرحّل خاصة به.'],
      ],
    },
    {
      id: 'protection',
      title: ['4 · Conditions and protection', '4 · الشروط والحماية'],
      ranges: py ? [R('^def water_ok', '^    return water_level'), R('^# >>> IRRIGATION', '^# <<< IRRIGATION')] : [R('^function waterOk', '^}'), R('^// >>> IRRIGATION', '^// <<< IRRIGATION')],
      text: [
        'water_ok() is the one place that decides "is there enough water?". Irrigation checks it before and during every second, and checks the pump current: a pump that runs dry or is not connected draws no current, so the program stops it and remembers the failure.',
        'الدالة water_ok() هي المكان الوحيد الذي يقرر "هل يوجد ماء كافٍ؟". الري يفحصها قبل كل ثانية وأثناءها، ويفحص تيار المضخة: المضخة المفصولة أو العالقة لا تسحب تياراً، فيوقفها البرنامج ويتذكر العطل.',
      ],
      points: [
        ['A level above 100 % is treated as an invalid reading, not as "full".', 'المستوى فوق 100٪ يُعدّ قراءة غير صالحة وليس "ممتلئاً".'],
        ['The pump is always switched off at the end, whatever stopped the irrigation.', 'تُطفأ المضخة دائماً في النهاية مهما كان سبب توقف الري.'],
      ],
    },
    {
      id: 'auto',
      title: ['5 · AUTO mode', '5 · وضع AUTO'],
      ranges: py ? [R('^def auto_control', 'print\\("IRRIGATION skipped')] : [R('^function autoControl', '^}$')],
      text: [
        'Every second: the fan follows the temperature with two thresholds (ON above 30 °C, OFF below 27 °C — between them it keeps its state, so it does not click on and off), the light follows the clock (06:00–20:00), and irrigation starts once at 07:00, 12:00 and 17:00 if there is water.',
        'كل ثانية: المروحة تتبع الحرارة بحدّين (تعمل فوق 30 °م وتتوقف تحت 27 °م — بينهما تبقى على حالها فلا تتقطع)، والإضاءة تتبع الساعة (06:00–20:00)، والري يبدأ مرة واحدة الساعة 07:00 و12:00 و17:00 إذا وُجد ماء.',
      ],
      points: [
        ['No temperature reading → the fan runs (the safe side for the plants).', 'لا توجد قراءة حرارة ← تعمل المروحة (الجانب الآمن للنباتات).'],
        ['last_irrigation_hour prevents watering again and again during the same hour.', 'المتغير last_irrigation_hour يمنع تكرار الري خلال الساعة نفسها.'],
      ],
    },
    {
      id: 'dosing',
      title: ['6 · DOSING mode', '6 · وضع DOSING'],
      ranges: [R(`^${comment(b)} >>> DOSING`, `^${comment(b)} <<< DOSING`)],
      text: [
        'Check the water, switch B off, run A for (dose ÷ flow) seconds, switch A off, run B, switch B off, print DOSING DONE. A and B are never on together. The volumes are only as accurate as the flow calibration of the real pumps (here 2 ml/s).',
        'افحص الماء، أطفئ B، شغّل A لمدة (الجرعة ÷ التدفق) ثانية، أطفئ A، شغّل B، أطفئ B، اطبع DOSING DONE. لا تعمل A وB معاً أبداً. دقة الكميات تعتمد على معايرة تدفق المضخات الحقيقية (هنا 2 مل/ث) وليست مضمونة بالحساب.',
      ],
      points: [
        pi || b === 'esp' ? ['Started by the DOSING button (or /mode/DOSING on the Pi web page).', 'يبدأ بزر DOSING (أو ‎/mode/DOSING من صفحة ويب Pi).'] : ['Started by the pushbutton farm/start_dosing (MQTT tab); setTimeout chains the three steps.', 'يبدأ بالزر farm/start_dosing ‏(تبويب MQTT)؛ ‏setTimeout تربط الخطوات الثلاث.'],
        ['The Smart Farm counts the millilitres really pumped, so you can check the doses.', 'المزرعة الذكية تعدّ المليلترات التي ضُخّت فعلاً، فيمكنك التحقق من الجرعات.'],
      ],
    },
    {
      id: 'test',
      title: ['7 · TEST mode', '7 · وضع TEST'],
      ranges: py ? [R('^def run_test', 'print\\("TEST DONE"\\)')] : [R('^var TEST_DEVICES', '^}$')],
      text: [
        'Each output runs for 2 s in turn: fan, light, dose A, dose B, then the pump — and the pump only if there is water. The protection stays active in test mode.',
        'يعمل كل مخرج ثانيتين بالترتيب: المروحة، الإضاءة، الجرعة A، الجرعة B، ثم المضخة — والمضخة فقط إذا وُجد ماء. الحماية تبقى فعّالة في وضع الاختبار.',
      ],
      points: [
        ['Use it after wiring a real farm: every relay should click once and every load should run.', 'استخدمه بعد توصيل مزرعة حقيقية: يجب أن ينقر كل مرحّل مرة ويعمل كل حمل.'],
        ['Dose A and dose B run one after the other, never together.', 'الجرعة A والجرعة B تعملان الواحدة بعد الأخرى، لا معاً.'],
      ],
    },
    {
      id: 'alarms',
      title: ['8 · Alarms', '8 · الإنذارات'],
      ranges: [R(`^${comment(b)} >>> ALARMS`, `^${comment(b)} <<< ALARMS`)],
      text: [
        'One if/elif chain picks the most important alarm: SENSOR ERROR, LOW WATER, PUMP FAILURE, HIGH TEMPERATURE, OUT OF RANGE, or NONE. The alarm lamp is on for any alarm, and the alarm is printed only when it changes.',
        'سلسلة if/elif واحدة تختار أهم إنذار: ‏SENSOR ERROR ثم LOW WATER ثم PUMP FAILURE ثم HIGH TEMPERATURE ثم OUT OF RANGE، أو NONE. مصباح الإنذار يعمل مع أي إنذار، ويُطبع الإنذار فقط عند تغيّره.',
      ],
      points: [
        ['The order of the elif lines is the priority: a missing sensor matters more than a high temperature.', 'ترتيب أسطر elif هو الأولوية: الحساس المفقود أهم من ارتفاع الحرارة.'],
        ['PUMP FAILURE stays until the program restarts (the pump must be checked by a person).', 'إنذار PUMP FAILURE يبقى حتى إعادة تشغيل البرنامج (يجب أن يفحص شخص المضخة).'],
      ],
    },
    {
      id: 'display',
      title: ['9 · Display and monitoring', '9 · العرض والمراقبة'],
      ranges: pi ? [R('^def show_status', 'day=" \\+ str\\(growth_day'), R('^# ---------- 4\\)', '^threading\\.Thread'), R('^# ---------- 5\\)', 'time\\.sleep\\(1\\)\\s+# 6')] : b === 'esp' ? [R('^def show\\(', 'show\\("tDay"'), R('^# ---------- 4\\)', 'time\\.sleep\\(1\\)\\s+# 6')] : [R('^defineVirtualDevice', '^\\}\\);'), R('^function showStatus', '^}$'), R('^// ---------- 4\\)', '^setInterval')],
      text: pi
        ? ['Every 5 s a STATUS line goes to the terminal, and the Flask page (Web tab) asks /status every 2 s. The main loop at the end is the whole program in 6 steps.', 'كل 5 ثوانٍ يُطبع سطر STATUS في الطرفية، وصفحة Flask ‏(تبويب Web) تطلب ‎/status كل ثانيتين. الحلقة الرئيسية في النهاية هي البرنامج كله في 6 خطوات.']
        : b === 'esp'
          ? ['Every 5 s a STATUS line goes to the serial monitor and the same values to the Nextion screen (tTemp.txt="…" + three 0xFF). There is no web server on this ESP32 program; on real hardware one could be added with Wi-Fi later.', 'كل 5 ثوانٍ يُطبع سطر STATUS في شاشة المنفذ التسلسلي، وتُرسل القيم نفسها إلى شاشة Nextion ‏(tTemp.txt="…" ثم ثلاثة 0xFF). لا يوجد خادم ويب في برنامج ESP32 هذا؛ يمكن إضافته لاحقاً على الجهاز الحقيقي عبر Wi-Fi.']
          : ['Every 5 s a STATUS line goes to the wb-rules log and the values to the virtual device "farm" (MQTT tab). Its two pushbuttons start DOSING and TEST. setInterval(control, 1000) is the main loop.', 'كل 5 ثوانٍ يُكتب سطر STATUS في سجل wb-rules، وتُرسل القيم إلى الجهاز الافتراضي "farm" ‏(تبويب MQTT). زرّاه يبدآن DOSING وTEST. ‏setInterval(control, 1000) هي الحلقة الرئيسية.'],
      points: [
        ['STATUS mode=… temp=… … alarm=… day=… is the same line on the three controllers.', 'السطر STATUS mode=… temp=… … alarm=… day=… هو نفسه في المتحكمات الثلاثة.'],
        ['The status panel of this page reads that line from the running program.', 'لوحة الحالة في هذه الصفحة تقرأ هذا السطر من البرنامج أثناء تشغيله.'],
      ],
    },
  ];
}

// ====================================================================== code recall
function recall(b: MasterBoard): RecallPart[] {
  return [
    { marker: 'FAN', title: ['Fan with two thresholds', 'المروحة بحدّين'], hint: ['None → on; above MAX_TEMP → on; below FAN_OFF_TEMP → off.', 'None ← تشغيل؛ فوق MAX_TEMP ← تشغيل؛ تحت FAN_OFF_TEMP ← إيقاف.'], scenarios: ['high_temp', 'sensor_failure'] },
    { marker: 'LIGHT', title: ['Lighting schedule', 'جدول الإضاءة'], hint: ['On from LIGHT_ON_HOUR until LIGHT_OFF_HOUR, off otherwise.', 'تعمل من LIGHT_ON_HOUR حتى LIGHT_OFF_HOUR، وتنطفئ في غير ذلك.'], scenarios: ['lighting', 'normal'] },
    { marker: 'IRRIGATION', title: ['Protected irrigation', 'الري مع الحماية'], hint: b === 'wb' ? ['Each second: stop on low water, stop on no current, else keep the pump on and count down; at the end switch it off.', 'كل ثانية: توقف عند نقص الماء، توقف عند غياب التيار، وإلا أبقِ المضخة تعمل وأنقص العدّاد؛ وفي النهاية أطفئها.'] : ['print start; for each second: check water, pump on, sleep 1, check current; pump off; print end.', 'اطبع البداية؛ لكل ثانية: افحص الماء، شغّل المضخة، انتظر ثانية، افحص التيار؛ أطفئ المضخة؛ اطبع النهاية.'], scenarios: ['irrigation', 'wiring_error'] },
    { marker: 'DOSING', title: ['Dosing A then B', 'الجرعات A ثم B'], hint: ['Water check, B off, A on for DOSE_A_ML ÷ FLOW, A off, B on for DOSE_B_ML ÷ FLOW, B off, DOSING DONE.', 'فحص الماء، B إيقاف، A تشغيل لمدة DOSE_A_ML ÷ FLOW، A إيقاف، B تشغيل لمدة DOSE_B_ML ÷ FLOW، B إيقاف، DOSING DONE.'], scenarios: ['dosing'] },
    { marker: 'ALARMS', title: ['Alarm priorities', 'أولويات الإنذارات'], hint: ['SENSOR ERROR → LOW WATER → PUMP FAILURE → HIGH TEMPERATURE → OUT OF RANGE → NONE; lamp on for any alarm; print on change.', 'SENSOR ERROR ← LOW WATER ← PUMP FAILURE ← HIGH TEMPERATURE ← OUT OF RANGE ← NONE؛ المصباح مع أي إنذار؛ اطبع عند التغيّر.'], scenarios: ['water_low', 'high_temp', 'sensor_failure'] },
    { marker: 'SENSORS', title: ['Reading the sensors', 'قراءة الحساسات'], hint: ['DHT/air sensor (None on failure), CO₂, then the four formulas.', 'حساس الهواء (None عند الفشل)، ثم CO₂، ثم المعادلات الأربع.'], scenarios: ['normal', 'sensor_failure'] },
  ];
}

// ====================================================================== exercises
function exercises(b: MasterBoard): Exercise[] {
  const pi = b === 'pi';
  const wb = b === 'wb';
  const fanPin = pi ? 'GPIO22' : b === 'esp' ? 'GPIO27' : 'K4';
  return [
    {
      title: ['Change the fan threshold', 'غيّر حد تشغيل المروحة'],
      steps: ['Set MAX_TEMP to 28 and FAN_OFF_TEMP to 25. Run, then set the farm air temperature to 29 °C.', 'اجعل MAX_TEMP = 28 وFAN_OFF_TEMP = 25. شغّل، ثم اضبط حرارة هواء المزرعة على 29 °م.'],
      observe: ['The fan starts at 29 °C now and the HIGH TEMPERATURE alarm appears.', 'تعمل المروحة الآن عند 29 °م ويظهر إنذار HIGH TEMPERATURE.'],
      answer: wb ? 'var MAX_TEMP = 28;\nvar FAN_OFF_TEMP = 25;' : 'MAX_TEMP = 28\nFAN_OFF_TEMP = 25',
    },
    {
      title: ['Change the irrigation time', 'غيّر مدة الري'],
      steps: ['Set PUMP_SECONDS to 8 and IRRIGATION_HOURS to include the current hour. Run and watch the pump.', 'اجعل PUMP_SECONDS = 8 وأضف الساعة الحالية إلى IRRIGATION_HOURS. شغّل وراقب المضخة.'],
      observe: ['IRRIGATION start … IRRIGATION end, about 8 s apart; the farm reservoir flow shows the pump running.', 'يظهر IRRIGATION start ثم IRRIGATION end بعد نحو 8 ثوانٍ؛ ويُظهر تدفق المزرعة عمل المضخة.'],
      answer: wb ? 'var PUMP_SECONDS = 8;\nvar IRRIGATION_HOURS = [7, 12, 17, 9];' : 'PUMP_SECONDS = 8\nIRRIGATION_HOURS = [7, 12, 17, 9]',
    },
    wb
      ? {
          title: ['Move the fan to another relay', 'انقل المروحة إلى مرحّل آخر'],
          steps: ['Move the fan wire from K4 NO to K6 NO and the alarm lamp to K4, then swap FAN and ALARM_LAMP in the PINS part.', 'انقل سلك المروحة من K4 NO إلى K6 NO ومصباح الإنذار إلى K4، ثم بدّل FAN وALARM_LAMP في جزء PINS.'],
          observe: ['Both work again. If you change only the wire or only the code, the wrong load switches.', 'يعمل الاثنان من جديد. إذا غيّرت السلك فقط أو الكود فقط، يعمل الحمل الخطأ.'],
          answer: 'var FAN = "wb-mr6c_32/K6";\nvar ALARM_LAMP = "wb-mr6c_32/K4";',
        }
      : {
          title: ['Move the fan to another GPIO', 'انقل المروحة إلى GPIO آخر'],
          steps: pi ? ['Move the wire from GPIO22 (pin 15) to GPIO24 (pin 18) and change OutputDevice(22) to OutputDevice(24).', 'انقل السلك من GPIO22 ‏(الرجل 15) إلى GPIO24 ‏(الرجل 18) وغيّر OutputDevice(22) إلى OutputDevice(24).'] : ['Move the wire from GPIO27 to GPIO21 and change Pin(27, …) to Pin(21, …). Do not use GPIO34–39 (input-only).', 'انقل السلك من GPIO27 إلى GPIO21 وغيّر Pin(27, …) إلى Pin(21, …). لا تستخدم GPIO34–39 ‏(للإدخال فقط).'],
          observe: [`The fan works again from the new pin. If only the code or only the wire changes, the fan stays off while the code thinks it is on (${fanPin}).`, `تعمل المروحة من الرجل الجديدة. إذا تغيّر الكود فقط أو السلك فقط تبقى المروحة متوقفة بينما يظن الكود أنها تعمل (${fanPin}).`],
          answer: pi ? 'fan = OutputDevice(24)' : 'fan = Pin(21, Pin.OUT, value=0)',
        },
    {
      title: ['Disconnect the level sensor', 'افصل حساس المستوى'],
      steps: ['While the program runs, delete the signal wire of the water-level sensor.', 'أثناء عمل البرنامج احذف سلك إشارة حساس مستوى الماء.'],
      observe: ['The level reads wrong (near 0): LOW WATER alarm, the lamp lights, irrigation and dosing are refused. Put the wire back (Ctrl+Z).', 'يُقرأ المستوى بشكل خاطئ (قريباً من 0): إنذار LOW WATER، يضيء المصباح، ويُرفض الري والجرعات. أعد السلك (Ctrl+Z).'],
      answer: wb ? '— (wire A3)' : pi ? '— (wire MCP3008 CH2)' : '— (wire GPIO34)',
    },
    {
      title: ['Change the dose', 'غيّر حجم الجرعة'],
      steps: ['Set DOSE_A_ML to 20 and DOSE_B_ML to 10, then start DOSING.', 'اجعل DOSE_A_ML = 20 وDOSE_B_ML = 10، ثم ابدأ DOSING.'],
      observe: ['A runs 10 s and B 5 s; the Smart Farm totals show about 20 ml and 10 ml. Changing FLOW_ML_PER_SEC without changing the pump only changes the time, not the real flow — that is why calibration matters.', 'تعمل A ‏10 ثوانٍ وB ‏5 ثوانٍ؛ وتُظهر المزرعة نحو 20 مل و10 مل. تغيير FLOW_ML_PER_SEC دون تغيير المضخة يغيّر الزمن فقط وليس التدفق الحقيقي — لذلك المعايرة مهمة.'],
      answer: wb ? 'var DOSE_A_ML = 20;\nvar DOSE_B_ML = 10;' : 'DOSE_A_ML = 20\nDOSE_B_ML = 10',
    },
    {
      title: ['Break the pump while it runs', 'عطّل المضخة أثناء التشغيل'],
      steps: ['Select the main pump, set its fault to "Pump failure" and start irrigation (put the current hour in IRRIGATION_HOURS).', 'اختر المضخة الرئيسية، واضبط عطلها على "Pump failure"، وابدأ الري (ضع الساعة الحالية في IRRIGATION_HOURS).'],
      observe: ['The relay closes but the ACS712 measures no current: PUMP FAILURE: no current, alarm PUMP FAILURE.', 'يغلق المرحّل لكن ACS712 لا يقيس تياراً: ‏PUMP FAILURE: no current، وإنذار PUMP FAILURE.'],
      answer: '—',
    },
    {
      title: ['Change the lighting hours', 'غيّر وقت الإضاءة'],
      steps: ['Set LIGHT_ON_HOUR to 8 and LIGHT_OFF_HOUR to 18. Use the clock (Fast-forward) to pass 18:00.', 'اجعل LIGHT_ON_HOUR = 8 وLIGHT_OFF_HOUR = 18. استخدم الساعة (التسريع) لتجاوز 18:00.'],
      observe: ['The grow light switches off at 18:00 instead of 20:00.', 'تنطفئ الإضاءة الساعة 18:00 بدلاً من 20:00.'],
      answer: wb ? 'var LIGHT_ON_HOUR = 8;\nvar LIGHT_OFF_HOUR = 18;' : 'LIGHT_ON_HOUR = 8\nLIGHT_OFF_HOUR = 18',
    },
    {
      title: ['Tighten the pH range', 'ضيّق مجال pH'],
      steps: ['Set PH_MAX to 6.0 (the farm solution is about pH 6.2).', 'اجعل PH_MAX = 6.0 ‏(محلول المزرعة نحو pH 6.2).'],
      observe: ['ALARM OUT OF RANGE and the lamp lights; nothing else changes because OUT OF RANGE only warns.', 'يظهر ALARM OUT OF RANGE ويضيء المصباح؛ ولا يتغير شيء آخر لأن OUT OF RANGE تحذير فقط.'],
      answer: wb ? 'var PH_MAX = 6.0;' : 'PH_MAX = 6.0',
    },
  ];
}

// ====================================================================== projects
const cache: Record<string, ProjectDoc> = {};
const arranged = (id: MasterBoard, build: () => ProjectDoc) => () => structuredClone((cache[id] ??= masterLayout(id, build())));

export const MASTER_PROJECTS: MasterProject[] = [
  {
    id: 'master-pi5',
    board: 'pi',
    num: '01',
    title: ['COMPETITION MASTER 01 — Raspberry Pi 5 Complete Smart Farm', 'COMPETITION MASTER 01 — المزرعة الذكية الكاملة على Raspberry Pi 5'],
    controller: 'Raspberry Pi 5 Model B',
    language: 'Python 3 (gpiozero, pyserial, adafruit_dht, Flask)',
    file: 'main.py',
    code: PI_MAIN,
    goal: ['Read six sensors, run the AUTO / DOSING / TEST modes with protections and alarms, and show everything in the terminal and on a small Flask web page.', 'قراءة ستة حساسات، وتشغيل أوضاع AUTO وDOSING وTEST مع الحماية والإنذارات، وعرض كل شيء في الطرفية وفي صفحة ويب Flask بسيطة.'],
    summary: ['DHT22 (GPIO16), MH-Z19B (UART0), MCP3008 (SPI0: pH, EC, level, ACS712), 4-channel + 2-channel relays, 12 V loads, two buttons.', 'DHT22 ‏(GPIO16)، وMH-Z19B ‏(UART0)، وMCP3008 ‏(SPI0: pH وEC والمستوى وACS712)، ومرحّل 4 قنوات + مرحّل قناتين، وأحمال 12 فولت، وزرّان.'],
    dashboard: ['Terminal (STATUS lines) + Web tab (Flask page on port 5000).', 'الطرفية (أسطر STATUS) + تبويب Web ‏(صفحة Flask على المنفذ 5000).'],
    build: arranged('pi', piMasterCircuit),
    sections: sections('pi'),
    recall: recall('pi'),
    exercises: exercises('pi'),
    hardware: [
      ['Enable SPI, the serial port (disable the login shell on it) with sudo raspi-config → Interface Options.', 'فعّل SPI والمنفذ التسلسلي (مع تعطيل تسجيل الدخول عليه) من sudo raspi-config ← Interface Options.'],
      ['Install the libraries (below) in a virtual environment: python3 -m venv --system-site-packages farm && . farm/bin/activate.', 'ثبّت المكتبات (أدناه) في بيئة افتراضية: python3 -m venv --system-site-packages farm ثم ‎. farm/bin/activate.'],
      ['Wire with the Pi switched off. Relay modules: use the 5 V pin for VCC; the GPIO signal is 3.3 V — choose modules that switch at 3.3 V (active-HIGH as in the code).', 'وصّل والـPi مطفأ. وحدات المرحّل: VCC من رجل 5 فولت؛ وإشارة GPIO بجهد 3.3 فولت — اختر وحدات تعمل بـ3.3 فولت (تعمل بـHIGH كما في الكود).'],
      ['The MH-Z19B needs 5 V power but its UART is 3.3 V: TX→GPIO15 (RX), RX←GPIO14 (TX).', 'يحتاج MH-Z19B تغذية 5 فولت لكن UART الخاص به 3.3 فولت: TX→GPIO15 ‏(RX)، وRX←GPIO14 ‏(TX).'],
      ['pH/EC modules: calibrate with buffer solutions and replace the factors 3.5 and 0.5 with your calibration.', 'وحدات pH وEC: عايِرها بمحاليل قياسية واستبدل المعاملين 3.5 و0.5 بنتيجة المعايرة.'],
      ['Copy main.py and templates/index.html, run python3 main.py, open http://<pi-address>:5000.', 'انسخ main.py و templates/index.html، ثم شغّل python3 main.py وافتح http://<عنوان-pi>:5000.'],
    ],
    libraries: [
      { name: 'gpiozero (+ lgpio on Pi 5)', install: 'sudo apt install python3-gpiozero python3-lgpio' },
      { name: 'pyserial', install: 'sudo apt install python3-serial' },
      { name: 'adafruit-circuitpython-dht', install: 'pip install adafruit-circuitpython-dht' },
      { name: 'Flask', install: 'sudo apt install python3-flask' },
      { name: 'MCP3008 (gpiozero, SPI)', install: 'sudo raspi-config → Interface Options → SPI → enable' },
    ],
    differences: [
      ['The sensors, the ADC and the relays are simulated part models; their formulas are the simulator modules, not your real probes.', 'الحساسات وADC والمرحّلات نماذج محاكاة؛ معادلاتها خاصة بوحدات المحاكي وليست حساساتك الحقيقية.'],
      ['The Flask page is served inside the simulator (Web tab); on the Pi it is a real server on port 5000.', 'صفحة Flask تُخدم داخل المحاكي (تبويب Web)؛ وعلى Pi تكون خادماً حقيقياً على المنفذ 5000.'],
      ['The DHT22 never fails randomly here; on real hardware an occasional read error is normal (the alarm can blink).', 'لا يفشل DHT22 عشوائياً هنا؛ على الجهاز الحقيقي خطأ قراءة عرضي أمر طبيعي (قد يومض الإنذار).'],
      ['Pump, fan and dosing pumps are resistive models; inrush current and back-EMF are not simulated — use relay modules with flyback protection.', 'المضخة والمروحة ومضخات الجرعات نماذج مقاومة؛ لا يُحاكى تيار البدء ولا الجهد العكسي — استخدم وحدات مرحّل فيها حماية.'],
    ],
  },
  {
    id: 'master-esp32',
    board: 'esp',
    num: '02',
    title: ['COMPETITION MASTER 02 — ESP32 Complete Smart Farm', 'COMPETITION MASTER 02 — المزرعة الذكية الكاملة على ESP32'],
    controller: 'ESP32-DevKitC V4 (ESP32-WROOM-32)',
    language: 'MicroPython 1.29 (machine, dht, time)',
    file: 'esp/main.py',
    code: ESP_MAIN,
    goal: ['The same farm and the same program structure as the Raspberry Pi, written with machine.Pin / ADC / UART, with the status on the serial monitor and on a Nextion screen.', 'نفس المزرعة ونفس هيكل برنامج Raspberry Pi، مكتوباً باستخدام machine.Pin وADC وUART، مع عرض الحالة على شاشة المنفذ التسلسلي وعلى شاشة Nextion.'],
    summary: ['DHT22 (GPIO4), MH-Z19B (UART2), pH/EC/level/ACS712 on ADC1 (GPIO36/39/34/35), Nextion (UART1), relays on GPIO26/27/14/13/25/33, buttons on GPIO23/32, 5 V and 12 V supplies.', 'DHT22 ‏(GPIO4)، وMH-Z19B ‏(UART2)، وpH وEC والمستوى وACS712 على ADC1 ‏(GPIO36/39/34/35)، وNextion ‏(UART1)، ومرحّلات على GPIO26/27/14/13/25/33، وأزرار على GPIO23/32، ومصدرا 5 و12 فولت.'],
    dashboard: ['Serial monitor (STATUS lines) + Nextion screen (Nextion tab). No web server.', 'شاشة المنفذ التسلسلي (أسطر STATUS) + شاشة Nextion ‏(تبويب Nextion). لا يوجد خادم ويب.'],
    build: arranged('esp', espMasterCircuit),
    sections: sections('esp'),
    recall: recall('esp'),
    exercises: exercises('esp'),
    hardware: [
      ['Flash MicroPython for ESP32 (esptool.py --chip esp32 write_flash -z 0x1000 ESP32_GENERIC-….bin).', 'ثبّت MicroPython على ESP32 ‏(esptool.py --chip esp32 write_flash -z 0x1000 ESP32_GENERIC-….bin).'],
      ['Copy the program as main.py with Thonny or mpremote (mpremote cp esp/main.py :main.py).', 'انسخ البرنامج باسم main.py باستخدام Thonny أو mpremote ‏(mpremote cp esp/main.py :main.py).'],
      ['Power the relays, sensors and the Nextion from a separate 5 V supply and join its GND with the ESP32 GND.', 'غذِّ المرحّلات والحساسات وNextion من مصدر 5 فولت منفصل واربط أرضيه بأرضي ESP32.'],
      ['ESP32 ADC inputs accept at most about 3.1 V with ATTN_11DB: the ACS712 output (2.5 V + 0.185 V/A) stays below that up to about 3 A; use a divider for bigger pumps.', 'مداخل ADC في ESP32 تقبل نحو 3.1 فولت على الأكثر مع ATTN_11DB: خرج ACS712 ‏(2.5 فولت + 0.185 فولت/أمبير) يبقى تحتها حتى نحو 3 أمبير؛ استخدم مقسّم جهد للمضخات الأكبر.'],
      ['Load the Nextion page (text boxes tTemp … tDay) into the screen with the Nextion Editor (.tft file).', 'حمّل صفحة Nextion ‏(مربعات النص tTemp … tDay) إلى الشاشة باستخدام Nextion Editor ‏(ملف ‎.tft).'],
      ['Set the ESP32 clock (ntptime over Wi-Fi or an RTC): the schedule uses time.localtime().', 'اضبط ساعة ESP32 ‏(ntptime عبر Wi-Fi أو RTC): الجدول يستخدم time.localtime().'],
    ],
    libraries: [
      { name: 'MicroPython firmware (machine, dht, time built in)', install: 'https://micropython.org/download/ESP32_GENERIC/' },
      { name: 'mpremote / Thonny', install: 'pip install mpremote' },
      { name: 'Nextion Editor (screen design)', install: 'Windows application from nextion.tech' },
    ],
    differences: [
      ['MicroPython 1.29 really runs (WebAssembly); the chip peripherals are simulated: ADC values come from the circuit solver, not from a real ADC with its non-linearity.', 'يعمل MicroPython 1.29 فعلاً (WebAssembly)؛ أما ملحقات الشريحة فمحاكاة: قيم ADC تأتي من حل الدائرة وليس من محوّل حقيقي بعدم خطيته.'],
      ['The Nextion is a training model of the instruction set; .HMI/.TFT files are not used.', 'Nextion نموذج تدريبي لمجموعة الأوامر؛ لا تُستخدم ملفات ‎.HMI/.TFT.'],
      ['The simulator clock is set for you; a real ESP32 starts at 2000-01-01 until you set the time.', 'ساعة المحاكي مضبوطة لك؛ ESP32 الحقيقي يبدأ من 2000-01-01 حتى تضبط الوقت.'],
      ['No Wi-Fi or web server is used in this program (none is claimed).', 'لا يستخدم هذا البرنامج Wi-Fi ولا خادم ويب (ولا ندّعي ذلك).'],
    ],
  },
  {
    id: 'master-wb7',
    board: 'wb',
    num: '03',
    title: ['COMPETITION MASTER 03 — Wiren Board 7.4 Complete Smart Farm', 'COMPETITION MASTER 03 — المزرعة الذكية الكاملة على Wiren Board 7.4'],
    controller: 'Wiren Board 7.4',
    language: 'wb-rules (JavaScript ES5) — defineRule, defineVirtualDevice, dev[], setTimeout',
    file: 'wb/rules.js',
    code: WB_RULES,
    goal: ['The same farm built the Wiren Board way: Modbus RTU devices on RS-485, the ADC inputs A1–A4, a WB-MR6C relay module, and rules that read and write MQTT controls.', 'نفس المزرعة بطريقة Wiren Board: أجهزة Modbus RTU على RS-485، ومداخل ADC ‏A1–A4، ووحدة مرحّلات WB-MR6C، وقواعد تقرأ وتكتب عناصر MQTT.'],
    summary: ['RS-485-1: air sensor (temperature, humidity, CO₂, address 2) + WB-MR6C (address 32: K1 pump, K2 dose A, K3 dose B, K4 fan, K5 light, K6 alarm). A1 pH, A2 EC, A3 level, A4 ACS712. 12 V and 5 V supplies.', 'RS-485-1: حساس الهواء (الحرارة والرطوبة وCO₂، العنوان 2) + WB-MR6C ‏(العنوان 32: K1 المضخة، K2 الجرعة A، K3 الجرعة B، K4 المروحة، K5 الإضاءة، K6 الإنذار). A1 ‏pH، A2 ‏EC، A3 المستوى، A4 ‏ACS712. مصدرا 12 و5 فولت.'],
    dashboard: ['MQTT tab: the virtual device "farm" (values + DOSING/TEST pushbuttons) and the wb-rules log (STATUS lines).', 'تبويب MQTT: الجهاز الافتراضي "farm" ‏(القيم + زرّا DOSING/TEST) وسجل wb-rules ‏(أسطر STATUS).'],
    build: arranged('wb', wbMasterCircuit),
    sections: sections('wb'),
    recall: recall('wb'),
    exercises: exercises('wb'),
    hardware: [
      ['Set the Modbus addresses: air sensor 2, WB-MR6C 32 (all devices 9600 8N1 on RS-485-1, A↔A, B↔B, 120 Ω termination at the bus end).', 'اضبط عناوين Modbus: حساس الهواء 2 ووحدة WB-MR6C ‏32 (كل الأجهزة 9600 8N1 على RS-485-1، ‏A↔A وB↔B، ومقاومة إنهاء 120 أوم في نهاية الناقل).'],
      ['Add both devices in the web interface: Settings → Configs → wb-mqtt-serial (choose the device templates).', 'أضف الجهازين من واجهة الويب: Settings ← Configs ← wb-mqtt-serial ‏(اختر قوالب الأجهزة).'],
      ['Check the control names in Devices: they must match TEMP, HUM, CO2 and K1–K6 in the PINS part (your real sensor template may use other names).', 'تحقق من أسماء العناصر في Devices: يجب أن تطابق TEMP وHUM وCO2 وK1–K6 في جزء PINS ‏(قد يستخدم قالب حساسك الحقيقي أسماء أخرى).'],
      ['Set A1–A4 to voltage measurement, then copy the script to /etc/wb-rules/farm.js (or the Rules editor); wb-rules reloads it automatically.', 'اضبط A1–A4 على قياس الجهد، ثم انسخ البرنامج إلى ‎/etc/wb-rules/farm.js (أو محرر Rules)؛ يعيد wb-rules تحميله تلقائياً.'],
      ['Watch journalctl -u wb-rules -f (or the Rules log) for the STATUS lines.', 'راقب journalctl -u wb-rules -f ‏(أو سجل Rules) لرؤية أسطر STATUS.'],
    ],
    libraries: [
      { name: 'wb-rules (pre-installed on the controller)', install: 'part of the Wiren Board firmware' },
      { name: 'wb-mqtt-serial (Modbus devices)', install: 'pre-installed; configure in Settings → Configs' },
      { name: 'wb-mqtt-adc / wb-mqtt-gpio', install: 'pre-installed drivers for A1–A4' },
    ],
    differences: [
      ['wb-rules really runs (QuickJS), with the real MQTT topics; Linux, the web interface and the drivers are reduced models.', 'يعمل wb-rules فعلاً (QuickJS) بمواضيع MQTT الحقيقية؛ أما Linux وواجهة الويب والمشغّلات فنماذج مبسّطة.'],
      ['The RS-485 air sensor is a generic Modbus model (input registers 0 temp×10, 1 humidity×10, 2 CO₂); your real sensor has its own register map and template.', 'حساس الهواء RS-485 نموذج Modbus عام (سجلات إدخال: 0 الحرارة×10، 1 الرطوبة×10، 2 CO₂)؛ لحساسك الحقيقي خريطة سجلات وقالب خاص.'],
      ['The A1–A4 inputs have a 5 V / 100 kΩ pull-up in the model, so analog readings are slightly higher (pH 6.3 for 6.2) — calibrate on the real device.', 'للمداخل A1–A4 مقاومة سحب 5 فولت / 100 كيلو أوم في النموذج، فتكون القراءات التناظرية أعلى قليلاً (pH 6.3 بدلاً من 6.2) — عايِر على الجهاز الحقيقي.'],
      ['There is no Wiren Board web UI in the simulator: the MQTT tab shows the same devices and controls.', 'لا توجد واجهة ويب Wiren Board في المحاكي: تبويب MQTT يعرض نفس الأجهزة والعناصر.'],
    ],
  },
];

export function masterProject(id: string | undefined) {
  if (!id) return null;
  return MASTER_PROJECTS.find((m) => m.id === id || `lib:${m.id}` === id) ?? null;
}

// ====================================================================== wiring notes
export interface WireNote {
  wire: string;
  from: string;
  to: string;
  kind: 'power' | 'ground' | 'data' | 'analog' | 'bus' | 'load';
  why: Bi;
  cut: Bi;
}

export const KIND_LABEL: Record<WireNote['kind'], Bi> = {
  power: ['Power', 'طاقة'],
  ground: ['Ground', 'أرضي'],
  data: ['Digital data', 'بيانات رقمية'],
  analog: ['Analog signal', 'إشارة تناظرية'],
  bus: ['Communication bus', 'ناقل اتصال'],
  load: ['Load circuit (12 V)', 'دائرة الحمل (12 فولت)'],
};

interface CompNote {
  name: Bi;
  signal: Bi;
  cut: Bi;
  power?: Bi;
}

const SENSOR_LOST: Bi = ['the reading is lost: SENSOR ERROR alarm, alarm lamp on', 'تضيع القراءة: إنذار SENSOR ERROR ويضيء مصباح الإنذار'];
function compNotes(b: MasterBoard): Record<string, CompNote> {
  const ctl = b === 'pi' ? 'Pi' : b === 'esp' ? 'ESP32' : 'WB7';
  return {
    dht: { name: ['DHT22', 'DHT22'], signal: [`one-wire digital data line to the ${ctl}`, `خط بيانات رقمي واحد إلى ${ctl}`], cut: [`no answer from the DHT22: temperature = None, ${SENSOR_LOST[0]}, fan forced ON for safety`, `لا رد من DHT22: الحرارة None، ${SENSOR_LOST[1]}، والمروحة تعمل للأمان`] },
    co2: { name: ['MH-Z19B CO₂ sensor', 'حساس CO₂ ‏MH-Z19B'], signal: ['UART: sensor TX → controller RX, sensor RX ← controller TX (crossed)', 'UART: ‏TX الحساس ← RX المتحكم، وRX الحساس ← TX المتحكم (متقاطعان)'], cut: [`no reply to the 0x86 command: co2 = None, ${SENSOR_LOST[0]}`, `لا رد على الأمر 0x86: ‏co2 = None، ${SENSOR_LOST[1]}`] },
    adc: { name: ['MCP3008 ADC', 'محوّل MCP3008'], signal: ['SPI bus: the Pi has no analog inputs, the MCP3008 measures the four analog sensors', 'ناقل SPI: لا توجد مداخل تناظرية في Pi، فيقيس MCP3008 الحساسات التناظرية الأربعة'], cut: ['all four analog readings become wrong (pH, EC, level, current): LOW WATER / SENSOR ERROR, irrigation blocked', 'تصبح القراءات التناظرية الأربع خاطئة (pH وEC والمستوى والتيار): ‏LOW WATER أو SENSOR ERROR، ويُمنع الري'] },
    ph: { name: ['pH sensor module', 'وحدة حساس pH'], signal: ['analog voltage: pH = 3.5 × V', 'جهد تناظري: pH = ‏3.5 × V'], cut: ['pH reads wrong (near 0 → below 1): SENSOR ERROR', 'تُقرأ pH خطأ (قريبة من 0 ← أقل من 1): ‏SENSOR ERROR'] },
    ec: { name: ['EC sensor module', 'وحدة حساس EC'], signal: ['analog voltage: EC = V ÷ 0.5', 'جهد تناظري: EC = V ÷ 0.5'], cut: ['EC reads wrong (near 0): OUT OF RANGE', 'تُقرأ EC خطأ (قريبة من 0): ‏OUT OF RANGE'] },
    lvl: { name: ['water-level sensor', 'حساس مستوى الماء'], signal: ['analog voltage: 3 V = 100 %', 'جهد تناظري: 3 فولت = 100٪'], cut: ['level reads wrong (near 0 %): LOW WATER, irrigation and dosing refused', 'يُقرأ المستوى خطأ (قريباً من 0٪): ‏LOW WATER ويُرفض الري والجرعات'] },
    cur: { name: ['ACS712 current sensor', 'حساس التيار ACS712'], signal: ['analog voltage: 2.5 V + 0.185 V per ampere of pump current', 'جهد تناظري: 2.5 فولت + 0.185 فولت لكل أمبير من تيار المضخة'], cut: ['the pump current reads wrong: the next irrigation reports PUMP FAILURE', 'يُقرأ تيار المضخة خطأ: الري التالي يبلّغ عن PUMP FAILURE'] },
    air: { name: ['RS-485 air sensor (address 2)', 'حساس الهواء RS-485 ‏(العنوان 2)'], signal: ['RS-485 bus (Modbus RTU, A↔A, B↔B)', 'ناقل RS-485 ‏(Modbus RTU، ‏A↔A وB↔B)'], cut: [`Modbus timeouts: Temperature/Humidity/CO2 get an error, ${SENSOR_LOST[0]}, fan forced ON`, `انتهاء مهلة Modbus: تحصل Temperature/Humidity/CO2 على خطأ، ${SENSOR_LOST[1]}، والمروحة تعمل للأمان`] },
    mr: { name: ['WB-MR6C relay module (address 32)', 'وحدة المرحّلات WB-MR6C ‏(العنوان 32)'], signal: ['RS-485 bus (Modbus RTU): the relays are switched by Modbus commands', 'ناقل RS-485 ‏(Modbus RTU): تُشغَّل المرحّلات بأوامر Modbus'], cut: ['the relay module stops answering: no load can be switched, wb-mqtt-serial reports errors', 'تتوقف وحدة المرحّلات عن الرد: لا يمكن تشغيل أي حمل، ويبلّغ wb-mqtt-serial عن أخطاء'] },
    rl4: { name: ['4-channel relay module', 'وحدة مرحّل 4 قنوات'], signal: ['relay input: a HIGH level closes that channel', 'مدخل المرحّل: المستوى HIGH يغلق القناة'], cut: ['that relay no longer follows the program: the program prints pump=ON but the load stays off', 'لا يتبع المرحّل البرنامج: يطبع البرنامج pump=ON بينما يبقى الحمل متوقفاً'], power: ['the relay coils lose power: none of pump, fan, light, alarm lamp can run', 'تفقد ملفات المرحّل التغذية: لا تعمل المضخة ولا المروحة ولا الإضاءة ولا مصباح الإنذار'] },
    rl2: { name: ['2-channel relay module (dosing)', 'وحدة مرحّل قناتين (الجرعات)'], signal: ['relay input: a HIGH level closes that channel', 'مدخل المرحّل: المستوى HIGH يغلق القناة'], cut: ['that dosing pump never runs although the program prints DOSING …', 'لا تعمل مضخة الجرعات رغم أن البرنامج يطبع DOSING …'], power: ['both dosing relays lose power: no dosing at all', 'يفقد مرحّلا الجرعات التغذية: لا جرعات أبداً'] },
    nx: { name: ['Nextion screen', 'شاشة Nextion'], signal: ['UART: ESP32 TX1 → screen RX (commands); screen TX → RX1 (touch events, not used here)', 'UART: ‏TX1 في ESP32 ← RX الشاشة (أوامر)؛ وTX الشاشة ← RX1 ‏(أحداث اللمس، غير مستخدمة هنا)'], cut: ['the screen stops updating; the farm keeps working (the program only sends)', 'تتوقف الشاشة عن التحديث؛ وتستمر المزرعة بالعمل (البرنامج يرسل فقط)'] },
    btnDose: { name: ['DOSING button', 'زر DOSING'], signal: ['input with internal pull-up: pressed = connected to GND = 0', 'مدخل بمقاومة سحب داخلية: مضغوط = موصول بالأرضي = 0'], cut: ['the button does nothing (the pull-up keeps the input at "not pressed")', 'لا يعمل الزر (مقاومة السحب تبقي المدخل "غير مضغوط")'] },
    btnTest: { name: ['TEST button', 'زر TEST'], signal: ['input with internal pull-up: pressed = connected to GND = 0', 'مدخل بمقاومة سحب داخلية: مضغوط = موصول بالأرضي = 0'], cut: ['the button does nothing (the pull-up keeps the input at "not pressed")', 'لا يعمل الزر (مقاومة السحب تبقي المدخل "غير مضغوط")'] },
    pump: { name: ['main pump', 'المضخة الرئيسية'], signal: ['12 V load', 'حمل 12 فولت'], cut: ['the pump cannot run: no current through the ACS712 → PUMP FAILURE: no current', 'لا تعمل المضخة: لا تيار في ACS712 ← ‏PUMP FAILURE: no current'] },
    fan: { name: ['fan', 'المروحة'], signal: ['12 V load', 'حمل 12 فولت'], cut: ['the fan never runs: the farm air keeps heating, and the program cannot know it (no fan feedback)', 'لا تعمل المروحة: يستمر هواء المزرعة بالسخونة، والبرنامج لا يعرف ذلك (لا توجد تغذية راجعة للمروحة)'] },
    light: { name: ['grow light', 'إضاءة النمو'], signal: ['12 V load', 'حمل 12 فولت'], cut: ['the light stays off although the program prints light=ON', 'تبقى الإضاءة مطفأة رغم أن البرنامج يطبع light=ON'] },
    doseA: { name: ['dosing pump A', 'مضخة الجرعات A'], signal: ['12 V load', 'حمل 12 فولت'], cut: ['dose A is not delivered although DOSING A is printed (the Smart Farm totals stay at 0 ml)', 'لا تُضخ الجرعة A رغم طباعة DOSING A ‏(تبقى مجاميع المزرعة 0 مل)'] },
    doseB: { name: ['dosing pump B', 'مضخة الجرعات B'], signal: ['12 V load', 'حمل 12 فولت'], cut: ['dose B is not delivered although DOSING B is printed', 'لا تُضخ الجرعة B رغم طباعة DOSING B'] },
    lamp: { name: ['alarm lamp', 'مصباح الإنذار'], signal: ['12 V lamp (LED + 2.2 kΩ)', 'مصباح 12 فولت (LED + ‏2.2 كيلو أوم)'], cut: ['alarms are still printed but the lamp never lights', 'تُطبع الإنذارات لكن المصباح لا يضيء أبداً'] },
    ralarm: { name: ['alarm lamp resistor', 'مقاومة مصباح الإنذار'], signal: ['limits the LED current on 12 V', 'تحد تيار LED على 12 فولت'], cut: ['alarms are still printed but the lamp never lights', 'تُطبع الإنذارات لكن المصباح لا يضيء أبداً'] },
    pi: { name: ['Raspberry Pi 5', 'Raspberry Pi 5'], signal: ['controller', 'المتحكم'], cut: ['the controller loses power: everything stops', 'يفقد المتحكم التغذية: يتوقف كل شيء'] },
    esp: { name: ['ESP32', 'ESP32'], signal: ['controller', 'المتحكم'], cut: ['the ESP32 loses its reference to the 5 V parts', 'يفقد ESP32 المرجع المشترك مع أجزاء 5 فولت'] },
    wb: { name: ['Wiren Board 7.4', 'Wiren Board 7.4'], signal: ['controller', 'المتحكم'], cut: ['the Wiren Board loses power: the rules, MQTT and Modbus stop', 'يفقد Wiren Board التغذية: تتوقف القواعد وMQTT وModbus'] },
    ps: { name: ['12 V supply', 'مصدر 12 فولت'], signal: ['supply for the loads', 'تغذية الأحمال'], cut: b === 'wb' ? ['the part fed by this wire loses 12 V (the WB7 itself, the RS-485 devices or a load)', 'يفقد الجزء الموصول بهذا السلك 12 فولت (WB7 نفسه أو أجهزة RS-485 أو أحد الأحمال)'] : ['the loads lose their 12 V', 'تفقد الأحمال 12 فولت'] },
    ps5: { name: ['5 V supply', 'مصدر 5 فولت'], signal: ['supply for the sensor modules and relays', 'تغذية وحدات الحساسات والمرحّلات'], cut: ['the parts on this wire lose 5 V; without the common GND wire every signal loses its reference and the readings are wrong', 'تفقد الأجزاء على هذا السلك 5 فولت؛ وبدون سلك الأرضي المشترك تفقد كل الإشارات مرجعها وتصبح القراءات خاطئة'] },
  };
}

/** relay channel → load, to explain the contact wires */
const CHANNEL_LOAD: Record<MasterBoard, Record<string, string>> = {
  pi: { 'rl4.1': 'pump', 'rl4.2': 'fan', 'rl4.3': 'light', 'rl4.4': 'lamp', 'rl2.1': 'doseA', 'rl2.2': 'doseB' },
  esp: { 'rl4.1': 'pump', 'rl4.2': 'fan', 'rl4.3': 'light', 'rl4.4': 'lamp', 'rl2.1': 'doseA', 'rl2.2': 'doseB' },
  wb: { 'mr.1': 'pump', 'mr.2': 'doseA', 'mr.3': 'doseB', 'mr.4': 'fan', 'mr.5': 'light', 'mr.6': 'lamp' },
};
const CONTROLLERS = new Set(['pi', 'esp', 'wb']);
const PRIORITY = ['pump', 'fan', 'light', 'doseA', 'doseB', 'lamp', 'ralarm', 'dht', 'co2', 'air', 'ph', 'ec', 'lvl', 'cur', 'adc', 'nx', 'btnDose', 'btnTest', 'rl4', 'rl2', 'mr', 'ps5', 'ps'];

export function wireNote(doc: ProjectDoc, w: Wire, b: MasterBoard): WireNote {
  const notes = compNotes(b);
  const comp = (id: string) => doc.components.find((c) => c.id === id);
  const pinDef = (id: string, pin: string) => {
    const c = comp(id);
    if (!c || !hasPart(c.type)) return undefined;
    return pinsOf(getPart(c.type), c.props).find((p) => p.id === pin);
  };
  const end = (id: string, pin: string) => `${comp(id)?.label || id} · ${pinDef(id, pin)?.label ?? pin}`;
  const kinds = [pinDef(w.from.comp, w.from.pin)?.kind, pinDef(w.to.comp, w.to.pin)?.kind];
  const pins = [w.from.pin, w.to.pin];
  const isBus = pins.some((p) => /^(A|B|RS1_A|RS1_B)$/.test(p) && (w.from.comp === 'air' || w.to.comp === 'air' || w.from.comp === 'mr' || w.to.comp === 'mr') && !/^A\d$/.test(p));
  const kind: WireNote['kind'] = kinds.includes('ground')
    ? 'ground'
    : kinds.includes('power') && !kinds.includes('terminal')
      ? 'power'
      : isBus
        ? 'bus'
        : kinds.includes('analog') || pins.some((p) => /^(AO|OUT|CH\d|A\d)$/.test(p))
          ? 'analog'
          : kinds.includes('terminal') || pins.some((p) => /^(COM|NO)\d$|^(P|N|IPP|IPN)$|^ralarm/.test(p))
            ? 'load'
            : 'data';
  // which part does this wire serve?
  const others = [w.from.comp, w.to.comp].filter((x) => !CONTROLLERS.has(x)).sort((a, z) => PRIORITY.indexOf(a) - PRIORITY.indexOf(z));
  const ctlEnd = [w.from.comp, w.to.comp].find((x) => CONTROLLERS.has(x));
  // a supply wired to the controller itself explains the controller
  let subject = others.length === 1 && /^ps5?$/.test(others[0]) && ctlEnd ? ctlEnd : (others[0] ?? w.to.comp);
  for (const e of [w.from, w.to]) {
    const m = /^(COM|NO)(\d)$/.exec(e.pin);
    const load = m && CHANNEL_LOAD[b][`${e.comp}.${m[2]}`];
    if (load) subject = load;
  }
  if ((w.from.comp === 'cur' || w.to.comp === 'cur') && pins.some((p) => p === 'IPP' || p === 'IPN')) subject = 'pump';
  const n = notes[subject] ?? { name: [subject, subject] as Bi, signal: ['connection', 'توصيل'] as Bi, cut: ['this part stops working', 'يتوقف هذا الجزء عن العمل'] as Bi };
  const commonGnd = (w.from.comp === 'ps5' || w.to.comp === 'ps5') && kind === 'ground' && pins.some((p) => /^GND\d?$/.test(p)) && [w.from.comp, w.to.comp].some((x) => CONTROLLERS.has(x));
  const why: Bi =
    commonGnd
      ? ['common ground: the 5 V parts and the controller must share GND so their signals have the same reference', 'أرضي مشترك: يجب أن تشترك أجزاء 5 فولت والمتحكم في الأرضي حتى يكون لإشاراتها المرجع نفسه']
      : kind === 'power'
        ? [`power for the ${n.name[0]}`, `تغذية ${n.name[1]}`]
        : kind === 'ground'
          ? [`ground (return path) of the ${n.name[0]}`, `الأرضي (مسار العودة) لـ${n.name[1]}`]
          : kind === 'load'
            ? [`12 V circuit of the ${n.name[0]}: supply + → relay contact → load → supply −`, `دائرة 12 فولت لـ${n.name[1]}: موجب المصدر ← تلامس المرحّل ← الحمل ← سالب المصدر`]
            : [`${n.name[0]}: ${n.signal[0]}`, `${n.name[1]}: ${n.signal[1]}`];
  const cut: Bi = commonGnd ? notes.ps5.cut : (kind === 'power' || kind === 'ground') && n.power ? n.power : kind === 'power' || kind === 'ground' ? (subject === 'ps' || subject === 'ps5' ? n.cut : [`the ${n.name[0]} loses power — ${n.cut[0]}`, `يفقد ${n.name[1]} التغذية — ${n.cut[1]}`]) : n.cut;
  return { wire: w.id, from: end(w.from.comp, w.from.pin), to: end(w.to.comp, w.to.pin), kind, why, cut };
}

export function wiringNotes(doc: ProjectDoc, b: MasterBoard): WireNote[] {
  return doc.wires.map((w) => wireNote(doc, w, b));
}

// ====================================================================== comparison
export interface CompareRow {
  key: Bi;
  cells: Record<MasterBoard, { text: Bi; code?: string }>;
}

/** the first line of `code` matching `re`, without its comment (real code, never retyped) */
export function snippet(code: string, re: RegExp, b: MasterBoard, lines = 1): string {
  const all = code.split('\n');
  const i = all.findIndex((l) => re.test(l));
  if (i < 0) return '';
  return all
    .slice(i, i + lines)
    .map((l) => splitComment(l, b).code)
    .join('\n');
}

export function comparison(): CompareRow[] {
  const P = (re: RegExp, n = 1) => snippet(PI_MAIN, re, 'pi', n);
  const E = (re: RegExp, n = 1) => snippet(ESP_MAIN, re, 'esp', n);
  const W = (re: RegExp, n = 1) => snippet(WB_RULES, re, 'wb', n);
  return [
    { key: ['Controller', 'المتحكم'], cells: { pi: { text: ['Raspberry Pi 5 — Linux computer', 'Raspberry Pi 5 — حاسوب Linux'] }, esp: { text: ['ESP32-DevKitC V4 — microcontroller, no OS', 'ESP32-DevKitC V4 — متحكم دقيق بدون نظام تشغيل'] }, wb: { text: ['Wiren Board 7.4 — Linux automation controller (DIN rail)', 'Wiren Board 7.4 — متحكم أتمتة Linux ‏(سكة DIN)'] } } },
    { key: ['Programming language', 'لغة البرمجة'], cells: { pi: { text: ['Python 3', 'Python 3'], code: P(/^from gpiozero/) }, esp: { text: ['MicroPython', 'MicroPython'], code: E(/^from machine/) }, wb: { text: ['JavaScript (wb-rules, ES5)', 'JavaScript ‏(wb-rules، ES5)'], code: W(/^defineRule/) } } },
    { key: ['GPIO handling', 'التعامل مع GPIO'], cells: { pi: { text: ['gpiozero objects by BCM number', 'كائنات gpiozero برقم BCM'], code: P(/^pump = /) }, esp: { text: ['machine.Pin by GPIO number', 'machine.Pin برقم GPIO'], code: E(/^pump = /) }, wb: { text: ['no GPIO in the program: MQTT controls "device/control"', 'لا GPIO في البرنامج: عناصر MQTT ‏"جهاز/عنصر"'], code: W(/^var PUMP = /) } } },
    { key: ['Sensor reading', 'قراءة الحساسات'], cells: { pi: { text: ['library objects; analog through the MCP3008 (SPI)', 'كائنات المكتبات؛ والتناظري عبر MCP3008 ‏(SPI)'], code: P(/^    ph = round/) }, esp: { text: ['internal ADC1 (read_uv) and dht.measure()', 'ADC1 الداخلي (read_uv) وdht.measure()'], code: E(/^    ph = round/) }, wb: { text: ['dev[] of Modbus and ADC controls; getError() for a lost sensor', 'dev[] لعناصر Modbus وADC؛ وgetError() للحساس المفقود'], code: W(/^  ph = round2/) } } },
    { key: ['Relay control', 'التحكم بالمرحّلات'], cells: { pi: { text: ['GPIO → relay module input', 'GPIO ← مدخل وحدة المرحّل'], code: P(/^        pump\.on\(\)/) }, esp: { text: ['GPIO → relay module input', 'GPIO ← مدخل وحدة المرحّل'], code: E(/^        pump\.on\(\)/) }, wb: { text: ['write a relay control → Modbus command to the WB-MR6C', 'كتابة عنصر المرحّل ← أمر Modbus إلى WB-MR6C'], code: W(/^  if \(dev\[name\] !== on\)/) } } },
    { key: ['Scheduling', 'الجدولة'], cells: { pi: { text: ['while True + time.sleep(1); hour from time.localtime()', 'while True مع time.sleep(1)؛ والساعة من time.localtime()'], code: P(/^    hour = /) }, esp: { text: ['same loop; time.localtime()[3]', 'نفس الحلقة؛ time.localtime()[3]'], code: E(/^    hour = /) }, wb: { text: ['setInterval every second + setTimeout steps; new Date().getHours()', 'setInterval كل ثانية + خطوات setTimeout؛ new Date().getHours()'], code: W(/^setInterval/) } } },
    { key: ['Communication', 'الاتصال'], cells: { pi: { text: ['UART (CO₂), SPI (ADC), HTTP (Flask)', 'UART ‏(CO₂)، SPI ‏(ADC)، HTTP ‏(Flask)'], code: P(/^co2_port = /) }, esp: { text: ['UART2 (CO₂), UART1 (Nextion)', 'UART2 ‏(CO₂)، UART1 ‏(Nextion)'], code: E(/^co2_port = /) }, wb: { text: ['RS-485 Modbus RTU + MQTT', 'RS-485 ‏Modbus RTU + MQTT'], code: W(/^var TEMP = /) } } },
    { key: ['Dashboard', 'لوحة المراقبة'], cells: { pi: { text: ['terminal + Flask web page', 'الطرفية + صفحة ويب Flask'], code: P(/^app\.add_url_rule\("\/status"/) }, esp: { text: ['serial monitor + Nextion screen', 'شاشة المنفذ التسلسلي + شاشة Nextion'], code: E(/^    screen\.write\(name/) }, wb: { text: ['virtual device "farm" in MQTT + wb-rules log', 'الجهاز الافتراضي "farm" في MQTT + سجل wb-rules'], code: W(/^defineVirtualDevice/) } } },
    { key: ['Required modules', 'الوحدات المطلوبة'], cells: { pi: { text: ['MCP3008 for analog, relay modules, 12 V supply', 'MCP3008 للتناظري، ووحدات مرحّل، ومصدر 12 فولت'] }, esp: { text: ['relay modules, separate 5 V supply, 12 V supply', 'وحدات مرحّل، ومصدر 5 فولت منفصل، ومصدر 12 فولت'] }, wb: { text: ['WB-MR6C relays, Modbus air sensor, 12 V + 5 V supplies', 'مرحّلات WB-MR6C، وحساس هواء Modbus، ومصدرا 12 و5 فولت'] } } },
    { key: ['Main program structure', 'هيكل البرنامج الرئيسي'], cells: { pi: { text: ['settings → pins → functions → web → while True', 'الإعدادات ← الأرجل ← الدوال ← الويب ← while True'], code: P(/^while True/) }, esp: { text: ['settings → pins → functions → while True', 'الإعدادات ← الأرجل ← الدوال ← while True'], code: E(/^while True/) }, wb: { text: ['settings → controls → virtual device → functions → rules → setInterval', 'الإعدادات ← العناصر ← الجهاز الافتراضي ← الدوال ← القواعد ← setInterval'], code: W(/^function control/) } } },
  ];
}

/** the controller pins of a project, for the cheat sheet: [controller pin, part · pin] */
export function pinMap(doc: ProjectDoc, b: MasterBoard): [string, string][] {
  const ctl = b === 'pi' ? 'pi' : b === 'esp' ? 'esp' : 'wb';
  const label = (id: string, pin: string) => {
    const c = doc.components.find((x) => x.id === id);
    if (!c || !hasPart(c.type)) return pin;
    const p = pinsOf(getPart(c.type), c.props).find((x) => x.id === pin);
    return p?.label ?? pin;
  };
  const rows: [string, string][] = [];
  for (const w of doc.wires) {
    const [a, z] = w.from.comp === ctl ? [w.from, w.to] : w.to.comp === ctl ? [w.to, w.from] : [null, null];
    if (!a || !z) continue;
    const c = doc.components.find((x) => x.id === z.comp);
    rows.push([`${label(ctl, a.pin)}${w.label ? ` (${w.label})` : ''}`, `${c?.label || z.comp} · ${label(z.comp, z.pin)}`]);
  }
  return rows.sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }));
}
