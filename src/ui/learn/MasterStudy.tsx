// Study page of a COMPETITION MASTER project: circuit, live status, the 9 study sections with a
// line-by-line explanation, the wiring notes, the 10 scenarios (run on the real runtime of the
// page), Code Recall checked by behaviour, "Change One Thing" exercises, the comparison of the
// three controllers, the real-hardware guide and the printable PDFs.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { sim, useSimVersion } from '../../state/engine';
import { runScenario, type ScenarioReport } from '../../tests/host';
import { DEFAULT_IMAGE, renderCircuitSvg } from '../../export/circuitImage';
import type { Bi } from '../../library';
import { inAppScenario } from '../../library/masters/inapp';
import { masterScenarios } from '../../library/masters/scenarios';
import { KIND_LABEL, MASTER_PROJECTS, comparison, explainLine, markerRange, recallPlaceholder, replaceMarked, sectionLines, splitComment, wiringNotes, type MasterProject } from '../../library/masters/study';

type Tab = 'sections' | 'wiring' | 'tests' | 'recall' | 'exercises' | 'compare' | 'hardware' | 'export';

/** results of the last in-app run per project, also used by the PDF export */
export const MASTER_REPORTS: Record<string, ScenarioReport[]> = {};

const STATUS_RE = /STATUS mode=(\S+) temp=(\S+) hum=(\S+) co2=(\S+) ph=(\S+) ec=(\S+) level=(\S+) pump=(\S+) fan=(\S+) light=(\S+) alarm=(.+?) day=(\d+)/g;

export function lastStatus(text: string) {
  let m: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  STATUS_RE.lastIndex = 0;
  while ((m = STATUS_RE.exec(text))) last = m;
  if (!last) return null;
  const [, mode, temp, hum, co2, ph, ec, level, pump, fan, light, alarm, day] = last;
  return { mode, temp, hum, co2, ph, ec, level, pump, fan, light, alarm, day };
}

const isOpen = (m: MasterProject, exampleId?: string) => exampleId === m.id || exampleId === `lib:${m.id}`;

