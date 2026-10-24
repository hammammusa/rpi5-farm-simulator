// Industrial automation: level control, pump sequencing, conveyors, safety interlocks.
import { check, energised, ex, lit, running, vis, type LibExample } from './dsl';

export const INDUSTRIAL_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'ind-tank-level-control',
      cat: 'industrial',
      level: 'intermediate',
      minutes: 25,
      title: ['Two-float tank level control', 'التحكم بمستوى خزان بعوامتين'],
      goal: ['Fill a tank between a low and a high float switch (classic level control).', 'ملء خزان بين عوامة منخفضة وعوامة مرتفعة (التحكم الكلاسيكي بالمستوى).'],
      result: ['The pump starts when the level drops below the low float and stops at the high float.', 'تبدأ المضخة عندما ينخفض المستوى تحت العوامة السفلى وتتوقف عند العوامة العليا.'],
      tryIt: ['Set both floats’ level to 10 %, then to 90 %.', 'اضبط مستوى العوامتين على 10% ثم على 90%.'],
      modify: ['Add a dry-run alarm if the level does not rise within 10 s.', 'أضف إنذار تشغيل جاف إذا لم يرتفع المستوى خلال 10 ثوانٍ.'],
      explain: ['Each float closes when the water reaches it. "Low open" starts filling, "high closed" stops it — between them the pump keeps its state.', 'تنغلق كل عوامة عندما يصلها الماء. انفتاح السفلى يبدأ الملء وانغلاق العليا يوقفه، وبينهما تحافظ المضخة على حالتها.'],
      code: `from smartfarm import FloatSwitch, Pump
from time import sleep

low, high = FloatSwitch(27), FloatSwitch(22)
pump = Pump(17, active_high=False)
for i in range(12):
    if not low.is_closed and not pump.is_on:
        pump.on(); print("level low -> filling")
    elif high.is_closed and pump.is_on:
        pump.off(); print("tank full -> pump off")
    sleep(0.4)
`,
      test: {
        expect: /level low -> filling[\s\S]*tank full -> pump off/,
        seconds: 6,
        events: [
          { at: 0.5, comp: 'flLow', props: { level: 10 } },
          { at: 0.5, comp: 'flHigh', props: { level: 10 } },
          { at: 2.5, comp: 'flLow', props: { level: 90 } },
          { at: 2.5, comp: 'flHigh', props: { level: 90 } },
        ],
        verify: (s) => check(!running(s, 'pump'), 'pump off when full'),
      },
    },
    (c) =>
      c
        .contact('flLow', 'float_switch', 27, { level: 50, trigger: 20 }, 'Low float')
        .contact('flHigh', 'float_switch', 22, { level: 50, trigger: 80 }, 'High float')
        .supply()
        .relay('relay', [17], {}, 'Relay')
        .load('pump', 'water_pump', 'relay', 1, {}, 'Fill pump'),
  ),
  ex(
    {
      id: 'ind-duty-standby-pumps',
      cat: 'industrial',
      level: 'advanced',
      minutes: 30,
      title: ['Duty / standby pump alternation', 'تبديل المضختين: عاملة واحتياطية'],
      goal: ['Alternate two pumps each cycle so they wear evenly, and count running hours.', 'تبديل مضختين في كل دورة حتى تتساوى الأعمار، وعدّ ساعات التشغيل.'],
      result: ['Four cycles run pump A, B, A, B; the run-time counters end equal.', 'تُشغّل أربع دورات المضخة A ثم B ثم A ثم B، وتنتهي عدادات التشغيل متساوية.'],
      tryIt: ['Watch the two relay channels take turns.', 'راقب قناتي المرحل تتناوبان.'],
      modify: ['If one pump is "faulted", run the other one every cycle.', 'إذا كانت إحدى المضختين "معطلة" فشغّل الأخرى في كل دورة.'],
      explain: ['A dict keeps run-time per pump; the duty pump is chosen with cycle % 2.', 'يحتفظ قاموس بزمن تشغيل كل مضخة، وتُختار المضخة العاملة بالتعبير cycle % 2.'],
      code: `from gpiozero import OutputDevice
from time import sleep, monotonic

pumps = {"A": OutputDevice(17, active_high=False), "B": OutputDevice(27, active_high=False)}
runtime = {"A": 0.0, "B": 0.0}
for cycle in range(4):
    name = "AB"[cycle % 2]
    start = monotonic()
    pumps[name].on(); sleep(0.8); pumps[name].off()
    runtime[name] += monotonic() - start
    print(f"cycle {cycle + 1}: pump {name}  runtime A {runtime['A']:.1f} s  B {runtime['B']:.1f} s")
    sleep(0.2)
`,
      test: { expect: /cycle 4: pump B\s+runtime A 1\.6 s\s+B 1\.6 s/, seconds: 6, verify: (s) => check(!running(s, 'pumpA') && !running(s, 'pumpB'), 'both pumps off') },
    },
    (c) => c.supply().relay('relay', [17, 27], {}, 'Relay ×2').load('pumpA', 'water_pump', 'relay', 1, {}, 'Pump A').load('pumpB', 'water_pump', 'relay', 2, {}, 'Pump B'),
  ),
  ex(
    {
      id: 'ind-conveyor-batch-counter',
      cat: 'industrial',
      level: 'intermediate',
      minutes: 25,
      title: ['Conveyor batch counter', 'عدّاد دفعات على سير ناقل'],
      goal: ['Count objects passing a light beam and stop the conveyor after a batch.', 'عدّ الأجسام التي تقطع شعاعاً ضوئياً وإيقاف السير الناقل بعد اكتمال الدفعة.'],
      result: ['The conveyor runs until three objects have passed, then stops.', 'يعمل السير حتى تمر ثلاثة أجسام ثم يتوقف.'],
      tryIt: ['Drop the light sensor lux to 50 and back three times.', 'خفّض lux في حساس الضوء إلى 50 ثم أعده ثلاث مرات.'],
      modify: ['Read the batch size from a DIP switch.', 'اقرأ حجم الدفعة من مفاتيح DIP.'],
      explain: ['Each beam interruption is one object (rising edge on DO); a counter compares with the batch size.', 'كل انقطاع للشعاع جسم واحد (حافة صاعدة على DO)، ويقارن عدّاد بحجم الدفعة.'],
      code: `from gpiozero import DigitalInputDevice, Motor
from time import sleep

beam = DigitalInputDevice(17)            # HIGH while an object blocks the light
belt = Motor(23, 24)
BATCH = 3
count = 0
belt.forward(0.6)
print("conveyor running")
while count < BATCH:
    beam.wait_for_active()
    count += 1
    print("object", count)
    beam.wait_for_inactive()
belt.stop()
print("batch complete, conveyor stopped")
`,
      test: {
        expect: /object 3[\s\S]*batch complete, conveyor stopped/,
        seconds: 6,
        events: [
          { at: 0.8, comp: 'beam', props: { lux: 50 } },
          { at: 1.2, comp: 'beam', props: { lux: 2000 } },
          { at: 1.8, comp: 'beam', props: { lux: 50 } },
          { at: 2.2, comp: 'beam', props: { lux: 2000 } },
          { at: 2.8, comp: 'beam', props: { lux: 50 } },
          { at: 3.2, comp: 'beam', props: { lux: 2000 } },
        ],
        verify: (s) => check(!running(s, 'belt'), 'conveyor stopped'),
      },
    },
    (c) =>
      c
        .part('beam', 'ldr_module', { lux: 2000, threshold: 500 }, 'Beam sensor')
        .w(`beam.VCC>${c.v33()}`, `beam.GND>${c.gnd()}`, 'beam.DO>pi.P11')
        .l298n('drv', 23, 24)
        .part('belt', 'dc_motor', { vrated: 12 }, 'Conveyor')
        .w('drv.OUT1>belt.P', 'drv.OUT2>belt.N'),
  ),
  ex(
    {
      id: 'ind-start-stop-estop',
      cat: 'industrial',
      level: 'intermediate',
      minutes: 25,
      title: ['Start / stop with emergency stop', 'تشغيل وإيقاف مع زر طوارئ'],
      goal: ['Implement the standard motor start/stop latch with an emergency-stop override.', 'تنفيذ دائرة الإمساك القياسية لتشغيل المحرك وإيقافه مع أولوية لزر الطوارئ.'],
      result: ['START latches the motor on, STOP turns it off, E-STOP stops it and blocks START until reset.', 'زر التشغيل يُثبّت المحرك عاملاً، وزر الإيقاف يطفئه، وزر الطوارئ يوقفه ويمنع التشغيل حتى إعادة الضبط.'],
      tryIt: ['Press START, then E-STOP, then START again (ignored), then RESET and START.', 'اضغط تشغيل ثم الطوارئ ثم تشغيل (يُتجاهل) ثم إعادة الضبط ثم تشغيل.'],
      modify: ['Add a green run light and a red stopped light.', 'أضف ضوءاً أخضر للتشغيل وأحمر للتوقف.'],
      explain: ['The latch is a variable; E-STOP sets a "tripped" flag that START checks first — safety always wins.', 'الإمساك متغيّر، وزر الطوارئ يرفع علم "تعطّل" يفحصه زر التشغيل أولاً، فالسلامة لها الأولوية دائماً.'],
      code: `from gpiozero import Button, OutputDevice
from signal import pause

start, stop, estop, reset = Button(17), Button(27), Button(22), Button(5)
motor = OutputDevice(23, active_high=False)
tripped = False

def on_start():
    if tripped:
        print("start ignored: E-STOP active")
    else:
        motor.on(); print("motor running")

def on_stop():
    motor.off(); print("motor stopped")

def on_estop():
    global tripped
    tripped = True; motor.off(); print("EMERGENCY STOP")

def on_reset():
    global tripped
    tripped = False; print("reset, ready")

start.when_pressed, stop.when_pressed = on_start, on_stop
estop.when_pressed, reset.when_pressed = on_estop, on_reset
pause()
`,
      test: {
        expect: /motor running[\s\S]*EMERGENCY STOP[\s\S]*start ignored: E-STOP active[\s\S]*reset, ready[\s\S]*motor running/,
        seconds: 7,
        events: [
          { at: 0.5, comp: 'start', press: true },
          { at: 0.7, comp: 'start', press: false },
          { at: 1.5, comp: 'estop', press: true },
          { at: 1.7, comp: 'estop', press: false },
          { at: 2.5, comp: 'start', press: true },
          { at: 2.7, comp: 'start', press: false },
          { at: 3.5, comp: 'reset', press: true },
          { at: 3.7, comp: 'reset', press: false },
          { at: 4.5, comp: 'start', press: true },
          { at: 4.7, comp: 'start', press: false },
        ],
        verify: (s) => check(energised(s, 'relay') && running(s, 'motor'), 'motor running at the end'),
      },
    },
    (c) =>
      c
        .button('start', 17, 'START')
        .button('stop', 27, 'STOP')
        .button('estop', 22, 'E-STOP')
        .button('reset', 5, 'RESET')
        .supply()
        .relay('relay', [23], {}, 'Contactor')
        .load('motor', 'dc_motor', 'relay', 1, {}, 'Motor'),
  ),
  ex(
    {
      id: 'ind-booster-pump-pressure',
      cat: 'industrial',
      level: 'advanced',
      minutes: 30,
      title: ['Pressure-controlled booster pump', 'مضخة تقوية بالتحكم بالضغط'],
      goal: ['Keep pipe pressure between 200 and 400 kPa with a transducer and a pump.', 'الحفاظ على ضغط الأنبوب بين 200 و400 كيلوباسكال بحساس ضغط ومضخة.'],
      result: ['Pressure below 200 kPa starts the pump; above 400 kPa stops it.', 'الضغط تحت 200 كيلوباسكال يشغّل المضخة، وفوق 400 يوقفها.'],
      tryIt: ['Set the transducer to 150 kPa, then to 450 kPa.', 'اضبط حساس الضغط على 150 ثم على 450 كيلوباسكال.'],
      modify: ['Add a maximum run time protection of 20 s.', 'أضف حماية بحد أقصى لزمن التشغيل قدره 20 ثانية.'],
      explain: ['The 0.5–4.5 V transducer output is divided by 1.5 for the ADS1115; PressureSensor converts it to kPa.', 'يُقسم مخرج حساس الضغط (0.5–4.5 فولت) على 1.5 من أجل ADS1115، وتحوّله PressureSensor إلى كيلوباسكال.'],
      code: `from smartfarm import ADS1115, PressureSensor, Pump
from time import sleep

pressure = PressureSensor(ADS1115(), 0, range_kpa=1200, divider=1.5)
pump = Pump(17, active_high=False)
for i in range(10):
    kpa = pressure.read()
    if kpa < 200 and not pump.is_on:
        pump.on(); print(f"{kpa:.0f} kPa -> pump ON")
    elif kpa > 400 and pump.is_on:
        pump.off(); print(f"{kpa:.0f} kPa -> pump OFF")
    sleep(0.5)
`,
      test: {
        expect: /(14\d|15\d|16\d) kPa -> pump ON[\s\S]*(43\d|44\d|45\d|46\d) kPa -> pump OFF/,
        seconds: 6,
        events: [
          { at: 0.8, comp: 'pt', props: { kpa: 150 } },
          { at: 2.5, comp: 'pt', props: { kpa: 450 } },
        ],
        verify: (s) => check(!running(s, 'pump'), 'pump off above 400 kPa'),
      },
    },
    (c) => c.analog5('pt', 'pressure_transducer', 0, { kpa: 300 }, 'Pressure').supply().relay('relay', [17], {}, 'Relay').load('pump', 'water_pump', 'relay', 1, {}, 'Booster pump'),
  ),
  ex(
    {
      id: 'ind-sequential-start',
      cat: 'industrial',
      level: 'intermediate',
      minutes: 20,
      title: ['Sequential motor start', 'تشغيل المحركات بالتتابع'],
      goal: ['Start several loads one after another to limit the inrush current.', 'تشغيل عدة أحمال واحداً تلو الآخر للحد من تيار البدء.'],
      result: ['Fan, pump and heater switch on 1 s apart; on shutdown they stop in reverse order.', 'تعمل المروحة ثم المضخة ثم المدفأة بفاصل ثانية، وعند الإيقاف تتوقف بالترتيب العكسي.'],
      tryIt: ['Watch the four-channel relay board switch channel by channel.', 'راقب لوحة المرحلات الرباعية تعمل قناة بعد قناة.'],
      modify: ['Abort the sequence if a fault input becomes active.', 'ألغِ التسلسل إذا نشط مدخل عطل.'],
      explain: ['A list of (name, device) pairs defines the order; reversed() gives the shutdown order.', 'تحدد قائمة من ثنائيات (الاسم، الجهاز) الترتيب، وتعطي reversed() ترتيب الإيقاف.'],
      code: `from gpiozero import OutputDevice
from time import sleep

loads = [("fan", OutputDevice(17, active_high=False)), ("pump", OutputDevice(27, active_high=False)), ("heater", OutputDevice(22, active_high=False))]
for name, dev in loads:
    dev.on(); print("start", name); sleep(1)
sleep(1)
for name, dev in reversed(loads):
    dev.off(); print("stop", name); sleep(0.5)
`,
      test: { expect: /start fan[\s\S]*start pump[\s\S]*start heater[\s\S]*stop heater[\s\S]*stop pump[\s\S]*stop fan/, seconds: 7, verify: (s) => check(!running(s, 'fan') && !running(s, 'pump') && !running(s, 'heater'), 'all loads off') },
    },
    (c) =>
      c
        .supply('ps', 12, 10)
        .relay('relay', [17, 27, 22], {}, 'Relay ×4')
        .load('fan', 'fan', 'relay', 1, {}, 'Fan')
        .load('pump', 'water_pump', 'relay', 2, {}, 'Pump')
        .load('heater', 'heater', 'relay', 3, {}, 'Heater'),
  ),
  ex(
    {
      id: 'ind-overcurrent-trip',
      cat: 'industrial',
      level: 'advanced',
      minutes: 30,
      title: ['Pump overcurrent trip (ACS712)', 'فصل المضخة عند زيادة التيار (ACS712)'],
      goal: ['Measure motor current with a Hall sensor and trip the relay on overload.', 'قياس تيار المحرك بحساس هول وفصل المرحل عند زيادة الحمل.'],
      result: ['The pump runs at about 0.5 A; when a jam doubles the load, the relay trips.', 'تعمل المضخة بنحو 0.5 أمبير، وعندما يتضاعف الحمل بسبب انسداد يُفصل المرحل.'],
      tryIt: ['Change the pump power to 18 W (a jam) while it runs.', 'غيّر قدرة المضخة إلى 18 واط (انسداد) أثناء التشغيل.'],
      modify: ['Allow a short inrush (ignore the first 0.5 s).', 'اسمح بتيار بدء قصير (تجاهل أول نصف ثانية).'],
      explain: ['The ACS712 outputs VCC/2 + 185 mV per amp; CurrentSensor converts that (through the divider) to amps.', 'يُخرج ACS712 نصف جهد التغذية زائد 185 ملي فولت لكل أمبير، وتحوّل CurrentSensor ذلك (عبر المقسّم) إلى أمبير.'],
      code: `from smartfarm import ADS1115, CurrentSensor, Pump
from time import sleep

current = CurrentSensor(ADS1115(), 0, divider=1.5)
pump = Pump(17, active_high=False)
LIMIT = 1.0
pump.on()
for i in range(10):
    amps = current.read()
    print(f"pump current {amps:.2f} A")
    if amps > LIMIT:
        pump.off()
        print("OVERCURRENT -> pump tripped")
        break
    sleep(0.5)
`,
      test: { expect: /pump current 0\.[45]\d A[\s\S]*OVERCURRENT -> pump tripped/, seconds: 6, events: [{ at: 1.8, comp: 'pump', props: { watts: 18 } }], verify: (s) => check(!energised(s, 'relay'), 'relay tripped') },
    },
    (c) => {
      c.supply();
      c.part('acs', 'acs712', {}, 'ACS712').part('r_acsa', 'resistor', { ohms: 10000 }).part('r_acsb', 'resistor', { ohms: 20000 });
      c.ads();
      c.w(`acs.VCC>${c.v50()}`, `acs.GND>${c.gnd()}`, 'acs.OUT>r_acsa.1', 'r_acsa.2>ads.A0', 'r_acsb.1>ads.A0', `r_acsb.2>${c.gnd()}`);
      c.relay('relay', [17], {}, 'Relay').part('pump', 'water_pump', { vrated: 12 }, 'Pump').w('relay.COM1>ps.P', 'relay.NO1>acs.IPP', 'acs.IPN>pump.P', 'pump.N>ps.N');
    },
  ),
  ex(
    {
      id: 'ind-stack-light',
      cat: 'industrial',
      level: 'beginner',
      minutes: 15,
      title: ['Machine stack light', 'برج إشارات الآلة'],
      goal: ['Show a machine state (running / warning / fault) on a green-amber-red tower with a horn.', 'عرض حالة الآلة (تعمل/تحذير/عطل) على برج أخضر-أصفر-أحمر مع صفارة.'],
      result: ['The tower cycles through the states; the horn sounds only for a fault.', 'يتنقل البرج بين الحالات، ولا تعمل الصفارة إلا عند العطل.'],
      tryIt: ['Watch the three lights and the horn.', 'راقب الأضواء الثلاثة والصفارة.'],
      modify: ['Blink the amber light in the warning state.', 'اجعل الضوء الأصفر يومض في حالة التحذير.'],
      explain: ['A dictionary maps each state to the lights that must be on; one function applies it.', 'يربط قاموس كل حالة بالأضواء التي يجب أن تضيء، وتطبّقها دالة واحدة.'],
      code: `from gpiozero import LEDBoard, Buzzer
from time import sleep

tower = LEDBoard(green=17, amber=27, red=22)
horn = Buzzer(18)
STATES = {"running": (1, 0, 0), "warning": (0, 1, 0), "fault": (0, 0, 1)}

def show(state):
    tower.value = STATES[state]
    horn.value = state == "fault"
    print("state:", state)

for state in ("running", "warning", "fault", "running"):
    show(state)
    sleep(0.8)
`,
      test: { expect: /state: fault[\s\S]*state: running/, seconds: 5, verify: (s) => check(lit(s, 'green') && !lit(s, 'red') && !vis(s, 'horn').on, 'back to running') },
    },
    (c) => c.led('green', 17, 'green', 'Run').led('amber', 27, 'yellow', 'Warning').led('red', 22, 'red', 'Fault').buzzer('horn', 18),
  ),
];
