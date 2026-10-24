// Energy & power: current, power and energy, batteries, load management, regulators, tracking.
import { check, energised, ex, running, vis, type Circuit, type LibExample } from './dsl';

/** ACS712 in the supply line of relay channel 1, output divided into ADS1115 A0 */
const currentSensed = (c: Circuit, range = 5) => {
  c.supply('ps', 12, 10).ads();
  c.part('acs', 'acs712', { range }, `ACS712 ${range} A`).part('r_acsa', 'resistor', { ohms: 10000 }).part('r_acsb', 'resistor', { ohms: 20000 });
  c.w(`acs.VCC>${c.v50()}`, `acs.GND>${c.gnd()}`, 'acs.OUT>r_acsa.1', 'r_acsa.2>ads.A0', 'r_acsb.1>ads.A0', `r_acsb.2>${c.gnd()}`, 'ps.P>acs.IPP');
  return c;
};

export const ENERGY_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'energy-power-meter',
      cat: 'energy',
      level: 'intermediate',
      minutes: 25,
      title: ['Pump power and energy meter', 'عدّاد قدرة وطاقة المضخة'],
      goal: ['Measure current, compute power (P = V × I) and integrate energy over time.', 'قياس التيار وحساب القدرة (P = V × I) وتجميع الطاقة مع الزمن.'],
      result: ['Current, power and accumulated energy are printed every half second while the pump runs.', 'يُطبع التيار والقدرة والطاقة المتراكمة كل نصف ثانية أثناء عمل المضخة.'],
      tryIt: ['Change the pump power from 6 W to 12 W while it runs.', 'غيّر قدرة المضخة من 6 إلى 12 واط أثناء التشغيل.'],
      modify: ['Estimate the cost per day at your electricity price.', 'قدّر التكلفة اليومية حسب سعر الكهرباء لديك.'],
      explain: ['Energy (Wh) = Σ power × Δt / 3600. The loop measures Δt with monotonic() so it stays correct if a step takes longer.', 'الطاقة بالواط ساعة = مجموع القدرة × Δt ÷ 3600، وتقيس الحلقة Δt بـ monotonic() لتبقى دقيقة إذا طالت خطوة.'],
      code: `from smartfarm import ADS1115, CurrentSensor, Pump
from time import monotonic, sleep

current = CurrentSensor(ADS1115(), 0, divider=1.5)
pump = Pump(17, active_high=False)
VOLTS = 12.0
energy_wh = 0.0
pump.on()
last = monotonic()
for i in range(8):
    sleep(0.5)
    now = monotonic()
    amps = current.read()
    watts = VOLTS * amps
    energy_wh += watts * (now - last) / 3600
    last = now
    print(f"{amps:.2f} A  {watts:5.1f} W  {energy_wh * 1000:6.2f} mWh")
pump.off()
`,
      test: { expect: /0\.(4\d|5\d) A\s+[56]\.\d W[\s\S]*(0\.[89]\d|1\.0\d) A\s+(9|1[0-2])\.\d W/, seconds: 6, events: [{ at: 1.8, comp: 'pump', props: { watts: 12 } }] },
    },
    (c) => currentSensed(c).relay('relay', [17], {}, 'Relay').part('pump', 'water_pump', { vrated: 12 }, 'Pump').w('acs.IPN>relay.COM1', 'relay.NO1>pump.P', 'pump.N>ps.N'),
  ),
  ex(
    {
      id: 'energy-battery-guard',
      cat: 'energy',
      level: 'intermediate',
      minutes: 25,
      title: ['Battery monitor with low-voltage disconnect', 'مراقب البطارية مع الفصل عند انخفاض الجهد'],
      goal: ['Measure a 12 V battery through a divider and disconnect the load before deep discharge.', 'قياس بطارية 12 فولت عبر مقسّم جهد وفصل الحمل قبل التفريغ العميق.'],
      result: ['The voltage and an estimated charge are printed; below 11 V the load relay opens.', 'يُطبع الجهد ونسبة الشحن التقديرية، وتحت 11 فولت يُفصل مرحل الحمل.'],
      tryIt: ['Change the supply (battery) to 9 V while it runs.', 'غيّر المصدر (البطارية) إلى 9 فولت أثناء التشغيل.'],
      modify: ['Reconnect only when the battery is back above 12.4 V.', 'أعد التوصيل فقط عندما يعود الجهد فوق 12.4 فولت.'],
      explain: ['47 kΩ / 10 kΩ divides by 5.7, so 12 V reads as 2.1 V at the ADC; the code multiplies it back.', 'المقسّم 47 كيلو/10 كيلو أوم يقسم الجهد على 5.7، فيُقرأ 12 فولت كـ 2.1 فولت في المحول، ويضربه الكود مجدداً.'],
      code: `from smartfarm import ADS1115, Relay
from time import sleep

adc = ADS1115()
load = Relay(17, active_high=False)
RATIO = (47 + 10) / 10
load.on()
for i in range(6):
    v = adc.voltage(0) * RATIO
    soc = max(0, min(100, (v - 11.0) / (12.7 - 11.0) * 100))
    if v < 11.0 and load.is_on:
        load.off()
        print(f"{v:.1f} V -> LOW BATTERY, load disconnected")
    else:
        print(f"{v:.1f} V  ~{soc:.0f} %")
    sleep(0.6)
`,
      test: { expect: /12\.0 V\s+~5\d %[\s\S]*9\.0 V -> LOW BATTERY, load disconnected/, seconds: 5, events: [{ at: 1.5, comp: 'ps', props: { volts: 9 } }], verify: (s) => check(!energised(s, 'relay') && !running(s, 'lamp'), 'load disconnected') },
    },
    (c) => {
      c.supply('ps', 12, 5).ads();
      c.part('r_top', 'resistor', { ohms: 47000 }).part('r_bot', 'resistor', { ohms: 10000 });
      c.w('ps.P>r_top.1', 'r_top.2>ads.A0', 'r_bot.1>ads.A0', `r_bot.2>${c.gnd()}`);
      c.relay('relay', [17], {}, 'Load relay').load('lamp', 'grow_light', 'relay', 1, { watts: 12 }, 'Load');
    },
  ),
  ex(
    {
      id: 'energy-load-shedding',
      cat: 'energy',
      level: 'advanced',
      minutes: 30,
      title: ['Load shedding under a current limit', 'تخفيف الأحمال تحت حد تيار'],
      goal: ['Keep the total current below a limit by switching off the least important load.', 'إبقاء التيار الكلي تحت حد معيّن بإطفاء الحمل الأقل أهمية.'],
      result: ['Pump and heater start; the total exceeds 4 A, so the heater (low priority) is shed.', 'تبدأ المضخة والمدفأة، فيتجاوز المجموع 4 أمبير، فتُفصل المدفأة (أولوية منخفضة).'],
      tryIt: ['Watch the measured current before and after the heater is shed.', 'راقب التيار المقاس قبل فصل المدفأة وبعده.'],
      modify: ['Switch the heater back on when the pump stops.', 'أعد تشغيل المدفأة عندما تتوقف المضخة.'],
      explain: ['Loads are listed by priority; while the measured current is above the limit, the lowest-priority running load is switched off.', 'تُرتب الأحمال حسب الأولوية، وطالما التيار فوق الحد يُطفأ الحمل العامل ذو الأولوية الأدنى.'],
      code: `from smartfarm import ADS1115, CurrentSensor, Relay
from time import sleep

meter = CurrentSensor(ADS1115(), 0, sensitivity=0.1, divider=1.5)   # 20 A version
loads = [("pump", Relay(17, active_high=False)), ("heater", Relay(27, active_high=False))]   # high → low priority
LIMIT = 4.0
for name, relay in loads:
    relay.on(); print("start", name); sleep(0.5)
total = meter.read()
print(f"total {total:.1f} A")
for name, relay in reversed(loads):
    if total <= LIMIT:
        break
    relay.off(); sleep(0.3)
    total = meter.read()
    print(f"shed {name} -> total {total:.1f} A")
`,
      test: { expect: /total 5\.\d A[\s\S]*shed heater -> total 0\.\d A/, seconds: 4, verify: (s) => check(running(s, 'pump') && !running(s, 'heater'), 'pump on, heater shed') },
    },
    (c) =>
      currentSensed(c, 20)
        .relay('relay', [17, 27], {}, 'Relay ×2')
        .part('pump', 'water_pump', { vrated: 12 }, 'Pump')
        .part('heater', 'heater', { vrated: 12 }, 'Heater')
        .w('acs.IPN>relay.COM1', 'acs.IPN>relay.COM2', 'relay.NO1>pump.P', 'pump.N>ps.N', 'relay.NO2>heater.P', 'heater.N>ps.N'),
  ),
  ex(
    {
      id: 'energy-solar-tracker',
      cat: 'energy',
      level: 'intermediate',
      minutes: 25,
      title: ['Single-axis solar tracker', 'متتبع شمسي أحادي المحور'],
      goal: ['Turn a panel towards the brighter of two light sensors with a servo.', 'توجيه لوح نحو الأكثر سطوعاً من حساسَي ضوء باستخدام سيرفو.'],
      result: ['When the right side is brighter the servo steps right, and vice versa, until both match.', 'عندما يكون الجانب الأيمن أسطع يتحرك السيرفو يميناً والعكس، حتى يتساويا.'],
      tryIt: ['Set the right sensor to 20000 lux while it runs.', 'اضبط الحساس الأيمن على 20000 lux أثناء التشغيل.'],
      modify: ['Add a dead band so tiny differences are ignored.', 'أضف منطقة ميتة لتجاهل الفروق الصغيرة جداً.'],
      explain: ['The module’s AO voltage falls as light rises, so the brighter side has the lower voltage.', 'ينخفض جهد المخرج AO في الوحدة كلما ازداد الضوء، فالجانب الأسطع جهده أقل.'],
      code: `import time
import board, busio
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn
from gpiozero import AngularServo

ads = ADS.ADS1115(busio.I2C(board.SCL, board.SDA))
left, right = AnalogIn(ads, ADS.P0), AnalogIn(ads, ADS.P1)
panel = AngularServo(18, min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
angle = 0
for i in range(10):
    diff = left.voltage - right.voltage          # > 0: right is brighter
    if abs(diff) > 0.05:
        angle = max(-90, min(90, angle + (10 if diff > 0 else -10)))
        panel.angle = angle
    print(f"L {left.voltage:.2f} V  R {right.voltage:.2f} V -> panel {angle:+d}°")
    time.sleep(0.3)
`,
      test: { expect: /panel \+0°[\s\S]*panel \+[1-9]\d°/, seconds: 4, events: [{ at: 0.8, comp: 'ldrR', props: { lux: 20000 } }], verify: (s) => check((vis(s, 'panel').angle ?? 0) > 20, `angle ${vis(s, 'panel').angle}`) },
    },
    (c) => c.analog('ldrL', 'ldr_module', 0, { lux: 2000 }, 'Left LDR').analog('ldrR', 'ldr_module', 1, { lux: 2000 }, 'Right LDR').servo('panel', 18, 'sg90'),
  ),
  ex(
    {
      id: 'energy-regulator-dropout',
      cat: 'energy',
      level: 'advanced',
      minutes: 25,
      title: ['Regulator output and dropout', 'خرج المنظم وهبوط الجهد'],
      goal: ['Measure a 7805 regulator output and detect when its input is too low to regulate.', 'قياس خرج منظم 7805 واكتشاف انخفاض جهد دخله عن الحد اللازم للتنظيم.'],
      result: ['With 12 V in, the output reads 5.0 V; with 5 V in, it drops below 4.75 V and a warning is printed.', 'مع دخل 12 فولت يُقرأ الخرج 5.0 فولت، ومع دخل 5 فولت ينخفض تحت 4.75 فولت وتُطبع رسالة تحذير.'],
      tryIt: ['Change the supply to 5 V while it runs.', 'غيّر المصدر إلى 5 فولت أثناء التشغيل.'],
      modify: ['Also measure the input voltage on channel 1.', 'قِس جهد الدخل أيضاً على القناة 1.'],
      explain: ['A linear regulator needs about 2 V more at its input than at its output (dropout voltage).', 'يحتاج المنظم الخطي إلى نحو 2 فولت في الدخل زيادة على الخرج (جهد الهبوط).'],
      code: `from smartfarm import ADS1115
from time import sleep

adc = ADS1115()
for i in range(5):
    vout = adc.voltage(0) * 1.5            # 10 k / 20 k divider
    status = "regulating" if vout > 4.75 else "DROPOUT: input too low"
    print(f"7805 output {vout:.2f} V -> {status}")
    sleep(0.6)
`,
      test: { expect: /output 5\.0\d V -> regulating[\s\S]*DROPOUT: input too low/, seconds: 4, events: [{ at: 1.2, comp: 'ps', props: { volts: 5 } }] },
    },
    (c) => {
      c.supply('ps', 12, 3).ads();
      c.part('reg', 'lm7805', {}, 'LM7805').part('r_a', 'resistor', { ohms: 10000 }).part('r_b', 'resistor', { ohms: 20000 }).part('r_load', 'resistor', { ohms: 470 });
      c.w('ps.P>reg.VIN', 'reg.GND>ps.N', 'reg.VOUT>r_a.1', 'r_a.2>ads.A0', 'r_b.1>ads.A0', 'r_b.2>ps.N', 'reg.VOUT>r_load.1', 'r_load.2>ps.N');
    },
  ),
  ex(
    {
      id: 'energy-standby-saver',
      cat: 'energy',
      level: 'beginner',
      minutes: 15,
      title: ['Standby power saver', 'موفّر طاقة الاستعداد'],
      goal: ['Cut power to devices when nobody has been in the room for a while.', 'قطع الطاقة عن الأجهزة عندما لا يوجد أحد في الغرفة لفترة.'],
      result: ['Motion switches the outlet on; after 3 s without motion it switches off.', 'الحركة تشغّل المأخذ، وبعد 3 ثوانٍ دون حركة يُفصل.'],
      tryIt: ['Set the PIR motion on, then off and wait.', 'فعّل حركة PIR ثم أوقفها وانتظر.'],
      modify: ['Count the seconds of saved standby time.', 'احسب ثواني وقت الاستعداد التي تم توفيرها.'],
      explain: ['MotionSensor.wait_for_no_motion() and a timer keep the logic short.', 'تجعل MotionSensor.wait_for_no_motion() مع مؤقت المنطق قصيراً.'],
      code: `from gpiozero import MotionSensor
from smartfarm import Relay
from time import sleep

pir = MotionSensor(27)
outlet = Relay(17, active_high=False)
pir.wait_for_motion()
outlet.on(); print("someone here -> outlet ON")
pir.wait_for_no_motion()
sleep(3)
if not pir.motion_detected:
    outlet.off(); print("room empty for 3 s -> outlet OFF")
`,
      test: {
        expect: /outlet ON[\s\S]*outlet OFF/,
        seconds: 7,
        events: [
          { at: 1, comp: 'pir', props: { motion: true } },
          { at: 2, comp: 'pir', props: { motion: false } },
        ],
        verify: (s) => check(!energised(s, 'relay'), 'outlet off'),
      },
    },
    (c) => c.pir('pir', 27, { hold: 0.5 }).supply().relay('relay', [17], {}, 'Outlet relay').load('tv', 'grow_light', 'relay', 1, { watts: 12 }, 'Appliance'),
  ),
];
