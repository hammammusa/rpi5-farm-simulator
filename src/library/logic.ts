// Digital logic & ICs: gates, adders, shift registers, optocouplers, transistors.
import { check, ex, lit, vis, type Circuit, type LibExample } from './dsl';

/** a 74HC gate chip with inputs 1A/1B on GPIO17/27 and output 1Y read back on `outBcm` */
const gate = (c: Circuit, id: string, type: string, label: string, outPin: string) =>
  c.part(id, type, {}, label).w(`${id}.VCC>${c.v33()}`, `${id}.GND>${c.gnd()}`, `${id}.1A>pi.P11`, `${id}.1B>pi.P13`, `${id}.1Y>${outPin}`);

export const LOGIC_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'logic-gate-explorer',
      cat: 'logic',
      level: 'beginner',
      minutes: 20,
      title: ['Logic gate explorer (AND, OR, XOR)', 'مستكشف البوابات المنطقية (AND وOR وXOR)'],
      goal: ['Drive the same two inputs into three real gate chips and compare with Python’s operators.', 'إدخال المدخلين نفسيهما إلى ثلاث شرائح بوابات حقيقية ومقارنة النتائج بعمليات بايثون.'],
      result: ['A truth table is printed; every chip output matches a & b, a | b and a ^ b.', 'يُطبع جدول الحقيقة، وتطابق مخارج الشرائح العمليات a & b وa | b وa ^ b.'],
      tryIt: ['Read the table and compare each row with the gate symbol.', 'اقرأ الجدول وقارن كل صف برمز البوابة.'],
      modify: ['Add a NOT gate (74HC04) on input A.', 'أضف بوابة NOT (74HC04) على المدخل A.'],
      explain: ['The two GPIO outputs feed all three chips in parallel; each chip output goes back to its own GPIO input.', 'يغذي مخرجا GPIO الشرائح الثلاث على التوازي، ويعود مخرج كل شريحة إلى مدخل GPIO خاص به.'],
      code: `from gpiozero import OutputDevice, DigitalInputDevice
from time import sleep

a, b = OutputDevice(17), OutputDevice(27)
AND, OR, XOR = DigitalInputDevice(22), DigitalInputDevice(23), DigitalInputDevice(24)
print(" A B | AND OR XOR | python")
ok = True
for va in (0, 1):
    for vb in (0, 1):
        a.value, b.value = va, vb
        sleep(0.05)
        row = (AND.value, OR.value, XOR.value)
        ok &= row == (va & vb, va | vb, va ^ vb)
        print(f" {va} {vb} |  {row[0]}   {row[1]}   {row[2]} | {'match' if row == (va & vb, va | vb, va ^ vb) else 'DIFFERENT'}")
print("all rows match:", ok)
`,
      test: { expect: /all rows match: True/ },
    },
    (c) => {
      gate(c, 'and', 'hc08', '74HC08 AND', 'pi.P15');
      gate(c, 'or', 'hc32', '74HC32 OR', 'pi.P16');
      gate(c, 'xor', 'hc86', '74HC86 XOR', 'pi.P18');
    },
  ),
  ex(
    {
      id: 'logic-half-adder',
      cat: 'logic',
      level: 'intermediate',
      minutes: 20,
      title: ['Half adder from logic chips', 'نصف جامع من شرائح منطقية'],
      goal: ['Add two bits in hardware: XOR gives the sum, AND gives the carry.', 'جمع بتين بالعتاد: XOR تعطي المجموع وAND تعطي الحمل.'],
      result: ['For 1 + 1 the sum LED is off and the carry LED is on (binary 10).', 'عند 1 + 1 ينطفئ LED المجموع ويضيء LED الحمل (العدد الثنائي 10).'],
      tryIt: ['Watch the sum and carry LEDs for each input pair.', 'راقب LEDَي المجموع والحمل لكل زوج من المدخلات.'],
      modify: ['Chain two half adders and an OR gate into a full adder.', 'اربط نصفي جامع مع بوابة OR لتصنع جامعاً كاملاً.'],
      explain: ['Sum = A XOR B, Carry = A AND B. The chip outputs drive LEDs directly through resistors.', 'المجموع = A XOR B، والحمل = A AND B، وتقود مخارج الشرائح الـ LEDs مباشرة عبر مقاومات.'],
      code: `from gpiozero import OutputDevice
from time import sleep

a, b = OutputDevice(17), OutputDevice(27)
for va, vb in ((0, 0), (0, 1), (1, 0), (1, 1)):
    a.value, b.value = va, vb
    print(f"{va} + {vb} = carry {va & vb}, sum {va ^ vb}")
    sleep(0.6)
`,
      test: { expect: /1 \+ 1 = carry 1, sum 0/, seconds: 4, verify: (s) => check(lit(s, 'carry') && !lit(s, 'sum'), 'carry on, sum off for 1 + 1') },
    },
    (c) => {
      c.part('xor', 'hc86', {}, '74HC86 XOR').w(`xor.VCC>${c.v33()}`, `xor.GND>${c.gnd()}`, 'xor.1A>pi.P11', 'xor.1B>pi.P13');
      c.part('and', 'hc08', {}, '74HC08 AND').w(`and.VCC>${c.v33()}`, `and.GND>${c.gnd()}`, 'and.1A>pi.P11', 'and.1B>pi.P13');
      c.part('r_sum', 'resistor', { ohms: 330 }).part('sum', 'led', { color: 'green' }, 'Sum').w('xor.1Y>r_sum.1', 'r_sum.2>sum.A', `sum.K>${c.gnd()}`);
      c.part('r_carry', 'resistor', { ohms: 330 }).part('carry', 'led', { color: 'red' }, 'Carry').w('and.1Y>r_carry.1', 'r_carry.2>carry.A', `carry.K>${c.gnd()}`);
    },
  ),
  ex(
    {
      id: 'logic-shift-register',
      cat: 'logic',
      level: 'intermediate',
      minutes: 25,
      title: ['More outputs with a 74HC595', 'مخارج إضافية بشريحة 74HC595'],
      goal: ['Control four LEDs with only three GPIO pins using a shift register.', 'التحكم بأربعة LEDs بثلاثة أطراف GPIO فقط باستخدام سجل إزاحة.'],
      result: ['The LEDs show the bit patterns 0001, 0011, 0111, 1111.', 'تعرض الـ LEDs أنماط البتات 0001 و0011 و0111 و1111.'],
      tryIt: ['Compare the printed bits with the LEDs (Q0 is the first LED).', 'قارن البتات المطبوعة مع الـ LEDs (Q0 هو أول LED).'],
      modify: ['Chain a second 74HC595 through Q7S for 16 outputs.', 'اربط شريحة 74HC595 ثانية عبر Q7S لتحصل على 16 مخرجاً.'],
      explain: ['Data is shifted in bit by bit on each clock pulse, then the latch pulse copies all bits to the outputs at once.', 'تُزاح البيانات بتاً بتاً مع كل نبضة ساعة، ثم تنسخ نبضة الإمساك كل البتات إلى المخارج دفعة واحدة.'],
      code: `from smartfarm import ShiftRegister
from time import sleep

sr = ShiftRegister(data=17, clock=27, latch=22)
for pattern in (0b0001, 0b0011, 0b0111, 0b1111):
    sr.write(pattern)
    print(f"Q3..Q0 = {pattern:04b}")
    sleep(0.5)
`,
      test: { expect: /Q3\.\.Q0 = 1111/, seconds: 4, verify: (s) => check(['q0', 'q1', 'q2', 'q3'].every((id) => lit(s, id)), 'all four LEDs on') },
    },
    (c) => {
      c.part('sr', 'hc595', {}, '74HC595').w(`sr.VCC>${c.v33()}`, `sr.GND>${c.gnd()}`, 'sr.DS>pi.P11', 'sr.SHCP>pi.P13', 'sr.STCP>pi.P15', `sr.MR>${c.v33()}`, `sr.OE>${c.gnd()}`);
      ['Q0', 'Q1', 'Q2', 'Q3'].forEach((q, i) => c.part(`r${i}`, 'resistor', { ohms: 330 }).part(`q${i}`, 'led', { color: 'yellow' }, q).w(`sr.${q}>r${i}.1`, `r${i}.2>q${i}.A`, `q${i}.K>${c.gnd()}`));
    },
  ),
  ex(
    {
      id: 'logic-optocoupler-pulses',
      cat: 'logic',
      level: 'intermediate',
      minutes: 20,
      title: ['Isolated pulse link (PC817)', 'نقل نبضات معزول (PC817)'],
      goal: ['Send pulses through an optocoupler and count them on the isolated side.', 'إرسال نبضات عبر عازل ضوئي وعدّها على الجانب المعزول.'],
      result: ['Five pulses are sent and five are counted.', 'تُرسل خمس نبضات وتُعدّ خمس.'],
      tryIt: ['Change the number of pulses in the code.', 'غيّر عدد النبضات في الكود.'],
      modify: ['Measure the pulse frequency on the receiving side.', 'قِس تردد النبضات على جانب الاستقبال.'],
      explain: ['The LED inside the PC817 switches the phototransistor; with a pull-up the output goes LOW for each pulse.', 'يشغّل الـ LED داخل PC817 الترانزستور الضوئي، ومع مقاومة الرفع ينخفض المخرج مع كل نبضة.'],
      code: `from gpiozero import OutputDevice, DigitalInputDevice
from time import sleep

tx = OutputDevice(17)
rx = DigitalInputDevice(22, pull_up=True)     # LOW while the opto LED is lit
count = 0

def pulse_seen():
    global count
    count += 1

rx.when_activated = pulse_seen
for i in range(5):
    tx.on(); sleep(0.1); tx.off(); sleep(0.1)
print("sent 5, counted", count)
`,
      test: { expect: /sent 5, counted 5/, seconds: 3 },
    },
    (c) => c.part('r_led', 'resistor', { ohms: 470 }).part('opto', 'pc817', {}, 'PC817').w('pi.P11>r_led.1', 'r_led.2>opto.A', `opto.K>${c.gnd()}`, 'opto.C>pi.P15', `opto.E>${c.gnd()}`),
  ),
  ex(
    {
      id: 'logic-transistor-driver',
      cat: 'logic',
      level: 'beginner',
      minutes: 15,
      title: ['Transistor switch for a 5 V load', 'ترانزستور كمفتاح لحمل 5 فولت'],
      goal: ['Switch a 5 V buzzer with an NPN transistor because a GPIO pin is only 3.3 V and 16 mA.', 'تشغيل جرس 5 فولت بترانزستور NPN لأن طرف GPIO يعطي 3.3 فولت و16 ملي أمبير فقط.'],
      result: ['The buzzer beeps three times from the 5 V rail; the GPIO only supplies the small base current.', 'يصفّر الجرس ثلاث مرات من خط 5 فولت، ولا يعطي طرف GPIO إلا تيار القاعدة الصغير.'],
      tryIt: ['Open the GPIO monitor to see the small current on GPIO17.', 'افتح مراقب GPIO لترى التيار الصغير على GPIO17.'],
      modify: ['Replace the buzzer with a 5 V relay coil (add a flyback diode!).', 'استبدل الجرس بملف مرحل 5 فولت (أضف ثنائي حماية!).'],
      explain: ['1 kΩ limits the base current to about 2.6 mA; the transistor then lets the buzzer current flow from 5 V to GND.', 'تحدد المقاومة 1 كيلو أوم تيار القاعدة بنحو 2.6 ملي أمبير، فيسمح الترانزستور بمرور تيار الجرس من 5 فولت إلى الأرضي.'],
      code: `from gpiozero import OutputDevice
from time import sleep

switch = OutputDevice(17)
for i in range(3):
    switch.on(); sleep(0.3)
    switch.off(); sleep(0.3)
    print("beep", i + 1)
switch.on(); sleep(0.5)
print("final beep")
`,
      test: { expect: /final beep/, seconds: 4, verify: (s) => check(!!vis(s, 'bz').on, 'buzzer on through the transistor') },
    },
    (c) => c.part('rb', 'resistor', { ohms: 1000 }).part('q1', 'npn', {}, '2N2222').part('bz', 'buzzer', {}, 'Buzzer 5 V').w('pi.P11>rb.1', 'rb.2>q1.B', `q1.E>${c.gnd()}`, `bz.P>${c.v50()}`, 'bz.N>q1.C'),
  ),
  ex(
    {
      id: 'logic-inverter-indicator',
      cat: 'logic',
      level: 'beginner',
      minutes: 10,
      title: ['NOT gate indicator', 'مؤشر بوابة NOT'],
      goal: ['See an inverter in action: the output LED is on when the input is LOW.', 'رؤية العاكس أثناء العمل: يضيء LED المخرج عندما يكون المدخل منخفضاً.'],
      result: ['Input and output alternate: when GPIO17 is HIGH the LED is off and vice versa.', 'يتناوب المدخل والمخرج: عندما يكون GPIO17 مرتفعاً ينطفئ الـ LED والعكس.'],
      tryIt: ['Watch the input in the GPIO monitor and the output LED.', 'راقب المدخل في مراقب GPIO والـ LED على المخرج.'],
      modify: ['Use two inverters in series: what happens?', 'استخدم عاكسين على التوالي: ماذا يحدث؟'],
      explain: ['A 74HC04 contains six NOT gates; output 1Y is always the opposite of input 1A.', 'تحتوي 74HC04 على ست بوابات NOT، والمخرج 1Y دائماً عكس المدخل 1A.'],
      code: `from gpiozero import OutputDevice
from time import sleep

a = OutputDevice(17)
for v in (0, 1, 0, 1):
    a.value = v
    print(f"input {v} -> LED {'on' if not v else 'off'}")
    sleep(0.5)
`,
      test: { expect: /input 1 -> LED off/, seconds: 3, verify: (s) => check(!lit(s, 'out'), 'LED off for input 1') },
    },
    (c) => c.part('inv', 'hc04', {}, '74HC04 NOT').part('r_out', 'resistor', { ohms: 330 }).part('out', 'led', { color: 'green' }, 'Output').w(`inv.VCC>${c.v33()}`, `inv.GND>${c.gnd()}`, 'inv.1A>pi.P11', 'inv.1Y>r_out.1', 'r_out.2>out.A', `out.K>${c.gnd()}`),
  ),
];
