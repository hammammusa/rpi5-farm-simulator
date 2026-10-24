// Educational explanations for electrical issues, farm alarms and Python errors (EN / AR).
type Entry = { title: string; explain: string };
type Bi = { en: Entry; ar: Entry };

export const ISSUE_TEXT: Record<string, Bi> = {
  E_SHORT_RAIL: {
    en: { title: 'Short circuit on the {rail} rail', explain: 'About {amps} A would flow from the Pi’s {rail} pin to GND. A real Pi would brown-out/reset or be damaged. The simulator switched the rail off. Look for a wire or part connecting {rail} directly to GND.' },
    ar: { title: 'قصر كهربائي على خط {rail}', explain: 'سيمر تيار يقارب {amps} أمبير من طرف {rail} إلى الأرضي GND. في الجهاز الحقيقي سيعيد Pi التشغيل أو يتلف. قام المحاكي بفصل هذا الخط. ابحث عن سلك أو قطعة تصل {rail} بالأرضي مباشرة.' },
  },
  E_RAILS_SHORTED: {
    en: { title: '3.3 V and 5 V rails connected together', explain: 'The 3.3 V and 5 V header pins are wired to the same net. This forces 5 V into the 3.3 V regulator and every 3.3 V device — never connect different supply rails.' },
    ar: { title: 'خط 3.3V موصول مع خط 5V', explain: 'أطراف 3.3V و5V موصولة بنفس العقدة، وهذا يدفع 5V إلى منظم 3.3V وإلى كل قطع 3.3V. لا تصل خطوط تغذية مختلفة ببعضها.' },
  },
  W_RAIL_BUDGET: {
    en: { title: '{rail} rail heavily loaded ({ma} mA)', explain: 'Parts draw {ma} mA from the Pi’s {rail} pin; keep it below about {limit} mA. Power motors, pumps and long LED strips from an external supply.' },
    ar: { title: 'حمل كبير على خط {rail} ({ma} مللي أمبير)', explain: 'القطع تسحب {ma} مللي أمبير من طرف {rail}. أبقِ السحب أقل من {limit} مللي أمبير تقريباً، وغذِّ المحركات والمضخات من مصدر خارجي.' },
  },
  E_GPIO_OVERVOLTAGE: {
    en: { title: 'Over-voltage on GPIO{pin} ({v} V)', explain: 'Raspberry Pi GPIO pins are 3.3 V logic and are NOT 5 V tolerant. GPIO{pin} (pin {phys}) sees {v} V, which can permanently damage the RP1 I/O chip. Use a voltage divider, level shifter or optocoupler, or power the sensor from 3.3 V.' },
    ar: { title: 'جهد زائد على GPIO{pin} ({v} فولت)', explain: 'أطراف GPIO في Raspberry Pi تعمل بمنطق 3.3V ولا تتحمل 5V. الطرف GPIO{pin} (رقم {phys}) يستقبل {v} فولت، وهذا قد يتلف شريحة RP1 نهائياً. استخدم مقسم جهد أو محول مستوى أو عازلاً ضوئياً، أو غذِّ الحساس من 3.3V.' },
  },
  E_GPIO_NEGATIVE: {
    en: { title: 'Negative voltage on GPIO{pin}', explain: 'GPIO{pin} is pulled to {v} V below ground. Check polarity of external supplies and their ground connection.' },
    ar: { title: 'جهد سالب على GPIO{pin}', explain: 'الطرف GPIO{pin} عند {v} فولت أقل من الأرضي. تحقق من قطبية المصادر الخارجية وتوصيل الأرضي.' },
  },
  E_GPIO_SHORT: {
    en: { title: 'GPIO{pin} output short-circuited ({ma} mA)', explain: 'GPIO{pin} drives a near-zero resistance (e.g. directly to GND or to another output). A GPIO can only safely source/sink about 16 mA. Add a resistor or remove the short.' },
    ar: { title: 'قصر على مخرج GPIO{pin} ({ma} مللي أمبير)', explain: 'المخرج GPIO{pin} موصول بمقاومة شبه صفرية (مثلاً بالأرضي مباشرة). يتحمل طرف GPIO نحو 16 مللي أمبير فقط. أضف مقاومة أو أزل القصر.' },
  },
  W_GPIO_OVERCURRENT: {
    en: { title: 'GPIO{pin} current too high ({ma} mA)', explain: 'GPIO{pin} supplies {ma} mA; the recommended maximum per pin is {limit} mA. Increase the series resistor (e.g. 330 Ω for an LED) or use a transistor/MOSFET.' },
    ar: { title: 'تيار GPIO{pin} مرتفع ({ma} مللي أمبير)', explain: 'الطرف GPIO{pin} يعطي {ma} مللي أمبير والحد الموصى به {limit} مللي أمبير. زد قيمة المقاومة (مثلاً 330 أوم للـ LED) أو استخدم ترانزستوراً/موسفت.' },
  },
  E_LED_BURNED: {
    en: { title: 'LED burned out', explain: 'More than 60 mA flowed through the LED and it is destroyed (reset the simulation to replace it). Always put a current-limiting resistor (220–330 Ω at 3.3 V) in series with an LED.' },
    ar: { title: 'احترق الـ LED', explain: 'مر أكثر من 60 مللي أمبير في الـ LED فاحترق (أعد ضبط المحاكاة لاستبداله). ضع دائماً مقاومة تحديد تيار (220–330 أوم عند 3.3V) على التوالي مع الـ LED.' },
  },
  W_LED_NO_RESISTOR: {
    en: { title: 'LED current too high ({ma} mA) — missing resistor?', explain: 'An LED needs a series resistor: R = (Vsupply − Vf) / I. For a red LED on 3.3 V at ~5 mA: (3.3 − 1.9) / 0.005 ≈ 280 Ω → use 330 Ω.' },
    ar: { title: 'تيار الـ LED مرتفع ({ma} مللي أمبير) — هل نسيت المقاومة؟', explain: 'يحتاج الـ LED إلى مقاومة على التوالي: R = (Vمصدر − Vf) / I. لـ LED أحمر على 3.3V بتيار 5 مللي أمبير تقريباً: (3.3 − 1.9) / 0.005 ≈ 280 أوم ← استخدم 330 أوم.' },
  },
  W_LED_REVERSED: {
    en: { title: 'LED connected backwards', explain: 'The cathode (−, short leg, flat side) is {v} V higher than the anode, so the LED is reverse-biased and stays dark. Swap its legs: anode (+) towards the GPIO/supply, cathode towards GND.' },
    ar: { title: 'الـ LED موصول بالعكس', explain: 'المهبط (−، الساق القصيرة) أعلى من المصعد بمقدار {v} فولت، لذلك لا يضيء. اعكس الساقين: المصعد (+) نحو GPIO أو المصدر، والمهبط نحو GND.' },
  },
  W_OPEN_CIRCUIT: {
    en: { title: 'Open circuit — no current path', explain: 'The {side} side of this LED does not reach the rest of the circuit, so no current can flow. A circuit must be a closed loop: GPIO → resistor → LED → GND. Check the ground wire and breadboard columns.' },
    ar: { title: 'دائرة مفتوحة — لا يوجد مسار للتيار', explain: 'الجهة {side} من هذا الـ LED غير موصولة بباقي الدائرة، فلا يمر تيار. يجب أن تكون الدائرة حلقة مغلقة: GPIO ← مقاومة ← LED ← GND. تحقق من سلك الأرضي وأعمدة لوحة التجارب.' },
  },
  W_RESISTOR_POWER: {
    en: { title: 'Resistor overheating ({w} W)', explain: 'This resistor dissipates {w} W; standard resistors are rated 0.25 W. Use a higher value or a power resistor.' },
    ar: { title: 'المقاومة تسخن ({w} واط)', explain: 'تبدد هذه المقاومة {w} واط والمقاومات العادية مقننة 0.25 واط. استخدم قيمة أكبر أو مقاومة قدرة.' },
  },
  W_CAP_REVERSED: {
    en: { title: 'Electrolytic capacitor reversed', explain: 'The − lead is {v} V above the + lead. Reversed electrolytic capacitors can bulge or explode.' },
    ar: { title: 'المكثف الإلكتروليتي معكوس', explain: 'الطرف السالب أعلى من الموجب بـ {v} فولت. المكثفات الإلكتروليتية المعكوسة قد تنتفخ أو تنفجر.' },
  },
  E_CAP_OVERVOLTAGE: {
    en: { title: 'Capacitor over its rated voltage', explain: '{v} V across a capacitor rated {max} V.' },
    ar: { title: 'جهد المكثف أعلى من المقنن', explain: '{v} فولت على مكثف مقنن {max} فولت.' },
  },
  W_POLARITY: {
    en: { title: 'Reversed polarity', explain: 'The − terminal is {v} V above +. Brushless fans, pumps, LED lights and buzzers do not run reversed. Swap the + and − wires.' },
    ar: { title: 'قطبية معكوسة', explain: 'الطرف السالب أعلى من الموجب بـ {v} فولت. المراوح والمضخات اللاكهربية وأضواء LED والجرس لا تعمل بقطبية معكوسة. بدِّل سلكي + و −.' },
  },
  E_DIODE_OVERCURRENT: {
    en: { title: 'Diode overloaded ({a} A)', explain: 'A 1N4007 is rated 1 A continuous.' },
    ar: { title: 'حمل زائد على الديود ({a} أمبير)', explain: 'الديود 1N4007 مقنن بـ 1 أمبير.' },
  },
  E_TRANSISTOR_OVERCURRENT: {
    en: { title: 'Transistor collector current {a} A > {max} A', explain: 'The 2N2222 is rated 600 mA. Use a logic-level MOSFET or relay for pumps and heaters.' },
    ar: { title: 'تيار المجمع {a} أمبير أكبر من {max}', explain: 'الترانزستور 2N2222 مقنن 600 مللي أمبير. استخدم موسفت منطقي أو مرحلاً للمضخات والسخانات.' },
  },
  W_BASE_NO_RESISTOR: {
    en: { title: 'Base current too high ({ma} mA)', explain: 'Put a 1 kΩ resistor between the GPIO and the transistor base.' },
    ar: { title: 'تيار القاعدة مرتفع ({ma} مللي أمبير)', explain: 'ضع مقاومة 1 كيلو أوم بين GPIO وقاعدة الترانزستور.' },
  },
  W_GATE_FLOATING: {
    en: { title: 'MOSFET gate not connected', explain: 'A floating gate can switch the MOSFET on randomly. Connect it to a GPIO through ~100 Ω and add a 10 kΩ pull-down to GND.' },
    ar: { title: 'بوابة الموسفت غير موصولة', explain: 'البوابة العائمة قد تشغّل الموسفت عشوائياً. صلها بطرف GPIO عبر 100 أوم تقريباً وأضف مقاومة 10 كيلو أوم إلى GND.' },
  },
  W_MOSFET_NOT_LOGIC: {
    en: { title: 'MOSFET not fully on at {v} V gate drive', explain: 'The IRF540N needs about 10 V on its gate. With 3.3 V from a GPIO it barely conducts and overheats. Use a logic-level MOSFET such as IRLZ44N.' },
    ar: { title: 'الموسفت لا يفتح بالكامل بجهد بوابة {v} فولت', explain: 'يحتاج IRF540N إلى 10 فولت تقريباً على البوابة. مع 3.3V من GPIO لا يوصل جيداً ويسخن. استخدم موسفت منطقياً مثل IRLZ44N.' },
  },
  E_SUPPLY_OVERLOAD: {
    en: { title: 'Power supply overloaded ({a} A > {max} A)', explain: 'The supply entered short-circuit protection and switched off. Look for a short between + and − or reduce the load.' },
    ar: { title: 'حمل زائد على مصدر التغذية ({a} > {max} أمبير)', explain: 'دخل المصدر في وضع الحماية وانطفأ. ابحث عن قصر بين + و − أو خفّف الحمل.' },
  },
  E_LOAD_OVERVOLTAGE: {
    en: { title: 'Load over-voltage: {v} V on a {rated} V device', explain: 'The device burned out. Check the supply voltage matches the device rating.' },
    ar: { title: 'جهد زائد: {v} فولت على جهاز {rated} فولت', explain: 'احترق الجهاز. تأكد أن جهد المصدر يطابق جهد الجهاز.' },
  },
  E_LOAD_BURNED: {
    en: { title: 'Device burned out', explain: 'This actuator was destroyed by over-voltage. Fix the supply and reset the simulation.' },
    ar: { title: 'الجهاز محترق', explain: 'تلف هذا المشغّل بسبب الجهد الزائد. أصلح المصدر ثم أعد ضبط المحاكاة.' },
  },
  E_GPIO_DRIVES_LOAD: {
    en: { title: 'GPIO{pin} wired directly to a motor/pump/heater', explain: 'A GPIO pin gives 3.3 V and about 16 mA — this {rated} V, {w} W device needs far more. Switch it with a relay module or a logic-level MOSFET powered from an external supply.' },
    ar: { title: 'GPIO{pin} موصول مباشرة بمحرك/مضخة/سخان', explain: 'يعطي طرف GPIO جهد 3.3V وتياراً قرابة 16 مللي أمبير فقط، وهذا الجهاز ({rated} فولت، {w} واط) يحتاج أكثر بكثير. شغّله عبر وحدة مرحل أو موسفت منطقي مع مصدر خارجي.' },
  },
  W_LOAD_UNDERVOLTAGE: {
    en: { title: 'Device under-powered ({v} V of {rated} V)', explain: 'The actuator gets too little voltage to start. Check supply voltage, relay contacts and wiring.' },
    ar: { title: 'تغذية غير كافية ({v} من {rated} فولت)', explain: 'الجهد غير كافٍ لتشغيل المشغّل. تحقق من جهد المصدر وتلامسات المرحل والأسلاك.' },
  },
  I_RELAY_IN_FLOATING: {
    en: { title: 'Relay input IN{ch} not connected', explain: 'Connect IN{ch} to a GPIO. On active-LOW boards an unconnected input means OFF.' },
    ar: { title: 'مدخل المرحل IN{ch} غير موصول', explain: 'صل IN{ch} بطرف GPIO. في الوحدات النشطة بالمنخفض يعني المدخل غير الموصول: إطفاء.' },
  },
  E_RELAY_CONTACT_OVERLOAD: {
    en: { title: 'Relay contact overloaded ({a} A)', explain: 'Typical relay modules are rated 10 A.' },
    ar: { title: 'حمل زائد على تلامس المرحل ({a} أمبير)', explain: 'وحدات المرحل الشائعة مقننة 10 أمبير.' },
  },
  W_RELAY_UNDERPOWERED: {
    en: { title: 'Relay module under-powered ({v} V for {coil} V coil)', explain: 'The coil needs about {coil} V on VCC to pull in. A 5 V relay board must be powered from the Pi’s 5 V pin (or an external 5 V supply), not 3.3 V.' },
    ar: { title: 'وحدة المرحل بتغذية غير كافية ({v} فولت لملف {coil} فولت)', explain: 'يحتاج الملف إلى {coil} فولت تقريباً على VCC. وحدة مرحل 5V يجب تغذيتها من طرف 5V وليس 3.3V.' },
  },
  E_RELAY_OVERVOLTAGE: {
    en: { title: 'Relay module over-voltage ({v} V on {coil} V coil)', explain: 'The coil will overheat.' },
    ar: { title: 'جهد زائد على المرحل ({v} فولت لملف {coil})', explain: 'سيسخن الملف ويتلف.' },
  },
  W_MISSING_GROUND: {
    en: { title: 'Missing ground (GND) connection', explain: 'This part has power but its GND pin is not connected, so no current can return and it will not work. Every circuit needs a return path to GND.' },
    ar: { title: 'سلك الأرضي GND مفقود', explain: 'القطعة موصولة بالتغذية لكن طرف GND غير موصول، فلا يعود التيار ولن تعمل. كل دائرة تحتاج مسار عودة إلى GND.' },
  },
  W_SERVO_FREQ: {
    en: { title: 'Servo PWM at {hz} Hz', explain: 'Hobby servos expect 50 Hz (20 ms frames).' },
    ar: { title: 'تردد PWM للسيرفو {hz} هرتز', explain: 'محركات السيرفو تتوقع 50 هرتز.' },
  },
  W_UNPOWERED: {
    en: { title: 'Part not powered ({v} V, needs ≥ {min} V)', explain: 'Connect VCC to the correct supply pin (3.3 V or 5 V as required) and GND to GND.' },
    ar: { title: 'القطعة بدون تغذية ({v} فولت، تحتاج {min} فولت على الأقل)', explain: 'صل VCC بطرف التغذية المناسب (3.3V أو 5V) وصل GND بالأرضي.' },
  },
  E_DEVICE_OVERVOLTAGE: {
    en: { title: 'Device over-voltage ({v} V > {max} V)', explain: 'The part is powered above its maximum rating and is now damaged. 3.3 V-only modules must not be connected to 5 V.' },
    ar: { title: 'جهد زائد على القطعة ({v} > {max} فولت)', explain: 'القطعة مغذاة بجهد أعلى من الحد الأقصى وتلفت. وحدات 3.3V لا توصل بـ 5V.' },
  },
  E_ANALOG_NO_ADC: {
    en: { title: 'Analog sensor wired to GPIO{pin} — the Pi 5 has no ADC', explain: 'Raspberry Pi GPIO pins are digital only (HIGH/LOW). Analog sensors (pH, EC, soil moisture, potentiometers) must go through an analog-to-digital converter such as the MCP3008 (SPI). Wire AO → MCP3008 CH0 and read it with gpiozero.MCP3008.' },
    ar: { title: 'حساس تناظري موصول بـ GPIO{pin} — لا يوجد ADC في Pi 5', explain: 'أطراف GPIO رقمية فقط (عالي/منخفض). الحساسات التناظرية (pH، EC، رطوبة التربة، المقاومة المتغيرة) تحتاج محول تناظري-رقمي مثل MCP3008 عبر SPI. صل AO إلى CH0 في MCP3008 واقرأه باستخدام gpiozero.MCP3008.' },
  },
  W_SENSOR_DISCONNECTED: {
    en: { title: 'Sensor output {pin} not connected', explain: 'The sensor is powered but its signal pin goes nowhere, so your program cannot read it.' },
    ar: { title: 'مخرج الحساس {pin} غير موصول', explain: 'الحساس مغذى لكن طرف الإشارة غير موصول، فلن يستطيع برنامجك قراءته.' },
  },
  E_MCP_DOUT_5V: {
    en: { title: 'MCP3008 powered at {v} V drives 5 V into MISO', explain: 'With VDD at 5 V the DOUT pin swings to 5 V and over-volts GPIO9. Power VDD/VREF from 3.3 V.' },
    ar: { title: 'MCP3008 بتغذية {v} فولت يرسل 5V إلى MISO', explain: 'عند تغذية VDD بـ 5V يصل DOUT إلى 5V ويضر GPIO9. غذِّ VDD وVREF من 3.3V.' },
  },
  W_MCP_NO_VREF: {
    en: { title: 'MCP3008 VREF not connected', explain: 'VREF sets the full-scale voltage. Connect it to 3.3 V.' },
    ar: { title: 'طرف VREF في MCP3008 غير موصول', explain: 'يحدد VREF جهد المقياس الكامل. صله بـ 3.3V.' },
  },
  W_MULTIPLE_PI: {
    en: { title: 'More than one Raspberry Pi', explain: 'Only the first Raspberry Pi runs your program.' },
    ar: { title: 'أكثر من Raspberry Pi', explain: 'فقط أول Raspberry Pi يشغّل برنامجك.' },
  },
  E_GPIO_TO_5V: {
    en: { title: 'GPIO{pin} wired to 5 V', explain: 'Pin {phys} is connected to a 5 V pin. GPIOs are 3.3 V only — this can destroy the pin.' },
    ar: { title: 'GPIO{pin} موصول بـ 5V', explain: 'الطرف {phys} موصول بطرف 5V. أطراف GPIO تعمل بـ 3.3V فقط وقد يتلف الطرف.' },
  },
  E_GPIO_EXTERNAL_SUPPLY: {
    en: { title: '{v} V supply connected directly to GPIO{pin}', explain: 'Never connect an external supply to a GPIO. To control a {v} V load use a relay or MOSFET; to read a {v} V signal use a divider or optocoupler.' },
    ar: { title: 'مصدر {v} فولت موصول مباشرة بـ GPIO{pin}', explain: 'لا توصل مصدراً خارجياً بطرف GPIO أبداً. للتحكم بحمل {v} فولت استخدم مرحلاً أو موسفت، ولقراءة إشارة {v} فولت استخدم مقسم جهد أو عازلاً ضوئياً.' },
  },
  W_SHORTED_PART: {
    en: { title: 'Both legs in the same breadboard column', explain: 'The two leads are in one connected strip, so the part is bypassed. Rotate it or move one leg to another column.' },
    ar: { title: 'الساقان في نفس عمود لوحة التجارب', explain: 'الطرفان في شريط موصول واحد، فالقطعة مقصورة. أدرها أو انقل أحد الطرفين إلى عمود آخر.' },
  },
  E_UART_TX_TX: {
    en: { title: 'UART TX connected to TX', explain: 'Serial lines must cross: device TX → Pi RX (GPIO15) and device RX → Pi TX (GPIO14). Two transmitters fight on the same wire and nothing is received.' },
    ar: { title: 'TX موصول مع TX في UART', explain: 'يجب أن تتقاطع خطوط التسلسل: TX الجهاز ← RX في Pi (GPIO15)، وRX الجهاز ← TX في Pi (GPIO14). مرسلان على نفس السلك يعني عدم استقبال شيء.' },
  },
  E_UART_RX_RX: {
    en: { title: 'UART RX connected to RX', explain: 'Connect device RX to Pi TX (GPIO14) instead.' },
    ar: { title: 'RX موصول مع RX في UART', explain: 'صل RX الجهاز بطرف TX في Pi (GPIO14).' },
  },
  E_I2C_SWAPPED: {
    en: { title: 'SDA and SCL swapped', explain: 'SDA → GPIO2 (pin 3), SCL → GPIO3 (pin 5).' },
    ar: { title: 'SDA وSCL معكوسان', explain: 'SDA ← GPIO2 (الطرف 3)، وSCL ← GPIO3 (الطرف 5).' },
  },
  W_I2C_WRONG_PINS: {
    en: { title: 'I2C device on GPIO {pins}', explain: 'The header I2C bus 1 is GPIO2 (SDA) and GPIO3 (SCL).' },
    ar: { title: 'جهاز I2C على GPIO {pins}', explain: 'ناقل I2C رقم 1 هو GPIO2 (SDA) وGPIO3 (SCL).' },
  },
  E_SPI_SWAPPED: {
    en: { title: 'MCP3008 DIN/DOUT swapped', explain: 'DIN ← MOSI (GPIO10, pin 19), DOUT → MISO (GPIO9, pin 21).' },
    ar: { title: 'DIN وDOUT معكوسان في MCP3008', explain: 'DIN ← MOSI (GPIO10، الطرف 19)، DOUT ← MISO (GPIO9، الطرف 21).' },
  },
  W_SPI_CS: {
    en: { title: 'MCP3008 CS not on CE0/CE1', explain: 'Connect CS to GPIO8 (CE0, pin 24) for spidev0.0 or GPIO7 (CE1, pin 26) for spidev0.1.' },
    ar: { title: 'CS في MCP3008 ليس على CE0/CE1', explain: 'صل CS بـ GPIO8 (CE0، الطرف 24) أو GPIO7 (CE1، الطرف 26).' },
  },
  I_ONEWIRE_DISABLED: {
    en: { title: '1-Wire interface disabled', explain: 'Enable 1-Wire on the Pi (Inspector → "1-Wire", like dtoverlay=w1-gpio in config.txt) to read the DS18B20.' },
    ar: { title: 'واجهة 1-Wire معطلة', explain: 'فعّل 1-Wire في خصائص Pi (مثل dtoverlay=w1-gpio في config.txt) لقراءة DS18B20.' },
  },
  W_ONEWIRE_PIN: {
    en: { title: 'DS18B20 not on GPIO4', explain: 'The default 1-Wire bus pin is GPIO4 (pin 7).' },
    ar: { title: 'DS18B20 ليس على GPIO4', explain: 'طرف ناقل 1-Wire الافتراضي هو GPIO4 (الطرف 7).' },
  },
  W_ONEWIRE_PULLUP: {
    en: { title: 'DS18B20 missing 4.7 kΩ pull-up', explain: '1-Wire needs a 4.7 kΩ resistor from DQ to 3.3 V. Without it the sensor is not detected.' },
    ar: { title: 'مقاومة الرفع 4.7 كيلو أوم مفقودة لـ DS18B20', explain: 'يحتاج 1-Wire مقاومة 4.7 كيلو أوم من DQ إلى 3.3V، وبدونها لا يُكتشف الحساس.' },
  },
  W_DHT_PULLUP: {
    en: { title: 'DHT22 data line needs a pull-up', explain: 'Bare DHT22 sensors need a 10 kΩ resistor from DATA to VCC.' },
    ar: { title: 'خط بيانات DHT22 يحتاج مقاومة رفع', explain: 'حساس DHT22 بدون وحدة يحتاج مقاومة 10 كيلو أوم من DATA إلى VCC.' },
  },
  W_NO_COMMON_GROUND: {
    en: { title: 'No common ground with the Pi', explain: 'Signals are measured relative to GND. When a device (or a MOSFET’s source / external supply) talks to the Pi, their grounds must be connected together.' },
    ar: { title: 'لا يوجد أرضي مشترك مع Pi', explain: 'تُقاس الإشارات بالنسبة للأرضي. عندما يتواصل جهاز (أو مصدر خارجي) مع Pi يجب توصيل الأرضيين معاً.' },
  },
  W_NO_FLYBACK: {
    en: { title: 'Inductive load without flyback diode', explain: 'Motors, pumps and solenoids produce a voltage spike when switched off that can destroy a transistor/MOSFET. Put a 1N4007 across the load: stripe (cathode) to +, anode to −.' },
    ar: { title: 'حمل حثي بدون ديود حماية', explain: 'المحركات والمضخات والصمامات تولد نبضة جهد عند الإطفاء قد تتلف الموسفت. ضع ديود 1N4007 على الحمل: الشريط (المهبط) إلى + والمصعد إلى −.' },
  },
  E_I2C_ADDR_CONFLICT: {
    en: { title: 'Two I2C devices at address {addr}', explain: 'Each device on a bus needs a unique address. Change one with its ADDR/SDO jumper.' },
    ar: { title: 'جهازا I2C على العنوان {addr}', explain: 'يجب أن يكون لكل جهاز عنوان فريد على الناقل. غيّر أحدهما بوصلة العنوان.' },
  },
  I_GPIO_NOT_IN_CODE: {
    en: { title: 'GPIO{pin} is wired but not used by your program', explain: '{parts} is connected to GPIO{pin}, but the running program never configures GPIO{pin}. Check the pin number in your code or move the wire.' },
    ar: { title: 'GPIO{pin} موصول لكن برنامجك لا يستخدمه', explain: '{parts} موصول بـ GPIO{pin} لكن البرنامج لا يهيئ GPIO{pin}. تحقق من رقم الطرف في الكود أو انقل السلك.' },
  },
  I_GPIO_UNCONNECTED: {
    en: { title: 'Program uses GPIO{pin}, but nothing is connected to it', explain: '{owner} on GPIO{pin} has no wire. Did you wire a different pin?' },
    ar: { title: 'البرنامج يستخدم GPIO{pin} ولا شيء موصول به', explain: '{owner} على GPIO{pin} بدون سلك. هل وصلت طرفاً آخر؟' },
  },
  W_FLOATING_INPUT: {
    en: { title: 'GPIO{pin} input is floating', explain: 'An input with no pull-up/down and nothing driving it reads random values. Use pull_up=True (Button) or add a 10 kΩ resistor.' },
    ar: { title: 'المدخل GPIO{pin} عائم', explain: 'مدخل بدون مقاومة رفع/خفض وبدون مصدر يقرأ قيماً عشوائية. استخدم pull_up=True أو أضف مقاومة 10 كيلو أوم.' },
  },
  W_SPI_NO_DEVICE: {
    en: { title: 'No SPI device answered on CE{dev}', explain: 'Check MCP3008 wiring: CLK→GPIO11, DIN→GPIO10, DOUT→GPIO9, CS→GPIO8/7, VDD/VREF→3.3 V, AGND/DGND→GND.' },
    ar: { title: 'لا يوجد جهاز SPI يستجيب على CE{dev}', explain: 'تحقق من توصيل MCP3008: CLK←GPIO11، DIN←GPIO10، DOUT←GPIO9، CS←GPIO8/7، VDD وVREF←3.3V، AGND وDGND←GND.' },
  },
};

