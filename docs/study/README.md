# مسابقة الزراعة الذكية — مشاريعي الثلاثة الأساسية

**City Farming — My 3 Master Projects** — ملفات الدراسة القابلة للطباعة للمشاريع المرجعية الثلاثة.

| المشروع | المتحكم | اللغة | ملف الدراسة | ورقة المراجعة |
|---|---|---|---|---|
| COMPETITION MASTER 01 | Raspberry Pi 5 | Python 3 (gpiozero, pyserial, adafruit_dht, Flask) | [عربي](master-pi5-study-ar.pdf) · [English](master-pi5-study-en.pdf) | [عربي](master-pi5-cheat-sheet-ar.pdf) · [English](master-pi5-cheat-sheet-en.pdf) |
| COMPETITION MASTER 02 | ESP32-DevKitC V4 | MicroPython 1.29 | [عربي](master-esp32-study-ar.pdf) · [English](master-esp32-study-en.pdf) | [عربي](master-esp32-cheat-sheet-ar.pdf) · [English](master-esp32-cheat-sheet-en.pdf) |
| COMPETITION MASTER 03 | Wiren Board 7.4 | wb-rules (JavaScript) | [عربي](master-wb7-study-ar.pdf) · [English](master-wb7-study-en.pdf) | [عربي](master-wb7-cheat-sheet-ar.pdf) · [English](master-wb7-cheat-sheet-en.pdf) |

مقارنة المتحكمات الثلاثة: [عربي](masters-comparison-ar.pdf) · [English](masters-comparison-en.pdf)

## كيف أفتح المشاريع

1. افتح الموقع: https://hammammusa.github.io/rpi5-farm-simulator/
2. اضغط تبويب **Examples / الأمثلة**.
3. فعّل **🎯 Focused Study Mode — وضع الدراسة المركزة**: تظهر المشاريع الثلاثة فقط (الأمثلة الأخرى مخفية مؤقتاً ولم تُحذف).
4. اختر مشروعاً: تظهر صفحة الدراسة (الدائرة، لوحة الحالة، الأقسام التسعة مع شرح كل سطر، التوصيلات، السيناريوهات العشرة، استرجاع الكود، التمارين، المقارنة، العتاد الحقيقي، ملفات PDF).
5. اضغط **افتح المشروع**: تُفتح الدائرة موصولة ومرتبة والكود جاهزاً. اضغط **▶ Run** ثم عد إلى صفحة الدراسة لترى لوحة الحالة.

## محتوى ملف الدراسة

صورة الدائرة · جدول التوصيلات (من، إلى، النوع، لماذا، لو انفصل) · قائمة القطع · الإعدادات · الأقسام التسعة مع الكود · البرنامج كاملاً · نتائج السيناريوهات العشرة (شُغّلت في المتصفح على بيئة التشغيل الحقيقية قبل التصدير) · تمارين «غيّر شيئاً واحداً» · التنفيذ على العتاد الحقيقي · المكتبات · الفروقات بين المحاكاة والجهاز.

## ملاحظة

هذه مشاريع تدريبية مرجعية. القيم في أعلى البرامج قيم تدريبية وليست إعدادات معتمدة لكل المحاصيل، ودقة الجرعات تعتمد على معايرة المضخات الحقيقية. لا تثبت هذه المشاريع المعدات التي ستُستخدم في النهائي، ولا تغطي كل الوحدات التنافسية.

الملفات أُنشئت تلقائياً بواسطة `tests/e2e/masters.spec.ts` (يشغّل السيناريوهات العشرة لكل مشروع ثم يصدّر الملفات). في GitHub Actions تُرفع النسخة الأحدث كـ artifact باسم `study-pdfs`.
