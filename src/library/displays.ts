// Displays: character LCDs, OLED, 7-segment, TM1637 and addressable LEDs.
import type { Simulator } from '../engine/simulator';
import { check, ex, vis, type LibExample } from './dsl';

const lcdLines = (s: Simulator, id: string): string[] => (s.device(id) as any)?.view?.().lines ?? [];
const SEG: Record<string, number> = { '0': 0x3f, '1': 0x06, '2': 0x5b, '3': 0x4f, '4': 0x66, '5': 0x6d, '6': 0x7d, '7': 0x07, '8': 0x7f, '9': 0x6f, '-': 0x40 };
const tmShows = (s: Simulator, id: string, text: string) => {
  const d: number[] = (vis(s, id).digits ?? []).map((x: number) => x & 0x7f);
  return text.split('').every((ch, i) => d[i] === SEG[ch]);
};

export const DISPLAY_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'displays-lcd-hello-counter',
      cat: 'displays',
      level: 'beginner',
      minutes: 10,
      title: ['LCD hello and counter', 'شاشة LCD: ترحيب وعدّاد'],
      goal: ['Write text to a 16×2 I2C LCD and update a number in place.', 'كتابة نص على شاشة LCD مقاس 16×2 عبر I2C وتحديث رقم في مكانه.'],
      result: ['Line 1 shows a greeting, line 2 counts from 0 to 5.', 'يعرض السطر الأول ترحيباً ويعد السطر الثاني من 0 إلى 5.'],
      tryIt: ['Watch the LCD in the workspace while the counter runs.', 'راقب الشاشة في مساحة العمل أثناء العد.'],
      modify: ['Show the time from time.strftime("%H:%M:%S") on line 2.', 'اعرض الوقت باستخدام time.strftime("%H:%M:%S") في السطر الثاني.'],
      explain: ['RPLCD drives the HD44780 through the PCF8574 backpack at 0x27. cursor_pos=(row, col) moves the cursor without clearing.', 'تتحكم RPLCD بشاشة HD44780 عبر لوحة PCF8574 على العنوان 0x27، وcursor_pos=(row, col) تنقل المؤشر دون مسح الشاشة.'],
      code: `from RPLCD.i2c import CharLCD
from time import sleep

lcd = CharLCD("PCF8574", 0x27, cols=16, rows=2)
lcd.clear()
lcd.write_string("Hello, Pi 5!")
for n in range(6):
    lcd.cursor_pos = (1, 0)
    lcd.write_string(f"count: {n:<5d}")
    sleep(0.4)
print("LCD done")
`,
      test: { expect: /LCD done/, seconds: 5, verify: (s) => check(/Hello, Pi 5!/.test(lcdLines(s, 'lcd')[0] ?? '') && /count: 5/.test(lcdLines(s, 'lcd')[1] ?? ''), `LCD shows ${JSON.stringify(lcdLines(s, 'lcd'))}`) },
    },
    (c) => c.i2c5('lcd', 'lcd1602_i2c', { pullups: 'removed' }, 'LCD 16×2'),
  ),
  ex(
    {
      id: 'displays-lcd-thermometer',
      cat: 'displays',
      level: 'beginner',
      minutes: 15,
      title: ['LCD thermometer (DHT22)', 'ميزان حرارة بشاشة LCD (DHT22)'],
      goal: ['Show live sensor readings on a character display.', 'عرض قراءات الحساس الحية على شاشة نصية.'],
      result: ['The LCD shows temperature on line 1 and humidity on line 2, refreshed every 2.5 s.', 'تعرض الشاشة الحرارة في السطر الأول والرطوبة في الثاني، وتتحدث كل 2.5 ثانية.'],
      tryIt: ['Change the DHT22 temperature to 29.5 °C while it runs.', 'غيّر حرارة DHT22 إلى 29.5 °م أثناء التشغيل.'],
      modify: ['Add a custom degree symbol with lcd.create_char.', 'أضف رمز الدرجة المخصص باستخدام lcd.create_char.'],
      explain: ['f-strings with width (e.g. {t:5.1f}) keep the text aligned so old characters are overwritten.', 'تحافظ صيغ f-string ذات العرض الثابت مثل {t:5.1f} على محاذاة النص فتُكتب الأحرف القديمة فوقها.'],
      code: `import time
import board, adafruit_dht
from RPLCD.i2c import CharLCD

dht = adafruit_dht.DHT22(board.D4)
lcd = CharLCD("PCF8574", 0x27, cols=16, rows=2)
for i in range(3):
    try:
        t, h = dht.temperature, dht.humidity
        lcd.cursor_pos = (0, 0); lcd.write_string(f"Temp {t:5.1f} C   ")
        lcd.cursor_pos = (1, 0); lcd.write_string(f"Hum  {h:5.1f} %   ")
        print(f"shown {t:.1f} C / {h:.1f} %")
    except RuntimeError:
        pass
    time.sleep(2.5)
`,
      test: { expect: /shown 25\.0 C[\s\S]*shown 29\.5 C/, seconds: 9, events: [{ at: 3, comp: 'dht', props: { temperature: 29.5 } }], verify: (s) => check(/29\.5/.test(lcdLines(s, 'lcd')[0] ?? ''), `LCD ${JSON.stringify(lcdLines(s, 'lcd'))}`) },
    },
    (c) => c.dht('dht', 4).i2c5('lcd', 'lcd1602_i2c', { pullups: 'removed' }, 'LCD 16×2'),
  ),
  ex(
    {
      id: 'displays-lcd2004-weather',
      cat: 'displays',
      level: 'intermediate',
      minutes: 20,
      title: ['20×4 weather panel (BME280)', 'لوحة طقس 20×4 (BME280)'],
      goal: ['Lay out four lines of data on a 20×4 LCD shared on the I2C bus with a sensor.', 'ترتيب أربعة أسطر من البيانات على شاشة 20×4 تشارك ناقل I2C مع حساس.'],
      result: ['Temperature, humidity, pressure and a comfort message appear on four lines.', 'تظهر الحرارة والرطوبة والضغط ورسالة الراحة على أربعة أسطر.'],
      tryIt: ['Raise the BME280 humidity to 85 % and watch line 4.', 'ارفع رطوبة BME280 إلى 85% وراقب السطر الرابع.'],
      modify: ['Alternate between two pages of information every 3 s.', 'بدّل بين صفحتين من المعلومات كل 3 ثوانٍ.'],
      explain: ['Two I2C devices share SDA/SCL; they are told apart by their addresses (0x76 sensor, 0x27 LCD).', 'يتشارك جهازا I2C الخطين SDA وSCL، ويُميّز كل منهما بعنوانه (0x76 للحساس و0x27 للشاشة).'],
      code: `import time
import board, busio
from adafruit_bme280 import basic as adafruit_bme280
from RPLCD.i2c import CharLCD

bme = adafruit_bme280.Adafruit_BME280_I2C(busio.I2C(board.SCL, board.SDA), address=0x76)
lcd = CharLCD("PCF8574", 0x27, cols=20, rows=4)
for i in range(3):
    t, h, p = bme.temperature, bme.relative_humidity, bme.pressure
    comfort = "too humid" if h > 70 else "too dry" if h < 30 else "comfortable"
    for row, text in enumerate([f"Temp  {t:6.1f} C", f"Hum   {h:6.1f} %", f"Press {p:6.1f} hPa", comfort]):
        lcd.cursor_pos = (row, 0)
        lcd.write_string(f"{text:<20}")
    print("panel:", comfort)
    time.sleep(1.5)
`,
      test: { expect: /panel: comfortable[\s\S]*panel: too humid/, seconds: 6, events: [{ at: 2, comp: 'bme', props: { humidity: 85 } }], verify: (s) => check(/too humid/.test(lcdLines(s, 'lcd')[3] ?? ''), `LCD ${JSON.stringify(lcdLines(s, 'lcd'))}`) },
    },
    (c) => c.i2c('bme', 'bme280', {}, 'BME280').i2c5('lcd', 'lcd2004_i2c', { pullups: 'removed' }, 'LCD 20×4'),
  ),
  ex(
    {
      id: 'displays-oled-status',
      cat: 'displays',
      level: 'beginner',
      minutes: 10,
      title: ['OLED status screen', 'شاشة حالة OLED'],
      goal: ['Draw text lines on a 128×64 OLED frame buffer and send it to the display.', 'رسم أسطر نصية في ذاكرة إطار شاشة OLED مقاس 128×64 ثم إرسالها إلى الشاشة.'],
      result: ['The OLED shows a title, the CPU temperature and an uptime counter.', 'تعرض الشاشة عنواناً وحرارة المعالج وعدّاد زمن التشغيل.'],
      tryIt: ['Watch the OLED update every half second.', 'راقب تحديث الشاشة كل نصف ثانية.'],
      modify: ['Draw a progress bar with oled pixels.', 'ارسم شريط تقدم باستخدام بكسلات الشاشة.'],
      explain: ['Drawing happens in memory; show() sends the whole frame over I2C at once, which avoids flicker.', 'يتم الرسم في الذاكرة ثم ترسل show() الإطار كاملاً عبر I2C دفعة واحدة، فيمنع ذلك الوميض.'],
      code: `from smartfarm import OLED
from gpiozero import CPUTemperature
from time import sleep

oled = OLED()
cpu = CPUTemperature()
for uptime in range(4):
    oled.clear()
    oled.text("Pi 5 status", 0, 0)
    oled.text(f"CPU {cpu.temperature:.1f} C", 0, 16)
    oled.text(f"up {uptime} s", 0, 32)
    oled.show()
    sleep(0.5)
print("OLED frames sent: 4")
`,
      test: { expect: /OLED frames sent: 4/, seconds: 4 },
    },
    (c) => c.i2c('oled', 'oled_ssd1306', {}, 'OLED'),
  ),
  ex(
    {
      id: 'displays-tm1637-stopwatch',
      cat: 'displays',
      level: 'intermediate',
      minutes: 20,
      title: ['Stopwatch on a TM1637 display', 'ساعة إيقاف على شاشة TM1637'],
      goal: ['Format time as MM:SS and show it on a 4-digit display with the colon.', 'تنسيق الزمن بصيغة دقائق:ثوانٍ وعرضه على شاشة من 4 خانات مع النقطتين.'],
      result: ['The display counts 00:00, 00:01 … and the button freezes the time.', 'تعدّ الشاشة 00:00 ثم 00:01 … ويوقف الزر العد.'],
      tryIt: ['Press the button to stop the stopwatch.', 'اضغط الزر لإيقاف ساعة الإيقاف.'],
      modify: ['Make a second press restart from zero.', 'اجعل الضغطة الثانية تعيد العد من الصفر.'],
      explain: ['divmod(seconds, 60) splits minutes and seconds; the TM1637 uses its own 2-wire protocol (CLK/DIO).', 'تقسم divmod(seconds, 60) الثواني إلى دقائق وثوانٍ، وتستخدم TM1637 بروتوكولاً خاصاً بخطين (CLK وDIO).'],
      code: `import time
import tm1637
from gpiozero import Button

disp = tm1637.TM1637(clk=23, dio=24)
stop = Button(17)
start = time.monotonic()
while not stop.is_pressed:
    m, s = divmod(int(time.monotonic() - start), 60)
    disp.show(f"{m:02d}{s:02d}", colon=True)
    time.sleep(0.2)
print(f"stopped at {m:02d}:{s:02d}")
`,
      test: { expect: /stopped at 00:03/, seconds: 6, events: [{ at: 3.5, comp: 'btn', press: true }], verify: (s) => check(tmShows(s, 'tm', '0003'), `digits ${JSON.stringify(vis(s, 'tm').digits)}`) },
    },
    (c) => c.part('tm', 'tm1637', {}, 'TM1637').w('tm.CLK>pi.P16', 'tm.DIO>pi.P18', `tm.VCC>${c.v33()}`, `tm.GND>${c.gnd()}`).button('btn', 17, 'Stop'),
  ),
  ex(
    {
      id: 'displays-seven-seg-countdown',
      cat: 'displays',
      level: 'beginner',
      minutes: 20,
      title: ['7-segment countdown', 'عد تنازلي على شاشة 7 مقاطع'],
      goal: ['Drive the seven segments of a digit directly from GPIO pins.', 'التحكم بالمقاطع السبعة لخانة مباشرة من أطراف GPIO.'],
      result: ['The digit counts down from 9 to 0.', 'تعد الخانة تنازلياً من 9 إلى 0.'],
      tryIt: ['Watch which segments light for each digit.', 'راقب المقاطع التي تضيء لكل رقم.'],
      modify: ['Show the letters A, b, C, d, E, F too (hexadecimal).', 'اعرض الأحرف A وb وC وd وE وF أيضاً (النظام الست عشري).'],
      explain: ['Each segment needs its own resistor; a table says which segments make each digit.', 'يحتاج كل مقطع مقاومة خاصة به، ويحدد جدول المقاطع التي تكوّن كل رقم.'],
      code: `from gpiozero import LEDBoard
from time import sleep

#                a   b   c   d   e   f   g
segments = LEDBoard(5, 6, 13, 19, 26, 16, 20)
DIGITS = {
    0: (1, 1, 1, 1, 1, 1, 0), 1: (0, 1, 1, 0, 0, 0, 0), 2: (1, 1, 0, 1, 1, 0, 1),
    3: (1, 1, 1, 1, 0, 0, 1), 4: (0, 1, 1, 0, 0, 1, 1), 5: (1, 0, 1, 1, 0, 1, 1),
    6: (1, 0, 1, 1, 1, 1, 1), 7: (1, 1, 1, 0, 0, 0, 0), 8: (1, 1, 1, 1, 1, 1, 1),
    9: (1, 1, 1, 1, 0, 1, 1),
}
for n in range(9, -1, -1):
    segments.value = DIGITS[n]
    print("showing", n)
    sleep(0.3)
`,
      test: {
        expect: /showing 0/,
        seconds: 5,
        verify: (s) => {
          const g = vis(s, 'seg').seg ?? {};
          return check(['a', 'b', 'c', 'd', 'e', 'f'].every((k) => g[k] > 0) && !(g.g > 0), `segments ${JSON.stringify(g)}`);
        },
      },
    },
    (c) => {
      c.part('seg', 'seven_segment', {}, '7-segment');
      const pins: [string, number][] = [
        ['a', 5],
        ['b', 6],
        ['c', 13],
        ['d', 19],
        ['e', 26],
        ['f', 16],
        ['g', 20],
      ];
      for (const [s, bcm] of pins) c.part(`r_${s}`, 'resistor', { ohms: 330 }).w(`pi.P${({ 5: 29, 6: 31, 13: 33, 19: 35, 26: 37, 16: 36, 20: 38 } as Record<number, number>)[bcm]}>r_${s}.1`, `r_${s}.2>seg.${s}`);
      c.w(`seg.COM>${c.gnd()}`);
    },
  ),
  ex(
    {
      id: 'displays-neopixel-level-bar',
      cat: 'displays',
      level: 'intermediate',
      minutes: 20,
      title: ['NeoPixel level bar', 'شريط مستوى بأضواء NeoPixel'],
      goal: ['Turn an analog value into a coloured bar graph on an addressable LED strip.', 'تحويل قيمة تناظرية إلى مخطط شريطي ملون على شريط LEDs قابلة للعنونة.'],
      result: ['More LEDs light as the knob turns: green, then yellow, then red.', 'تضيء LEDs أكثر كلما دار المقبض: أخضر ثم أصفر ثم أحمر.'],
      tryIt: ['Set the knob to 100 % while it runs.', 'اضبط المقبض على 100% أثناء التشغيل.'],
      modify: ['Make the top LED blink when the bar is full.', 'اجعل آخر LED يومض عندما يمتلئ الشريط.'],
      explain: ['Each pixel gets its own (r, g, b); show() sends the whole strip on one data wire with precise timing.', 'لكل بكسل قيمة (r, g, b) خاصة، وترسل show() الشريط كاملاً عبر سلك بيانات واحد بتوقيت دقيق.'],
      code: `import time
import board, busio, neopixel
import adafruit_ads1x15.ads1115 as ADS
from adafruit_ads1x15.analog_in import AnalogIn

knob = AnalogIn(ADS.ADS1115(busio.I2C(board.SCL, board.SDA)), ADS.P0)
strip = neopixel.NeoPixel(board.D18, 8, brightness=0.3, auto_write=False)
for i in range(5):
    level = round(knob.voltage / 3.3 * 8)
    for p in range(8):
        colour = (0, 255, 0) if p < 4 else (255, 160, 0) if p < 6 else (255, 0, 0)
        strip[p] = colour if p < level else (0, 0, 0)
    strip.show()
    print("level", level, "of 8")
    time.sleep(0.6)
`,
      test: { expect: /level 4 of 8[\s\S]*level 8 of 8/, seconds: 5, events: [{ at: 1.5, comp: 'knob', props: { position: 100 } }], verify: (s) => check((vis(s, 'strip').pixels?.[7]?.[0] ?? 0) > 50, `pixel 7 ${JSON.stringify(vis(s, 'strip').pixels?.[7])}`) },
    },
    (c) => c.pot('knob', 0, { position: 50 }, 'Knob').part('strip', 'ws2812_strip', { count: 8 }, 'NeoPixel ×8').w('strip.DIN>pi.P12', `strip.VCC>${c.v50()}`, `strip.GND>${c.gnd()}`),
  ),
  ex(
    {
      id: 'displays-neopixel-rainbow',
      cat: 'displays',
      level: 'beginner',
      minutes: 15,
      title: ['NeoPixel rainbow', 'قوس قزح بأضواء NeoPixel'],
      goal: ['Generate colours with the HSV colour wheel and animate them along a strip.', 'توليد الألوان من عجلة HSV وتحريكها على طول الشريط.'],
      result: ['A rainbow moves along the 8 pixels.', 'يتحرك قوس قزح على البكسلات الثمانية.'],
      tryIt: ['Watch the colours shift along the strip.', 'راقب انتقال الألوان على الشريط.'],
      modify: ['Change the speed or make the rainbow move backwards.', 'غيّر السرعة أو اجعل قوس قزح يتحرك للخلف.'],
      explain: ['colorsys.hsv_to_rgb turns a hue (0–1) into red, green and blue; shifting the hue per pixel spreads the rainbow.', 'تحوّل colorsys.hsv_to_rgb درجة اللون (0–1) إلى أحمر وأخضر وأزرق، وإزاحة الدرجة لكل بكسل تنشر قوس قزح.'],
      code: `import time, colorsys
import board, neopixel

strip = neopixel.NeoPixel(board.D18, 8, brightness=0.2, auto_write=False)
for frame in range(12):
    for p in range(8):
        r, g, b = colorsys.hsv_to_rgb(((p + frame) % 8) / 8, 1, 1)
        strip[p] = (int(r * 255), int(g * 255), int(b * 255))
    strip.show()
    time.sleep(0.1)
print("rainbow frames:", frame + 1)
`,
      test: { expect: /rainbow frames: 12/, seconds: 4, verify: (s) => check(new Set((vis(s, 'strip').pixels ?? []).map((p: number[]) => p.join(','))).size >= 6, 'pixels should show different colours') },
    },
    (c) => c.part('strip', 'ws2812_strip', { count: 8 }, 'NeoPixel ×8').w('strip.DIN>pi.P12', `strip.VCC>${c.v50()}`, `strip.GND>${c.gnd()}`),
  ),
  ex(
    {
      id: 'displays-lcd-menu',
      cat: 'displays',
      level: 'advanced',
      minutes: 30,
      title: ['Two-button LCD menu', 'قائمة بزرين على شاشة LCD'],
      goal: ['Build a small menu system: one button scrolls, the other selects.', 'بناء نظام قوائم صغير: زر للتنقل وآخر للاختيار.'],
      result: ['The LCD shows the menu item; "next" moves through items and "ok" activates one.', 'تعرض الشاشة عنصر القائمة، وزر "التالي" ينقل بين العناصر وزر "موافق" يفعّل العنصر.'],
      tryIt: ['Press NEXT twice and then OK.', 'اضغط زر التالي مرتين ثم زر موافق.'],
      modify: ['Add a sub-menu that changes a setting value.', 'أضف قائمة فرعية تغيّر قيمة إعداد.'],
      explain: ['The program keeps the selected index in a variable and redraws the screen on every button event; the LED shows the activated item.', 'يحتفظ البرنامج بفهرس العنصر المحدد في متغير ويعيد رسم الشاشة مع كل ضغطة، ويُظهر الـ LED العنصر المفعّل.'],
      code: `from RPLCD.i2c import CharLCD
from gpiozero import Button, LED
from signal import pause

lcd = CharLCD("PCF8574", 0x27, cols=16, rows=2)
nxt, ok = Button(17), Button(27)
light = LED(22)
ITEMS = ["Light ON", "Light OFF", "Blink"]
index = 0

def draw():
    lcd.clear()
    lcd.write_string(f"> {ITEMS[index]}")
    lcd.cursor_pos = (1, 0)
    lcd.write_string(f"item {index + 1}/{len(ITEMS)}")

def next_item():
    global index
    index = (index + 1) % len(ITEMS)
    draw()
    print("menu:", ITEMS[index])

def select():
    choice = ITEMS[index]
    if choice == "Light ON": light.on()
    elif choice == "Light OFF": light.off()
    else: light.blink(0.2, 0.2)
    print("selected:", choice)

nxt.when_pressed = next_item
ok.when_pressed = select
draw()
pause()
`,
      test: {
        expect: /menu: Light OFF[\s\S]*menu: Blink[\s\S]*selected: Blink/,
        seconds: 6,
        events: [
          { at: 1, comp: 'next', press: true },
          { at: 1.3, comp: 'next', press: false },
          { at: 2, comp: 'next', press: true },
          { at: 2.3, comp: 'next', press: false },
          { at: 3, comp: 'ok', press: true },
          { at: 3.3, comp: 'ok', press: false },
        ],
        verify: (s) => check(/Blink/.test(lcdLines(s, 'lcd')[0] ?? ''), `LCD ${JSON.stringify(lcdLines(s, 'lcd'))}`),
      },
    },
    (c) => c.i2c5('lcd', 'lcd1602_i2c', { pullups: 'removed' }, 'LCD 16×2').button('next', 17, 'Next').button('ok', 27, 'OK').led('light', 22, 'yellow', 'Light'),
  ),
  ex(
    {
      id: 'displays-tm1637-thermometer',
      cat: 'displays',
      level: 'intermediate',
      minutes: 15,
      title: ['Digital thermometer (TM1637 + DS18B20)', 'ميزان حرارة رقمي (TM1637 مع DS18B20)'],
      goal: ['Show a 1-Wire temperature on a 4-digit display with the °C symbol.', 'عرض حرارة حساس 1-Wire على شاشة من 4 خانات مع رمز الدرجة المئوية.'],
      result: ['The display shows the water temperature as e.g. "21°C".', 'تعرض الشاشة حرارة الماء مثل "21°C".'],
      tryIt: ['Change the probe temperature to 35 °C while it runs.', 'غيّر حرارة المجس إلى 35 °م أثناء التشغيل.'],
      modify: ['Show "Hi" when the temperature is above 30 °C.', 'اعرض "Hi" عندما تتجاوز الحرارة 30 °م.'],
      explain: ['TM1637.temperature() draws two digits plus the degree and C symbols.', 'ترسم الدالة TM1637.temperature() رقمين مع رمزي الدرجة وC.'],
      code: `from w1thermsensor import W1ThermSensor
import tm1637
from time import sleep

probe = W1ThermSensor()
disp = tm1637.TM1637(clk=23, dio=24)
for i in range(4):
    t = round(probe.get_temperature())
    disp.temperature(t)
    print("display:", t, "C")
    sleep(1)
`,
      test: { expect: /display: 21 C[\s\S]*display: 35 C/, seconds: 6, events: [{ at: 1.5, comp: 'probe', props: { temperature: 35 } }], verify: (s) => check(tmShows(s, 'tm', '35'), `digits ${JSON.stringify(vis(s, 'tm').digits)}`) },
    },
    (c) => c.ds18b20('probe').part('tm', 'tm1637', {}, 'TM1637').w('tm.CLK>pi.P16', 'tm.DIO>pi.P18', `tm.VCC>${c.v33()}`, `tm.GND>${c.gnd()}`),
  ),
];