export const FARM_ALARM_TEXT: Record<string, Bi> = {
  PUMP_DRY_RUN: {
    en: { title: 'Pump running dry', explain: 'The circulation pump is powered while the reservoir is below the intake ({level} %). Real pumps overheat and fail. Your program should stop the pump on low water.' },
    ar: { title: 'المضخة تعمل على الجاف', explain: 'مضخة التدوير تعمل والخزان تحت مستوى السحب ({level}٪). المضخات الحقيقية تسخن وتتلف. يجب أن يوقف برنامجك المضخة عند انخفاض الماء.' },
  },
  OVERFLOW: {
    en: { title: 'Reservoir overflow', explain: 'Water spilled. Stop the fresh-water valve before the tank is full.' },
    ar: { title: 'فيضان الخزان', explain: 'انسكب الماء. أوقف صمام الماء العذب قبل امتلاء الخزان.' },
  },
  AB_SIMULTANEOUS: {
    en: { title: 'Fertilizers A and B dosed at the same time', explain: 'Concentrated A (calcium) and B (sulphates/phosphates) must never mix undiluted — they precipitate. Use an interlock so only one dosing pump runs at a time.' },
    ar: { title: 'ضخ السماد A وB في نفس الوقت', explain: 'يجب ألا يختلط المحلولان المركّزان A (كالسيوم) وB (كبريتات/فوسفات) دون تخفيف لأنهما يترسبان. استخدم قفلاً برمجياً بحيث تعمل مضخة جرعات واحدة فقط.' },
  },
  TANK_A_EMPTY: { en: { title: 'Fertilizer tank A empty', explain: 'Refill tank A.' }, ar: { title: 'خزان السماد A فارغ', explain: 'أعد تعبئة الخزان A.' } },
  TANK_B_EMPTY: { en: { title: 'Fertilizer tank B empty', explain: 'Refill tank B.' }, ar: { title: 'خزان السماد B فارغ', explain: 'أعد تعبئة الخزان B.' } },
  LEAK: { en: { title: 'Water leak', explain: 'The reservoir is losing water (fault injected).' }, ar: { title: 'تسرب ماء', explain: 'الخزان يفقد الماء (عطل مُدخل).' } },
};

