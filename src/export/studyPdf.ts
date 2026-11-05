// Printable study files of the three COMPETITION MASTER projects: the complete study file of a
// project, the one-sheet review per controller and the comparison of the three controllers.
// Everything is generated from the real project (circuit image, wiring table, parts list, code)
// and from the study material; test results are the ones the student ran in the browser.
import { translate, type Lang } from '../i18n';
import type { Bi } from '../library/dsl';
import type { ScenarioReport } from '../tests/host';
import { masterScenarios } from '../library/masters/scenarios';
import { KIND_LABEL, MASTER_PROJECTS, comparison, pinMap, sectionLines, wiringNotes, type MasterProject } from '../library/masters/study';
import { renderCircuitSvg, safeScale, svgToCanvas } from './circuitImage';
import { renderDocument, type DocWriter } from './docPdf';
import { BOM_COLUMNS, buildReport } from './report';
import { download } from '../state/persist';

const SITE = 'Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator';

export function downloadPdf(pdf: Uint8Array, name: string) {
  download(new Blob([pdf as BlobPart], { type: 'application/pdf' }), name);
}

const thresholds = (code: string, comment: string) =>
  code
    .split('\n')
    // the numeric settings only (thresholds, durations, hours), not the pin / control names
    .filter((l) => /^(var )?[A-Z_]{3,} = [\d.[\], -]+;?\s*(#|\/\/|$)/.test(l))
    .map((l) => {
      const i = l.indexOf(comment);
      const kv = (i >= 0 ? l.slice(0, i) : l).replace(/^var /, '').replace(/;\s*$/, '').trim();
      const [k, v] = kv.split(/\s*=\s*/);
      return [k, v, i >= 0 ? l.slice(i + comment.length).trim() : ''] as [string, string, string];
    });

async function circuitImage(w: DocWriter, m: MasterProject, caption: string) {
  const doc = m.build();
  const svg = renderCircuitSvg(doc, { background: 'white', scope: 'all', grid: false, labels: true, scale: 2 });
  const canvas = await svgToCanvas(svg, safeScale(svg.width, svg.height, Math.min(4, Math.max(1.5, 2800 / svg.width))));
  w.image(canvas, svg.width, svg.height, caption);
}

export async function masterStudyPdf(m: MasterProject, lang: Lang, results: ScenarioReport[]) {
  const L = (b: Bi) => (lang === 'ar' ? b[1] : b[0]);
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const doc = m.build();
  const report = buildReport(doc, { lang });
  const notes = wiringNotes(doc, m.board);
  const comment = m.board === 'wb' ? '//' : '#';
  const bullet = lang === 'ar' ? '◂' : '▸';
  const date = new Date().toISOString().slice(0, 10);
  const r = await renderDocument(
    lang === 'ar',
    (p, total) => `${m.controller} — ${T(`page ${p} of ${total}`, `صفحة ${p} من ${total}`)} · ${SITE}`,
    async (w) => {
      w.title(L(m.title), T('Complete study file', 'ملف الدراسة الكامل'));
      w.paragraph(L(m.goal));
      w.keyValues([
        [T('Controller', 'المتحكم'), m.controller],
        [T('Language', 'اللغة'), m.language],
        [T('Program file', 'ملف البرنامج'), m.file],
        [T('Status display', 'عرض الحالة'), L(m.dashboard)],
        [T('Parts / wires', 'القطع / الأسلاك'), `${doc.components.length} / ${doc.wires.length}`],
        [T('Exported', 'تاريخ التصدير'), date],
      ]);
      w.paragraph(L(m.summary), { size: 9, color: '#5d6b78' });
      // 1 circuit
      w.newPage('landscape');
      w.heading(T('1. Circuit diagram', '1. مخطط الدائرة'));
      await circuitImage(w, m, `${doc.components.length} ${T('parts', 'قطعة')} · ${doc.wires.length} ${T('wires', 'سلك')}`);
      // 2 wiring
      w.newPage('landscape');
      w.heading(T('2. Wiring table — every wire explained', '2. جدول التوصيلات — شرح كل سلك'));
      w.table(
        [
          { title: '#', w: 0.3 },
          { title: T('From', 'من'), w: 1.6 },
          { title: T('To', 'إلى'), w: 1.6 },
          { title: T('Type', 'النوع'), w: 0.9 },
          { title: T('Why', 'لماذا'), w: 2.6 },
          { title: T('If disconnected', 'لو انفصل'), w: 2.8 },
        ],
        notes.map((n, i) => [String(i + 1), n.from, n.to, L(KIND_LABEL[n.kind]), L(n.why), L(n.cut)]),
        { size: 6.5, zebra: true },
      );
      // 3 parts
      w.newPage('landscape');
      w.heading(T('3. Parts list', '3. قائمة القطع'));
      w.table(
        BOM_COLUMNS.map(([, h], i) => ({ title: translate(lang, h), w: [0.35, 2, 2, 0.4, 2.6, 1.6, 1.1, 1, 2.6][i] ?? 1 })),
        report.bom.map((b) => BOM_COLUMNS.map(([k]) => String(b[k] ?? ''))),
        { size: 7, zebra: true },
      );
      // 4 settings
      w.newPage('portrait');
      w.heading(T('4. Settings (constants at the top of the program)', '4. الإعدادات (الثوابت في أعلى البرنامج)'));
      w.table(
        [
          { title: T('Name', 'الاسم'), w: 1.4, mono: true },
          { title: T('Value', 'القيمة'), w: 1, mono: true },
          { title: T('Meaning', 'المعنى'), w: 3 },
        ],
        thresholds(m.code, comment),
        { size: 8, zebra: true },
      );
      w.paragraph(T('Training values you may change; they are not certified settings for every crop. Dose accuracy depends on the calibration of the real pumps.', 'قيم تدريبية يمكنك تغييرها، وليست إعدادات معتمدة لكل المحاصيل. دقة الجرعات تعتمد على معايرة المضخات الحقيقية.'), { size: 8.5, color: '#5d6b78' });
      // 5 sections
      w.heading(T('5. The program in 9 sections', '5. البرنامج في 9 أقسام'));
      for (const s of m.sections) {
        w.heading(L(s.title), 2);
        w.paragraph(L(s.text), { size: 9.5 });
        for (const p of s.points) w.paragraph(L(p), { size: 9, bullet });
        w.code(m.file, sectionLines(m.code, s).map(([n, l]) => `${String(n).padStart(3)}  ${l}`).join('\n'));
      }
      // 6 code
      w.newPage('portrait');
      w.heading(T('6. Complete program', '6. البرنامج كاملاً'));
      w.code(m.file, m.code);
      if (m.board === 'pi') w.code('templates/index.html', doc.files.find((f) => f.name === 'templates/index.html')?.content ?? '');
      // 7 tests
      w.newPage('portrait');
      w.heading(T('7. Test scenarios and results', '7. سيناريوهات الاختبار ونتائجها'));
      w.paragraph(
        results.length
          ? T(`Results of the scenarios run in the browser on ${date} (real runtime of the simulator).`, `نتائج السيناريوهات التي شُغّلت في المتصفح بتاريخ ${date} (بيئة التشغيل الحقيقية في المحاكي).`)
          : T('The scenarios were not run before this export (Study page → 10 test scenarios → Run all).', 'لم تُشغَّل السيناريوهات قبل هذا التصدير (صفحة الدراسة ← سيناريوهات الاختبار العشرة ← شغّل الكل).'),
        { size: 9, color: '#5d6b78' },
      );
      w.table(
        [
          { title: T('Scenario', 'السيناريو'), w: 1.6 },
          { title: T('What it does', 'ماذا يفعل'), w: 2.6 },
          { title: T('Expected', 'المتوقع'), w: 2.8 },
          { title: T('Result', 'النتيجة'), w: 0.8 },
        ],
        masterScenarios(m.board).map((s) => {
          const res = results.find((x) => x.id === `${m.id}-${s.id}`);
          return [L(s.name), L(s.does), L(s.expected), res ? res.status : T('not run', 'لم يُشغَّل')];
        }),
        { size: 7, zebra: true },
      );
      // 8 exercises
      w.heading(T('8. Change One Thing — exercises', '8. غيّر شيئاً واحداً — تمارين'));
      m.exercises.forEach((x, i) => {
        w.paragraph(`${i + 1}. ${L(x.title)}`, { size: 10 });
        w.paragraph(L(x.steps), { size: 9, indent: 14 });
        w.paragraph(`${T('You should see', 'ما يجب أن تلاحظه')}: ${L(x.observe)}`, { size: 9, indent: 14, color: '#5d6b78' });
      });
      // 9 hardware
      w.newPage('portrait');
      w.heading(T('9. Building it on real hardware', '9. التنفيذ على العتاد الحقيقي'));
      m.hardware.forEach((h, i) => w.paragraph(L(h), { bullet: `${i + 1}.` }));
      w.heading(T('10. Libraries to install', '10. المكتبات المطلوب تثبيتها'));
      for (const l of m.libraries) w.paragraph(`${l.name}: ${l.install}`, { bullet });
      w.heading(T('11. Simulation vs. real device', '11. الفروقات بين المحاكاة والجهاز الحقيقي'));
      for (const d of m.differences) w.paragraph(L(d), { bullet });
      w.paragraph(T('These projects are training references; they do not prove which equipment the final uses nor cover every competition module.', 'هذه المشاريع مراجع تدريبية؛ ولا تثبت المعدات التي ستُستخدم في النهائي ولا تغطي كل الوحدات التنافسية.'), { size: 8.5, color: '#5d6b78' });
    },
    { title: L(m.title), subject: T('Complete study file', 'ملف الدراسة الكامل'), lang },
  );
  return { ...r, name: `${m.id}-study-${lang}.pdf` };
}

export async function masterCheatSheetPdf(m: MasterProject, lang: Lang) {
  const L = (b: Bi) => (lang === 'ar' ? b[1] : b[0]);
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const doc = m.build();
  const comment = m.board === 'wb' ? '//' : '#';
  const pick = (re: RegExp) => m.code.split('\n').filter((l) => re.test(l)).map((l) => l.replace(/\s+(#|\/\/).*$/, ''));
  const key =
    m.board === 'pi'
      ? pick(/^(dht|co2_port|ph_adc|pump|dosing_button) = |^    (temperature = dht|ph = round|pump_amps = round)|is_pressed:|time\.localtime|^\s+fan\.on\(\)$|app\.add_url_rule\("\/status"/)
      : m.board === 'esp'
        ? pick(/^(dht_sensor|co2_port|screen|ph_adc|pump|dosing_button) = |^    return adc\.read_uv|dht_sensor\.measure|value\(\) == 0|time\.localtime|screen\.write\(name/)
        : pick(/^var (TEMP|PH_VOLTS|PUMP) = |^defineVirtualDevice|getError|if \(dev\[name\] !== on\)|whenChanged|setTimeout\(doseBStart|getHours|^setInterval/);
  const r = await renderDocument(
    lang === 'ar',
    (p, total) => `${m.controller} — ${T('cheat sheet', 'ورقة المراجعة')} ${p}/${total}`,
    (w) => {
      w.title(`${m.controller} — ${T('cheat sheet', 'ورقة مراجعة')}`, L(m.title));
      w.heading(T('Connections to remember', 'التوصيلات التي يجب حفظها'));
      w.table(
        [
          { title: T('Controller pin', 'طرف المتحكم'), w: 1.6 },
          { title: T('Goes to', 'يذهب إلى'), w: 2.4 },
        ],
        pinMap(doc, m.board),
        { size: 7.5, zebra: true },
      );
      w.heading(T('Settings', 'الإعدادات'));
      w.paragraph(thresholds(m.code, comment).map(([k, v]) => `${k} = ${v}`).join('   ·   '), { size: 8.5, mono: true });
      w.heading(T('Key lines of the program', 'أهم أسطر البرنامج'));
      w.code(m.file, key.join('\n'));
      w.heading(T('The program in 6 steps', 'البرنامج في 6 خطوات'));
      for (const s of [
        T('Read the sensors (None/null when one fails).', 'اقرأ الحساسات (None/null عند الفشل).'),
        T('Buttons choose the mode: AUTO, DOSING, TEST.', 'الأزرار تختار الوضع: AUTO وDOSING وTEST.'),
        T('AUTO: fan 30/27 °C, light 06–20 h, irrigation at 7/12/17 h if water ≥ 20 %.', 'AUTO: المروحة 30/27 °م، الإضاءة 06–20، الري الساعة 7 و12 و17 إذا كان الماء ≥ 20٪.'),
        T('DOSING: water check, B off, A for 5 s, A off, B for 2.5 s, B off.', 'DOSING: فحص الماء، B إيقاف، A لمدة 5 ث، A إيقاف، B لمدة 2.5 ث، B إيقاف.'),
        T('Alarms: SENSOR ERROR → LOW WATER → PUMP FAILURE → HIGH TEMPERATURE → OUT OF RANGE.', 'الإنذارات: SENSOR ERROR ← LOW WATER ← PUMP FAILURE ← HIGH TEMPERATURE ← OUT OF RANGE.'),
        T('Status every 5 s, wait 1 s, repeat.', 'الحالة كل 5 ثوانٍ، انتظر ثانية، كرّر.'),
      ])
        w.paragraph(s, { bullet: '•', size: 9 });
    },
    { title: `${m.controller} cheat sheet`, lang },
  );
  return { ...r, name: `${m.id}-cheat-sheet-${lang}.pdf` };
}

export async function masterComparisonPdf(lang: Lang) {
  const L = (b: Bi) => (lang === 'ar' ? b[1] : b[0]);
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const rows = comparison();
  const r = await renderDocument(
    lang === 'ar',
    (p, total) => `${T('Comparison of the three controllers', 'مقارنة المتحكمات الثلاثة')} ${p}/${total}`,
    (w) => {
      w.newPage('landscape');
      w.title(T('One logic, three controllers', 'منطق واحد وثلاثة متحكمات'), T('Raspberry Pi 5 · ESP32 · Wiren Board 7.4', 'Raspberry Pi 5 · ESP32 · Wiren Board 7.4'));
      w.table(
        [{ title: '', w: 1.1 }, ...MASTER_PROJECTS.map((p) => ({ title: p.controller, w: 2 }))],
        rows.map((row) => [L(row.key), ...MASTER_PROJECTS.map((p) => L(row.cells[p.board].text))]),
        { size: 8, zebra: true },
      );
      w.heading(T('The same step in the three programs (real lines)', 'الخطوة نفسها في البرامج الثلاثة (أسطر حقيقية)'));
      for (const row of rows) {
        if (!MASTER_PROJECTS.some((p) => row.cells[p.board].code)) continue;
        w.heading(L(row.key), 2);
        w.code('', MASTER_PROJECTS.map((p) => `[${p.controller}]\n${row.cells[p.board].code ?? '—'}`).join('\n\n'));
      }
    },
    { title: 'Controller comparison', lang },
  );
  return { ...r, name: `masters-comparison-${lang}.pdf` };
}
