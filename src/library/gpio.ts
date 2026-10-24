// GPIO basics: outputs, inputs, PWM, timing and simple state machines.
import { check, ex, lit, vis, type LibExample } from './dsl';

export const GPIO_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'gpio-sos',
      cat: 'gpio',
      level: 'beginner',
      minutes: 10,
      title: ['Morse code SOS', 'إشارة SOS بشفرة مورس'],
      goal: ['Blink an LED in a timed pattern using lists and loops.', 'وميض LED بنمط زمني باستخدام القوائم والحلقات.'],
      result: ['The LED flashes · · · — — — · · · and the terminal prints each letter.', 'يومض الـ LED بنمط · · · — — — · · · وتطبع الطرفية كل حرف.'],
      tryIt: ['Watch the long and short flashes of the LED while the program runs.', 'راقب الومضات الطويلة والقصيرة للـ LED أثناء التشغيل.'],
      modify: ['Change UNIT to 0.1 to send faster, or add your own word to MORSE.', 'غيّر UNIT إلى 0.1 للإرسال أسرع، أو أضف كلمتك إلى MORSE.'],
      explain: ['A dot is 1 time unit and a dash 3 units; the gap between letters is 3 units. The dictionary maps letters to patterns.', 'النقطة وحدة زمنية واحدة والشرطة ثلاث وحدات، والفاصل بين الحروف ثلاث وحدات. القاموس يربط الحروف بأنماطها.'],
      code: `from gpiozero import LED
from time import sleep

led = LED(17)
UNIT = 0.2
MORSE = {"S": "...", "O": "---"}

for letter in "SOS":
    for symbol in MORSE[letter]:
        led.on()
        sleep(UNIT if symbol == "." else 3 * UNIT)
        led.off()
        sleep(UNIT)
    print("sent", letter)
    sleep(2 * UNIT)
print("SOS sent")
`,
      test: { expect: /sent S[\s\S]*sent O[\s\S]*SOS sent/, seconds: 10, verify: (s) => check(!lit(s, 'led'), 'LED should be off at the end') },
    },
    (c) => c.led('led', 17, 'red'),
  ),
  ex(
    {
      id: 'gpio-pedestrian-crossing',
      cat: 'gpio',
      level: 'intermediate',
      minutes: 25,
      title: ['Pedestrian crossing', 'إشارة عبور المشاة'],
      goal: ['Combine a 3-colour traffic light with a request button and a walk light.', 'دمج إشارة مرور ثلاثية الألوان مع زر طلب عبور وإشارة للمشاة.'],
      result: ['Cars have green until the button is pressed; then amber, red and the walk light for a few seconds.', 'تبقى الإشارة خضراء للسيارات حتى الضغط على الزر، ثم أصفر فأحمر مع إضاءة إشارة المشاة لثوانٍ.'],
      tryIt: ['While it runs, click the push button in the workspace.', 'أثناء التشغيل اضغط على زر الطلب في مساحة العمل.'],
      modify: ['Make the walk time depend on how long the button was held.', 'اجعل مدة العبور تعتمد على مدة الضغط على الزر.'],
      explain: ['wait_for_press() blocks until the button closes; the sequence then runs in order with sleep(). The button uses the Pi’s internal pull-up.', 'الدالة wait_for_press() تنتظر حتى يُضغط الزر، ثم ينفذ التسلسل بالترتيب مع sleep(). يستخدم الزر مقاومة الرفع الداخلية في Pi.'],
      code: `from gpiozero import LED, Button
from time import sleep

red, amber, green = LED(17), LED(27), LED(22)
walk = LED(23)
request = Button(24)

green.on()
print("cars: green - press the button to cross")
request.wait_for_press()
print("request received")
green.off(); amber.on(); sleep(1)
amber.off(); red.on()
walk.on()
print("walk")
sleep(2)
walk.off(); red.off(); green.on()
print("cars: green again")
`,
      test: {
        expect: /request received[\s\S]*walk[\s\S]*cars: green again/,
        seconds: 8,
        events: [
          { at: 1, comp: 'btn', press: true },
          { at: 1.3, comp: 'btn', press: false },
        ],
        verify: (s) => check(lit(s, 'green') && !lit(s, 'red') && !lit(s, 'walk'), 'cars should have green again at the end'),
      },
    },
    (c) => c.led('red', 17, 'red', 'Red').led('amber', 27, 'yellow', 'Amber').led('green', 22, 'green', 'Green').led('walk', 23, 'white', 'Walk').button('btn', 24, 'Request'),
  ),
  ex(
    {
      id: 'gpio-led-chaser',
      cat: 'gpio',
      level: 'beginner',
      minutes: 15,
      title: ['LED chaser', 'مطاردة الأضواء'],
      goal: ['Drive six LEDs as one board with gpiozero.LEDBoard and index them in a loop.', 'التحكم بست LEDs كلوحة واحدة باستخدام LEDBoard والوصول إليها بالفهرس داخل حلقة.'],
      result: ['A single light runs left to right and back, three times.', 'يتحرك ضوء واحد من اليسار إلى اليمين ثم يعود، ثلاث مرات.'],
      tryIt: ['Watch the LEDs light one after another.', 'راقب إضاءة الـ LEDs واحداً تلو الآخر.'],
      modify: ['Light two neighbouring LEDs at once to make a longer tail.', 'أضئ LEDين متجاورين معاً لتصنع ذيلاً أطول.'],
      explain: ['LEDBoard.value takes a tuple with one entry per LED. range(6) followed by range(4, 0, -1) makes the bounce.', 'تأخذ LEDBoard.value مجموعة فيها قيمة لكل LED. الحلقة range(6) ثم range(4, 0, -1) تصنع الارتداد.'],
      code: `from gpiozero import LEDBoard
from time import sleep

leds = LEDBoard(5, 6, 13, 19, 26, 21)
for lap in range(3):
    for i in list(range(6)) + list(range(4, 0, -1)):
        leds.value = tuple(1 if j == i else 0 for j in range(6))
        sleep(0.1)
    print("lap", lap + 1, "done")
leds.off()
`,
      test: { expect: /lap 3 done/, seconds: 8, verify: (s) => check(['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].every((id) => !lit(s, id)), 'all LEDs off at the end') },
    },
    (c) => [5, 6, 13, 19, 26, 21].forEach((bcm, i) => c.led(`l${i + 1}`, bcm, ['red', 'yellow', 'green', 'blue', 'white', 'red'][i])),
  ),
  ex(
    {
      id: 'gpio-binary-counter',
      cat: 'gpio',
      level: 'beginner',
      minutes: 15,
      title: ['4-bit binary counter', 'عدّاد ثنائي 4 بت'],
      goal: ['Show numbers 0–15 in binary on four LEDs using bit operations.', 'عرض الأعداد من 0 إلى 15 بالنظام الثنائي على أربعة LEDs باستخدام عمليات البت.'],
      result: ['The LEDs count up in binary; at 15 all four are lit.', 'تعد الـ LEDs بالنظام الثنائي، وعند 15 تضيء الأربعة جميعها.'],
      tryIt: ['Compare the printed binary number with the lit LEDs (bit 0 is the right-most).', 'قارن العدد الثنائي المطبوع مع الـ LEDs المضاءة (البت 0 هو الأيمن).'],
      modify: ['Count down instead, or display only even numbers.', 'اجعل العد تنازلياً، أو اعرض الأعداد الزوجية فقط.'],
      explain: ['(n >> bit) & 1 extracts one bit of n. f"{n:04b}" formats the number as four binary digits.', 'التعبير (n >> bit) & 1 يستخرج بتاً واحداً من n، والصيغة f"{n:04b}" تكتب العدد بأربع خانات ثنائية.'],
      code: `from gpiozero import LED
from time import sleep

bits = [LED(p) for p in (17, 27, 22, 23)]   # bit 0 .. bit 3
for n in range(16):
    for bit, led in enumerate(bits):
        led.value = (n >> bit) & 1
    print(f"{n:2d} = {n:04b}")
    sleep(0.3)
`,
      test: { expect: /15 = 1111/, seconds: 8, verify: (s) => check(['b0', 'b1', 'b2', 'b3'].every((id) => lit(s, id)), 'all four LEDs lit at 15') },
    },
    (c) => [17, 27, 22, 23].forEach((bcm, i) => c.led(`b${i}`, bcm, 'green', `bit ${i}`)),
  ),
  ex(
    {
      id: 'gpio-breathing-led',
      cat: 'gpio',
      level: 'beginner',
      minutes: 15,
      title: ['Breathing LED (PWM)', 'LED يتنفس (PWM)'],
      goal: ['Fade an LED smoothly with pulse-width modulation.', 'تخفيت LED وإضاءته بسلاسة باستخدام تعديل عرض النبضة PWM.'],
      result: ['The LED fades up and down; the terminal shows the duty cycle.', 'يخفت الـ LED ويشتد تدريجياً، وتعرض الطرفية نسبة التشغيل.'],
      tryIt: ['Open the GPIO monitor: GPIO18 shows PWM and its duty cycle.', 'افتح مراقب GPIO: يظهر GPIO18 كمخرج PWM مع نسبة التشغيل.'],
      modify: ['Use led.pulse() instead of the loop, or change the step size.', 'استخدم led.pulse() بدل الحلقة، أو غيّر مقدار الخطوة.'],
      explain: ['PWMLED.value is the fraction of time the pin is HIGH. GPIO18 is a hardware-PWM pin on the Pi 5.', 'القيمة PWMLED.value هي نسبة الزمن الذي يكون فيه الطرف HIGH. الطرف GPIO18 يدعم PWM عتادياً في Pi 5.'],
      code: `from gpiozero import PWMLED
from time import sleep

led = PWMLED(18)
for cycle in range(2):
    for v in [i / 10 for i in range(11)] + [i / 10 for i in range(9, -1, -1)]:
        led.value = v
        sleep(0.05)
    print("breath", cycle + 1)
led.value = 0.5
print("holding 50 %")
sleep(1)
`,
      test: { expect: /breath 2[\s\S]*holding 50 %/, seconds: 6, verify: (s) => check((vis(s, 'led').brightness ?? 0) > 0.1 && (vis(s, 'led').brightness ?? 0) < 0.9, `brightness ${vis(s, 'led').brightness}`) },
    },
    (c) => c.led('led', 18, 'blue'),
  ),
  ex(
    {
      id: 'gpio-toggle-button',
      cat: 'gpio',
      level: 'beginner',
      minutes: 15,
      title: ['Toggle with one button', 'التبديل بزر واحد'],
      goal: ['Make each press switch the LED on or off (latching) using an event callback.', 'جعل كل ضغطة تبدّل حالة الـ LED (تشغيل/إطفاء) باستخدام دالة استدعاء للحدث.'],
      result: ['First press: LED on. Second press: LED off. Each press is printed.', 'الضغطة الأولى تشغّل الـ LED والثانية تطفئه، وتُطبع كل ضغطة.'],
      tryIt: ['Click the button a few times while the program runs.', 'اضغط الزر عدة مرات أثناء التشغيل.'],
      modify: ['Count the presses and blink the LED that many times.', 'عدّ الضغطات واجعل الـ LED يومض بعددها.'],
      explain: ['when_pressed runs toggle() on every press; bounce_time ignores the contact bounce of a real switch.', 'تستدعي when_pressed الدالة toggle() مع كل ضغطة، وتتجاهل bounce_time الارتداد الميكانيكي لمفتاح حقيقي.'],
      code: `from gpiozero import LED, Button
from signal import pause

led = LED(17)
button = Button(27, bounce_time=0.05)
presses = 0

def toggle():
    global presses
    presses += 1
    led.toggle()
    print(f"press {presses}: LED {'ON' if led.is_lit else 'OFF'}")

button.when_pressed = toggle
print("ready")
pause()
`,
      test: {
        expect: /press 1: LED ON[\s\S]*press 2: LED OFF[\s\S]*press 3: LED ON/,
        seconds: 6,
        events: [
          { at: 1, comp: 'btn', press: true },
          { at: 1.3, comp: 'btn', press: false },
          { at: 2.5, comp: 'btn', press: true },
          { at: 2.8, comp: 'btn', press: false },
          { at: 4, comp: 'btn', press: true },
          { at: 4.3, comp: 'btn', press: false },
        ],
        verify: (s) => check(lit(s, 'led'), 'LED on after the third press'),
      },
    },
    (c) => c.led('led', 17, 'yellow').button('btn', 27),
  ),
  ex(
    {
      id: 'gpio-reaction-game',
      cat: 'gpio',
      level: 'intermediate',
      minutes: 20,
      title: ['Reaction-time game', 'لعبة زمن الاستجابة'],
      goal: ['Measure time between two events with time.monotonic().', 'قياس الزمن بين حدثين باستخدام time.monotonic().'],
      result: ['After a random wait the LED lights; pressing the button prints your reaction time.', 'بعد انتظار عشوائي يضيء الـ LED، وعند الضغط على الزر يُطبع زمن استجابتك.'],
      tryIt: ['Press the button as soon as the LED lights.', 'اضغط الزر بمجرد أن يضيء الـ LED.'],
      modify: ['Play five rounds and print the best and average times.', 'العب خمس جولات واطبع أفضل زمن والمتوسط.'],
      explain: ['random.uniform picks the wait; monotonic() never jumps backwards, so it is the right clock for durations.', 'تختار random.uniform مدة الانتظار، والساعة monotonic() لا ترجع للخلف أبداً، لذا فهي المناسبة لقياس المدد.'],
      code: `from gpiozero import LED, Button
from time import sleep, monotonic
import random

led = LED(17)
button = Button(27)
random.seed(1)
wait = random.uniform(1, 2)
print(f"get ready... ({wait:.1f} s)")
sleep(wait)
led.on()
start = monotonic()
button.wait_for_press(timeout=5)
reaction = monotonic() - start
led.off()
print(f"reaction time: {reaction:.2f} s")
`,
      test: {
        expect: /reaction time: 0\.[3-6]\d s/,
        seconds: 8,
        events: [
          { at: 1.6, comp: 'btn', press: true },
          { at: 1.9, comp: 'btn', press: false },
        ],
      },
    },
    (c) => c.led('led', 17, 'green').button('btn', 27),
  ),
  ex(
    {
      id: 'gpio-rgb-mixer',
      cat: 'gpio',
      level: 'beginner',
      minutes: 15,
      title: ['RGB colour mixer', 'مزج الألوان بـ RGB'],
      goal: ['Mix colours by setting the red, green and blue channels of an RGB LED with PWM.', 'مزج الألوان بضبط القنوات الحمراء والخضراء والزرقاء في LED ثلاثي الألوان باستخدام PWM.'],
      result: ['The LED shows red, green, blue, yellow, cyan, magenta and white in turn.', 'يعرض الـ LED الأحمر ثم الأخضر ثم الأزرق ثم الأصفر والسماوي والأرجواني والأبيض.'],
      tryIt: ['Watch the colour change and read the channel values in the terminal.', 'راقب تغيّر اللون واقرأ قيم القنوات في الطرفية.'],
      modify: ['Add orange (1, 0.5, 0) to the list.', 'أضف اللون البرتقالي (1, 0.5, 0) إلى القائمة.'],
      explain: ['RGBLED.color takes three values from 0 to 1; mixing two primaries gives a secondary colour.', 'تأخذ RGBLED.color ثلاث قيم من 0 إلى 1، ومزج لونين أساسيين يعطي لوناً ثانوياً.'],
      code: `from gpiozero import RGBLED
from time import sleep

rgb = RGBLED(red=17, green=27, blue=22)
colours = {
    "red": (1, 0, 0), "green": (0, 1, 0), "blue": (0, 0, 1),
    "yellow": (1, 1, 0), "cyan": (0, 1, 1), "magenta": (1, 0, 1), "white": (1, 1, 1),
}
for name, value in colours.items():
    rgb.color = value
    print(f"{name:8s} {value}")
    sleep(0.5)
`,
      test: { expect: /white\s+\(1, 1, 1\)/, seconds: 6, verify: (s) => check(['R', 'G', 'B'].every((k) => (vis(s, 'rgb')[k] ?? 0) > 0.2), `channels ${JSON.stringify(vis(s, 'rgb'))}`) },
    },
    (c) => c.rgb('rgb', 17, 27, 22),
  ),
  ex(
    {
      id: 'gpio-beep-pattern',
      cat: 'gpio',
      level: 'beginner',
      minutes: 10,
      title: ['Buzzer alarm pattern', 'نمط إنذار بالجرس'],
      goal: ['Drive an active buzzer with timed beeps and a counted loop.', 'تشغيل جرس نشط بصفارات زمنية وحلقة معدودة.'],
      result: ['Three short beeps, a pause and one long beep.', 'ثلاث صفارات قصيرة، ثم توقف، ثم صفارة طويلة.'],
      tryIt: ['Watch the buzzer icon and the GPIO monitor while it beeps.', 'راقب الجرس ومراقب GPIO أثناء الصفير.'],
      modify: ['Use buzzer.beep(on_time, off_time, n) instead of the loop.', 'استخدم buzzer.beep(on_time, off_time, n) بدل الحلقة.'],
      explain: ['An active buzzer contains its own oscillator: the GPIO only switches it on and off.', 'الجرس النشط يحتوي مذبذباً داخلياً، فيكفي أن يشغّله الطرف ويطفئه.'],
      code: `from gpiozero import Buzzer
from time import sleep

buzzer = Buzzer(18)
for i in range(3):
    buzzer.on(); sleep(0.15)
    buzzer.off(); sleep(0.15)
    print("beep", i + 1)
sleep(0.5)
buzzer.on(); sleep(0.8); buzzer.off()
print("long beep done")
`,
      test: { expect: /beep 3[\s\S]*long beep done/, seconds: 5, verify: (s) => check(!vis(s, 'bz').on, 'buzzer silent at the end') },
    },
    (c) => c.buzzer('bz', 18),
  ),
  ex(
    {
      id: 'gpio-dip-config',
      cat: 'gpio',
      level: 'intermediate',
      minutes: 15,
      title: ['DIP-switch configuration', 'الإعداد بمفاتيح DIP'],
      goal: ['Read four switches as a 4-bit number that selects the blink speed.', 'قراءة أربعة مفاتيح كعدد من 4 بت يحدد سرعة الوميض.'],
      result: ['The program prints the switch code and blinks the LED at the matching speed.', 'يطبع البرنامج رمز المفاتيح ويومض الـ LED بالسرعة المقابلة.'],
      tryIt: ['Stop, change the DIP switches in the Inspector and run again.', 'أوقف البرنامج، وغيّر مفاتيح DIP من نافذة الخصائص، ثم شغّله من جديد.'],
      modify: ['Use the code to select between different blink patterns.', 'استخدم الرمز للاختيار بين أنماط وميض مختلفة.'],
      explain: ['Each switch closes to GND, so a pressed (ON) switch reads as 1 with the internal pull-up. The bits are combined with shifts.', 'كل مفتاح يوصل إلى GND، فالمفتاح المغلق يُقرأ 1 مع مقاومة الرفع الداخلية، وتُجمع البتات بالإزاحة.'],
      code: `from gpiozero import Button, LED
from time import sleep

switches = [Button(p) for p in (5, 6, 13, 19)]
led = LED(17)
code = sum(1 << i for i, s in enumerate(switches) if s.is_pressed)
period = 0.1 * (code + 1)
print(f"DIP code {code:04b} = {code} -> blink period {period:.1f} s")
for i in range(4):
    led.toggle()
    sleep(period)
print("done")
`,
      test: { expect: /DIP code 0101 = 5 -> blink period 0\.6 s[\s\S]*done/, seconds: 5 },
    },
    (c) => {
      c.part('dip', 'dip_switch', { sw1: true, sw3: true }, 'DIP');
      [5, 6, 13, 19].forEach((bcm, i) => c.w(`dip.${i + 1}>pi.P${({ 5: 29, 6: 31, 13: 33, 19: 35 } as any)[bcm]}`));
      c.w(`dip.8>${c.gnd()}`, `dip.7>${c.gnd()}`, `dip.6>${c.gnd()}`, `dip.5>${c.gnd()}`);
      c.led('led', 17, 'green');
    },
  ),
  ex(
    {
      id: 'gpio-mode-switch',
      cat: 'gpio',
      level: 'beginner',
      minutes: 10,
      title: ['Mode selector switch', 'مفتاح اختيار الوضع'],
      goal: ['Read a two-position switch continuously and react when it changes.', 'قراءة مفتاح ذي وضعين باستمرار والاستجابة عند تغيّره.'],
      result: ['Position A lights the green LED, position B the red one; changes are printed.', 'الوضع A يضيء الـ LED الأخضر والوضع B الأحمر، وتُطبع التغييرات.'],
      tryIt: ['While running, change the switch position in the Inspector (or click it).', 'أثناء التشغيل غيّر وضع المفتاح من نافذة الخصائص (أو بالنقر عليه).'],
      modify: ['Add a third LED that blinks while the switch is in position B.', 'أضف LED ثالثاً يومض عندما يكون المفتاح في الوضع B.'],
      explain: ['Polling with a short sleep checks the input regularly; the program only prints when the value differs from the last one.', 'الفحص الدوري مع انتظار قصير يقرأ المدخل بانتظام، ولا يطبع البرنامج إلا عند اختلاف القيمة عن سابقتها.'],
      code: `from gpiozero import DigitalInputDevice, LED
from time import sleep

switch = DigitalInputDevice(27, pull_up=True)   # COM to GPIO27, side A to GND
green, red = LED(17), LED(22)
last = None
while True:
    # with pull_up=True gpiozero reports 1 (active) while the pin is pulled LOW
    mode = "A" if switch.value else "B"
    if mode != last:
        green.value = mode == "A"
        red.value = mode == "B"
        print("mode", mode)
        last = mode
    sleep(0.1)
`,
      test: {
        expect: /mode A[\s\S]*mode B/,
        seconds: 4,
        events: [{ at: 2, comp: 'sw', props: { position: 'B' } }],
        verify: (s) => check(lit(s, 'red') && !lit(s, 'green'), 'red LED in mode B'),
      },
    },
    (c) => c.part('sw', 'switch', { position: 'A' }, 'Mode').w(`sw.COM>pi.P13`, `sw.A>${c.gnd()}`).led('green', 17, 'green').led('red', 22, 'red'),
  ),
  ex(
    {
      id: 'gpio-lgpio-blink',
      cat: 'gpio',
      level: 'intermediate',
      minutes: 15,
      title: ['Blink with lgpio (Pi 5 native)', 'الوميض باستخدام lgpio (مكتبة Pi 5 الأصلية)'],
      goal: ['Use the low-level lgpio library that gpiozero uses on the Raspberry Pi 5.', 'استخدام المكتبة منخفضة المستوى lgpio التي تعتمد عليها gpiozero في Raspberry Pi 5.'],
      result: ['The LED blinks five times and the input pin reports the button state.', 'يومض الـ LED خمس مرات ويعرض طرف الإدخال حالة الزر.'],
      tryIt: ['Hold the button down during the run and compare the printed values.', 'اضغط الزر مطولاً أثناء التشغيل وقارن القيم المطبوعة.'],
      modify: ['Use lgpio.tx_pwm to dim the LED instead of blinking it.', 'استخدم lgpio.tx_pwm لتخفيت الـ LED بدل الوميض.'],
      explain: ['gpiochip_open(4) opens the RP1 GPIO chip of the Pi 5; pins are claimed as outputs or inputs before use.', 'تفتح gpiochip_open(4) شريحة GPIO الخاصة بـ RP1 في Pi 5، ويُحجز كل طرف كمخرج أو مدخل قبل استخدامه.'],
      code: `import lgpio
import time

h = lgpio.gpiochip_open(4)            # RP1 on the Raspberry Pi 5
lgpio.gpio_claim_output(h, 17)
lgpio.gpio_claim_input(h, 27, lgpio.SET_PULL_UP)
for i in range(5):
    lgpio.gpio_write(h, 17, 1)
    time.sleep(0.2)
    lgpio.gpio_write(h, 17, 0)
    time.sleep(0.2)
    print("blink", i + 1, "button level:", lgpio.gpio_read(h, 27))
lgpio.gpiochip_close(h)
`,
      test: {
        expect: /blink 1 button level: 1[\s\S]*button level: 0/,
        seconds: 4,
        events: [{ at: 1, comp: 'btn', press: true }],
      },
    },
    (c) => c.led('led', 17, 'red').button('btn', 27),
  ),
  ex(
    {
      id: 'gpio-cpu-temp-alert',
      cat: 'gpio',
      level: 'beginner',
      minutes: 10,
      title: ['CPU temperature warning light', 'ضوء تحذير حرارة المعالج'],
      goal: ['Read the Pi’s own CPU temperature and compare it with thresholds.', 'قراءة حرارة معالج Pi نفسه ومقارنتها بحدود معيّنة.'],
      result: ['Green LED while the CPU is cool, red LED when it is above the limit.', 'يضيء الأخضر ما دام المعالج بارداً، والأحمر عند تجاوز الحد.'],
      tryIt: ['Change LIMIT to a value below the printed temperature and run again.', 'غيّر LIMIT إلى قيمة أقل من الحرارة المطبوعة وشغّل مجدداً.'],
      modify: ['Add a fan output that switches on above the limit.', 'أضف مخرجاً لمروحة يعمل عند تجاوز الحد.'],
      explain: ['CPUTemperature reads /sys/class/thermal; an if/else picks the LED.', 'تقرأ CPUTemperature الحرارة من /sys/class/thermal، ويختار الشرط if/else الـ LED المناسب.'],
      code: `from gpiozero import CPUTemperature, LED

cpu = CPUTemperature()
ok, hot = LED(17), LED(27)
LIMIT = 70
t = cpu.temperature
print(f"CPU temperature: {t:.1f} °C (limit {LIMIT} °C)")
if t > LIMIT:
    hot.on(); print("too hot")
else:
    ok.on(); print("temperature OK")
`,
      test: { expect: /CPU temperature: \d+\.\d °C[\s\S]*temperature OK/, verify: (s) => check(lit(s, 'ok') && !lit(s, 'hot'), 'green LED only') },
    },
    (c) => c.led('ok', 17, 'green', 'OK').led('hot', 27, 'red', 'Hot'),
  ),
];
