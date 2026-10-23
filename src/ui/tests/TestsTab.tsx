import { useState } from 'react';
import { ACCEPTANCE } from '../../tests/acceptance';
import { runScenario, type ScenarioReport } from '../../tests/host';
import { useApp } from '../../state/store';
import { saveNow } from '../../state/engine';
import { download } from '../../state/persist';
import { useT } from '../../i18n';

export function reportMarkdown(rows: ScenarioReport[], title: string) {
  const lines = [`# ${title}`, '', `Run: ${new Date().toISOString()} · ${location.origin} · ${navigator.userAgent}`, '', '| Test | Status | Expected | Actual | Error |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.id} ${r.name} | ${r.status} | ${r.expected} | ${r.actual.replace(/\|/g, '/')} | ${r.error ?? ''} |`);
  lines.push('', `Passed ${rows.filter((r) => r.status === 'PASS').length}/${rows.length}`);
  return lines.join('\n');
}

export default function TestsTab() {
  const t = useT();
  const [rows, setRows] = useState<Record<string, ScenarioReport>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const runSome = async (ids: string[]) => {
    const original = structuredClone(useApp.getState().doc);
    await saveNow();
    try {
      for (const id of ids) {
        const s = ACCEPTANCE.find((x) => x.id === id)!;
        setBusy(id);
        const r = await runScenario(s, 1);
        setRows((prev) => ({ ...prev, [id]: r }));
      }
    } finally {
      setBusy(null);
      useApp.getState().loadProject(original);
    }
  };

  const list = ACCEPTANCE.map((s) => rows[s.id]).filter(Boolean) as ScenarioReport[];
  const passed = list.filter((r) => r.status === 'PASS').length;
  return (
    <div className="page" data-testid="tests-tab">
      <h1>✅ {t('Automated acceptance tests')}</h1>
      <p className="muted">
        {t('Each test loads a test circuit, runs real Python in the browser and checks the simulated hardware. Your current project is saved first and restored afterwards.')}
      </p>
      <div className="row">
        <button className="primary" disabled={!!busy} onClick={() => void runSome(ACCEPTANCE.map((s) => s.id))} data-testid="run-all-tests">
          ▶ {t('Run all 15 tests')}
        </button>
        {busy && <span className="pill warn">{t('Running')} {busy}…</span>}
        {list.length > 0 && (
          <>
            <span className={`pill ${passed === ACCEPTANCE.length ? 'ok' : 'warn'}`} data-testid="tests-summary">
              {passed}/{list.length} PASS
            </span>
            <button onClick={() => download(new Blob([reportMarkdown(list, 'Acceptance test report')], { type: 'text/markdown' }), 'acceptance-report.md')}>{t('Download report (.md)')}</button>
            <button onClick={() => download(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), 'acceptance-report.json')}>{t('Download report (.json)')}</button>
          </>
        )}
      </div>
      <table className="data-table report" data-testid="tests-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('Test')}</th>
            <th>{t('Status')}</th>
            <th>{t('Expected behaviour')}</th>
            <th>{t('Actual behaviour')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ACCEPTANCE.map((s) => {
            const r = rows[s.id];
            return (
              <tr key={s.id} data-test-id={s.id} data-status={r?.status ?? 'NOT RUN'}>
                <td>{s.id}</td>
                <td>{s.name}</td>
                <td>
                  <span className={`pill ${r ? (r.status === 'PASS' ? 'ok' : 'err') : ''}`}>{busy === s.id ? '…' : r?.status ?? t('not run')}</span>
                </td>
                <td className="small">{s.expected}</td>
                <td className="small" dir="ltr">
                  {r?.actual}
                  {r?.error && <div className="t-err">{r.error}</div>}
                  {r && <div className="muted">{(r.durationMs / 1000).toFixed(1)} s</div>}
                </td>
                <td>
                  <button disabled={!!busy} onClick={() => void runSome([s.id])}>
                    ▶
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {t('Test 15 only passes when run on the published HTTPS site — open the production URL and press "Run all" there to verify the deployment. Passing these simulator tests does not guarantee competition scores.')}
      </p>
    </div>
  );
}
