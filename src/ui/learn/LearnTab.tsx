import { useState } from 'react';
import { EXAMPLES, type Example } from '../../examples';
import { uid } from '../../engine/project';
import { useApp } from '../../state/store';
import { saveNow } from '../../state/engine';
import { runScenario, type ScenarioReport } from '../../tests/host';
import { useT } from '../../i18n';
import { Docs } from './Docs';

const LEVELS: Example['level'][] = ['beginner', 'intermediate', 'advanced', 'competition'];

export async function openExample(ex: Example) {
  await saveNow();
  const d = ex.build();
  d.id = uid('p');
  d.createdAt = d.updatedAt = Date.now();
  useApp.getState().loadProject(d);
  useApp.setState({ dirty: true });
  await saveNow();
  useApp.getState().setTab('circuit');
}

export default function LearnTab() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const current = useApp((s) => s.doc.exampleId);
  const [sel, setSel] = useState<string>(current ?? EXAMPLES[0].id);
  const [result, setResult] = useState<Record<string, ScenarioReport[]>>({});
  const [busy, setBusy] = useState(false);
  const ex = EXAMPLES.find((e) => e.id === sel) ?? EXAMPLES[0];
  const L = (b: { en: string; ar: string }) => (lang === 'ar' ? b.ar : b.en);

  const check = async () => {
    setBusy(true);
    const keep = useApp.getState().doc.exampleId === ex.id;
    const original = structuredClone(useApp.getState().doc);
    const reports: ScenarioReport[] = [];
    for (const s of ex.checks) reports.push(await runScenario(s, 1, keep));
    if (!keep) useApp.getState().loadProject(original);
    setResult({ ...result, [ex.id]: reports });
    setBusy(false);
  };

  return (
    <div className="learn-tab">
      <aside className="learn-list">
        <button className={`learn-item ${sel === '__docs' ? 'on' : ''}`} onClick={() => setSel('__docs')} data-testid="docs-link" style={{ marginTop: 8 }}>
          📖 {t('Python & hardware reference')}
        </button>
        {LEVELS.map((lv) => (
          <div key={lv}>
            <div className="panel-title sub">{t(lv)}</div>
            {EXAMPLES.filter((e) => e.level === lv).map((e) => (
              <button key={e.id} className={`learn-item ${e.id === sel ? 'on' : ''}`} onClick={() => setSel(e.id)} data-testid={`example-${e.n}`}>
                <span className="num">{e.n}</span> {L(e.title)}
                {e.id === current && <span className="badge">{t('open')}</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>
      {sel === '__docs' ? (
        <Docs />
      ) : (
      <article className="page learn-detail">
        <h1>
          {ex.n}. {L(ex.title)}
        </h1>
        <p>
          <b>{t('Learning objective')}:</b> {L(ex.objective)}
        </p>
        <div className="row">
          <button className="primary" onClick={() => void openExample(ex)} data-testid="open-example">
            {t('Open this example')}
          </button>
          <button onClick={() => void check()} disabled={busy} data-testid="check-example">
            {busy ? t('Checking…') : current === ex.id ? t('Check my project') : t('Run automated check')}
          </button>
        </div>
        {result[ex.id]?.map((r) => (
          <div key={r.id} className={`issue ${r.status === 'PASS' ? '' : 'issue-error'}`} data-check={r.status}>
            <div className="issue-title">
              {r.status === 'PASS' ? '✅' : '❌'} {r.name} — {r.status}
            </div>
            <div className="issue-explain" dir="ltr">
              {t('Expected')}: {r.expected}
              <br />
              {t('Actual')}: {r.actual} {r.error}
            </div>
          </div>
        ))}
        <h2>{t('Components')}</h2>
        <ul>
          {ex.parts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <h2>{t('Expected result')}</h2>
        <p>{L(ex.expected)}</p>
        <h2>{t('How to run')}</h2>
        <p>{L(ex.instructions)}</p>
        <h2>{t('Break it and fix it')}</h2>
        <ul>
          {ex.breakIt.map((b, i) => (
            <li key={i}>{L(b)}</li>
          ))}
        </ul>
        <h2>{t('Code')}</h2>
        {ex.build().files.map((f) => (
          <details key={f.name} open={f.name === 'main.py'}>
            <summary dir="ltr">{f.name}</summary>
            <pre className="code-view" dir="ltr">
              {f.content}
            </pre>
          </details>
        ))}
      </article>
      )}
    </div>
  );
}
