// Examples 12–20: Nextion, scheduling, dosing, interlock, fault handling, web, full controller.
import { WIRE_COLORS as W } from '../engine/project';
import { defaultFarmConfig } from '../engine/farm';
import type { NextionRuntime } from '../engine/devices/nextion';
import type { Example } from './types';
import { base, finish } from './types';
import { farmNextionTemplate, simpleNextion } from './nextionTemplates';
import { farmCircuit } from './farmCircuit';
import { CFG_PY, DASH_HTML, DASH_PY, HW_PY, INDEX_HTML, MAIN_PY, NX_PY, WEB_PY } from './competitionCode';
import { sim } from '../state/engine';

const farmOn = () => ({ ...defaultFarmConfig(), enabled: true });
const nxText = (id: string, name: string, page = 0) => String((sim.device(id) as NextionRuntime | null)?.liveOf(page, name)?.attrs.txt ?? '');

function nextionCircuit(extra?: (b: ReturnType<typeof base>) => void) {
  const b = base('Nextion');
  b.add('nx', 'nextion', 880, 300, { baud: 9600 }, 0, 'Nextion 2.8"');
  b.wire('pi.P2', 'nx.VCC', W.red, '5V').wire('pi.P6', 'nx.GND', W.black).wire('pi.P8', 'nx.RX', W.green, 'TX→RX').wire('pi.P10', 'nx.TX', W.blue, 'RX←TX');
  extra?.(b);
  return b;
}

// ------------------------------------------------------------------ 12
const NX_DASH = `import time
import board
import adafruit_dht
import serial

END = b"\\xff\\xff\\xff"                 # every Nextion instruction ends with FF FF FF
ser = serial.Serial("/dev/serial0", 9600, timeout=0.1)

def nx(command):
    ser.write(command.encode() + END)

dht = adafruit_dht.DHT22(board.D4)
time.sleep(0.5)                        # the display boots and sends 00 00 00 FF FF FF 88 FF FF FF
ser.reset_input_buffer()

count = 0
while True:
    try:
        t, h = dht.temperature, dht.humidity
        nx(f't0.txt="{t:.1f} C  {h:.0f} %"')
        nx(f"j0.val={int(h)}")         # progress bar = humidity
    except RuntimeError:
        nx('t0.txt="sensor error"')
    count += 1
    nx(f"n0.val={count}")
    reply = ser.read(64)
    if reply:
        print("Nextion replied:", reply.hex(" "))   # error codes such as 1a ff ff ff
    time.sleep(2)
`;

