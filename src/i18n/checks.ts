// "How to check it on the real circuit" hints for electrical problems, by issue-code pattern.
// First match wins; every hint describes a measurement or inspection, never an automatic fix.
export const CHECK_HINTS: [RegExp, { en: string; ar: string }][] = [
  [/SHORT|RAILS_SHORTED|SHORTED_PART/, { en: 'Power off. With a multimeter in continuity mode, check that the two highlighted nets do not beep; follow the wires listed above to find the bridge.', ar: 'افصل التغذية. بجهاز القياس على وضع الاستمرارية تأكد أن الشبكتين المميزتين لا تصدران صفيراً، وتتبّع الأسلاك المذكورة أعلاه لإيجاد موضع القصر.' }],
  [/OVERVOLTAGE|TO_5V|EXTERNAL_SUPPLY|ECHO_5V|MCP_DOUT_5V|NEGATIVE/, { en: 'Before connecting the Pi, measure the highlighted signal against GND: it must never exceed 3.3 V. Use a divider or level shifter for 5 V outputs.', ar: 'قبل توصيل Pi قِس الإشارة المميزة بالنسبة إلى GND: يجب ألا تتجاوز 3.3 فولت أبداً. استخدم مقسّم جهد أو محوّل مستويات لمخارج 5 فولت.' }],
  [/OVERCURRENT|BURNED|OVERLOAD|RAIL_BUDGET|NO_RESISTOR|RESISTOR_POWER|DRIVES_LOAD/, { en: 'Check the series resistor / driver between the pin and the load and compare the current with the part rating (Ohm’s law: I = V / R).', ar: 'تحقق من المقاومة أو دائرة القيادة بين الطرف والحمل وقارن التيار مع تصنيف القطعة (قانون أوم: I = V / R).' }],
  [/GROUND|MISSING_GROUND/, { en: 'Measure continuity between the module GND and a Pi GND pin; every supply and module must share one ground.', ar: 'قِس الاستمرارية بين GND الوحدة وطرف GND في Pi؛ يجب أن تشترك كل المصادر والوحدات في أرضي واحد.' }],
  [/PULLUP|FLOATING|IN_FLOATING/, { en: 'With the program stopped, measure the pin: it should rest at a defined level (3.3 V with a pull-up, 0 V with a pull-down). Add the resistor or enable the internal pull.', ar: 'والبرنامج متوقف قِس الطرف: يجب أن يستقر على مستوى محدد (3.3 فولت مع مقاومة رفع و0 فولت مع مقاومة خفض). أضف المقاومة أو فعّل المقاومة الداخلية.' }],
  [/I2C/, { en: 'On the Pi run i2cdetect -y 1 and check that the device address appears; SDA goes to GPIO2 (pin 3) and SCL to GPIO3 (pin 5).', ar: 'نفّذ على Pi الأمر i2cdetect -y 1 وتحقق من ظهور عنوان الجهاز؛ SDA إلى GPIO2 (الطرف 3) وSCL إلى GPIO3 (الطرف 5).' }],
  [/UART/, { en: 'TX of one side must go to RX of the other. Check the port name and baud rate in the code match the device.', ar: 'يجب أن يذهب TX لكل طرف إلى RX للطرف الآخر. تحقق من تطابق اسم المنفذ وسرعة النقل في الكود مع الجهاز.' }],
  [/SPI/, { en: 'Check MOSI→DIN, MISO←DOUT, SCLK→CLK and the chip-select pin used in the code (CE0 = GPIO8, CE1 = GPIO7).', ar: 'تحقق من MOSI←DIN وMISO→DOUT وSCLK→CLK وطرف اختيار الشريحة المستخدم في الكود (CE0 = GPIO8 وCE1 = GPIO7).' }],
  [/ONEWIRE/, { en: 'Enable dtoverlay=w1-gpio, wire DQ to GPIO4 with a 4.7 kΩ pull-up to 3.3 V, then list /sys/bus/w1/devices.', ar: 'فعّل dtoverlay=w1-gpio وصِل DQ بـ GPIO4 مع مقاومة رفع 4.7 كيلو أوم إلى 3.3 فولت، ثم اعرض محتوى ‎/sys/bus/w1/devices‎.' }],
  [/CODE_PIN|NOT_IN_CODE|UNCONNECTED|DHT_TYPE/, { en: 'Compare the GPIO number in the code with the wire in the wiring table (BCM numbers, not physical pin numbers).', ar: 'قارن رقم GPIO في الكود مع السلك في جدول التوصيلات (أرقام BCM وليست أرقام الأطراف الفيزيائية).' }],
  [/REVERSED|POLARITY|CAP_/, { en: 'Check the orientation: anode/+ towards the positive side, cathode/− (flat side, short leg, stripe) towards GND.', ar: 'تحقق من الاتجاه: المصعد/+ نحو الجهة الموجبة، والمهبط/− (الجهة المسطحة، الساق القصيرة، الشريط) نحو GND.' }],
  [/FLYBACK/, { en: 'Check that a diode (e.g. 1N4007) sits across the coil/motor with its stripe towards the positive supply.', ar: 'تحقق من وجود ثنائي (مثل 1N4007) على طرفي الملف أو المحرك وشريطه نحو التغذية الموجبة.' }],
  [/UNPOWERED|UNDERVOLTAGE|UNDERPOWERED|DROPOUT|NO_VREF|RESET|STANDBY/, { en: 'Measure the supply pin of the part against GND; it must be within the voltage given in the part description.', ar: 'قِس طرف تغذية القطعة بالنسبة إلى GND؛ يجب أن يكون ضمن الجهد المذكور في وصف القطعة.' }],
];

export function checkHint(code: string, lang: 'en' | 'ar'): string {
  const h = CHECK_HINTS.find(([re]) => re.test(code))?.[1];
  return h ? h[lang] : lang === 'ar' ? 'قارن التوصيلات المميزة مع جدول التوصيلات، ثم قِس الجهود بجهاز القياس قبل تشغيل البرنامج.' : 'Compare the highlighted connections with the wiring table, then measure the voltages with a multimeter before running the program.';
}