export function MasterStudy({ m, onOpen }: { m: MasterProject; onOpen: () => Promise<void> }) {
  const lang = useApp((s) => s.lang);
  const L = (b: Bi) => (lang === 'ar' ? b[1] : b[0]);
  const open = useApp((s) => isOpen(m, s.doc.exampleId));
  const [tab, setTab] = useState<Tab>('sections');
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    // the circuit as it opens (rendered off-screen once)
    const t = setTimeout(() => {
      try {
        const svg = renderCircuitSvg(m.build(), { ...DEFAULT_IMAGE, scale: 1 });
        setImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}`);
      } catch {
        setImg(null);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [m]);

  const tabs: [Tab, Bi][] = [
    ['sections', ['Study sections & every line', 'الأقسام وشرح كل سطر']],
    ['wiring', ['Understand the wiring', 'فهم التوصيلات']],
    ['tests', ['10 test scenarios', 'سيناريوهات الاختبار العشرة']],
    ['recall', ['Code Recall', 'استرجاع الكود']],
    ['exercises', ['Change One Thing', 'غيّر شيئاً واحداً']],
    ['compare', ['Compare the 3 controllers', 'مقارنة المتحكمات الثلاثة']],
    ['hardware', ['Real hardware', 'العتاد الحقيقي']],
    ['export', ['PDF files', 'ملفات PDF']],
  ];

  return (
    <article className="page learn-detail master-study" data-testid="master-study" data-id={m.id}>
      <h1>{L(m.title)}</h1>
      <div className="lib-chips">
        <span className="chip">🎛 {m.controller}</span>
        <span className="chip">💻 {m.language}</span>
        <span className="chip">📄 {m.file}</span>
      </div>
      <p>{L(m.goal)}</p>
      <p className="muted small">{L(m.summary)}</p>
      <div className="row">
        <button className="primary" onClick={() => void onOpen()} data-testid="open-example">
          {open ? L(['Reopen a fresh copy', 'افتح نسخة جديدة']) : L(['Open the project (circuit + code)', 'افتح المشروع (الدائرة + الكود)'])}
        </button>
        {open && (
          <button onClick={() => useApp.getState().setTab('circuit')} data-testid="master-go-circuit">
            {L(['Go to the circuit', 'اذهب إلى الدائرة'])}
          </button>
        )}
      </div>
      <div className="master-top">
        <figure className="master-circuit">{img ? <img src={img} alt={L(m.title)} data-testid="master-circuit-img" /> : <div className="muted small">…</div>}</figure>
        <StatusPanel m={m} open={open} L={L} />
      </div>
      <p className="muted small">
        <b>{L(['Status shown on', 'تُعرض الحالة على'])}:</b> {L(m.dashboard)}
      </p>
      <div className="tabs master-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" className={tab === id ? 'on' : ''} aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`mtab-${id}`}>
            {L(label)}
          </button>
        ))}
      </div>
      {tab === 'sections' && <Sections m={m} L={L} />}
      {tab === 'wiring' && <Wiring m={m} L={L} open={open} />}
      {tab === 'tests' && <Tests m={m} L={L} lang={lang} open={open} />}
      {tab === 'recall' && <Recall m={m} L={L} lang={lang} open={open} onOpen={onOpen} />}
      {tab === 'exercises' && <Exercises m={m} L={L} />}
      {tab === 'compare' && <Compare L={L} />}
      {tab === 'hardware' && <Hardware m={m} L={L} />}
      {tab === 'export' && <ExportPanel m={m} L={L} lang={lang} />}
    </article>
  );
}

type LFn = (b: Bi) => string;

// ---------------------------------------------------------------- live status
function StatusPanel({ m, open, L }: { m: MasterProject; open: boolean; L: LFn }) {
  useSimVersion();
  const term = useApp((s) => s.term);
  const text = useMemo(() => term.map((l) => l.text).join(''), [term]);
  const st = open ? lastStatus(text) : null;
  const run = (id: string) => Math.abs(sim.vis.get(id)?.run ?? 0) > 0.5;
  const lamp = (sim.vis.get('lamp')?.brightness ?? 0) > 0.1;
  const rows: [Bi, string][] = st
    ? [
        [['Temperature', 'الحرارة'], `${st.temp} °C`],
        [['Humidity', 'الرطوبة'], `${st.hum} %`],
        [['CO₂', 'CO₂'], `${st.co2} ppm`],
        [['pH', 'pH'], st.ph],
        [['EC', 'EC'], `${st.ec} mS/cm`],
        [['Water level', 'مستوى الماء'], `${st.level} %`],
        [['Mode', 'الوضع'], st.mode],
        [['Pump', 'المضخة'], st.pump],
        [['Fan', 'المروحة'], st.fan],
        [['Light', 'الإضاءة'], st.light],
        [['Alarm', 'الإنذار'], st.alarm],
        [['Growth day', 'يوم النمو'], st.day],
      ]
    : [];
  return (
    <div className="master-status" data-testid="master-status">
      <div className="panel-title sub">{L(['Status panel (from the running program)', 'لوحة الحالة (من البرنامج أثناء التشغيل)'])}</div>
      {!open && <p className="muted small">{L(['Open the project and press ▶ Run: the panel shows the last STATUS line of the program and the real state of the loads.', 'افتح المشروع واضغط ▶ تشغيل: تعرض اللوحة آخر سطر STATUS من البرنامج والحالة الفعلية للأحمال.'])}</p>}
      {open && !st && <p className="muted small">{L(['No STATUS line yet — press ▶ Run (the program prints one every 5 s).', 'لا يوجد سطر STATUS بعد — اضغط ▶ تشغيل (يطبع البرنامج سطراً كل 5 ثوانٍ).'])}</p>}
      {st && (
        <table className="data-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k[0]} data-status={k[0]}>
                <th>{L(k)}</th>
                <td dir="ltr" className={k[0] === 'Alarm' && v !== 'NONE' ? 'bad' : ''}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="master-loads">
          {(
            [
              ['pump', ['Pump', 'المضخة']],
              ['fan', ['Fan', 'المروحة']],
              ['light', ['Light', 'الإضاءة']],
              ['doseA', ['Dose A', 'الجرعة A']],
              ['doseB', ['Dose B', 'الجرعة B']],
            ] as [string, Bi][]
          ).map(([id, n]) => (
            <span key={id} className={`chip ${run(id) ? 'on' : ''}`} data-load={id} data-on={run(id) ? '1' : '0'}>
              {run(id) ? '●' : '○'} {L(n)}
            </span>
          ))}
          <span className={`chip ${lamp ? 'alarm' : ''}`} data-load="lamp" data-on={lamp ? '1' : '0'}>
            {lamp ? '🔴' : '⚪'} {L(['Alarm lamp', 'مصباح الإنذار'])}
          </span>
        </div>
      )}
      {open && <p className="muted small">{L(['Loads: measured in the simulated circuit (not printed by the program).', 'الأحمال: مقاسة في الدائرة المحاكاة (وليست مما يطبعه البرنامج).'])}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- sections + every line
function Sections({ m, L }: { m: MasterProject; L: LFn }) {
  const [sel, setSel] = useState(m.sections[0].id);
  const [line, setLine] = useState<number | null>(null);
  const whole = { id: 'all', title: ['Whole program', 'البرنامج كاملاً'] as Bi, ranges: [], text: ['The complete program, top to bottom, with the note of every line.', 'البرنامج كاملاً من أوله إلى آخره مع ملاحظة كل سطر.'] as Bi, points: [] as Bi[] };
  const s = sel === 'all' ? whole : m.sections.find((x) => x.id === sel)!;
  const lines: [number, string][] = sel === 'all' ? m.code.split('\n').map((l, i) => [i + 1, l]) : sectionLines(m.code, s);
  return (
    <div data-testid="master-sections">
      <div className="seg master-seg">
        {[...m.sections, whole].map((x) => (
          <button key={x.id} className={x.id === sel ? 'on' : ''} onClick={() => (setSel(x.id), setLine(null))} data-testid={`msec-${x.id}`}>
            {L(x.title)}
          </button>
        ))}
      </div>
      <h2>{L(s.title)}</h2>
      <p>{L(s.text)}</p>
      <ul>
        {s.points.map((p, i) => (
          <li key={i}>{L(p)}</li>
        ))}
      </ul>
      <p className="muted small">{L(['Explain Every Line: click a line to see what each word does.', 'شرح كل سطر: اضغط على سطر لترى ماذا تفعل كل كلمة فيه.'])}</p>
      <div className="explain-lines" dir="ltr" data-testid="explain-lines">
        {lines.map(([n, text]) => {
          const { code, note } = splitComment(text, m.board);
          const terms = line === n ? explainLine(code) : [];
          return (
            <div key={n} className={`xline ${line === n ? 'on' : ''}`} onClick={() => setLine(line === n ? null : n)} data-line={n}>
              <span className="xn">{n}</span>
              <code className="xc">{code || ' '}</code>
              {note && (
                <span className="xa" dir="rtl">
                  {note}
                </span>
              )}
              {line === n && (
                <div className="xterms" dir={L(['ltr', 'rtl']) as 'ltr' | 'rtl'}>
                  {terms.length ? terms.map((t, i) => <div key={i}>• {L(t)}</div>) : <div>• {L(['A comment or a value: read the note beside it.', 'تعليق أو قيمة: اقرأ الملاحظة بجانبه.'])}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- wiring
function Wiring({ m, L, open }: { m: MasterProject; L: LFn; open: boolean }) {
  const doc = useApp((s) => s.doc);
  const notes = useMemo(() => wiringNotes(open ? doc : m.build(), m.board), [open, doc, m]);
  const [q, setQ] = useState('');
  const shown = notes.filter((n) => !q || `${n.from} ${n.to}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div data-testid="master-wiring">
      <p className="muted small">{L(['Every wire of the circuit: where it starts and ends, why it is there, what it carries and what happens if it comes loose. In the circuit, click a wire to see the same explanation in the inspector.', 'كل سلك في الدائرة: من أين يبدأ وأين ينتهي، ولماذا وُضع، وماذا يحمل، وماذا يحدث لو انفصل. في الدائرة اضغط على أي سلك لترى الشرح نفسه في لوحة الخصائص.'])}</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(['Filter: part or pin (e.g. DHT22, GPIO17, K1)', 'تصفية: قطعة أو طرف (مثل DHT22 أو GPIO17 أو K1)'])} />
      <table className="data-table master-wires">
        <thead>
          <tr>
            <th>#</th>
            <th>{L(['From', 'من'])}</th>
            <th>{L(['To', 'إلى'])}</th>
            <th>{L(['Type', 'النوع'])}</th>
            <th>{L(['Why', 'لماذا'])}</th>
            <th>{L(['If it is disconnected', 'لو انفصل'])}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((n, i) => (
            <tr key={n.wire} data-kind={n.kind}>
              <td>{i + 1}</td>
              <td dir="ltr">{n.from}</td>
              <td dir="ltr">{n.to}</td>
              <td>
                <span className={`kind kind-${n.kind}`}>{L(KIND_LABEL[n.kind])}</span>
              </td>
              <td>{L(n.why)}</td>
              <td>{L(n.cut)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- tests
async function runList(m: MasterProject, ids: string[], lang: 'en' | 'ar', keep: boolean, speed = 3) {
  const original = structuredClone(useApp.getState().doc);
  const out: ScenarioReport[] = [];
  for (const s of masterScenarios(m.board).filter((x) => ids.includes(x.id))) out.push(await runScenario(inAppScenario(m, s, lang), speed, keep));
  if (!keep) {
    useApp.getState().loadProject(original);
    useApp.getState().setTab('learn');
  }
  return out;
}

function ReportList({ reports, L }: { reports: ScenarioReport[]; L: LFn }) {
  return (
    <>
      {reports.map((r) => (
        <div key={r.id} className={`issue ${r.status === 'PASS' ? '' : 'issue-error'}`} data-check={r.status} data-scenario={r.id}>
          <div className="issue-title">
            {r.status === 'PASS' ? '✅' : '❌'} {r.name} — {r.status} <span className="muted small">({(r.durationMs / 1000).toFixed(0)} s)</span>
          </div>
          <div className="issue-explain">
            {L(['Expected', 'المتوقع'])}: {r.expected}
            <br />
            <span dir="ltr">
              {L(['Actual', 'الفعلي'])}: {r.actual} {r.error}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function Tests({ m, L, lang, open }: { m: MasterProject; L: LFn; lang: 'en' | 'ar'; open: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  const list = masterScenarios(m.board);
  const reports = MASTER_REPORTS[m.id] ?? [];
  const run = async (ids: string[]) => {
    setBusy(ids.length > 1 ? 'all' : ids[0]);
    const out = await runList(m, ids, lang, open);
    const prev = (MASTER_REPORTS[m.id] ?? []).filter((r) => !out.some((o) => o.id === r.id));
    MASTER_REPORTS[m.id] = [...prev, ...out].sort((a, b) => list.findIndex((s) => `${m.id}-${s.id}` === a.id) - list.findIndex((s) => `${m.id}-${s.id}` === b.id));
    setBusy(null);
    tick((n) => n + 1);
  };
  const passed = reports.filter((r) => r.status === 'PASS').length;
  return (
    <div data-testid="master-tests">
      <p className="muted small">
        {open
          ? L(['The scenarios run YOUR open project (your code and wiring) on the real runtime, 3× faster than real time. Any change a scenario makes (a fault, a removed wire) is undone afterwards.', 'تشغّل السيناريوهات مشروعك المفتوح (كودك وتوصيلاتك) على بيئة التشغيل الحقيقية، أسرع 3 مرات من الزمن الحقيقي. أي تغيير يجريه السيناريو (عطل أو سلك محذوف) يُلغى بعد ذلك.'])
          : L(['The scenarios run the reference project on the real runtime (Pyodide, MicroPython or wb-rules), 3× faster than real time. Open the project to test your own version.', 'تشغّل السيناريوهات المشروع المرجعي على بيئة التشغيل الحقيقية (Pyodide أو MicroPython أو wb-rules)، أسرع 3 مرات من الزمن الحقيقي. افتح المشروع لاختبار نسختك.'])}
      </p>
      <div className="row">
        <button className="primary" disabled={!!busy} onClick={() => void run(list.map((s) => s.id))} data-testid="master-run-all">
          {busy === 'all' ? L(['Running…', 'جارٍ التشغيل…']) : L(['Run all 10 scenarios', 'شغّل السيناريوهات العشرة'])}
        </button>
        {reports.length > 0 && (
          <span className="chip" data-testid="master-score">
            {passed} / {reports.length} {L(['passed', 'نجح'])}
          </span>
        )}
      </div>
      <table className="data-table">
        <tbody>
          {list.map((s) => {
            const r = reports.find((x) => x.id === `${m.id}-${s.id}`);
            return (
              <tr key={s.id} data-scenario-row={s.id}>
                <td>{r ? (r.status === 'PASS' ? '✅' : '❌') : '○'}</td>
                <td>
                  <b>{L(s.name)}</b>
                  <div className="small">{L(s.does)}</div>
                  <div className="small muted">
                    {L(['Expected', 'المتوقع'])}: {L(s.expected)}
                  </div>
                </td>
                <td>
                  <button disabled={!!busy} onClick={() => void run([s.id])} data-testid={`master-run-${s.id}`}>
                    {busy === s.id ? '…' : '▶'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {reports.length > 0 && <ReportList reports={reports} L={L} />}
    </div>
  );
}

// ---------------------------------------------------------------- code recall
const RECALL_ORIGINAL: Record<string, string> = {};

function Recall({ m, L, lang, open, onOpen }: { m: MasterProject; L: LFn; lang: 'en' | 'ar'; open: boolean; onOpen: () => Promise<void> }) {
  const doc = useApp((s) => s.doc);
  const [busy, setBusy] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, ScenarioReport[]>>({});
  const [show, setShow] = useState<string | null>(null);
  const file = doc.files.find((f) => f.name === m.file)?.content ?? '';
  const setFile = (content: string) => {
    const st = useApp.getState();
    st.setDoc({ ...st.doc, files: st.doc.files.map((f) => (f.name === m.file ? { ...f, content } : f)) });
  };
  if (!open)
    return (
      <div data-testid="master-recall">
        <p>{L(['Code Recall works on your open copy of the project: a part of the program is hidden, you write it again in the editor, and the check runs the scenarios of that part on the real runtime — it judges what your code DOES, not how it is written.', 'يعمل استرجاع الكود على نسختك المفتوحة من المشروع: يُخفى جزء من البرنامج، فتكتبه من جديد في المحرر، ثم يشغّل الفحص سيناريوهات هذا الجزء على بيئة التشغيل الحقيقية — فهو يحكم على ما يفعله كودك وليس على طريقة كتابته.'])}</p>
        <button className="primary" onClick={() => void onOpen()} data-testid="recall-open">
          {L(['Open the project first', 'افتح المشروع أولاً'])}
        </button>
      </div>
    );
  return (
    <div data-testid="master-recall">
      <p className="muted small">{L(['1) Hide a part. 2) Write it in the Code tab (file {f}). 3) Check by behaviour. 4) Show the original if you need it.', '1) أخفِ جزءاً. 2) اكتبه في تبويب الكود (الملف {f}). 3) افحص بالسلوك. 4) اعرض الحل الأصلي عند الحاجة.']).replace('{f}', m.file)}</p>
      {m.recall.map((r) => {
        const key = `${m.id}:${r.marker}`;
        const cur = markerRange(file, r.marker, m.board);
        const orig = markerRange(m.code, r.marker, m.board)!;
        const hidden = !!cur && cur.body !== orig.body;
        const rep = reports[r.marker];
        return (
          <div key={r.marker} className="issue" data-recall={r.marker}>
            <div className="issue-title">
              🧠 {L(r.title)} {hidden && <span className="badge">{L(['hidden / rewritten', 'مخفي / أُعيدت كتابته'])}</span>}
            </div>
            <div className="issue-explain">
              {L(['Hint', 'تلميح'])}: {L(r.hint)}
              <br />
              {L(['Checked with', 'يُفحص بالسيناريوهات'])}: {r.scenarios.map((id) => L(masterScenarios(m.board).find((s) => s.id === id)!.name)).join(' · ')}
            </div>
            {!cur && <p className="muted small">{L(['The markers of this part were removed from the file; reopen the project to restore them.', 'حُذفت علامات هذا الجزء من الملف؛ أعد فتح المشروع لاستعادتها.'])}</p>}
            <div className="row">
              <button
                disabled={!cur || hidden}
                onClick={() => {
                  RECALL_ORIGINAL[key] = cur!.body;
                  setFile(replaceMarked(file, r.marker, m.board, recallPlaceholder(m.code, r.marker, m.board)));
                  useApp.getState().setTab('python');
                }}
                data-testid={`recall-hide-${r.marker}`}
              >
                🙈 {L(['Hide Code — write it from memory', 'أخفِ الكود — اكتبه من ذاكرتك'])}
              </button>
              <button
                disabled={!cur || !!busy}
                onClick={async () => {
                  setBusy(r.marker);
                  const out = await runList(m, r.scenarios, lang, true);
                  setReports((x) => ({ ...x, [r.marker]: out }));
                  setBusy(null);
                }}
                data-testid={`recall-check-${r.marker}`}
              >
                {busy === r.marker ? L(['Checking…', 'جارٍ الفحص…']) : `✔ ${L(['Check by behaviour', 'افحص بالسلوك'])}`}
              </button>
              <button onClick={() => setShow(show === r.marker ? null : r.marker)} data-testid={`recall-show-${r.marker}`}>
                👁 {L(['Show the original solution', 'اعرض الحل الأصلي'])}
              </button>
              {hidden && (
                <button onClick={() => setFile(replaceMarked(file, r.marker, m.board, orig.body))} data-testid={`recall-restore-${r.marker}`}>
                  ↩ {L(['Put the original back', 'أعد الحل الأصلي'])}
                </button>
              )}
            </div>
            {show === r.marker && (
              <pre className="code-view" dir="ltr">
                {orig.body}
              </pre>
            )}
            {rep && (
              <>
                <p className={rep.every((x) => x.status === 'PASS') ? 'ok' : 'bad'} data-testid={`recall-result-${r.marker}`}>
                  {rep.every((x) => x.status === 'PASS') ? L(['✅ Your code behaves like the reference.', '✅ كودك يتصرف مثل الحل المرجعي.']) : L(['❌ The behaviour differs — read the scenario result below.', '❌ السلوك مختلف — اقرأ نتيجة السيناريو أدناه.'])}
                </p>
                <ReportList reports={rep} L={L} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- exercises / compare / hardware
function Exercises({ m, L }: { m: MasterProject; L: LFn }) {
  return (
    <ol data-testid="master-exercises">
      {m.exercises.map((x, i) => (
        <li key={i}>
          <b>{L(x.title)}</b>
          <p>{L(x.steps)}</p>
          <p className="muted">
            {L(['What you should see', 'ما يجب أن تلاحظه'])}: {L(x.observe)}
          </p>
          <details>
            <summary>{L(['Show the change', 'اعرض التعديل'])}</summary>
            <pre className="code-view" dir="ltr">
              {x.answer}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function Compare({ L }: { L: LFn }) {
  const rows = useMemo(() => comparison(), []);
  return (
    <div data-testid="master-compare">
      <p>{L(['The logic is the same on the three controllers — the tools differ. Every code cell is a real line of the three programs.', 'المنطق واحد في المتحكمات الثلاثة — الأدوات تختلف. كل خلية كود هي سطر حقيقي من البرامج الثلاثة.'])}</p>
      <table className="data-table master-compare">
        <thead>
          <tr>
            <th />
            {MASTER_PROJECTS.map((p) => (
              <th key={p.id}>{p.controller}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key[0]}>
              <th>{L(r.key)}</th>
              {MASTER_PROJECTS.map((p) => (
                <td key={p.id}>
                  {L(r.cells[p.board].text)}
                  {r.cells[p.board].code && (
                    <pre className="code-view" dir="ltr">
                      {r.cells[p.board].code}
                    </pre>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Hardware({ m, L }: { m: MasterProject; L: LFn }) {
  return (
    <div data-testid="master-hardware">
      <h2>{L(['Building it on real hardware', 'بناء المشروع على العتاد الحقيقي'])}</h2>
      <ol>
        {m.hardware.map((h, i) => (
          <li key={i}>{L(h)}</li>
        ))}
      </ol>
      <h2>{L(['Libraries and tools', 'المكتبات والأدوات'])}</h2>
      <ul>
        {m.libraries.map((l) => (
          <li key={l.name}>
            <b dir="ltr">{l.name}</b> — <code dir="ltr">{l.install}</code>
          </li>
        ))}
      </ul>
      <h2>{L(['Simulation vs. real device', 'المحاكاة مقابل الجهاز الحقيقي'])}</h2>
      <ul>
        {m.differences.map((d, i) => (
          <li key={i}>{L(d)}</li>
        ))}
      </ul>
      <p className="muted small">{L(['These projects are training references. They do not prove which equipment the final uses, and they do not cover every competition module.', 'هذه المشاريع مراجع تدريبية. لا تثبت المعدات التي ستُستخدم في النهائي، ولا تغطي كل الوحدات التنافسية.'])}</p>
    </div>
  );
}

// ---------------------------------------------------------------- PDFs
function ExportPanel({ m, L, lang }: { m: MasterProject; L: LFn; lang: 'en' | 'ar' }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async (what: 'study' | 'cheat' | 'compare') => {
    setBusy(what);
    setErr(null);
    try {
      const pdf = await import('../../export/studyPdf');
      const r = what === 'study' ? await pdf.masterStudyPdf(m, lang, MASTER_REPORTS[m.id] ?? []) : what === 'cheat' ? await pdf.masterCheatSheetPdf(m, lang) : await pdf.masterComparisonPdf(lang);
      pdf.downloadPdf(r.pdf, r.name);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
    setBusy(null);
  };
  const tested = (MASTER_REPORTS[m.id] ?? []).length;
  return (
    <div data-testid="master-export">
      <p>{L(['Printable A4 files to study away from the site.', 'ملفات A4 قابلة للطباعة للدراسة بعيداً عن الموقع.'])}</p>
      <p className="muted small">
        {tested
          ? L(['The study file includes the results of the {n} scenarios you ran in this session.', 'يتضمن ملف الدراسة نتائج {n} سيناريو شغّلتها في هذه الجلسة.']).replace('{n}', String(tested))
          : L(['Run the 10 scenarios first (tab "10 test scenarios") so the study file contains their results; otherwise it lists them as not run.', 'شغّل السيناريوهات العشرة أولاً (تبويب "سيناريوهات الاختبار العشرة") ليحتوي ملف الدراسة نتائجها؛ وإلا تُذكر على أنها لم تُشغَّل.'])}
      </p>
      <div className="row">
        <button className="primary" disabled={!!busy} onClick={() => void save('study')} data-testid="pdf-study">
          {busy === 'study' ? '…' : `📘 ${L(['Complete study file (PDF)', 'ملف الدراسة الكامل (PDF)'])}`}
        </button>
        <button disabled={!!busy} onClick={() => void save('cheat')} data-testid="pdf-cheat">
          {busy === 'cheat' ? '…' : `📝 ${L(['Cheat sheet (PDF)', 'ورقة المراجعة (PDF)'])}`}
        </button>
        <button disabled={!!busy} onClick={() => void save('compare')} data-testid="pdf-compare">
          {busy === 'compare' ? '…' : `⚖ ${L(['Comparison of the 3 controllers (PDF)', 'مقارنة المتحكمات الثلاثة (PDF)'])}`}
        </button>
      </div>
      {err && <p className="bad">{err}</p>}
    </div>
  );
}