export const ex12: Example = {
  id: 'ex12-nextion-dash',
  n: 12,
  level: 'intermediate',
  title: { en: 'Nextion dashboard', ar: 'لوحة عرض Nextion' },
  objective: { en: 'Send text and numbers to a Nextion Enhanced over UART and see each byte in the UART monitor.', ar: 'إرسال نصوص وأرقام إلى شاشة Nextion عبر UART ورؤية كل بايت في مراقب UART.' },
  parts: ['Nextion NX3224K028 (5 V, TX→GPIO15, RX←GPIO14)', 'DHT22 on GPIO4'],
  expected: { en: 't0 shows temperature and humidity, j0 the humidity bar, n0 counts updates.', ar: 'يعرض t0 الحرارة والرطوبة، وj0 شريط الرطوبة، وn0 عدد التحديثات.' },
  instructions: { en: 'Run and watch the screen on the workspace or in the Nextion tab (Live screen). Change the DHT22 temperature.', ar: 'شغّل وراقب الشاشة في مساحة العمل أو في تبويب Nextion. غيّر حرارة DHT22.' },
  breakIt: [
    { en: 'Remove the END bytes: the display never executes the instruction.', ar: 'احذف بايتات النهاية: لن تنفذ الشاشة الأمر.' },
    { en: 'Write t9.txt="x" (no such object): reply 02 FF FF FF.', ar: 'اكتب t9.txt="x" (عنصر غير موجود): الرد 02 FF FF FF.' },
  ],
  build() {
    const b = nextionCircuit((bb) => {
      bb.add('dht', 'dht22', 520, 380, { temperature: 25, humidity: 60 }, 0, 'DHT22');
      bb.wire('pi.P1', 'dht.VCC', W.red).wire('pi.P7', 'dht.DATA', W.yellow, 'GPIO4').wire('pi.P9', 'dht.GND', W.black);
    });
    return finish(b, 'Ex 12 · Nextion dashboard', this.id, { 'main.py': NX_DASH }, { nextion: simpleNextion() });
  },
  checks: [
    {
      id: 'ex12',
      name: 'Nextion shows the DHT22 values',
      expected: 't0 = "25.0 C  60 %", j0 = 60',
      async run(h) {
        await h.load(ex12.build());
        await h.run();
        await h.waitSim(1.5);
        const txt = nxText('nx', 't0');
        const j0 = (sim.device('nx') as NextionRuntime).liveOf(0, 'j0')?.attrs.val;
        return { pass: txt === '25.0 C  60 %' && j0 === 60, actual: `t0="${txt}", j0=${j0}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 13
const NX_PUMP = `import time
import serial
from gpiozero import OutputDevice

END = b"\\xff\\xff\\xff"
pump = OutputDevice(17, active_high=False, initial_value=False)   # active-LOW relay
ser = serial.Serial("/dev/serial0", 9600, timeout=0.05)

def nx(command):
    ser.write(command.encode() + END)

time.sleep(0.5)
ser.reset_input_buffer()
nx('t0.txt="Touch a button"')

buf = b""
while True:
    buf += ser.read(32)
    while END in buf:
        frame, buf = buf.split(END, 1)
        # touch event: 0x65 page component-id event(1=press, 0=release)
        if len(frame) == 4 and frame[0] == 0x65:
            page, comp, event = frame[1], frame[2], frame[3]
            print(f"touch: page {page}, component {comp}, {'press' if event else 'release'}")
            if comp == 4 and event == 1:            # b0 "PUMP ON"
                pump.on()
                nx('t1.txt="Pump: ON"')
                nx("t1.pco=2016")
            elif comp == 5 and event == 1:          # b1 "PUMP OFF"
                pump.off()
                nx('t1.txt="Pump: OFF"')
                nx("t1.pco=65504")
`;

export const ex13: Example = {
  id: 'ex13-nextion-pump',
  n: 13,
  level: 'intermediate',
  title: { en: 'Nextion controls a pump', ar: 'Nextion تتحكم بمضخة' },
  objective: { en: 'Receive touch events (0x65 …) in Python and drive a relay — the screen itself never touches GPIO.', ar: 'استقبال أحداث اللمس (0x65 …) في Python وتشغيل مرحل — الشاشة لا تتحكم بـ GPIO مباشرة.' },
  parts: ['Nextion', 'Relay', '12 V pump + supply'],
  expected: { en: 'Touch PUMP ON on the screen: Python prints the event, the relay energises, the pump runs and t1 shows "Pump: ON".', ar: 'المس PUMP ON على الشاشة: يطبع Python الحدث، ويعمل المرحل والمضخة ويظهر "Pump: ON".' },
  instructions: { en: 'Run, then touch the buttons on the Nextion (workspace or Nextion tab → Live screen).', ar: 'شغّل ثم المس الأزرار على شاشة Nextion (في مساحة العمل أو تبويب Nextion).' },
  breakIt: [
    { en: 'Stop the program and touch the button: nothing happens — the decision lives in Python.', ar: 'أوقف البرنامج والمس الزر: لا يحدث شيء — القرار في Python.' },
    { en: 'Untick "Send Component ID" for b0 in the Nextion designer.', ar: 'ألغِ "Send Component ID" للزر b0 في المصمم.' },
  ],
  build() {
    const b = nextionCircuit((bb) => {
      bb.add('rl', 'relay_module', 470, 40, { channels: 1, trigger: 'low' }, 0, 'Relay');
      bb.add('ps', 'power_supply', 470, 420, { volts: 12 }, 0, '12 V supply');
      bb.add('pump', 'water_pump', 680, 140, { role: 'none' }, 0, 'Pump');
      bb.wire('pi.P4', 'rl.VCC', W.red).wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
      bb.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
    });
    return finish(b, 'Ex 13 · Nextion controls pump', this.id, { 'main.py': NX_PUMP }, { nextion: simpleNextion() });
  },
  checks: [
    {
      id: 'ex13',
      name: 'Touch → UART → Python → GPIO → relay → pump',
      expected: 'pump runs after touching b0 and stops after b1',
      async run(h) {
        await h.load(ex13.build());
        await h.run();
        await h.waitSim(1);
        sim.nextionTouch('nx', 'b0', true);
        sim.nextionTouch('nx', 'b0', false);
        await h.waitSim(0.6);
        const on = h.vis('pump').run ?? 0;
        const t1 = nxText('nx', 't1');
        sim.nextionTouch('nx', 'b1', true);
        sim.nextionTouch('nx', 'b1', false);
        await h.waitSim(0.6);
        const off = h.vis('pump').run ?? 0;
        return { pass: on > 0.9 && off === 0 && t1 === 'Pump: ON', actual: `after b0: run=${on.toFixed(2)} t1="${t1}"; after b1: run=${off}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 14
const IRRIGATION = `import datetime
import time

import schedule
from gpiozero import Button, OutputDevice

pump = OutputDevice(17, active_high=False, initial_value=False)
water_ok = Button(23)              # float switch: closed while water is above it
RUN_MINUTES = 2
pump_off_at = None

def clock():
    return datetime.datetime.now().strftime("%H:%M:%S")

def start_irrigation():
    global pump_off_at
    if not water_ok.is_pressed:
        print(clock(), "irrigation SKIPPED - water level low")
        return
    pump.on()
    pump_off_at = time.time() + RUN_MINUTES * 60
    print(clock(), "Irrigation start")

schedule.every(30).minutes.do(start_irrigation)
start_irrigation()

while True:
    schedule.run_pending()
    if pump_off_at and time.time() >= pump_off_at:
        pump.off()
        pump_off_at = None
        print(clock(), "Irrigation stop")
    if pump.value and not water_ok.is_pressed:
        pump.off()
        pump_off_at = None
        print(clock(), "EMERGENCY STOP - low water")
    time.sleep(1)
`;

export const ex14: Example = {
  id: 'ex14-irrigation',
  n: 14,
  level: 'advanced',
  title: { en: 'Irrigation scheduler', ar: 'جدولة الري' },
  objective: { en: 'Run a schedule with the `schedule` library and simulated time; keep the loop non-blocking so protection still works.', ar: 'تشغيل جدول زمني بمكتبة schedule والزمن المحاكى، مع حلقة غير معطِّلة حتى تبقى الحماية فعالة.' },
  parts: ['Relay + circulation pump', 'Float switch', 'Farm model'],
  expected: { en: 'Irrigation every 30 min for 2 min. Use ⏩ fast-forward to watch several cycles; the reservoir level and the flow in the farm tab follow.', ar: 'ري كل 30 دقيقة لمدة دقيقتين. استخدم التقديم السريع ⏩ لرؤية عدة دورات ومتابعة الخزان والتدفق.' },
  instructions: { en: 'Run, then press ⏩ (+1 h) in the top bar or the Smart Farm tab.', ar: 'شغّل ثم اضغط ⏩ (+1 ساعة) في الشريط العلوي أو تبويب المزرعة.' },
  breakIt: [{ en: 'Replace the non-blocking timer with time.sleep(120): the emergency stop can no longer react during irrigation.', ar: 'استبدل المؤقت بـ time.sleep(120): لن يستطيع الإيقاف الطارئ الاستجابة أثناء الري.' }],
  build() {
    const b = base('Irrigation');
    b.add('fs', 'float_switch', 480, 400, { source: 'farm', trigger: 20 }, 0, 'Float switch');
    b.add('rl', 'relay_module', 600, 80, { channels: 1, trigger: 'low' }, 0, 'Relay');
    b.add('ps', 'power_supply', 600, 440, { volts: 12 }, 0, '12 V');
    b.add('pump', 'water_pump', 840, 230, { role: 'circulation', rate: 4 }, 0, 'Irrigation pump');
    b.wire('pi.P16', 'fs.1', W.blue, 'GPIO23').wire('fs.2', 'pi.P20', W.black);
    b.wire('pi.P2', 'rl.VCC', W.red).wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
    b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
    return finish(b, 'Ex 14 · Irrigation scheduler', this.id, { 'main.py': IRRIGATION }, { farm: farmOn() });
  },
  checks: [
    {
      id: 'ex14',
      name: 'Irrigation every 30 minutes',
      expected: '3 irrigation starts in 65 simulated minutes',
      async run(h) {
        h.speed = 300;
        await h.load(ex14.build());
        await h.run();
        await h.waitSim(65 * 60);
        const n = (h.term().match(/Irrigation start/g) ?? []).length;
        const stops = (h.term().match(/Irrigation stop/g) ?? []).length;
        return { pass: n === 3 && stops >= 2, actual: `${n} starts, ${stops} stops` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 15
const GROW_LIGHT = `import time
from datetime import datetime, time as clock_time
from gpiozero import OutputDevice

light = OutputDevice(27, active_high=False, initial_value=False)
LIGHT_ON = clock_time(6, 0)     # 16 h photoperiod: 06:00 - 22:00
LIGHT_OFF = clock_time(22, 0)

while True:
    now = datetime.now().time()
    wanted = LIGHT_ON <= now < LIGHT_OFF
    if wanted != bool(light.value):
        light.value = wanted
        print(datetime.now().strftime("%H:%M:%S"), "grow light", "ON" if wanted else "OFF")
    time.sleep(1)
`;

export const ex15: Example = {
  id: 'ex15-light',
  n: 15,
  level: 'intermediate',
  title: { en: 'Grow-light automation', ar: 'أتمتة إضاءة النمو' },
  objective: { en: 'Compare times of day and implement a photoperiod; see energy use in the farm tab.', ar: 'مقارنة أوقات اليوم وتنفيذ فترة إضاءة، ورؤية استهلاك الطاقة في تبويب المزرعة.' },
  parts: ['Relay', '12 V LED grow light', 'Supply'],
  expected: { en: 'The light is ON between 06:00 and 22:00 simulation time. Fast-forward to 06:00 to see it switch.', ar: 'يعمل الضوء بين 06:00 و22:00 بزمن المحاكاة. قدّم الزمن حتى 06:00 لرؤية التبديل.' },
  instructions: { en: 'Run, open Smart Farm and press "⏩ to 06:00".', ar: 'شغّل وافتح تبويب المزرعة واضغط "⏩ إلى 06:00".' },
  breakIt: [{ en: 'Use LIGHT_ON <= now <= LIGHT_OFF and think about the boundary minute.', ar: 'استخدم <= في الطرفين وفكّر في دقيقة الحد.' }],
  build() {
    const b = base('Light');
    b.add('rl', 'relay_module', 560, 60, { channels: 1, trigger: 'low' }, 0, 'Relay');
    b.add('ps', 'power_supply', 560, 420, { volts: 12 }, 0, '12 V');
    b.add('light', 'grow_light', 780, 200, { role: 'grow_light' }, 0, 'Grow light');
    b.wire('pi.P2', 'rl.VCC', W.red).wire('pi.P14', 'rl.GND', W.black).wire('pi.P13', 'rl.IN1', W.yellow, 'GPIO27');
    b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'light.P', W.red).wire('light.N', 'ps.N', W.black);
    return finish(b, 'Ex 15 · Grow light', this.id, { 'main.py': GROW_LIGHT }, { farm: farmOn() });
  },
  checks: [
    {
      id: 'ex15',
      name: 'Photoperiod switches at 06:00',
      expected: 'off at 05:59:40, on after 06:00:00',
      async run(h) {
        h.speed = 5;
        await h.load(ex15.build());
        const d = new Date(sim.clock.nowMs());
        d.setHours(5, 59, 40, 0);
        sim.clock.set(d.getTime());
        sim.farm.state.t = sim.clock.now();
        await h.run();
        await h.waitSim(5);
        const before = h.vis('light').run ?? 0;
        await h.waitSim(25);
        const after = h.vis('light').run ?? 0;
        return { pass: before === 0 && after > 0.9, actual: `05:59:45 run=${before}, 06:00:10 run=${after.toFixed(2)}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 16 / 17 dosing
function dosingCircuit() {
  const b = base('Dosing');
  b.add('rl2', 'relay_module', 560, 60, { channels: 2, trigger: 'low' }, 0, 'Relay ×2');
  b.add('ps', 'power_supply', 560, 420, { volts: 12 }, 0, '12 V');
  b.add('doseA', 'dosing_pump', 800, 80, { role: 'dose_a', rate: 100 }, 0, 'Pump A');
  b.add('doseB', 'dosing_pump', 800, 240, { role: 'dose_b', rate: 100 }, 0, 'Pump B');
  b.wire('pi.P2', 'rl2.VCC', W.red).wire('pi.P14', 'rl2.GND', W.black);
  b.wire('pi.P29', 'rl2.IN1', W.orange, 'GPIO5').wire('pi.P31', 'rl2.IN2', W.yellow, 'GPIO6');
  b.wire('ps.P', 'rl2.COM1', W.red).wire('rl2.NO1', 'doseA.P', W.red).wire('doseA.N', 'ps.N', W.black);
  b.wire('ps.P', 'rl2.COM2', W.red).wire('rl2.NO2', 'doseB.P', W.red).wire('doseB.N', 'ps.N', W.black);
  return b;
}

const DOSING = `import time
from gpiozero import OutputDevice

# Calibrate! Run a pump for 60 s into a measuring cylinder and enter ml/min here.
FLOW_ML_PER_MIN = {"A": 100.0, "B": 100.0}
pumps = {
    "A": OutputDevice(5, active_high=False, initial_value=False),
    "B": OutputDevice(6, active_high=False, initial_value=False),
}

def dose(name, ml):
    busy = [n for n, p in pumps.items() if p.value]
    if busy:
        raise RuntimeError(f"interlock: {busy} already running")
    seconds = ml / FLOW_ML_PER_MIN[name] * 60
    print(f"Dosing {ml} ml of {name}: pump ON for {seconds:.1f} s")
    pumps[name].on()
    time.sleep(seconds)
    pumps[name].off()
    print(f"{name} done")

for name, ml in [("A", 10), ("B", 10)]:
    dose(name, ml)
    time.sleep(2)        # let the solution mix before the next component
print("Recipe complete - compare with the totals in the Smart Farm tab")
`;

export const ex16: Example = {
  id: 'ex16-dosing',
  n: 16,
  level: 'advanced',
  title: { en: 'Fertilizer dosing (ml)', ar: 'ضخ السماد بالمليلتر' },
  objective: { en: 'Convert millilitres to pump run-time from a calibrated flow rate and dose A then B.', ar: 'تحويل المليلترات إلى زمن تشغيل من معدل تدفق معاير وضخ A ثم B.' },
  parts: ['2-channel relay', '2 peristaltic pumps (100 ml/min nominal)', 'Farm model (tanks A/B)'],
  expected: { en: '10 ml of A, pause, 10 ml of B. The farm totals show 10.0 ± 1 ml each and EC rises slightly.', ar: '10 مل من A ثم توقف ثم 10 مل من B. تظهر المجاميع 10.0 ± 1 مل لكل منهما ويرتفع EC قليلاً.' },
  instructions: { en: 'Run at 1× or 2×. Then set "Real flow error" on pump A to +8 % and see the dose drift — that is why calibration matters.', ar: 'شغّل بسرعة 1× أو 2×. ثم اجعل "خطأ التدفق الحقيقي" للمضخة A +8٪ لترى انحراف الجرعة — لذلك تهم المعايرة.' },
  breakIt: [{ en: 'Remove the interlock check and call dose() for B from a Timer while A runs.', ar: 'احذف فحص القفل واستدعِ dose() لـ B من مؤقت أثناء عمل A.' }],
  build() {
    return finish(dosingCircuit(), 'Ex 16 · Fertilizer dosing', this.id, { 'main.py': DOSING }, { farm: farmOn() });
  },
  checks: [
    {
      id: 'ex16',
      name: 'Dose accuracy ±1 ml',
      expected: 'A = 10 ± 1 ml, B = 10 ± 1 ml',
      async run(h) {
        h.speed = 2;
        await h.load(ex16.build());
        await h.run();
        await h.until(() => h.term().includes('Recipe complete'), 40);
        const a = sim.farm.state.totals.doseAml;
        const b = sim.farm.state.totals.doseBml;
        return { pass: Math.abs(a - 10) <= 1 && Math.abs(b - 10) <= 1, actual: `A ${a.toFixed(2)} ml, B ${b.toFixed(2)} ml` };
      },
    },
  ],
};

const INTERLOCK = `import threading
import time
from gpiozero import OutputDevice

class DosingController:
    """Only one concentrated fertilizer may be dosed at a time."""

    def __init__(self):
        self.pumps = {"A": OutputDevice(5, active_high=False), "B": OutputDevice(6, active_high=False)}
        self.running = None

    def start(self, name):
        if self.running and self.running != name:
            print(f"INTERLOCK: request for {name} refused - {self.running} is running")
            return False
        self.running = name
        self.pumps[name].on()
        print(f"{name} ON")
        return True

    def stop(self, name):
        self.pumps[name].off()
        if self.running == name:
            self.running = None
        print(f"{name} OFF")

ctl = DosingController()

# A second request arrives while A is dosing (e.g. from the web page or Nextion)
threading.Timer(2.0, lambda: ctl.start("B")).start()

ctl.start("A")
time.sleep(6)
ctl.stop("A")
time.sleep(1)
ctl.start("B")
time.sleep(3)
ctl.stop("B")
print("Check the Smart Farm tab: there must be NO 'A and B dosed at the same time' alarm")
`;

export const ex17: Example = {
  id: 'ex17-interlock',
  n: 17,
  level: 'advanced',
  title: { en: 'Dosing pump interlock', ar: 'القفل البرمجي لمضخات الجرعات' },
  objective: { en: 'Prevent two conflicting actuators from running together, even when requests arrive asynchronously.', ar: 'منع تشغيل مشغّلين متعارضين معاً حتى عند وصول الطلبات بشكل غير متزامن.' },
  parts: ['Same circuit as example 16'],
  expected: { en: 'The request for B during A is refused ("INTERLOCK"); the farm model never sees A and B together.', ar: 'يُرفض طلب B أثناء A ("INTERLOCK") ولا يرى نموذج المزرعة تشغيل A وB معاً.' },
  instructions: { en: 'Run, then delete the interlock `if` and run again: the farm tab raises the A+B alarm.', ar: 'شغّل، ثم احذف شرط القفل وشغّل مجدداً: يظهر إنذار A+B في تبويب المزرعة.' },
  breakIt: [{ en: 'Delete the `if self.running …` block.', ar: 'احذف كتلة if self.running.' }],
  build() {
    return finish(dosingCircuit(), 'Ex 17 · Pump interlock', this.id, { 'main.py': INTERLOCK }, { farm: farmOn() });
  },
  checks: [
    {
      id: 'ex17',
      name: 'Interlock prevents A+B together',
      expected: 'INTERLOCK message, no AB_SIMULTANEOUS alarm',
      async run(h) {
        h.speed = 2;
        await h.load(ex17.build());
        await h.run();
        await h.until(() => h.term().includes('Check the Smart Farm tab'), 20);
        const alarm = sim.farm.state.alarms.some((a) => a.id === 'AB_SIMULTANEOUS');
        return { pass: h.term().includes('INTERLOCK') && !alarm, actual: `interlock message: ${h.term().includes('INTERLOCK')}, A+B alarm: ${alarm}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 18
const FAILSAFE = `import time
import board
import adafruit_dht
from gpiozero import OutputDevice

heater = OutputDevice(17, active_high=False, initial_value=False)
dht = adafruit_dht.DHT22(board.D4)
SET_POINT = 22.0
fails = 0
last_good = time.time()

def plausible(t, h):
    return t is not None and h is not None and -10 <= t <= 50 and 0 < h <= 100

while True:
    try:
        t, h = dht.temperature, dht.humidity
        if not plausible(t, h):
            raise ValueError(f"implausible reading t={t} h={h}")
        fails, last_good = 0, time.time()
        heater.value = t < SET_POINT
        print(f"T={t:.1f} °C -> heater {'ON' if heater.value else 'OFF'}")
    except (RuntimeError, ValueError) as e:
        fails += 1
        print(f"read problem #{fails}: {e}")
    if time.time() - last_good > 10:
        heater.off()                       # fail-safe state
        print("SENSOR FAULT: no valid data for 10 s -> heater OFF")
    time.sleep(2)
`;

export const ex18: Example = {
  id: 'ex18-failsafe',
  n: 18,
  level: 'advanced',
  title: { en: 'Sensor failure response', ar: 'الاستجابة لعطل الحساس' },
  objective: { en: 'Detect missing, stuck or implausible readings and put actuators into a safe state.', ar: 'اكتشاف القراءات المفقودة أو العالقة أو غير المنطقية ووضع المشغّلات في حالة آمنة.' },
  parts: ['DHT22', 'Relay + 12 V heater'],
  expected: { en: 'Normal: heater regulates around 22 °C. Inject "Sensor disconnected" or "Invalid reading": after 10 s the heater is forced OFF and SENSOR FAULT is printed.', ar: 'في الوضع الطبيعي ينظم السخان الحرارة حول 22°م. عند حقن عطل "فصل الحساس" أو "قراءة غير صالحة" يُطفأ السخان بعد 10 ث وتُطبع SENSOR FAULT.' },
  instructions: { en: 'Run, select the DHT22, choose a fault in "Fault injection".', ar: 'شغّل، اختر DHT22 ثم اختر عطلاً من "حقن الأعطال".' },
  breakIt: [{ en: 'Remove the fail-safe block: the heater stays ON with a dead sensor.', ar: 'احذف كتلة الأمان: يبقى السخان يعمل مع حساس معطل.' }],
  build() {
    const b = base('Failsafe');
    b.add('dht', 'dht22', 480, 380, { temperature: 18, humidity: 55 }, 0, 'DHT22');
    b.add('rl', 'relay_module', 600, 60, { channels: 1, trigger: 'low' }, 0, 'Relay');
    b.add('ps', 'power_supply', 600, 420, { volts: 12, amps: 10 }, 0, '12 V');
    b.add('heater', 'heater', 820, 220, { role: 'heater', watts: 40 }, 0, 'Heater');
    b.wire('pi.P1', 'dht.VCC', W.red).wire('pi.P7', 'dht.DATA', W.yellow, 'GPIO4').wire('pi.P9', 'dht.GND', W.black);
    b.wire('pi.P2', 'rl.VCC', W.red).wire('pi.P14', 'rl.GND', W.black).wire('pi.P11', 'rl.IN1', W.orange, 'GPIO17');
    b.wire('ps.P', 'rl.COM1', W.red).wire('rl.NO1', 'heater.P', W.red).wire('heater.N', 'ps.N', W.black);
    return finish(b, 'Ex 18 · Sensor failure response', this.id, { 'main.py': FAILSAFE });
  },
  checks: [
    {
      id: 'ex18',
      name: 'Fail-safe on sensor loss',
      expected: 'heater ON at 18 °C, OFF + SENSOR FAULT after disconnection',
      async run(h) {
        h.speed = 5;
        await h.load(ex18.build());
        await h.run();
        await h.waitSim(3);
        const on = h.vis('heater').run ?? 0;
        h.setProp('dht', 'fault', 'disconnected');
        await h.waitSim(15);
        const off = h.vis('heater').run ?? 0;
        return { pass: on > 0.9 && off === 0 && h.term().includes('SENSOR FAULT'), actual: `heater before fault ${on.toFixed(2)}, after ${off}; fault message: ${h.term().includes('SENSOR FAULT')}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 19
export const ex19: Example = {
  id: 'ex19-dashboard',
  n: 19,
  level: 'advanced',
  title: { en: 'Hydroponic farm web dashboard', ar: 'لوحة ويب للمزرعة المائية' },
  objective: { en: 'Serve a responsive web page from Flask with a JSON API while the control loop keeps running.', ar: 'تقديم صفحة ويب متجاوبة من Flask مع واجهة JSON بينما تستمر حلقة التحكم.' },
  parts: ['Farm circuit: DHT22, MCP3008 (pH, EC, level), float switch, relays, pump'],
  expected: { en: 'Open the Web tab: cards show live readings every 2 s; lower the reservoir in Smart Farm and the LOW WATER alert appears.', ar: 'افتح تبويب الويب: تُظهر البطاقات القراءات كل ثانيتين؛ اخفض الخزان فيظهر تنبيه LOW WATER.' },
  instructions: { en: 'Run, open the Web tab (try the phone width), then change the farm.', ar: 'شغّل وافتح تبويب الويب (جرّب عرض الهاتف) ثم غيّر المزرعة.' },
  breakIt: [{ en: 'Call app.run() before the control loop without a thread: the loop never starts on a real Pi.', ar: 'استدعِ app.run() قبل الحلقة بدون Thread: لن تبدأ الحلقة على Pi حقيقي.' }],
  build() {
    const b = farmCircuit({ dosing: false, nextion: false, co2: false });
    return finish(b, 'Ex 19 · Farm web dashboard', this.id, { 'main.py': DASH_PY, 'templates/index.html': DASH_HTML }, { farm: farmOn() });
  },
  checks: [
    {
      id: 'ex19',
      name: 'Web API returns live data',
      expected: 'GET /api/state → 200 JSON with pH and pump ON',
      async run(h) {
        await h.load(ex19.build());
        await h.run();
        await h.waitSim(3);
        const r = await h.http('GET', '/api/state');
        let j: any = {};
        try {
          j = JSON.parse(r.body);
        } catch {
          /* keep empty */
        }
        const page = await h.http('GET', '/');
        return { pass: r.status === 200 && typeof j.ph === 'number' && j.pump === true && page.body.includes('Hydroponic farm'), actual: `status ${r.status}, body ${r.body.slice(0, 120)}` };
      },
    },
  ],
};

// ------------------------------------------------------------------ 20
export const ex20: Example = {
  id: 'ex20-city-farming',
  n: 20,
  level: 'competition',
  title: { en: 'Complete City Farming controller', ar: 'وحدة تحكم City Farming الكاملة' },
  objective: {
    en: 'Module A + B practice: AUTO / DOSING / TEST / MANUAL modes, light and irrigation schedules, thresholds, water protection, alerts, grow-day counter (0–40), Nextion UI and a local web interface.',
    ar: 'تدريب على الوحدتين A وB: أوضاع تلقائي/جرعات/اختبار/يدوي، جداول الإضاءة والري، الحدود، حماية الماء، التنبيهات، عداد أيام النمو (0–40)، واجهة Nextion وواجهة ويب محلية.',
  },
  parts: ['Raspberry Pi 5', 'Nextion 2.8"', '4-ch + 2-ch relays', 'Pump, light, fan, heater', '2 dosing pumps', 'DHT22, DS18B20, MH-Z19B, MCP3008 (pH, EC, level), float switch'],
  expected: {
    en: 'Nextion main page shows time, sensors, mode, grow day and alerts; the Web tab shows the same and lets you change settings, dose, test relays and switch modes.',
    ar: 'تعرض صفحة Nextion الرئيسية الوقت والحساسات والوضع ويوم النمو والتنبيهات؛ ويعرض تبويب الويب ذلك ويسمح بتغيير الإعدادات والجرعات واختبار المرحلات وتبديل الأوضاع.',
  },
  instructions: {
    en: 'Run. Use the Nextion (Control page → MANUAL → toggle relays), the Web tab (dosing, test mode, settings) and the Smart Farm tab (lower the water, raise the temperature, inject faults). settings.json appears in the file list.',
    ar: 'شغّل. استخدم Nextion (صفحة التحكم ← يدوي ← تبديل المرحلات) وتبويب الويب (الجرعات، وضع الاختبار، الإعدادات) وتبويب المزرعة (اخفض الماء، ارفع الحرارة، احقن أعطالاً). سيظهر settings.json في قائمة الملفات.',
  },
  breakIt: [
    { en: 'Swap the Nextion TX/RX wires and watch the UART monitor.', ar: 'بدّل سلكي TX/RX للشاشة وراقب مراقب UART.' },
    { en: 'Set pump A "Real flow error" to +10 % and dose 10 ml: the total is off by 1 ml.', ar: 'اجعل خطأ تدفق المضخة A +10٪ واضخ 10 مل: يزيد المجموع 1 مل.' },
    { en: 'Unplug the DHT22 (fault): SENSOR DHT alert appears on screen and web.', ar: 'افصل DHT22 (عطل): يظهر تنبيه SENSOR DHT على الشاشة والويب.' },
  ],
  build() {
    const b = farmCircuit({ nextion: true, co2: true, dosing: true });
    return finish(
      b,
      'Ex 20 · City Farming controller',
      this.id,
      { 'main.py': MAIN_PY, 'config.py': CFG_PY, 'hardware.py': HW_PY, 'nextion.py': NX_PY, 'web.py': WEB_PY, 'templates/index.html': INDEX_HTML },
      { nextion: farmNextionTemplate(), farm: farmOn() },
    );
  },
  checks: [
    {
      id: 'ex20',
      name: 'Integrated controller (Nextion + web + protection)',
      expected: 'screen and web updated; pump stops on low water; LOW WATER alert',
      async run(h) {
        await h.load(ex20.build());
        await h.run();
        await h.waitSim(4);
        const temp = nxText('nx', 'tTemp');
        const r = await h.http('GET', '/api/state');
        const j = JSON.parse(r.body || '{}');
        sim.farm.state.reservoir.volumeL = 2;
        sim.evaluate();
        await h.waitSim(4);
        const alarm = nxText('nx', 'tAlarm');
        const pump = h.vis('pump').run ?? 0;
        const ok = temp !== '--' && temp !== '' && r.status === 200 && j.mode === 'AUTO' && alarm.includes('LOW WATER') && pump === 0;
        return { pass: ok, actual: `tTemp="${temp}", web mode=${j.mode}, tAlarm="${alarm}", pump run=${pump}` };
      },
    },
  ],
};