export const PY_ERROR_TEXT: Record<string, { en: string; ar: string }> = {
  ZeroDivisionError: { en: 'You divided by zero. Check the divisor before dividing (e.g. if count > 0).', ar: 'قسمت على صفر. تحقق من المقسوم عليه قبل القسمة (مثلاً if count > 0).' },
  NameError: { en: 'A variable or function name is not defined — check spelling, capital letters and that it is defined before use (and imported).', ar: 'اسم متغير أو دالة غير معرّف — تحقق من الإملاء والأحرف الكبيرة وأنه معرّف قبل الاستخدام (ومستورد).' },
  SyntaxError: { en: 'Python could not understand this line: look for missing colons (:), brackets, quotes or a typo.', ar: 'لم يفهم Python هذا السطر: ابحث عن نقطتين (:) أو قوس أو علامة تنصيص ناقصة أو خطأ إملائي.' },
  IndentationError: { en: 'Indentation is wrong. Blocks after if/for/while/def must be indented consistently (4 spaces).', ar: 'المسافات البادئة خاطئة. الكتل بعد if/for/while/def يجب أن تكون مزاحة بشكل ثابت (4 مسافات).' },
  TabError: { en: 'Tabs and spaces are mixed. Use 4 spaces only.', ar: 'خلط بين Tab والمسافات. استخدم 4 مسافات فقط.' },
  TypeError: { en: 'An operation got a value of the wrong type (e.g. adding str + int, or serial.write() with a str instead of bytes — use .encode()).', ar: 'عملية حصلت على قيمة من نوع خاطئ (مثل جمع نص مع رقم، أو serial.write() بنص بدلاً من bytes — استخدم .encode()).' },
  ValueError: { en: 'The type is right but the value is not allowed (e.g. int("abc") or a PWM value outside 0–1).', ar: 'النوع صحيح لكن القيمة غير مسموحة (مثل int("abc") أو قيمة PWM خارج 0–1).' },
  AttributeError: { en: 'The object has no such attribute/method — check the name (e.g. led.on() not led.On()).', ar: 'الكائن لا يملك هذه الخاصية/الدالة — تحقق من الاسم (مثلاً led.on() وليس led.On()).' },
  ModuleNotFoundError: { en: 'This module is not available in the simulator. Supported hardware modules: gpiozero, RPi.GPIO, serial, smbus2, spidev, adafruit_dht, board, w1thermsensor, bme280, RPLCD, ssd1306, flask, schedule — plus the Python standard library.', ar: 'هذه الوحدة غير متاحة في المحاكي. الوحدات المدعومة: gpiozero وRPi.GPIO وserial وsmbus2 وspidev وadafruit_dht وboard وw1thermsensor وbme280 وRPLCD وssd1306 وflask وschedule إضافة إلى مكتبة Python القياسية.' },
  ImportError: { en: 'The name could not be imported from that module — check spelling and supported classes.', ar: 'تعذر استيراد الاسم من الوحدة — تحقق من الإملاء والأصناف المدعومة.' },
  KeyError: { en: 'The dictionary has no such key. Use dict.get(key, default) or check the key name.', ar: 'القاموس لا يحتوي هذا المفتاح. استخدم dict.get(key, default) أو تحقق من اسم المفتاح.' },
  IndexError: { en: 'List index out of range — e.g. reading data[3] when fewer bytes arrived. Check len(data) first.', ar: 'الفهرس خارج النطاق — مثلاً قراءة data[3] عند وصول بايتات أقل. تحقق من len(data) أولاً.' },
  GPIOPinInUse: { en: 'Two devices try to use the same GPIO pin (or the pin belongs to UART/SPI/1-Wire). Create each device once and use different pins.', ar: 'جهازان يحاولان استخدام نفس طرف GPIO (أو الطرف محجوز لـ UART/SPI/1-Wire). أنشئ كل جهاز مرة واحدة واستخدم أطرافاً مختلفة.' },
  PinInvalidPin: { en: 'That is not a valid GPIO. On the Pi 5 header use BCM numbers 0–27 (e.g. LED(17)) or "BOARD11" for physical pin numbers.', ar: 'هذا ليس طرف GPIO صالحاً. استخدم أرقام BCM من 0 إلى 27 (مثل LED(17)) أو "BOARD11" لأرقام الأطراف الفعلية.' },
  SerialException: { en: 'The serial port could not be opened. Use /dev/serial0 for GPIO14/15 and make sure UART is enabled.', ar: 'تعذر فتح المنفذ التسلسلي. استخدم /dev/serial0 لـ GPIO14/15 وتأكد من تفعيل UART.' },
  PortNotOpenError: { en: 'You used a serial port after closing it (or before opening).', ar: 'استخدمت المنفذ التسلسلي بعد إغلاقه أو قبل فتحه.' },
  OSError: { en: 'An I/O error. "[Errno 121] Remote I/O error" on I2C means no device answered at that address: check wiring, power and address (e.g. 0x76/0x77).', ar: 'خطأ إدخال/إخراج. "[Errno 121] Remote I/O error" في I2C يعني أن لا جهاز يستجيب على هذا العنوان: تحقق من الأسلاك والتغذية والعنوان (مثل 0x76/0x77).' },
  FileNotFoundError: { en: 'The file or device path does not exist. For DS18B20, enable 1-Wire and check the probe wiring and pull-up.', ar: 'المسار غير موجود. بالنسبة لـ DS18B20 فعّل 1-Wire وتحقق من التوصيل ومقاومة الرفع.' },
  RuntimeError: { en: 'A library reported a run-time problem. For DHT sensors: "not found" means wiring/power; "full buffer" is a normal occasional failure — retry in a try/except.', ar: 'أبلغت مكتبة عن مشكلة أثناء التشغيل. لحساسات DHT: "not found" تعني التوصيل/التغذية، و"full buffer" فشل عادي أحياناً — أعد المحاولة داخل try/except.' },
  RecursionError: { en: 'A function calls itself without stopping. Use a loop instead.', ar: 'دالة تستدعي نفسها بلا توقف. استخدم حلقة بدلاً من ذلك.' },
  UnboundLocalError: { en: 'You assign to a variable inside a function before reading it. Declare it global or pass it as a parameter.', ar: 'تسند قيمة لمتغير داخل دالة قبل قراءته. عرّفه global أو مرره كمعامل.' },
  NoSensorFoundError: { en: 'No DS18B20 detected: enable 1-Wire, wire DQ to GPIO4 and add a 4.7 kΩ pull-up to 3.3 V.', ar: 'لم يُكتشف DS18B20: فعّل 1-Wire وصل DQ بـ GPIO4 وأضف مقاومة 4.7 كيلو أوم إلى 3.3V.' },
};

