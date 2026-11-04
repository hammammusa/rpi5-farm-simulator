// Arabic UI strings for the microcontroller boards (ESP32 …).
export const AR4: Record<string, string> = {
  Controller: 'المتحكم',
  Reset: 'إعادة ضبط',
  'Run this controller only': 'تشغيل هذا المتحكم فقط',
  'EN button: restart the program from the beginning': 'زر EN: إعادة تشغيل البرنامج من البداية',
  'Open main file': 'فتح الملف الرئيسي',
  'Board reset — restarting the program…': 'إعادة ضبط اللوحة — يُعاد تشغيل البرنامج…',
  'Main file not found: {f}': 'الملف الرئيسي غير موجود: {f}',
  MQTT: 'MQTT',
  Broker: 'الوسيط',
  clients: 'العملاء',
  'read error': 'خطأ قراءة',
  'write error': 'خطأ كتابة',
  Topic: 'الموضوع',
  Payload: 'الحمولة',
  Publish: 'نشر',
  'Add a Wiren Board 7.4 to the project: its MQTT broker carries the devices of every controller (ESP32 boards publish to it over Wi-Fi).':
    'أضف Wiren Board 7.4 إلى المشروع: يحمل وسيط MQTT الخاص به أجهزة كل المتحكمات (تنشر لوحات ESP32 إليه عبر Wi-Fi).',
  'The Wiren Board is not powered: connect 9…48 V DC to V+ and GND. Its MQTT broker runs only while it is on.':
    'لوحة Wiren Board غير مغذّاة: وصّل جهداً مستمراً من 9 إلى 48 فولت إلى V+ وGND. يعمل وسيط MQTT فقط أثناء تشغيلها.',
  'ESP32: MicroPython programs run in the official MicroPython 1.29 WebAssembly port; Arduino sketches are compiled by Clang/LLVM 22 to WebAssembly with the simulator’s Arduino-ESP32 core subset. The Xtensa CPU, ESP-IDF, FreeRTOS and the radio are not emulated; Wi-Fi is a virtual LAN.':
    'ESP32: تعمل برامج MicroPython في منفذ WebAssembly الرسمي لـ MicroPython 1.29؛ وتُترجم شيفرات Arduino بمترجم Clang/LLVM 22 إلى WebAssembly مع جزء من نواة Arduino-ESP32 الخاصة بالمحاكي. لا تُحاكى وحدة المعالجة Xtensa ولا ESP-IDF ولا FreeRTOS ولا الراديو؛ شبكة Wi-Fi افتراضية.',
  'Wiren Board 7.4: wb-rules scripts run in a QuickJS sandbox against simulated wb-mqtt-gpio/adc/w1/serial drivers and an MQTT broker. Debian/Linux, the web interface and CAN are not emulated.':
    'Wiren Board 7.4: تعمل نصوص wb-rules في بيئة QuickJS معزولة مع مشغلات wb-mqtt-gpio/adc/w1/serial محاكاة ووسيط MQTT. لا يُحاكى نظام Debian/Linux ولا واجهة الويب ولا CAN.',
};
