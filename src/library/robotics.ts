// Robotics: differential drive, obstacle avoidance, line following, arms and scanning.
import { check, ex, near, running, vis, type Circuit, type LibExample } from './dsl';

/** two DC motors on one L298N (left on OUT1/2, right on OUT3/4) */
const twoMotors = (c: Circuit) =>
  c
    .l298n('drv', 23, 24, 5, 6)
    .part('left', 'dc_motor', { vrated: 12 }, 'Left wheel')
    .part('right', 'dc_motor', { vrated: 12 }, 'Right wheel')
    .w('drv.OUT1>left.P', 'drv.OUT2>left.N', 'drv.OUT3>right.P', 'drv.OUT4>right.N');

export const ROBOTICS_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'robot-drive-square',
      cat: 'robotics',
      level: 'intermediate',
      minutes: 25,
      title: ['Differential drive: drive a square', 'قيادة تفاضلية: رسم مربع'],
      goal: ['Steer a two-wheel robot by running its motors forwards and backwards.', 'توجيه روبوت بعجلتين بتشغيل محركيه للأمام وللخلف.'],
      result: ['The robot drives forward and turns right four times, then stops.', 'يتقدم الروبوت ثم ينعطف يميناً أربع مرات ثم يتوقف.'],
      tryIt: ['Watch both wheels: during a turn they spin in opposite directions.', 'راقب العجلتين: أثناء الانعطاف تدوران باتجاهين متعاكسين.'],
      modify: ['Make a triangle by changing the turn time.', 'ارسم مثلثاً بتغيير زمن الانعطاف.'],
      explain: ['Same direction on both wheels = straight; opposite directions = turn on the spot. Functions keep the moves readable.', 'الاتجاه نفسه للعجلتين يعني سيراً مستقيماً، والاتجاهان المتعاكسان يعنيان دوراناً في المكان، والدوال تجعل الحركات سهلة القراءة.'],
      code: `from gpiozero import Motor
from time import sleep

left, right = Motor(23, 24), Motor(5, 6)

def forward(t):
    left.forward(0.8); right.forward(0.8); sleep(t)

def turn_right(t):
    left.forward(0.6); right.backward(0.6); sleep(t)

for side in range(4):
    forward(0.6)
    turn_right(0.3)
    print("side", side + 1, "done")
left.stop(); right.stop()
print("square finished")
`,
      test: { expect: /side 4 done[\s\S]*square finished/, seconds: 6, verify: (s) => check(!running(s, 'left') && !running(s, 'right'), 'both wheels stopped') },
    },
    twoMotors,
  ),
  ex(
    {
      id: 'robot-obstacle-avoider',
      cat: 'robotics',
      level: 'intermediate',
      minutes: 25,
      title: ['Obstacle-avoiding robot', 'روبوت يتجنب العوائق'],
      goal: ['Combine a distance sensor and two motors in a sense–decide–act loop.', 'دمج حساس مسافة ومحركين في حلقة: استشعر ثم قرر ثم نفّذ.'],
      result: ['The robot drives forward; when an obstacle is closer than 30 cm it turns until the way is clear.', 'يتقدم الروبوت، وعندما يقترب عائق لأقل من 30 سم ينعطف حتى يصبح الطريق خالياً.'],
      tryIt: ['Change the HC-SR04 distance to 15 cm, then back to 120 cm.', 'غيّر مسافة HC-SR04 إلى 15 سم ثم أعدها إلى 120 سم.'],
      modify: ['Reverse a little before turning.', 'ارجع قليلاً إلى الخلف قبل الانعطاف.'],
      explain: ['Every 0.2 s the loop reads the distance and chooses one of two actions; printing only state changes keeps the log short.', 'كل 0.2 ثانية تقرأ الحلقة المسافة وتختار أحد فعلين، وطباعة تغيّر الحالة فقط تُبقي السجل قصيراً.'],
      code: `from gpiozero import Motor, DistanceSensor
from time import sleep

left, right = Motor(23, 24), Motor(5, 6)
eye = DistanceSensor(echo=27, trigger=17, max_distance=2)
state = None
for i in range(25):
    if eye.distance < 0.30:
        new = "turning"
        left.backward(0.6); right.forward(0.6)
    else:
        new = "forward"
        left.forward(0.8); right.forward(0.8)
    if new != state:
        print(f"{eye.distance * 100:.0f} cm -> {new}")
        state = new
    sleep(0.2)
left.stop(); right.stop()
`,
      test: {
        expect: /120 cm -> forward[\s\S]*15 cm -> turning[\s\S]*120 cm -> forward/,
        seconds: 6,
        events: [
          { at: 1.5, comp: 'us', props: { distance: 15 } },
          { at: 3, comp: 'us', props: { distance: 120 } },
        ],
      },
    },
    (c) => twoMotors(c).ultrasonic('us', 17, 27, { distance: 120 }),
  ),
  ex(
    {
      id: 'robot-line-follower',
      cat: 'robotics',
      level: 'intermediate',
      minutes: 25,
      title: ['Line follower with two light sensors', 'تتبع الخط بحساسَي ضوء'],
      goal: ['Steer by comparing two reflectance sensors left and right of a dark line.', 'التوجيه بمقارنة حساسَي انعكاس على يسار ويمين خط داكن.'],
      result: ['Both bright → straight; left sees the line → steer left; right sees it → steer right.', 'كلاهما ساطع: مستقيم. اليسار يرى الخط: انعطف يساراً. اليمين يراه: انعطف يميناً.'],
      tryIt: ['Lower the left sensor lux to 50 (it is over the black line), then restore it.', 'خفّض lux في الحساس الأيسر إلى 50 (فوق الخط الأسود) ثم أعده.'],
      modify: ['Stop when both sensors see the line (a crossing).', 'توقف عندما يرى الحساسان الخط معاً (تقاطع).'],
      explain: ['A dark line reflects little light, so its sensor output goes HIGH. The motor on the line side slows down to turn towards it.', 'الخط الداكن يعكس ضوءاً قليلاً فيصبح مخرج حساسه مرتفعاً، ويبطؤ المحرك في جهة الخط لينعطف نحوه.'],
      code: `from gpiozero import Motor, DigitalInputDevice
from time import sleep

left, right = Motor(23, 24), Motor(5, 6)
sensor_l, sensor_r = DigitalInputDevice(17), DigitalInputDevice(27)   # 1 = dark line
last = None
for i in range(30):
    l, r = sensor_l.value, sensor_r.value
    if l and not r:
        action = "steer left"; left.forward(0.2); right.forward(0.8)
    elif r and not l:
        action = "steer right"; left.forward(0.8); right.forward(0.2)
    else:
        action = "straight"; left.forward(0.7); right.forward(0.7)
    if action != last:
        print(action); last = action
    sleep(0.1)
left.stop(); right.stop()
`,
      test: {
        expect: /straight[\s\S]*steer left[\s\S]*straight[\s\S]*steer right/,
        seconds: 5,
        events: [
          { at: 0.8, comp: 'eyeL', props: { lux: 50 } },
          { at: 1.6, comp: 'eyeL', props: { lux: 2000 } },
          { at: 2.4, comp: 'eyeR', props: { lux: 50 } },
        ],
      },
    },
    (c) =>
      twoMotors(c)
        .part('eyeL', 'ldr_module', { lux: 2000, threshold: 500 }, 'Left sensor')
        .part('eyeR', 'ldr_module', { lux: 2000, threshold: 500 }, 'Right sensor')
        .w(`eyeL.VCC>${c.v33()}`, `eyeL.GND>${c.gnd()}`, 'eyeL.DO>pi.P11', `eyeR.VCC>${c.v33()}`, `eyeR.GND>${c.gnd()}`, 'eyeR.DO>pi.P13'),
  ),
  ex(
    {
      id: 'robot-arm-pick-place',
      cat: 'robotics',
      level: 'intermediate',
      minutes: 25,
      title: ['Two-servo arm: pick and place', 'ذراع بسيرفوين: التقاط ووضع'],
      goal: ['Coordinate two servos (base and gripper) with a list of poses.', 'تنسيق سيرفوين (القاعدة والقابض) بقائمة من الأوضاع.'],
      result: ['The arm turns to the object, closes the gripper, turns to the target and opens.', 'تدور الذراع نحو الجسم وتغلق القابض ثم تدور نحو الهدف وتفتحه.'],
      tryIt: ['Watch the two servo angles change step by step.', 'راقب تغيّر زاويتي السيرفو خطوة بخطوة.'],
      modify: ['Add a third pose that returns the arm to the centre.', 'أضف وضعاً ثالثاً يعيد الذراع إلى المنتصف.'],
      explain: ['A pose is a (base, gripper) pair; the loop moves both and waits so the motion can finish.', 'الوضع زوج (القاعدة، القابض)، وتحرك الحلقة السيرفوين ثم تنتظر حتى تكتمل الحركة.'],
      code: `from gpiozero import AngularServo
from time import sleep

SG90 = dict(min_angle=-90, max_angle=90, min_pulse_width=0.0005, max_pulse_width=0.0025)
base, grip = AngularServo(18, **SG90), AngularServo(13, **SG90)
POSES = [("to object", -60, 60), ("grab", -60, -30), ("to target", 60, -30), ("release", 60, 60)]
for name, b, g in POSES:
    base.angle, grip.angle = b, g
    print(f"{name:10s} base {b:+d}° gripper {g:+d}°")
    sleep(0.6)
`,
      test: { expect: /release\s+base \+60° gripper \+60°/, seconds: 4, verify: (s) => check(near(vis(s, 'base').angle ?? 0, 60, 3) && near(vis(s, 'grip').angle ?? 0, 60, 3), `base ${vis(s, 'base').angle}, grip ${vis(s, 'grip').angle}`) },
    },
    (c) => c.servo('base', 18, 'mg996r').servo('grip', 13, 'sg90'),
  ),
  ex(
    {
      id: 'robot-sonar-scanner',
      cat: 'robotics',
      level: 'advanced',
      minutes: 30,
      title: ['Stepper sonar scanner', 'ماسح سونار بمحرك خطوي'],
      goal: ['Rotate a distance sensor with a stepper and build a list of (angle, distance) readings.', 'تدوير حساس مسافة بمحرك خطوي وبناء قائمة من قراءات (الزاوية، المسافة).'],
      result: ['Five readings at 0°, 45°, 90°, 135° and 180° are printed with the closest direction.', 'تُطبع خمس قراءات عند 0° و45° و90° و135° و180° مع أقرب اتجاه.'],
      tryIt: ['Change the HC-SR04 distance during the scan to create a "close object".', 'غيّر مسافة HC-SR04 أثناء المسح لإنشاء "جسم قريب".'],
      modify: ['Print a simple text radar map from the readings.', 'اطبع خريطة رادار نصية بسيطة من القراءات.'],
      explain: ['min(scan, key=…) finds the reading with the smallest distance in the list of tuples.', 'تجد الدالة min(scan, key=…) القراءة ذات أقل مسافة في قائمة الثنائيات.'],
      code: `from smartfarm import Stepper28BYJ
from gpiozero import DistanceSensor
from time import sleep

turntable = Stepper28BYJ([17, 18, 27, 22], delay=0.002)
eye = DistanceSensor(echo=24, trigger=23, max_distance=3)
scan = []
for angle in range(0, 181, 45):
    if angle:
        turntable.rotate(45)
    d = round(eye.distance * 100)
    scan.append((angle, d))
    print(f"{angle:3d}° : {d} cm")
closest = min(scan, key=lambda r: r[1])
print("closest object at", closest[0], "degrees,", closest[1], "cm")
`,
      test: { expect: /closest object at (90|135) degrees, 40 cm/, seconds: 20, events: [{ at: 3, comp: 'us', props: { distance: 40 } }, { at: 9, comp: 'us', props: { distance: 150 } }] },
    },
    (c) =>
      c
        .part('step', 'stepper_28byj48', {}, 'Turntable')
        .w('step.IN1>pi.P11', 'step.IN2>pi.P12', 'step.IN3>pi.P13', 'step.IN4>pi.P15', `step.VCC>${c.v50()}`, `step.GND>${c.gnd()}`)
        .ultrasonic('us', 23, 24, { distance: 150 }),
  ),
  ex(
    {
      id: 'robot-bumper-stop',
      cat: 'robotics',
      level: 'beginner',
      minutes: 15,
      title: ['Bumper switch stops the robot', 'مفتاح المصد يوقف الروبوت'],
      goal: ['Use a contact switch as a safety bumper that immediately stops both motors.', 'استخدام مفتاح تلامس كمصد أمان يوقف المحركين فوراً.'],
      result: ['The robot drives until the bumper is hit, then stops and reverses briefly.', 'يسير الروبوت حتى يصطدم المصد، ثم يتوقف ويرجع للخلف قليلاً.'],
      tryIt: ['Press the bumper button while the robot drives.', 'اضغط زر المصد أثناء سير الروبوت.'],
      modify: ['After reversing, turn and continue driving.', 'بعد الرجوع، انعطف وتابع السير.'],
      explain: ['wait_for_press() blocks the program until the bumper closes; the motors keep running in the meantime.', 'توقف wait_for_press() البرنامج حتى ينغلق المصد، بينما تستمر المحركات في الدوران.'],
      code: `from gpiozero import Motor, Button
from time import sleep

left, right = Motor(23, 24), Motor(5, 6)
bumper = Button(17)
left.forward(0.8); right.forward(0.8)
print("driving")
bumper.wait_for_press()
left.stop(); right.stop()
print("bump! stopped")
left.backward(0.5); right.backward(0.5); sleep(0.5)
left.stop(); right.stop()
print("backed off")
`,
      test: { expect: /driving[\s\S]*bump! stopped[\s\S]*backed off/, seconds: 5, events: [{ at: 1.5, comp: 'bumper', press: true }], verify: (s) => check(!running(s, 'left') && !running(s, 'right'), 'stopped') },
    },
    (c) => twoMotors(c).button('bumper', 17, 'Bumper'),
  ),
];
