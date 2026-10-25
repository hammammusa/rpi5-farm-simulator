// Communication: I2C scanning and devices, SPI, UART frames, Modbus RS-485, expanders and multiplexers.
import type { Simulator } from '../engine/simulator';
import { check, ex, lit, type LibExample } from './dsl';

const terminalText = (s: Simulator, id: string): string => (s.device(id) as any)?.view?.().text ?? '';

export const COMMS_EXAMPLES: LibExample[] = [
  ex(
    {
      id: 'comms-i2c-scanner',
      cat: 'comms',
      level: 'beginner',
      minutes: 15,
      title: ['I2C bus scanner', 'ماسح ناقل I2C'],
      goal: ['Find every device on the I2C bus and print its address, like i2cdetect.', 'إيجاد كل جهاز على ناقل I2C وطباعة عنوانه، مثل الأمر i2cdetect.'],
      result: ['The bus is scanned every 3 s: the first scan lists all four devices by name, later scans report devices that appear or disappear. It keeps watching until you press Stop.', 'يُفحص الناقل كل 3 ثوانٍ: يسرد الفحص الأول الأجهزة الأربعة بأسمائها، وتبلّغ الفحوص اللاحقة عن الأجهزة التي تظهر أو تختفي، ويستمر حتى تضغط إيقاف.'],
      tryIt: ['While it runs, set the BH1750 fault to "Sensor disconnected" and watch the next scan.', 'أثناء التشغيل اضبط عطل BH1750 على "Sensor disconnected" وراقب الفحص التالي.'],
      modify: ['Warn when two devices answer at the same address.', 'نبّه عندما يجيب جهازان على العنوان نفسه.'],
      explain: ['Blinka requires the bus to be locked before scan(); every device answers (ACKs) only at its own 7-bit address.', 'تتطلب Blinka قفل الناقل قبل scan()، وكل جهاز يجيب (ACK) فقط على عنوانه ذي 7 بتات.'],
      code: `import time
import board, busio

KNOWN = {0x23: "BH1750 light", 0x27: "PCF8574 LCD backpack", 0x68: "DS3231 clock", 0x76: "BME280 climate"}
i2c = busio.I2C(board.SCL, board.SDA)

def scan():
    while not i2c.try_lock():
        pass
    try:
        return set(i2c.scan())
    finally:
        i2c.unlock()

known = scan()
print(len(known), "devices found")
for addr in sorted(known):
    print(f"  0x{addr:02X}  {KNOWN.get(addr, 'unknown')}")
while True:                      # runs until you press Stop
    time.sleep(3)
    now = scan()
    for addr in sorted(now - known):
        print(f"+ 0x{addr:02X}  {KNOWN.get(addr, 'unknown')} (new)")
    for addr in sorted(known - now):
        print(f"- 0x{addr:02X}  {KNOWN.get(addr, 'unknown')} (removed)")
    known = now
`,
      test: { expect: /4 devices found[\s\S]*0x23\s+BH1750[\s\S]*0x27[\s\S]*0x68\s+DS3231[\s\S]*0x76\s+BME280[\s\S]*- 0x23\s+BH1750 light \(removed\)/, seconds: 4, events: [{ at: 1.5, comp: 'light', props: { fault: 'disconnected' } }] },
    },
    (c) => c.i2c('light', 'bh1750', {}, 'BH1750').i2c('rtc', 'ds3231', {}, 'DS3231').i2c('bme', 'bme280', {}, 'BME280').i2c5('lcd', 'lcd1602_i2c', { pullups: 'removed' }, 'LCD'),
  ),
  ex(
    {
      id: 'comms-spi-two-channels',
      cat: 'comms',
      level: 'intermediate',
      minutes: 20,
      title: ['Raw SPI: two channels of an MCP3008', 'SPI مباشر: قناتان في MCP3008'],
      goal: ['Build the 3-byte SPI request by hand and decode the 10-bit answer.', 'بناء طلب SPI من 3 بايتات يدوياً وفك الإجابة ذات 10 بتات.'],
      result: ['Both channels are printed as raw values and voltages.', 'تُطبع القناتان كقيم خام وكجهد.'],
      tryIt: ['Change the position of the second knob to 20 % while it runs.', 'غيّر موضع المقبض الثاني إلى 20% أثناء التشغيل.'],
      modify: ['Read all eight channels in a loop.', 'اقرأ القنوات الثماني كلها في حلقة.'],
      explain: ['Byte 1 = start bit, byte 2 = single-ended mode + channel in the high nibble; the answer is the low 2 bits of byte 2 and all of byte 3.', 'البايت الأول بت البدء، والثاني وضع الإدخال المفرد مع رقم القناة في النصف العلوي، والإجابة هي آخر بتين من البايت الثاني مع البايت الثالث كاملاً.'],
      code: `import spidev, time

spi = spidev.SpiDev()
spi.open(0, 0)                 # SPI0, CE0
spi.max_speed_hz = 1_000_000

def read(ch):
    r = spi.xfer2([1, (8 + ch) << 4, 0])
    return ((r[1] & 3) << 8) | r[2]

while True:                      # runs until you press Stop
    a, b = read(0), read(1)
    print(f"CH0 {a:4d} ({a * 3.3 / 1023:.2f} V)   CH1 {b:4d} ({b * 3.3 / 1023:.2f} V)")
    time.sleep(1)
`,
      test: { expect: /CH1\s+(76[0-9]|77\d) \(2\.4\d V\)[\s\S]*CH1\s+(20[0-9]|19\d) \(0\.6\d V\)/, seconds: 5, events: [{ at: 1.4, comp: 'k2', props: { position: 20 } }] },
    },
    (c) => {
      c.mcp();
      for (const [id, ch, pos] of [
        ['k1', 0, 50],
        ['k2', 1, 75],
      ] as const)
        c.part(id, 'potentiometer', { position: pos }, `Knob ${ch}`).w(`${id}.A>${c.gnd()}`, `${id}.B>pi.P17`, `${id}.W>mcp.CH${ch}`);
    },
  ),
  ex(
    {
      id: 'comms-uart-pc-report',
      cat: 'comms',
      level: 'beginner',
      minutes: 15,
      title: ['Send reports to a PC over UART', 'إرسال تقارير إلى حاسوب عبر UART'],
      goal: ['Open the serial port and send formatted text lines to a USB-serial adapter.', 'فتح المنفذ التسلسلي وإرسال أسطر نصية منسقة إلى محول USB-تسلسلي.'],
      result: ['Every 0.5 s a numbered report with the CPU temperature is sent to the PC terminal, until you press Stop.', 'كل 0.5 ثانية يُرسل تقرير مرقّم بحرارة المعالج إلى طرفية الحاسوب حتى تضغط إيقاف.'],
      tryIt: ['Open the UART monitor tab and watch the bytes arrive.', 'افتح تبويب مراقب UART وراقب وصول البايتات.'],
      modify: ['Change the baud rate on both sides to 115200.', 'غيّر سرعة النقل على الجانبين إلى 115200.'],
      explain: ['TX of the Pi goes to RX of the adapter and vice versa; both sides must use the same baud rate.', 'يتصل TX في Pi بـ RX في المحول والعكس، ويجب أن يستخدم الطرفان سرعة النقل نفسها.'],
      code: `import serial, time
from gpiozero import CPUTemperature

port = serial.Serial("/dev/serial0", 9600)
cpu = CPUTemperature()
n = 0
while True:                      # runs until you press Stop
    n += 1
    line = f"report {n}: CPU {cpu.temperature:.1f} C\\r\\n"
    port.write(line.encode())
    print("sent:", line.strip())
    time.sleep(0.5)
`,
      test: { expect: /sent: report 3/, seconds: 2, verify: (s) => check(/report 1: CPU[\s\S]*report 3: CPU/.test(terminalText(s, 'pc')), `terminal got ${JSON.stringify(terminalText(s, 'pc'))}`) },
    },
    (c) => c.part('pc', 'usb_serial', {}, 'USB-serial (PC)').w(`pc.GND>${c.gnd()}`, 'pc.TX>pi.P10', 'pc.RX>pi.P8'),
  ),
  ex(
    {
      id: 'comms-uart-co2-protocol',
      cat: 'comms',
      level: 'advanced',
      minutes: 30,
      title: ['Speak the MH-Z19B protocol yourself', 'التحدث ببروتوكول MH-Z19B بنفسك'],
      goal: ['Build a 9-byte UART command with a checksum and decode the reply without a library.', 'بناء أمر UART من 9 بايتات مع مجموع التحقق وفك الرد دون مكتبة.'],
      result: ['The command frame is built with its checksum; every 2 s the sensor is asked again and each reply is checked and decoded, until you press Stop.', 'يُبنى إطار الأمر مع مجموع التحقق، وكل ثانيتين يُسأل الحساس من جديد ويُفحص كل رد ويُفك، حتى تضغط إيقاف.'],
      tryIt: ['While it runs, change the MH-Z19B CO₂ value and watch the next reply.', 'أثناء التشغيل غيّر قيمة CO₂ في MH-Z19B وراقب الرد التالي.'],
      modify: ['Reject replies with a wrong checksum and retry.', 'ارفض الردود ذات مجموع التحقق الخاطئ وأعد المحاولة.'],
      explain: ['Checksum = 0xFF − (sum of bytes 1…7) + 1, all modulo 256. CO₂ = high byte × 256 + low byte.', 'مجموع التحقق = ‎0xFF − (مجموع البايتات 1…7) + 1 بباقي القسمة على 256، وCO₂ = البايت العالي × 256 + البايت المنخفض.'],
      code: `import serial, time

def checksum(frame):
    return (0xFF - (sum(frame[1:8]) & 0xFF) + 1) & 0xFF

port = serial.Serial("/dev/serial0", 9600, timeout=1)
cmd = [0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0]
cmd[8] = checksum(cmd)
print("command:", " ".join(f"{b:02X}" for b in cmd))
while True:                      # runs until you press Stop
    port.write(bytes(cmd))
    reply = port.read(9)
    print("reply:  ", " ".join(f"{b:02X}" for b in reply))
    ok = len(reply) == 9 and reply[8] == checksum(reply)
    print("checksum ok:", ok)
    if ok:
        print("CO2:", reply[2] * 256 + reply[3], "ppm")
    time.sleep(2)
`,
      test: { expect: /command: FF 01 86 00 00 00 00 00 79[\s\S]*checksum ok: True[\s\S]*CO2: 650 ppm[\s\S]*CO2: 900 ppm/, seconds: 3, events: [{ at: 1, comp: 'co2', props: { co2: 900 } }] },
    },
    (c) => c.uart('co2', 'mhz19b', {}, 'MH-Z19B'),
  ),
  ex(
    {
      id: 'comms-eeprom-boot-counter',
      cat: 'comms',
      level: 'intermediate',
      minutes: 20,
      title: ['Boot counter in an I2C EEPROM', 'عدّاد التشغيل في ذاكرة EEPROM عبر I2C'],
      goal: ['Store a value that survives power-off in a 24C32 EEPROM.', 'تخزين قيمة تبقى بعد فصل الطاقة في ذاكرة EEPROM من نوع 24C32.'],
      result: ['Each run increases the start counter stored in the EEPROM (it survives power-off); while running, the uptime is saved to the EEPROM every 2 s until you press Stop.', 'كل تشغيل يزيد عداد البدء المخزن في EEPROM (يبقى بعد فصل الطاقة)، وأثناء التشغيل يُحفظ زمن التشغيل في EEPROM كل ثانيتين حتى تضغط إيقاف.'],
      tryIt: ['Stop and run again: the start number goes up by one.', 'أوقف البرنامج وشغّله مجدداً: يزيد رقم البدء بواحد.'],
      modify: ['Also store the date of the last start.', 'خزّن أيضاً تاريخ آخر تشغيل.'],
      explain: ['The 24C32 uses 2-byte memory addresses; int.to_bytes/from_bytes convert the counter to bytes. A fresh chip contains 0xFF.', 'تستخدم 24C32 عناوين ذاكرة من بايتين، وتحوّل to_bytes وfrom_bytes العدد إلى بايتات. الشريحة الجديدة تحتوي 0xFF.'],
      code: `import time
from smartfarm import EEPROM

ee = EEPROM(0x50)
raw = ee.read(0x0000, 2)
count = 0 if raw == b"\\xff\\xff" else int.from_bytes(raw, "big")
count += 1
ee.write(0x0000, count.to_bytes(2, "big"))
print("this is start number", count)
print("read back:", int.from_bytes(ee.read(0x0000, 2), "big"))
start = time.monotonic()
while True:                      # runs until you press Stop
    time.sleep(2)
    up = int(time.monotonic() - start)
    ee.write(0x0002, up.to_bytes(4, "big"))       # last uptime, kept after power-off
    print(f"start {count}: running for {int.from_bytes(ee.read(0x0002, 4), 'big')} s (saved)")
`,
      test: { expect: /this is start number 1[\s\S]*read back: 1[\s\S]*start 1: running for 2 s \(saved\)/, seconds: 3 },
    },
    (c) => c.i2c('ee', 'at24c32', {}, '24C32 EEPROM'),
  ),
  ex(
    {
      id: 'comms-i2c-mux-greenhouse',
      cat: 'comms',
      level: 'advanced',
      minutes: 25,
      title: ['Same-address sensors behind a TCA9548A', 'حساسات بالعنوان نفسه خلف TCA9548A'],
      goal: ['Use an I2C multiplexer to read two identical sensors that share address 0x44.', 'استخدام مُبدّل I2C لقراءة حساسين متطابقين يشتركان في العنوان 0x44.'],
      result: ['Inside and outside temperatures are printed with their difference.', 'تُطبع حرارة الداخل والخارج والفرق بينهما.'],
      tryIt: ['Change the outside sensor to 5 °C while it runs.', 'غيّر حرارة الحساس الخارجي إلى 5 °م أثناء التشغيل.'],
      modify: ['Add a third SHT31 on channel 2.', 'أضف حساس SHT31 ثالثاً على القناة 2.'],
      explain: ['tca[0] and tca[1] are virtual I2C buses: the multiplexer connects one channel at a time to the Pi.', 'العنصران tca[0] وtca[1] ناقلان افتراضيان: يوصل المُبدّل قناة واحدة في كل مرة إلى Pi.'],
      code: `import time
import board, busio
import adafruit_tca9548a, adafruit_sht31d

tca = adafruit_tca9548a.TCA9548A(busio.I2C(board.SCL, board.SDA))
inside = adafruit_sht31d.SHT31D(tca[0])
outside = adafruit_sht31d.SHT31D(tca[1])
while True:                      # runs until you press Stop
    ti, to = inside.temperature, outside.temperature
    print(f"inside {ti:.1f} °C  outside {to:.1f} °C  difference {ti - to:.1f} K")
    time.sleep(1)
`,
      test: { expect: /inside 24\.0 °C\s+outside 31\.0 °C[\s\S]*outside 5\.0 °C\s+difference 19\.0 K/, seconds: 5, events: [{ at: 1.3, comp: 's2', props: { temperature: 5 } }] },
    },
    (c) => {
      c.part('mux', 'tca9548a', {}, 'TCA9548A').w(`mux.VIN>${c.v33()}`, `mux.GND>${c.gnd()}`, 'mux.SDA>pi.P3', 'mux.SCL>pi.P5');
      c.part('s1', 'sht31', { temperature: 24 }, 'Inside').w(`s1.VCC>${c.v33()}`, `s1.GND>${c.gnd()}`, 's1.SDA>mux.SD0', 's1.SCL>mux.SC0');
      c.part('s2', 'sht31', { temperature: 31 }, 'Outside').w(`s2.VCC>${c.v33()}`, `s2.GND>${c.gnd()}`, 's2.SDA>mux.SD1', 's2.SCL>mux.SC1');
    },
  ),
  ex(
    {
      id: 'comms-modbus-soil-probe',
      cat: 'comms',
      level: 'advanced',
      minutes: 30,
      title: ['Modbus RTU over RS-485', 'بروتوكول Modbus RTU عبر RS-485'],
      goal: ['Read holding registers from an industrial soil probe through a MAX485 transceiver.', 'قراءة سجلات من مجس تربة صناعي عبر محول MAX485.'],
      result: ['Every 2 s the four registers are read and printed as moisture, temperature, EC and pH, until you press Stop.', 'كل ثانيتين تُقرأ السجلات الأربعة وتُطبع كرطوبة وحرارة وموصلية وpH، حتى تضغط إيقاف.'],
      tryIt: ['While it runs, change the soil probe values in the Inspector.', 'أثناء التشغيل غيّر قيم مجس التربة من نافذة الخصائص.'],
      modify: ['Read the NPK registers (4–6) too.', 'اقرأ سجلات NPK (من 4 إلى 6) أيضاً.'],
      explain: ['RS-485 is a differential pair (A/B) for long cables; Modbus frames carry a slave address, function 3 and a CRC that minimalmodbus checks.', 'RS-485 زوج تفاضلي (A وB) للكابلات الطويلة، وتحمل إطارات Modbus عنوان الجهاز والوظيفة 3 ورمز CRC تتحقق منه minimalmodbus.'],
      code: `import time
import minimalmodbus

probe = minimalmodbus.Instrument("/dev/serial0", 1)   # slave address 1
probe.serial.baudrate = 9600
probe.serial.timeout = 0.3
while True:                      # runs until you press Stop
    moisture, temperature, ec, ph = probe.read_registers(0, 4)
    print(f"moisture {moisture / 10:.1f} %  temperature {temperature / 10:.1f} °C  EC {ec} µS/cm  pH {ph / 10:.1f}")
    time.sleep(2)
`,
      test: { expect: /moisture 32\.0 %\s+temperature 22\.0 °C\s+EC 800 µS\/cm\s+pH 6\.5[\s\S]*moisture 45\.0 %/, seconds: 3, events: [{ at: 1, comp: 'soil', props: { moisture: 45 } }] },
    },
    (c) =>
      c
        .supply()
        .part('xcvr', 'max485', { auto: true }, 'MAX485')
        .part('soil', 'rs485_soil', {}, 'Soil probe')
        .w(`xcvr.VCC>${c.v33()}`, `xcvr.GND>${c.gnd()}`, 'xcvr.TX>pi.P10', 'xcvr.RX>pi.P8', 'xcvr.A>soil.A', 'xcvr.B>soil.B', 'soil.VCC>ps.P', 'soil.GND>ps.N'),
  ),
  ex(
    {
      id: 'comms-pcf8574-io',
      cat: 'comms',
      level: 'intermediate',
      minutes: 20,
      title: ['More I/O with a PCF8574 expander', 'مداخل ومخارج إضافية بموسّع PCF8574'],
      goal: ['Drive LEDs and read a button through an I2C port expander.', 'تشغيل LEDs وقراءة زر عبر موسّع منافذ I2C.'],
      result: ['A light runs along the four LEDs on the expander while the button on P7 is read in the same loop; each press is printed. It runs until you press Stop.', 'يتحرك ضوء على الـ LEDs الأربعة في الموسّع بينما يُقرأ الزر على P7 في الحلقة نفسها، وتُطبع كل ضغطة، ويستمر حتى تضغط إيقاف.'],
      tryIt: ['Press the button while the pattern runs.', 'اضغط الزر أثناء تشغيل النمط.'],
      modify: ['Use the button to reverse the direction of the pattern.', 'استخدم الزر لعكس اتجاه النمط.'],
      explain: ['PCF8574 pins can only sink current well, so the LEDs are wired from 3.3 V to the pin (LOW = on). Writing 1 to P7 makes it an input.', 'تسحب أطراف PCF8574 التيار بكفاءة فقط، لذا توصل الـ LEDs من 3.3 فولت إلى الطرف (المستوى المنخفض = تشغيل). كتابة 1 في P7 تجعله مدخلاً.'],
      code: `from smbus2 import SMBus
from time import sleep

bus = SMBus(1)
ADDR = 0x20
seen = False
step = 0
while True:                      # runs until you press Stop
    leds = ~(1 << (step % 4)) & 0x0F       # one LED on (LOW)
    bus.write_byte(ADDR, 0x80 | 0x70 | leds)   # P7 stays HIGH = input
    pressed = not (bus.read_byte(ADDR) & 0x80)
    if pressed and not seen:
        print("button on P7 pressed at step", step)
    seen = pressed
    step += 1
    sleep(0.3)
`,
      test: { expect: /button on P7 pressed at step [3-5]/, seconds: 3, events: [{ at: 1.2, comp: 'btn', press: true }] },
    },
    (c) => {
      c.i2c('pcf', 'pcf8574', {}, 'PCF8574');
      for (let i = 0; i < 4; i++) c.part(`r${i}`, 'resistor', { ohms: 330 }).part(`l${i}`, 'led', { color: 'green' }).w(`r${i}.1>${c.v33()}`, `r${i}.2>l${i}.A`, `l${i}.K>pcf.P${i}`);
      c.part('btn', 'button', {}, 'Button').w('btn.1a>pcf.P7', `btn.2a>${c.gnd()}`);
    },
  ),
  ex(
    {
      id: 'comms-mcp23017-bargraph',
      cat: 'comms',
      level: 'intermediate',
      minutes: 20,
      title: ['MCP23017 bar graph and input', 'مخطط شريطي ومدخل بموسّع MCP23017'],
      goal: ['Use pins of a 16-bit I2C expander as outputs and an input with pull-up.', 'استخدام أطراف موسّع I2C ذي 16 بتاً كمخارج ومدخل مع مقاومة رفع.'],
      result: ['The bar fills LED by LED; the button clears it and it fills again, until you press Stop.', 'يمتلئ الشريط LED بعد LED، والزر يمسحه ثم يمتلئ من جديد، حتى تضغط إيقاف.'],
      tryIt: ['Press the button after the bar is full.', 'اضغط الزر بعد امتلاء الشريط.'],
      modify: ['Use all eight GPA pins for an 8-step bar.', 'استخدم أطراف GPA الثمانية لشريط من 8 خطوات.'],
      explain: ['get_pin(n) returns a digitalio-style pin; pins 0–7 are GPA0–7 and 8–15 are GPB0–7. The internal pull-up keeps the input HIGH until the button pulls it LOW.', 'تعيد get_pin(n) طرفاً بأسلوب digitalio؛ الأطراف 0–7 هي GPA0–7 و8–15 هي GPB0–7. تُبقي مقاومة الرفع الداخلية المدخل مرتفعاً حتى يسحبه الزر إلى الأرضي.'],
      code: `import time
import board, busio, digitalio
from adafruit_mcp230xx.mcp23017 import MCP23017

mcp = MCP23017(busio.I2C(board.SCL, board.SDA))
leds = [mcp.get_pin(i) for i in range(4)]
for led in leds:
    led.switch_to_output(value=False)
button = mcp.get_pin(8)                      # GPB0
button.switch_to_input(pull=digitalio.Pull.UP)
while True:                                  # runs until you press Stop
    for led in leds:
        led.value = True
        time.sleep(0.3)
    print("bar full")
    while button.value:                      # HIGH = not pressed
        time.sleep(0.05)
    for led in leds:
        led.value = False
    print("cleared by button")
    while not button.value:                  # wait for the release
        time.sleep(0.05)
    time.sleep(0.5)
`,
      test: { expect: /bar full[\s\S]*cleared by button/, seconds: 5, events: [{ at: 2, comp: 'btn', press: true }], verify: (s) => check(['l0', 'l1', 'l2', 'l3'].every((id) => !lit(s, id)), 'LEDs cleared') },
    },
    (c) => {
      c.part('mcp', 'mcp23017', {}, 'MCP23017').w(`mcp.VDD>${c.v33()}`, `mcp.VSS>${c.gnd()}`, 'mcp.SDA>pi.P3', 'mcp.SCL>pi.P5');
      for (let i = 0; i < 4; i++) c.part(`r${i}`, 'resistor', { ohms: 330 }).part(`l${i}`, 'led', { color: 'blue' }).w(`mcp.GPA${i}>r${i}.1`, `r${i}.2>l${i}.A`, `l${i}.K>${c.gnd()}`);
      c.part('btn', 'button', {}, 'Clear').w('btn.1a>mcp.GPB0', `btn.2a>${c.gnd()}`);
    },
  ),
];