export function fill(s: string, params?: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (params && params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

// ---------------------------------------------------------------- extended component library
Object.assign(ISSUE_TEXT, {
  E_ECHO_5V: {
    en: { title: 'HC-SR04 ECHO (5 V) wired straight to GPIO{pin}', explain: 'The ECHO output swings to the module supply (5 V), which exceeds the Pi’s 3.3 V GPIO limit. Put a divider between ECHO and the GPIO (e.g. 1 kΩ from ECHO, 2 kΩ to GND) or use a level shifter.' },
    ar: { title: 'طرف ECHO (5 فولت) في HC-SR04 موصول مباشرة بـ GPIO{pin}', explain: 'يخرج طرف ECHO بجهد التغذية (5 فولت)، وهذا يتجاوز حد 3.3 فولت لأطراف GPIO. ضع مقسم جهد بين ECHO وطرف GPIO (مثلاً 1 كيلو أوم من ECHO و2 كيلو أوم إلى الأرضي) أو استخدم محول مستوى.' },
  },
  W_ADC_INPUT_RANGE: {
    en: { title: 'ADC input {pin} at {v} V is above VDD ({vdd} V)', explain: 'ADS1115 inputs must stay between GND and VDD + 0.3 V. Divide the sensor output down (e.g. 10 kΩ / 20 kΩ) or power the ADC from a higher supply — but then its I2C pull-ups must not exceed 3.3 V.' },
    ar: { title: 'دخل الـ ADC {pin} عند {v} فولت أعلى من VDD ({vdd} فولت)', explain: 'يجب أن يبقى دخل ADS1115 بين GND وVDD + 0.3 فولت. قسّم خرج الحساس (مثلاً 10 كيلو / 20 كيلو أوم) أو غذِّ الـ ADC بجهد أعلى مع الانتباه إلى ألا تتجاوز مقاومات سحب I2C جهد 3.3 فولت.' },
  },
  W_CHIP_IN_RESET: {
    en: { title: 'Chip held in reset ({pin} is LOW or floating)', explain: 'The reset pin must be pulled HIGH for the chip to work. Connect it to VDD (directly or with a 10 kΩ resistor).' },
    ar: { title: 'الشريحة في حالة إعادة الضبط (الطرف {pin} منخفض أو عائم)', explain: 'يجب سحب طرف إعادة الضبط إلى HIGH حتى تعمل الشريحة. صِله بـ VDD مباشرة أو عبر مقاومة 10 كيلو أوم.' },
  },
  W_LOGIC_INPUT_FLOATING: {
    en: { title: 'Logic input {pin} is floating', explain: 'CMOS logic inputs must be driven or tied HIGH/LOW. A floating input reads randomly in a real circuit. Connect it to a GPIO, VCC or GND.' },
    ar: { title: 'دخل منطقي {pin} عائم', explain: 'يجب توصيل مداخل CMOS المنطقية بمخرج أو تثبيتها على HIGH/LOW. الدخل العائم يقرأ قيماً عشوائية في الدائرة الحقيقية. صِله بـ GPIO أو VCC أو GND.' },
  },
  W_IC_OUTPUT_CURRENT: {
    en: { title: 'Output {pin} overloaded ({ma} mA)', explain: 'A 74HC output should supply at most about 20–35 mA. Add or increase the series resistor, or use a transistor/driver.' },
    ar: { title: 'حمل زائد على المخرج {pin} ({ma} مللي أمبير)', explain: 'يجب ألا يتجاوز تيار مخرج 74HC نحو 20–35 مللي أمبير. أضف مقاومة أو زد قيمتها، أو استخدم ترانزستوراً أو دائرة قيادة.' },
  },
  W_LEVEL_SIDES_SWAPPED: {
    en: { title: 'Level shifter LV ({lv} V) is higher than HV ({hv} V)', explain: 'LV must be the low-voltage side (3.3 V from the Pi) and HV the high side (5 V). Swap the supply wires.' },
    ar: { title: 'جهد LV ({lv} فولت) في محول المستوى أعلى من HV ({hv} فولت)', explain: 'يجب أن يكون LV الجانب المنخفض (3.3 فولت من Pi) وHV الجانب المرتفع (5 فولت). بدّل سلكي التغذية.' },
  },
  W_REG_DROPOUT: {
    en: { title: 'Regulator input too low ({vin} V)', explain: 'This regulator needs at least {vout} V + {drop} V on VIN to regulate. Below that the output sags and connected parts may brown out.' },
    ar: { title: 'جهد دخل المنظم منخفض ({vin} فولت)', explain: 'يحتاج هذا المنظم إلى {vout} + {drop} فولت على الأقل على VIN. تحت ذلك ينخفض الخرج وقد تتوقف القطع الموصولة.' },
  },
  W_STEPPER_RESET_FLOATING: {
    en: { title: 'Stepper driver /RST is floating', explain: 'On A4988/DRV8825 carriers /RST has no pull-up: the driver ignores STEP pulses. Bridge /RST to /SLP (which is pulled up on the board).' },
    ar: { title: 'الطرف /RST في دائرة قيادة المحرك الخطوي عائم', explain: 'في لوحات A4988/DRV8825 لا توجد مقاومة سحب على /RST، فتتجاهل الدائرة نبضات STEP. صِل /RST بـ /SLP (المسحوب إلى HIGH على اللوحة).' },
  },
  W_DRIVER_STANDBY: {
    en: { title: 'TB6612FNG is in standby (STBY LOW)', explain: 'Drive STBY HIGH (GPIO or 3.3 V) to enable the outputs.' },
    ar: { title: 'دائرة TB6612FNG في وضع الاستعداد (STBY منخفض)', explain: 'اجعل الطرف STBY في HIGH (من GPIO أو 3.3 فولت) لتفعيل المخارج.' },
  },
  I_WS2812_3V3_DATA: {
    en: { title: 'NeoPixel data from a 3.3 V GPIO into a 5 V strip', explain: 'WS2812B data needs about 0.7 × VDD = 3.5 V. A 3.3 V GPIO often works on short strips but is out of spec — use a 74AHCT125 level shifter for reliability.' },
    ar: { title: 'إشارة بيانات NeoPixel من GPIO بجهد 3.3 فولت إلى شريط 5 فولت', explain: 'تحتاج بيانات WS2812B إلى نحو 0.7 × VDD = 3.5 فولت. غالباً ينجح 3.3 فولت مع الأشرطة القصيرة لكنه خارج المواصفات — استخدم محول مستوى 74AHCT125 لضمان الاعتمادية.' },
  },
  W_DHT_TYPE_MISMATCH: {
    en: { title: 'Code reads a {want}, but the sensor on GPIO{pin} is a {kind}', explain: 'The DHT11 and DHT22 send their 40 data bits in different formats, so the wrong driver class returns wrong numbers (no error!). Use adafruit_dht.{kind}.' },
    ar: { title: 'الكود يقرأ {want} بينما الحساس على GPIO{pin} من نوع {kind}', explain: 'يرسل DHT11 وDHT22 بياناتهما بصيغتين مختلفتين، لذلك يعيد الصنف الخاطئ أرقاماً خاطئة دون خطأ ظاهر. استخدم adafruit_dht.{kind}.' },
  },
  W_CODE_PIN_MISMATCH: {
    en: { title: 'Code reads GPIO{pin}, but nothing matching is wired there', explain: '{hint}. Change the pin number in the code or move the wire.' },
    ar: { title: 'الكود يقرأ GPIO{pin} ولا يوجد حساس مطابق موصول به', explain: '{hint}. غيّر رقم الطرف في الكود أو انقل السلك.' },
  },
});
